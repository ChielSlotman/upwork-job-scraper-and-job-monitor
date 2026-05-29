import { calculateRelevanceScore, findMatchedKeywords } from './scoring.js';
import {
  compactText,
  normalizeWhitespace,
  stableHash,
  textLines,
  toNumber,
  truncateText,
  uniqueStrings,
} from './text.js';

export const UPWORK_SEARCH_URL = 'https://www.upwork.com/nx/search/jobs/';
export const DEFAULT_PROXY_CONFIGURATION = {
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
};

const SEARCH_SCROLL_ATTEMPTS = 8;
const COMMON_NON_SKILL_LINES = new Set([
  'hourly',
  'fixed-price',
  'fixed price',
  'entry level',
  'intermediate',
  'expert',
  'search',
  'jobs',
  'talent',
  'advanced search',
  'category',
  'experience level',
  'job type',
  'client history',
  'client location',
  'sort by',
]);

export function normalizeInput(input = {}) {
  const keywords = uniqueStrings(input.keywords || [])
    .map((keyword) => keyword.slice(0, 120))
    .filter(Boolean);

  if (!keywords.length) {
    throw new Error('Input must contain at least one keyword.');
  }

  const minBudget = input.minBudget === undefined || input.minBudget === null || input.minBudget === ''
    ? null
    : Number(input.minBudget);
  const maxBudget = input.maxBudget === undefined || input.maxBudget === null || input.maxBudget === ''
    ? null
    : Number(input.maxBudget);

  if (minBudget !== null && maxBudget !== null && minBudget > maxBudget) {
    throw new Error('minBudget cannot be greater than maxBudget.');
  }

  return {
    keywords,
    maxResults: clampInteger(input.maxResults, 50, 1, 1000),
    minBudget: Number.isFinite(minBudget) ? minBudget : null,
    maxBudget: Number.isFinite(maxBudget) ? maxBudget : null,
    jobType: ['fixed', 'hourly', 'both'].includes(input.jobType) ? input.jobType : 'both',
    experienceLevel: ['entry', 'intermediate', 'expert', 'all'].includes(input.experienceLevel)
      ? input.experienceLevel
      : 'all',
    postedWithin: ['last24h', 'last7d', 'all'].includes(input.postedWithin) ? input.postedWithin : 'all',
    includeDescription: Boolean(input.includeDescription),
    includeSkills: input.includeSkills !== false,
    deduplicateResults: input.deduplicateResults !== false,
    proxyConfiguration: normalizeProxyConfiguration(input.proxyConfiguration),
    maxConcurrency: clampInteger(input.maxConcurrency, 1, 1, 3),
    requestTimeoutSecs: clampInteger(input.requestTimeoutSecs, 60, 15, 180),
    saveDebugHtml: Boolean(input.saveDebugHtml),
  };
}

function normalizeProxyConfiguration(proxyConfiguration) {
  if (proxyConfiguration?.useApifyProxy === false || proxyConfiguration?.proxyUrls?.length) {
    return proxyConfiguration;
  }

  const normalized = {
    ...DEFAULT_PROXY_CONFIGURATION,
    ...(proxyConfiguration || {}),
    useApifyProxy: true,
  };

  const selectedGroups = normalized.groups?.length
    ? normalized.groups
    : normalized.apifyProxyGroups;

  normalized.apifyProxyGroups = selectedGroups?.length
    ? selectedGroups
    : DEFAULT_PROXY_CONFIGURATION.apifyProxyGroups;

  return normalized;
}

export function buildSearchUrl(keyword) {
  const url = new URL(UPWORK_SEARCH_URL);
  url.searchParams.set('q', keyword);
  url.searchParams.set('sort', 'recency');
  return url.toString();
}

