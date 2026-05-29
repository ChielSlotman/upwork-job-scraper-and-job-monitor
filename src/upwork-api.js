import {
  compactText,
  toNumber,
  truncateText,
  uniqueStrings,
} from './text.js';

export const UPWORK_GRAPHQL_ENDPOINT = 'https://api.upwork.com/graphql';
export const UPWORK_OAUTH_TOKEN_ENDPOINT = 'https://www.upwork.com/api/v3/oauth2/token';

const PUBLIC_JOB_SEARCH_QUERY = `
query PublicMarketplaceJobPostingsSearch($marketPlaceJobFilter: PublicMarketplaceJobPostingsSearchFilter!) {
  publicMarketplaceJobPostingsSearch(marketPlaceJobFilter: $marketPlaceJobFilter) {
    jobs {
      id
      title
      createdDateTime
      publishedDateTime
      jobTs
      type
      ciphertext
      description
      skills {
        name
        prettyName
      }
      ontologySkills {
        prefLabel
        freeText
      }
      engagement
      amount {
        rawValue
        currency
        displayValue
      }
      weeklyBudget {
        rawValue
        currency
        displayValue
      }
      recno
      contractorTier
      jobStatus
      category
      subcategory
      freelancersToHire
      enterpriseJob
      totalApplicants
      durationLabel
      duration
      hourlyBudgetType
      hourlyBudgetMin
      hourlyBudgetMax
      engagementDuration {
        label
      }
      client {
        totalHires
        totalPostedJobs
        totalReviews
        totalFeedback
        hasFinancialPrivacy
        location {
          country
          city
          timezone
        }
      }
    }
    paging {
      endCursor
      hasNextPage
    }
  }
}`;

export function hasUpworkApiCredentials(input = {}, env = process.env) {
  const credentials = resolveUpworkApiCredentials(input, env);
  return Boolean(credentials.accessToken || (credentials.clientId && credentials.clientSecret));
}

export function resolveUpworkApiCredentials(input = {}, env = process.env) {
  return {
    accessToken: firstText(input.upworkApiAccessToken, env.UPWORK_API_ACCESS_TOKEN),
    clientId: firstText(input.upworkApiClientId, env.UPWORK_API_CLIENT_ID),
    clientSecret: firstText(input.upworkApiClientSecret, env.UPWORK_API_CLIENT_SECRET),
    refreshToken: firstText(input.upworkApiRefreshToken, env.UPWORK_API_REFRESH_TOKEN),
    tenantId: firstText(input.upworkApiTenantId, env.UPWORK_API_TENANT_ID),
  };
}

export async function collectJobsFromOfficialApi(input, options = {}) {
  const log = options.log || console;
  const credentials = resolveUpworkApiCredentials(input, options.env || process.env);
  const accessToken = await getUpworkApiAccessToken(input, options);
  const pageSize = Math.min(50, Math.max(10, input.maxResults));
  const rawTarget = Math.min(Math.max(input.maxResults * 3, input.maxResults + 25), input.maxResults + 250);
  const perKeywordTarget = Math.max(pageSize, Math.ceil(rawTarget / input.keywords.length) + pageSize);
  const jobs = [];
  let requestsMade = 0;

  for (const keyword of input.keywords) {
    let pageOffset = 0;
    let keywordJobs = 0;

    while (jobs.length < rawTarget && keywordJobs < perKeywordTarget) {
      const filter = buildPublicJobSearchFilter(input, keyword, { pageOffset, pageSize });
      const data = await callUpworkGraphql({
        accessToken,
        tenantId: credentials.tenantId,
        query: PUBLIC_JOB_SEARCH_QUERY,
        variables: { marketPlaceJobFilter: filter },
      });
      requestsMade += 1;
      if (typeof options.onRequest === 'function') options.onRequest();

      const result = data?.publicMarketplaceJobPostingsSearch;
      const pageJobs = Array.isArray(result?.jobs) ? result.jobs : [];

      log.info?.(`Official Upwork API returned ${pageJobs.length} jobs for "${keyword}"`, {
        pageOffset,
        pageSize,
      });

      jobs.push(...pageJobs.map((job) => mapPublicApiJob(job, keyword, {
        scrapedAt: options.scrapedAt,
      })));

      keywordJobs += pageJobs.length;
      pageOffset += pageJobs.length || pageSize;

      if (!pageJobs.length || pageJobs.length < pageSize || result?.paging?.hasNextPage === false) {
        break;
      }
    }
  }

  return { jobs, requestsMade };
}

export function buildPublicJobSearchFilter(input, keyword, pagination) {
  const filter = {
    searchExpression_eq: keyword,
    pagination: {
      pageOffset: pagination.pageOffset,
      pageSize: pagination.pageSize,
    },
  };

  if (input.postedWithin === 'last24h') filter.daysPosted_eq = 1;
  if (input.postedWithin === 'last7d') filter.daysPosted_eq = 7;

  return filter;
}

