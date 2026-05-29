import { Actor } from 'apify';
import { PlaywrightCrawler, log } from '@crawlee/playwright';
import {
  buildSearchUrl,
  DEFAULT_PROXY_CONFIGURATION,
  detectUpworkChallenge,
  extractJobDetailsFromPage,
  extractJobsFromSearchPage,
  finalizeJob,
  jobDedupeKey,
  jobMatchesFilters,
  normalizeInput,
  scrollSearchResults,
} from './upwork.js';

await Actor.init();

const startedAt = new Date();
const rawInput = await Actor.getInput();
const input = normalizeInput(rawInput || {});
const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
const isUsingDefaultResidentialProxy = input.proxyConfiguration?.useApifyProxy !== false
  && (input.proxyConfiguration?.apifyProxyGroups || input.proxyConfiguration?.groups || [])
    .includes('RESIDENTIAL');

const scrapedAt = new Date().toISOString();
const collectedJobs = [];
const seenKeys = new Set();
const stats = {
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  status: 'running',
  keywords: input.keywords,
  searchPagesProcessed: 0,
  detailPagesProcessed: 0,
  jobsExtractedBeforeFilters: 0,
  jobsFilteredOut: 0,
  duplicateJobsSkipped: 0,
  jobsPushed: 0,
  challengePages: 0,
  searchRequestsFailed: 0,
  detailRequestsFailed: 0,
  emptySearchPages: 0,
  noResultSearchPages: 0,
  warnings: [],
};

log.info('Starting Upwork job discovery run', {
  keywords: input.keywords,
  maxResults: input.maxResults,
  jobType: input.jobType,
  experienceLevel: input.experienceLevel,
  postedWithin: input.postedWithin,
  includeDescription: input.includeDescription,
  proxyGroups: input.proxyConfiguration?.apifyProxyGroups || input.proxyConfiguration?.groups || [],
  proxyCountry: input.proxyConfiguration?.apifyProxyCountry || input.proxyConfiguration?.countryCode || null,
});

if (isUsingDefaultResidentialProxy) {
  log.info('Using Apify Residential proxy for Upwork access', {
    recommendedFor: 'reducing HTTP 403 responses on strict public job pages',
  });
}

const searchRequests = input.keywords.map((keyword) => ({
  url: buildSearchUrl(keyword),
  uniqueKey: `search:${keyword}`,
  userData: { type: 'search', keyword },
}));

