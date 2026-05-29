import { Actor, log } from 'apify';
import {
  collectPublicationCandidates,
  createPostCandidate,
  createUnavailableResult,
  fetchPublicResource,
  finalizeResult,
  mapLimit,
  normalizeInput,
  parsePostHtml,
  postDedupeKey,
  resultMatchesDateFilter,
} from './substack.js';

await Actor.init();

const startedAt = new Date();
const scrapedAt = startedAt.toISOString();
const rawInput = await Actor.getInput();
const input = normalizeInput(rawInput || {});
const stats = {
  startedAt: startedAt.toISOString(),
  finishedAt: null,
  status: 'running',
  publicationUrls: input.publicationUrls,
  postUrls: input.postUrls,
  publicationsProcessed: 0,
  publicationFeedsRead: 0,
  postCandidatesFound: 0,
  postPagesFetched: 0,
  postsPushed: 0,
  duplicatesSkipped: 0,
  postsFilteredByDate: 0,
  unavailablePosts: 0,
  previewOnlyPosts: 0,
  warnings: [],
};

log.info('Starting Substack public publication and post scrape', {
  publicationUrls: input.publicationUrls.length,
  postUrls: input.postUrls.length,
  maxPostsPerPublication: input.maxPostsPerPublication,
  includePostText: input.includePostText,
  includeExcerpt: input.includeExcerpt,
  includeAuthorInfo: input.includeAuthorInfo,
  includePublicationInfo: input.includePublicationInfo,
  dateFrom: input.dateFrom?.toISOString?.() || null,
  dateTo: input.dateTo?.toISOString?.() || null,
  maxConcurrency: input.maxConcurrency,
});

const candidates = [];

for (const publicationUrl of input.publicationUrls) {
  try {
    log.info(`Reading public Substack publication: ${publicationUrl}`);
    const publication = await collectPublicationCandidates(publicationUrl, input, {
      log,
      scrapedAt,
    });

    stats.publicationsProcessed += 1;
    if (publication.feedUrl) stats.publicationFeedsRead += 1;
    candidates.push(...publication.candidates);

    log.info(`Found ${publication.candidates.length} public post candidates`, {
      publicationUrl,
      feedUrl: publication.feedUrl,
      publicationName: publication.publicationInfo.publicationName,
    });
  } catch (error) {
    const warning = `Could not process publication ${publicationUrl}: ${error.message}`;
    stats.warnings.push(warning);
    log.warning(warning);
  }
}

for (const postUrl of input.postUrls) {
  candidates.push(createPostCandidate({
    postUrl,
    sourceInputUrl: postUrl,
    scrapedAt,
  }));
}

stats.postCandidatesFound = candidates.length;

const dedupedCandidates = [];
const seenPostKeys = new Set();

for (const candidate of candidates) {
  const key = postDedupeKey(candidate);
  if (input.deduplicateResults && seenPostKeys.has(key)) {
    stats.duplicatesSkipped += 1;
    continue;
  }

  if (input.deduplicateResults) seenPostKeys.add(key);

  if (!resultMatchesDateFilter(candidate, input)) {
    stats.postsFilteredByDate += 1;
    continue;
  }

  dedupedCandidates.push(candidate);
}

log.info(`Fetching ${dedupedCandidates.length} public Substack post pages`, {
  duplicatesSkipped: stats.duplicatesSkipped,
  filteredByDate: stats.postsFilteredByDate,
});

const results = await mapLimit(dedupedCandidates, input.maxConcurrency, async (candidate) => {
  try {
    const response = await fetchPublicResource(candidate.postUrl, input, {
      label: `post ${candidate.postUrl}`,
      log,
    });
    stats.postPagesFetched += 1;

    if (input.saveDebugHtml) {
      await Actor.setValue(`DEBUG_POST_${stats.postPagesFetched}.html`, response.body, {
        contentType: 'text/html; charset=utf-8',
      });
    }

    const detail = parsePostHtml(response.body, response.url, {
      publicationInfo: candidate,
    });
    const result = finalizeResult(candidate, detail, input, {
      scrapedAt,
    });

    if (!resultMatchesDateFilter(result, input)) {
      stats.postsFilteredByDate += 1;
      return null;
    }

    if (result.accessStatus === 'preview_only') stats.previewOnlyPosts += 1;
    if (result.accessStatus === 'unavailable') stats.unavailablePosts += 1;

    return result;
  } catch (error) {
    const warning = `Could not fetch post ${candidate.postUrl}: ${error.message}`;
    stats.warnings.push(warning);
    stats.unavailablePosts += 1;
    log.warning(warning);

    return createUnavailableResult(candidate, input, {
      scrapedAt,
    });
  }
});

const finalResults = results
  .filter(Boolean)
  .filter((result) => result.postUrl || result.postTitle);

if (finalResults.length) {
  await Actor.pushData(finalResults);
}

stats.postsPushed = finalResults.length;
stats.finishedAt = new Date().toISOString();

if (!finalResults.length && stats.warnings.length) {
  stats.status = 'failed_or_empty';
} else if (!finalResults.length) {
  stats.status = 'no_results';
} else if (stats.warnings.length || stats.unavailablePosts || stats.previewOnlyPosts) {
  stats.status = 'partial';
} else {
  stats.status = 'ok';
}

await Actor.setValue('RUN_SUMMARY', stats);

log.info('Substack scrape finished', {
  status: stats.status,
  postsPushed: stats.postsPushed,
  previewOnlyPosts: stats.previewOnlyPosts,
  unavailablePosts: stats.unavailablePosts,
  warnings: stats.warnings.length,
});

await Actor.exit();