export async function getUpworkApiAccessToken(input = {}, options = {}) {
  const credentials = resolveUpworkApiCredentials(input, options.env || process.env);

  if (credentials.accessToken) return credentials.accessToken;

  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error('Official API mode requires upworkApiAccessToken, or upworkApiClientId and upworkApiClientSecret. You can also set UPWORK_API_ACCESS_TOKEN or UPWORK_API_CLIENT_ID and UPWORK_API_CLIENT_SECRET as Actor environment variables.');
  }

  const body = new URLSearchParams();
  body.set('client_id', credentials.clientId);
  body.set('client_secret', credentials.clientSecret);

  if (credentials.refreshToken) {
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', credentials.refreshToken);
  } else {
    body.set('grant_type', 'client_credentials');
  }

  const response = await fetch(UPWORK_OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await readJsonResponse(response, 'Upwork OAuth token request');

  if (!payload.access_token) {
    throw new Error('Upwork OAuth token response did not include an access_token.');
  }

  return payload.access_token;
}

export async function callUpworkGraphql({ accessToken, tenantId, query, variables }) {
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  if (tenantId) headers['x-upwork-api-tenantid'] = tenantId;

  const response = await fetch(UPWORK_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const payload = await readJsonResponse(response, 'Upwork GraphQL request');

  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(`Upwork GraphQL error: ${formatGraphqlErrors(payload.errors)}`);
  }

  return payload.data;
}

export function mapPublicApiJob(job = {}, keyword = '', options = {}) {
  const description = htmlToText(job.description);
  const jobType = normalizeJobType(job);
  const postedAt = normalizeTimestamp(job.publishedDateTime || job.createdDateTime || job.jobTs);
  const ageHours = postedAt ? Math.max(0, (Date.now() - Date.parse(postedAt)) / 36e5) : null;
  const skills = uniqueStrings([
    ...(job.skills || []).map((skill) => skill?.prettyName || skill?.name),
    ...(job.ontologySkills || []).map((skill) => skill?.prefLabel || skill?.freeText),
  ]).slice(0, 30);

  return {
    jobTitle: compactText(job.title) || null,
    jobUrl: buildUpworkJobUrl(job),
    jobId: normalizeJobId(job.ciphertext) || cleanId(job.id) || cleanId(job.recno),
    postedAt,
    scrapedAt: options.scrapedAt || new Date().toISOString(),
    jobType,
    fixedBudget: jobType === 'fixed' ? moneyToNumber(job.amount) : null,
    hourlyMin: toNumber(job.hourlyBudgetMin),
    hourlyMax: toNumber(job.hourlyBudgetMax),
    experienceLevel: normalizeExperienceLevel(job.contractorTier),
    estimatedDuration: compactText(job.durationLabel || job.engagementDuration?.label || job.duration) || null,
    workload: compactText(job.engagement || job.hourlyBudgetType) || null,
    skills,
    descriptionSnippet: truncateText(description, 700),
    fullDescription: description,
    clientCountry: compactText(job.client?.location?.country) || null,
    clientRating: normalizeClientRating(job.client?.totalFeedback),
    clientSpent: moneyToDisplay(job.client?.totalSpent),
    proposalsCount: Number.isFinite(Number(job.totalApplicants)) ? String(job.totalApplicants) : null,
    sourceSearchKeyword: compactText(keyword),
    matchedKeywords: [],
    relevanceScore: 0,
    _rawText: compactText([
      job.title,
      description,
      skills.join(' '),
      job.category,
      job.subcategory,
    ].filter(Boolean).join(' ')),
    _ageHours: Number.isFinite(ageHours) ? ageHours : null,
  };
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON response with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
  }

  return payload;
}

function buildUpworkJobUrl(job) {
  const jobId = normalizeJobId(job.ciphertext);
  if (!jobId) return null;
  return `https://www.upwork.com/jobs/${jobId}/`;
}

function normalizeJobId(value) {
  const normalized = compactText(value);
  if (!normalized) return null;
  return normalized.startsWith('~') ? normalized : `~${normalized}`;
}

function cleanId(value) {
  const normalized = compactText(value);
  return normalized || null;
}

function normalizeTimestamp(value) {
  if (!value) return null;

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return compactText(value) || null;

  return new Date(parsed).toISOString();
}

function normalizeJobType(job) {
  const raw = compactText([
    job.type,
    job.engagement,
    job.hourlyBudgetType,
  ].filter(Boolean).join(' ')).toLowerCase();

  if (raw.includes('hour') || job.hourlyBudgetMin != null || job.hourlyBudgetMax != null) return 'hourly';
  if (raw.includes('fixed') || job.amount) return 'fixed';

  return null;
}

function normalizeExperienceLevel(value) {
  const normalized = compactText(value).toLowerCase();
  if (/entry/.test(normalized)) return 'entry';
  if (/intermediate|mid/.test(normalized)) return 'intermediate';
  if (/expert|advanced/.test(normalized)) return 'expert';
  return null;
}

function normalizeClientRating(value) {
  const rating = toNumber(value);
  if (rating === null || rating < 0 || rating > 5) return null;
  return rating;
}

function moneyToNumber(value) {
  if (!value) return null;
  return toNumber(value.rawValue ?? value.amount ?? value.displayValue);
}

function moneyToDisplay(value) {
  if (!value) return null;
  if (value.displayValue) return compactText(value.displayValue);

  const amount = moneyToNumber(value);
  if (amount === null) return null;

  const currency = compactText(value.currency || 'USD');
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}

function htmlToText(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function decodeHtmlEntities(value) {
  return compactText(value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function firstText(...values) {
  for (const value of values) {
    const normalized = compactText(value);
    if (normalized) return normalized;
  }

  return null;
}

function formatGraphqlErrors(errors) {
  return errors
    .map((error) => compactText(error.message || JSON.stringify(error)))
    .filter(Boolean)
    .join('; ')
    .slice(0, 700);
}