const searchCrawler = new PlaywrightCrawler({
  proxyConfiguration,
  maxConcurrency: input.maxConcurrency,
  requestHandlerTimeoutSecs: input.requestTimeoutSecs,
  navigationTimeoutSecs: input.requestTimeoutSecs,
  maxRequestRetries: 4,
  maxSessionRotations: 10,
  retryOnBlocked: true,
  persistCookiesPerSession: true,
  browserPoolOptions: {
    useFingerprints: true,
    retireBrowserAfterPageCount: 1,
  },
  launchContext: {
    launchOptions: {
      headless: true,
    },
  },
  preNavigationHooks: [
    async ({ page }, gotoOptions) => {
      gotoOptions.waitUntil = 'domcontentloaded';
      await blockHeavyResources(page);
      await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9',
      });
    },
  ],
  requestHandler: async ({ page, request, response }) => {
    if (collectedJobs.length >= input.maxResults) return;

    const keyword = request.userData.keyword;
    log.info(`Processing Upwork search for "${keyword}"`);

    await page.waitForLoadState('domcontentloaded', { timeout: input.requestTimeoutSecs * 1000 }).catch(() => {});

    if ([403, 429].includes(response?.status?.())) {
      stats.challengePages += 1;
      const warning = `Upwork returned HTTP ${response.status()} for keyword "${keyword}" after proxy retries. Use Apify Residential proxy access, keep concurrency at 1, or try again later.`;
      stats.warnings.push(warning);
      log.warning(warning);
      await saveDebugHtml(page, `DEBUG_BLOCKED_${safeKey(keyword)}.html`, input.saveDebugHtml);
      return;
    }

    if (await detectUpworkChallenge(page)) {
      stats.challengePages += 1;
      const warning = `Upwork returned an access challenge for keyword "${keyword}". Use Apify Residential proxy access, keep concurrency at 1, or try again later.`;
      stats.warnings.push(warning);
      log.warning(warning);
      await saveDebugHtml(page, `DEBUG_CHALLENGE_${safeKey(keyword)}.html`, input.saveDebugHtml);
      return;
    }

    const perSearchTarget = Math.min(input.maxResults, Math.ceil(input.maxResults / input.keywords.length) + 10);
    await scrollSearchResults(page, perSearchTarget);

    const rawJobs = await extractJobsFromSearchPage(page, keyword, { scrapedAt });
    stats.searchPagesProcessed += 1;
    stats.jobsExtractedBeforeFilters += rawJobs.length;

    if (!rawJobs.length) {
      if (await detectUpworkChallenge(page)) {
        stats.challengePages += 1;
        const warning = `Upwork returned an access challenge for keyword "${keyword}" after page load. Use Apify Residential proxy access, keep concurrency at 1, or try again later.`;
        stats.warnings.push(warning);
        log.warning(warning);
        await saveDebugHtml(page, `DEBUG_CHALLENGE_${safeKey(keyword)}.html`, input.saveDebugHtml);
        return;
      }

      if (await isNoResultsPage(page)) {
        stats.noResultSearchPages += 1;
        log.info(`Upwork reported no visible jobs for keyword "${keyword}"`);
        return;
      }

      stats.emptySearchPages += 1;
      const warning = `No job cards were detected for keyword "${keyword}". Upwork may have changed the page structure or blocked the page without a standard challenge.`;
      stats.warnings.push(warning);
      log.warning(warning);
      await saveDebugHtml(page, `DEBUG_EMPTY_${safeKey(keyword)}.html`, input.saveDebugHtml);
      return;
    }

    for (const rawJob of rawJobs) {
      if (collectedJobs.length >= input.maxResults) break;

      if (!jobMatchesFilters(rawJob, input)) {
        stats.jobsFilteredOut += 1;
        continue;
      }

      const key = jobDedupeKey(rawJob);
      if (input.deduplicateResults && seenKeys.has(key)) {
        stats.duplicateJobsSkipped += 1;
        continue;
      }

      if (input.deduplicateResults) seenKeys.add(key);
      collectedJobs.push(rawJob);
    }

    log.info(`Collected ${collectedJobs.length}/${input.maxResults} matching jobs so far`);
  },
  failedRequestHandler: async ({ request }, error) => {
    stats.searchRequestsFailed += 1;
    const warning = `Request failed for ${request.url}: ${error.message}`;
    stats.warnings.push(warning);
    log.warning(warning);
  },
});

await searchCrawler.run(searchRequests);