export function extractJobIdFromUrl(jobUrl) {
  if (!jobUrl) return null;

  const decoded = decodeURIComponent(jobUrl);
  const patterns = [
    /\/jobs\/(?:[^/?#]*_)?(~[A-Za-z0-9]+)/,
    /[?&]jobId=([A-Za-z0-9~]+)/,
    /_(~[A-Za-z0-9]+)(?:[/?#]|$)/,
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1].startsWith('~') ? match[1] : `~${match[1]}`;
  }

  return null;
}

export function parseRelativePostedAt(value, now = new Date()) {
  const text = compactText(value).replace(/^Posted\s+/i, '');
  const lower = text.toLowerCase();

  if (!lower) return { postedAt: null, ageHours: null, postedText: null };

  let ageHours = null;

  if (/just now|moments? ago/.test(lower)) ageHours = 0;
  else if (/yesterday/.test(lower)) ageHours = 24;
  else {
    const match = lower.match(/(\d+(?:\.\d+)?)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago/);
    if (match) {
      const amount = Number(match[1]);
      const unit = match[2];
      const multipliers = {
        minute: 1 / 60,
        minutes: 1 / 60,
        hour: 1,
        hours: 1,
        day: 24,
        days: 24,
        week: 168,
        weeks: 168,
        month: 730,
        months: 730,
      };
      ageHours = amount * multipliers[unit];
    }
  }

  if (!Number.isFinite(ageHours)) {
    const absolute = Date.parse(text);
    if (Number.isFinite(absolute)) {
      ageHours = Math.max(0, (now.getTime() - absolute) / 36e5);
    }
  }

  if (!Number.isFinite(ageHours)) {
    return { postedAt: null, ageHours: null, postedText: compactText(value) };
  }

  return {
    postedAt: new Date(now.getTime() - (ageHours * 36e5)).toISOString(),
    ageHours,
    postedText: compactText(value),
  };
}

export function parseJobCard(rawJob, keyword, options = {}) {
  const rawText = normalizeWhitespace(rawJob.text || '');
  const lines = textLines(rawText);
  const postedLine = lines.find((line) => /^Posted\b/i.test(line));
  const parsedPosted = parseRelativePostedAt(postedLine || rawJob.postedText, options.now || new Date());
  const sourceSearchKeyword = compactText(keyword);

  const jobUrl = normalizeJobUrl(rawJob.jobUrl);
  const titleFromText = inferTitleFromLines(lines, postedLine);
  const jobTitle = compactText(rawJob.jobTitle || titleFromText) || null;
  const budget = parseBudget(rawText);
  const estimated = parseEstimatedTime(rawText);
  const client = parseClientFields(rawText);
  const proposalsCount = parseProposalsCount(rawText);
  const experienceLevel = parseExperienceLevel(rawText);
  const descriptionSnippet = truncateText(rawJob.descriptionSnippet || inferDescriptionSnippet(lines, jobTitle), 700);
  const skills = uniqueStrings([...(rawJob.skills || []), ...inferSkillLines(lines, jobTitle, descriptionSnippet)])
    .slice(0, 30);

  return {
    jobTitle,
    jobUrl,
    jobId: extractJobIdFromUrl(jobUrl),
    postedAt: parsedPosted.postedAt || parsedPosted.postedText,
    scrapedAt: options.scrapedAt || new Date().toISOString(),
    jobType: budget.jobType,
    fixedBudget: budget.fixedBudget,
    hourlyMin: budget.hourlyMin,
    hourlyMax: budget.hourlyMax,
    experienceLevel,
    estimatedDuration: estimated.estimatedDuration,
    workload: estimated.workload,
    skills,
    descriptionSnippet,
    fullDescription: rawJob.fullDescription ? compactText(rawJob.fullDescription) : null,
    clientCountry: client.clientCountry,
    clientRating: client.clientRating,
    clientSpent: client.clientSpent,
    proposalsCount,
    sourceSearchKeyword,
    matchedKeywords: [],
    relevanceScore: 0,
    _rawText: rawText,
    _ageHours: parsedPosted.ageHours,
  };
}

export function finalizeJob(job, input) {
  const output = {
    jobTitle: job.jobTitle ?? null,
    jobUrl: job.jobUrl ?? null,
    jobId: job.jobId ?? null,
    postedAt: job.postedAt ?? null,
    scrapedAt: job.scrapedAt ?? new Date().toISOString(),
    jobType: job.jobType ?? null,
    fixedBudget: job.fixedBudget ?? null,
    hourlyMin: job.hourlyMin ?? null,
    hourlyMax: job.hourlyMax ?? null,
    experienceLevel: job.experienceLevel ?? null,
    estimatedDuration: job.estimatedDuration ?? null,
    workload: job.workload ?? null,
    skills: input.includeSkills ? uniqueStrings(job.skills || []) : [],
    descriptionSnippet: job.descriptionSnippet ?? null,
    fullDescription: input.includeDescription ? (job.fullDescription ?? null) : null,
    clientCountry: job.clientCountry ?? null,
    clientRating: job.clientRating ?? null,
    clientSpent: job.clientSpent ?? null,
    proposalsCount: job.proposalsCount ?? null,
    sourceSearchKeyword: job.sourceSearchKeyword,
    matchedKeywords: [],
    relevanceScore: 0,
  };

  output.matchedKeywords = findMatchedKeywords(output, input.keywords);
  if (!output.matchedKeywords.length && output.sourceSearchKeyword) {
    output.matchedKeywords = [output.sourceSearchKeyword];
  }
  output.relevanceScore = calculateRelevanceScore(output, input);

  return output;
}

export function jobMatchesFilters(job, input) {
  if (input.jobType !== 'both' && job.jobType && job.jobType !== input.jobType) return false;
  if (input.experienceLevel !== 'all' && job.experienceLevel && job.experienceLevel !== input.experienceLevel) return false;

  if (job.jobType === 'fixed' && input.minBudget !== null && job.fixedBudget !== null && job.fixedBudget < input.minBudget) {
    return false;
  }

  if (job.jobType === 'fixed' && input.maxBudget !== null && job.fixedBudget !== null && job.fixedBudget > input.maxBudget) {
    return false;
  }

  if (input.postedWithin !== 'all' && Number.isFinite(job._ageHours)) {
    const maxAgeHours = input.postedWithin === 'last24h' ? 24 : 168;
    if (job._ageHours > maxAgeHours) return false;
  }

  return true;
}

export function jobDedupeKey(job) {
  return job.jobId || job.jobUrl || `${compactText(job.jobTitle).toLowerCase()}-${stableHash(job.descriptionSnippet)}`;
}

export async function detectUpworkChallenge(page) {
  const title = await page.title().catch(() => '');
  if (/challenge\s*-\s*upwork/i.test(title)) return true;

  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return /challenge\s*-\s*upwork|verify you are human|access denied/i.test(bodyText);
}

export async function extractJobsFromSearchPage(page, keyword, options = {}) {
  const rawJobs = await extractRawJobsFromDom(page);

  if (!rawJobs.length) {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    return extractJobsFromSearchText(bodyText, keyword, options);
  }

  return rawJobs
    .map((rawJob) => parseJobCard(rawJob, keyword, options))
    .filter((job) => job.jobTitle || job.jobUrl);
}

export async function extractJobDetailsFromPage(page, options = {}) {
  const rawDetails = await page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const textOf = (selector) => {
      const nodes = [...document.querySelectorAll(selector)];
      return nodes
        .map((node) => clean(node.innerText || node.textContent || ''))
        .filter((text) => text.length > 40)
        .sort((a, b) => b.length - a.length)[0] || '';
    };
    const skillSelectors = [
      '[data-test="Skill"]',
      '[data-test="skill"]',
      '[data-test*="skill" i]',
      '.up-skill-badge',
      '.air3-token',
      'a[href*="/freelance-jobs/"]',
    ];
    const skills = [...new Set(skillSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]
      .map((node) => clean(node.innerText || node.textContent || ''))
      .filter((text) => text && text.length <= 60)))];

    return {
      text: document.body?.innerText || '',
      jobTitle: clean(document.querySelector('h1')?.innerText || ''),
      fullDescription: textOf([
        '[data-test="job-description"]',
        '[data-test="Description"]',
        '[data-test="description"]',
        '[data-test*="description" i]',
        '.job-description',
      ].join(',')),
      skills,
    };
  });

  const parsed = parseJobCard(rawDetails, options.keyword || '', {
    now: options.now,
    scrapedAt: options.scrapedAt,
  });

  return {
    jobTitle: rawDetails.jobTitle || parsed.jobTitle,
    fullDescription: rawDetails.fullDescription || parsed.descriptionSnippet,
    skills: uniqueStrings([...(rawDetails.skills || []), ...(parsed.skills || [])]),
    clientCountry: parsed.clientCountry,
    clientRating: parsed.clientRating,
    clientSpent: parsed.clientSpent,
    proposalsCount: parsed.proposalsCount,
    fixedBudget: parsed.fixedBudget,
    hourlyMin: parsed.hourlyMin,
    hourlyMax: parsed.hourlyMax,
    jobType: parsed.jobType,
    experienceLevel: parsed.experienceLevel,
    estimatedDuration: parsed.estimatedDuration,
    workload: parsed.workload,
  };
}

export async function scrollSearchResults(page, expectedCount) {
  let lastHeight = 0;

  for (let attempt = 0; attempt < SEARCH_SCROLL_ATTEMPTS; attempt += 1) {
    const currentCount = await countVisibleJobLinks(page);
    if (currentCount >= expectedCount) break;

    await clickLoadMoreIfPresent(page);
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1200);

    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
    if (height === lastHeight && currentCount > 0) break;
    lastHeight = height;
  }
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeJobUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value, 'https://www.upwork.com');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function inferTitleFromLines(lines, postedLine) {
  const postedIndex = postedLine ? lines.indexOf(postedLine) : -1;
  const candidates = postedIndex >= 0 ? lines.slice(postedIndex + 1) : lines;

  return candidates.find((line) => {
    if (line.length < 6 || line.length > 180) return false;
    if (/^(Hourly|Fixed|Entry Level|Intermediate|Expert|Est\. time|Proposals|Payment verified)/i.test(line)) return false;
    return true;
  }) || null;
}

function parseBudget(text) {
  const hourlyMatch = text.match(/Hourly\s*:?\s*\$?([\d,.]+)\s*(?:-|to)\s*\$?([\d,.]+)/i);
  if (hourlyMatch) {
    return {
      jobType: 'hourly',
      fixedBudget: null,
      hourlyMin: toNumber(hourlyMatch[1]),
      hourlyMax: toNumber(hourlyMatch[2]),
    };
  }

  if (/\bHourly\b/i.test(text)) {
    return {
      jobType: 'hourly',
      fixedBudget: null,
      hourlyMin: null,
      hourlyMax: null,
    };
  }

  const fixedMatch = text.match(/(?:Fixed(?:-price)?|Budget|Est\.\s*Budget)\s*:?\s*\$?([\d,.]+)/i);
  if (fixedMatch) {
    return {
      jobType: 'fixed',
      fixedBudget: toNumber(fixedMatch[1]),
      hourlyMin: null,
      hourlyMax: null,
    };
  }

  if (/\bFixed(?:-price)?\b/i.test(text)) {
    return {
      jobType: 'fixed',
      fixedBudget: null,
      hourlyMin: null,
      hourlyMax: null,
    };
  }

  return {
    jobType: null,
    fixedBudget: null,
    hourlyMin: null,
    hourlyMax: null,
  };
}