if (input.includeDescription && collectedJobs.length) {
  log.info(`Opening ${collectedJobs.length} public job pages to enrich full descriptions`);

  const detailRequests = collectedJobs
    .flatMap((job, index) => (job.jobUrl ? [{
      url: job.jobUrl,
      uniqueKey: `detail:${job.jobId || job.jobUrl}`,
      userData: {
        type: 'detail',
        jobIndex: index,
        keyword: job.sourceSearchKeyword,
      },
    }] : []));

  const detailCrawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxConcurrency: Math.min(input.maxConcurrency, 2),
    requestHandlerTimeoutSecs: input.requestTimeoutSecs,
    navigationTimeoutSecs: input.requestTimeoutSecs,
    maxRequestRetries: 3,
    maxSessionRotations: 8,
    retryOnBlocked: true,
    persistCookiesPerSession: true,
    browserPoolOptions: {
      useFingerprints: true,
      retireBrowserAfterPageCount: 1,
    },
    preNavigationHooks: [
      async ({ page }, gotoOptions) => {
        gotoOptions.waitUntil = 'domcontentloaded';
        await blockHeavyResources(page);
        await page.setExtraHTTPHeaders({
          'accept-language': 'en-US,en;q=0.9',
        });
      },
    ],
    launchContext: {
      launchOptions: {
        headless: true,
      },
    },
    requestHandler: async ({ page, request, response }) => {
      await page.waitForLoadState('domcontentloaded', { timeout: input.requestTimeoutSecs * 1000 }).catch(() => {});

      if ([403, 429].includes(response?.status?.())) {
        stats.challengePages += 1;
        log.warning(`Upwork returned HTTP ${response.status()} on job detail page: ${request.url}`);
        return;
      }

      if (await detectUpworkChallenge(page)) {
        stats.challengePages += 1;
        log.warning(`Upwork returned an access challenge on job detail page: ${request.url}`);
        return;
      }

      const detail = await extractJobDetailsFromPage(page, {
        keyword: request.userData.keyword,
        scrapedAt,
      });
      const job = collectedJobs[request.userData.jobIndex];

      if (!job) return;

      Object.assign(job, {
        jobTitle: job.jobTitle || detail.jobTitle,
        fullDescription: detail.fullDescription || job.fullDescription,
        skills: [...new Set([...(job.skills || []), ...(detail.skills || [])])],
        clientCountry: job.clientCountry || detail.clientCountry,
        clientRating: job.clientRating ?? detail.clientRating,
        clientSpent: job.clientSpent || detail.clientSpent,
        proposalsCount: job.proposalsCount || detail.proposalsCount,
        fixedBudget: job.fixedBudget ?? detail.fixedBudget,
        hourlyMin: job.hourlyMin ?? detail.hourlyMin,
        hourlyMax: job.hourlyMax ?? detail.hourlyMax,
        jobType: job.jobType || detail.jobType,
        experienceLevel: job.experienceLevel || detail.experienceLevel,
        estimatedDuration: job.estimatedDuration || detail.estimatedDuration,
        workload: job.workload || detail.workload,
      });

      stats.detailPagesProcessed += 1;
    },
    failedRequestHandler: async ({ request }, error) => {
      stats.detailRequestsFailed += 1;
      const warning = `Detail request failed for ${request.url}: ${error.message}`;
      stats.warnings.push(warning);
      log.warning(warning);
    },
  });

  await detailCrawler.run(detailRequests);
}

const finalJobs = collectedJobs
  .slice(0, input.maxResults)
  .map((job) => finalizeJob(job, input))
  .filter((job) => job.jobTitle || job.jobUrl);

if (!finalJobs.length && stats.challengePages >= input.keywords.length) {
  stats.status = 'blocked';
  stats.warnings.push(`Upwork returned access challenges for all searches and no results could be collected. This Actor now defaults to ${DEFAULT_PROXY_CONFIGURATION.apifyProxyGroups[0]} proxy, but your Apify account must have residential proxy access and enough proxy traffic available.`);
} else if (!finalJobs.length && stats.emptySearchPages >= input.keywords.length && stats.jobsExtractedBeforeFilters === 0) {
  stats.status = 'empty_pages';
  stats.warnings.push('No Upwork job cards were detected on any search page. Upwork may have changed its page structure or blocked access without a standard challenge. Enable saveDebugHtml and inspect the key-value store debug records.');
} else if (!finalJobs.length && stats.searchPagesProcessed === 0 && stats.searchRequestsFailed >= input.keywords.length) {
  stats.status = 'failed_requests';
  stats.warnings.push('All Upwork search pages failed before job extraction. Use Apify Proxy, reduce concurrency, or try again later.');
} else if (!finalJobs.length) {
  stats.status = 'no_results';
} else if (stats.warnings.length) {
  stats.status = 'partial';
} else {
  stats.status = 'ok';
}

if (finalJobs.length) {
  await Actor.pushData(finalJobs);
}

stats.jobsPushed = finalJobs.length;
stats.finishedAt = new Date().toISOString();
await Actor.setValue('RUN_SUMMARY', stats);

log.info('Run finished', {
  jobsPushed: stats.jobsPushed,
  filteredOut: stats.jobsFilteredOut,
  duplicatesSkipped: stats.duplicateJobsSkipped,
  warnings: stats.warnings.length,
});

await Actor.exit();

async function saveDebugHtml(page, key, enabled) {
  if (!enabled) return;

  const html = await page.content().catch(() => '');
  if (html) {
    await Actor.setValue(key, html, { contentType: 'text/html; charset=utf-8' });
  }
}

async function blockHeavyResources(page) {
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();

    if (['image', 'media', 'font'].includes(resourceType)) {
      return route.abort();
    }

    return route.continue();
  }).catch(() => {});
}

function safeKey(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 60);
}

async function isNoResultsPage(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return /no\s+(jobs|results)\s+(found|match)|try\s+different\s+keywords|0\s+jobs\s+found/i.test(bodyText);
}