function parseEstimatedTime(text) {
  const match = text.match(/Est\.\s*time\s*:?\s*([^\n,]+)(?:,\s*([^\n]+?hrs\/week))?/i);

  return {
    estimatedDuration: match?.[1] ? compactText(match[1]) : null,
    workload: match?.[2] ? compactText(match[2]) : null,
  };
}

function parseExperienceLevel(text) {
  if (/\bEntry\s+Level\b/i.test(text)) return 'entry';
  if (/\bIntermediate\b/i.test(text)) return 'intermediate';
  if (/\bExpert\b/i.test(text)) return 'expert';
  return null;
}

function parseClientFields(text) {
  const ratingMatch = text.match(/(?:Rating|Rated)?\s*(\d(?:\.\d)?)\s*(?:out of|\/)\s*5/i)
    || text.match(/\b(\d\.\d)\b(?=\s*(?:stars?|rating))/i);
  const spentMatch = text.match(/\$[\d,.]+\s*[KkMm]?\+?\s+spent/i);
  const countryMatch = text.match(/Client\s+(?:location|country)\s*:?\s*([A-Za-z][A-Za-z .'-]{2,60})/i)
    || text.match(/Location\s*:?\s*([A-Za-z][A-Za-z .'-]{2,60})/i);

  return {
    clientCountry: countryMatch?.[1] ? compactText(countryMatch[1]) : null,
    clientRating: ratingMatch?.[1] ? toNumber(ratingMatch[1]) : null,
    clientSpent: spentMatch?.[0] ? compactText(spentMatch[0]) : null,
  };
}

function parseProposalsCount(text) {
  const match = text.match(/Proposals?\s*:?\s*([^\n]+)/i)
    || text.match(/\b(Less than \d+|\d+\s*(?:to|-)\s*\d+|\d+\+?)\s+proposals?\b/i);

  return match?.[1] ? compactText(match[1]) : null;
}

function inferDescriptionSnippet(lines, jobTitle) {
  const candidates = lines.filter((line) => {
    if (line === jobTitle) return false;
    if (line.length < 70) return false;
    if (/^(Posted|Hourly|Fixed|Entry Level|Intermediate|Expert|Est\. time|Proposals|Search category|Category|Experience level|Job type|Client history)/i.test(line)) {
      return false;
    }
    return true;
  });

  return candidates.sort((a, b) => b.length - a.length)[0] || null;
}

function inferSkillLines(lines, jobTitle, descriptionSnippet) {
  return lines.filter((line) => {
    const lower = line.toLowerCase();
    if (line === jobTitle || line === descriptionSnippet) return false;
    if (line.length < 2 || line.length > 55) return false;
    if (COMMON_NON_SKILL_LINES.has(lower)) return false;
    if (/^(Posted|Hourly|Fixed|Est\. time|Proposals|Less than|More than|\$|Search|Select|Custom USD|Minimum|Maximum|Client|Sort by|Tabs)$/i.test(line)) {
      return false;
    }
    if (/\d/.test(line) && !/[A-Za-z]/.test(line)) return false;
    if (/[.!?]{1,}$/.test(line) && line.split(/\s+/).length > 5) return false;
    return /^[A-Za-z0-9+#./&() -]+$/.test(line);
  });
}

async function extractRawJobsFromDom(page) {
  return page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const uniqueNodes = (nodes) => {
      const seen = new Set();
      return nodes.filter((node) => {
        if (!node || seen.has(node)) return false;
        seen.add(node);
        return true;
      });
    };
    const safeQueryAll = (selector) => {
      try {
        return [...document.querySelectorAll(selector)];
      } catch {
        return [];
      }
    };
    const candidateSelectors = [
      'section.job-tile',
      'article[data-test="JobTile"]',
      'section[data-test="job-tile"]',
      '[data-test="JobTile"]',
      '[data-test="job-tile"]',
      '[data-test*="job-tile" i]',
      'article:has(a[href*="/jobs/"])',
      'section:has(a[href*="/jobs/"])',
    ];
    const linkCandidates = [...document.querySelectorAll('a[href*="/jobs/"]')]
      .map((link) => link.closest('article, section, [data-test*="job" i], .job-tile') || link.closest('div'))
      .filter((node) => node && clean(node.innerText || '').length > 80);
    const nodes = uniqueNodes([...candidateSelectors.flatMap(safeQueryAll), ...linkCandidates]);
    const titleSelectors = [
      '[data-test="job-tile-title"] a',
      '[data-test*="job-title" i] a',
      '.job-tile-title a',
      'h2 a[href*="/jobs/"]',
      'h3 a[href*="/jobs/"]',
      'a[href*="/jobs/"]',
    ];
    const descriptionSelectors = [
      '[data-test="job-description-text"]',
      '[data-test="job-description"]',
      '[data-test*="description" i]',
      '.job-description',
      'p',
    ];
    const skillSelectors = [
      '[data-test="Skill"]',
      '[data-test="skill"]',
      '[data-test*="skill" i]',
      '.up-skill-badge',
      '.air3-token',
      'a[href*="/freelance-jobs/"]',
    ];

    return nodes.map((node) => {
      const titleLink = titleSelectors
        .map((selector) => node.querySelector(selector))
        .find(Boolean);
      const description = descriptionSelectors
        .map((selector) => node.querySelector(selector))
        .map((element) => clean(element?.innerText || element?.textContent || ''))
        .find((text) => text.length > 40) || '';
      const skills = skillSelectors.flatMap((selector) => [...node.querySelectorAll(selector)]
        .map((element) => clean(element.innerText || element.textContent || ''))
        .filter((text) => text && text.length <= 60));

      return {
        jobTitle: clean(titleLink?.innerText || titleLink?.textContent || ''),
        jobUrl: titleLink?.href || '',
        descriptionSnippet: description,
        skills: [...new Set(skills)],
        text: node.innerText || node.textContent || '',
      };
    }).filter((job) => {
      const hasJobLink = /\/jobs\//.test(job.jobUrl || job.text || '');
      const hasUsefulText = clean(job.text).length > 80;
      return hasJobLink && hasUsefulText;
    });
  });
}

function extractJobsFromSearchText(bodyText, keyword, options = {}) {
  const lines = textLines(bodyText);
  const postedIndexes = [];

  lines.forEach((line, index) => {
    if (/^Posted\b/i.test(line)) postedIndexes.push(index);
  });

  return postedIndexes.map((startIndex, position) => {
    const endIndex = postedIndexes[position + 1] || Math.min(lines.length, startIndex + 40);
    const block = lines.slice(startIndex, endIndex).join('\n');
    return parseJobCard({ text: block }, keyword, options);
  }).filter((job) => job.jobTitle);
}

async function countVisibleJobLinks(page) {
  return page.evaluate(() => document.querySelectorAll('a[href*="/jobs/"]').length).catch(() => 0);
}

async function clickLoadMoreIfPresent(page) {
  const labels = ['Load more', 'Show more', 'Next'];

  for (const label of labels) {
    const button = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }

    const link = page.getByRole('link', { name: new RegExp(label, 'i') }).first();
    if (await link.isVisible({ timeout: 500 }).catch(() => false)) {
      await link.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return true;
    }
  }

  return false;
}
