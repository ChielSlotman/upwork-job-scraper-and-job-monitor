import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import {
  compactText,
  normalizeWhitespace,
  stableHash,
  truncateText,
  uniqueStrings,
} from './text.js';

export const USER_AGENT = 'Mozilla/5.0 (compatible; Apify Substack Publication and Post Scraper; +https://apify.com/)';
export const ACCESS_STATUS = {
  PUBLIC: 'public',
  PREVIEW_ONLY: 'preview_only',
  UNAVAILABLE: 'unavailable',
};

const DEFAULT_HEADERS = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};
const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});
const POST_LINK_PATTERN = /\/p\/[^/?#]+/i;
const UNWANTED_CONTENT_SELECTORS = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'nav',
  'footer',
  'header',
  'form',
  'button',
  'input',
  'textarea',
  '[aria-hidden="true"]',
  '.subscribe-widget',
  '.subscription-widget-wrap',
  '.subscription-widget',
  '.paywall',
  '.post-ufi',
  '.post-ufi-button',
  '.comments',
  '.comment-list',
  '.recommendations',
  '.share-dialog',
  '.visibility-check',
];

export function normalizeInput(input = {}) {
  const publicationUrls = uniqueStrings(input.publicationUrls || [])
    .map(normalizePublicationUrl)
    .filter(Boolean);
  const postUrls = uniqueStrings(input.postUrls || [])
    .map(normalizePostUrl)
    .filter(Boolean);
  const dateFrom = normalizeDateFilter(input.dateFrom, 'from');
  const dateTo = normalizeDateFilter(input.dateTo, 'to');

  if (!publicationUrls.length && !postUrls.length) {
    throw new Error('Enter at least one publication URL or post URL.');
  }

  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    throw new Error('dateFrom cannot be later than dateTo.');
  }

  return {
    publicationUrls,
    postUrls,
    maxPostsPerPublication: clampInteger(input.maxPostsPerPublication, 25, 1, 500),
    includePostText: input.includePostText !== false,
    includeExcerpt: input.includeExcerpt !== false,
    includeAuthorInfo: input.includeAuthorInfo !== false,
    includePublicationInfo: input.includePublicationInfo !== false,
    dateFrom,
    dateTo,
    deduplicateResults: input.deduplicateResults !== false,
    maxConcurrency: clampInteger(input.maxConcurrency, 5, 1, 10),
    requestTimeoutSecs: clampInteger(input.requestTimeoutSecs, 30, 10, 120),
    maxRetries: clampInteger(input.maxRetries, 2, 0, 5),
    saveDebugHtml: Boolean(input.saveDebugHtml),
  };
}

export async function fetchPublicResource(url, input, options = {}) {
  const label = options.label || url;
  let lastError = null;

  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.requestTimeoutSecs * 1000);

    try {
      const response = await fetch(url, {
        headers: DEFAULT_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });
      const body = await response.text();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        url: response.url || url,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        body,
      };
    } catch (error) {
      lastError = error;
      if (attempt < input.maxRetries) {
        const waitMs = 500 * (attempt + 1);
        options.log?.debug?.(`Retrying ${label} after ${error.message}`, { attempt: attempt + 1, waitMs });
        await sleep(waitMs);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Failed to fetch ${label}: ${lastError?.message || 'unknown error'}`);
}

export async function collectPublicationCandidates(publicationUrl, input, options = {}) {
  const log = options.log || console;
  const scrapedAt = options.scrapedAt || new Date().toISOString();
  const page = await fetchPublicResource(publicationUrl, input, {
    label: `publication ${publicationUrl}`,
    log,
  });
  const publicationInfo = parsePublicationHtml(page.body, page.url, publicationUrl);
  const feedUrls = uniqueStrings([
    publicationInfo.feedUrl,
    `${new URL(page.url).origin}/feed`,
    `${new URL(publicationUrl).origin}/feed`,
  ]).map((url) => absolutizeUrl(url, page.url)).filter(Boolean);

  for (const feedUrl of feedUrls) {
    try {
      const feed = await fetchPublicResource(feedUrl, input, {
        label: `RSS feed ${feedUrl}`,
        log,
      });
      const parsedFeed = parseRssFeed(feed.body, {
        sourceInputUrl: publicationUrl,
        publicationInfo,
        scrapedAt,
      });

      return {
        publicationInfo: mergePublicationInfo(publicationInfo, parsedFeed.publicationInfo),
        candidates: parsedFeed.candidates.slice(0, input.maxPostsPerPublication),
        feedUrl,
      };
    } catch (error) {
      log.warning?.(`Could not read Substack RSS feed ${feedUrl}: ${error.message}`);
    }
  }

  log.warning?.(`No RSS feed could be read for ${publicationUrl}; falling back to public post links on the publication page`);
  return {
    publicationInfo,
    feedUrl: null,
    candidates: extractPostLinksFromPublicationHtml(page.body, page.url)
      .slice(0, input.maxPostsPerPublication)
      .map((postUrl) => createPostCandidate({
        postUrl,
        sourceInputUrl: publicationUrl,
        publicationInfo,
        scrapedAt,
      })),
  };
}

export function parsePublicationHtml(html, pageUrl, sourceInputUrl = pageUrl) {
  const $ = cheerio.load(html || '');
  const canonicalUrl = absolutizeUrl($('link[rel="canonical"]').attr('href'), pageUrl) || originUrl(pageUrl);
  const rawTitle = firstText(
    metaContent($, 'property', 'og:site_name'),
    metaContent($, 'property', 'og:title'),
    metaContent($, 'name', 'twitter:title'),
    $('title').first().text(),
  );
  const titleParts = compactText(rawTitle)
    .replace(/\s*\|\s*Substack\s*$/i, '')
    .split(/\s+\|\s+/)
    .map(compactText)
    .filter(Boolean);
  const publicationName = titleParts[0] || null;
  const authorName = titleParts.length > 1 ? titleParts[1] : null;
  let feedUrl = null;
  $('link[rel="alternate"], link[type]').each((_, element) => {
    if (feedUrl) return;
    const type = compactText($(element).attr('type')).toLowerCase();
    if (type.includes('rss')) feedUrl = absolutizeUrl($(element).attr('href'), pageUrl);
  });

  return cleanPublicationInfo({
    publicationName,
    publicationUrl: canonicalUrl || originUrl(pageUrl),
    publicationDescription: stripSubstackDescription(firstText(
      metaContent($, 'name', 'description'),
      metaContent($, 'property', 'og:description'),
      metaContent($, 'name', 'twitter:description'),
    )),
    publicationLogo: firstText(
      absolutizeUrl($('link[rel="apple-touch-icon"]').attr('href'), pageUrl),
      absolutizeUrl($('link[rel~="icon"]').attr('href'), pageUrl),
      metaContent($, 'property', 'og:image'),
    ),
    publicationTopic: extractPublicationTopic($),
    authorName,
    feedUrl,
    sourceInputUrl,
  });
}

export function parseRssFeed(xml, options = {}) {
  const parsed = XML_PARSER.parse(xml || '');
  const channel = parsed?.rss?.channel || parsed?.feed || {};
  const items = toArray(channel.item || channel.entry);
  const publicationInfo = cleanPublicationInfo({
    publicationName: textValue(channel.title) || options.publicationInfo?.publicationName || null,
    publicationUrl: normalizePublicationUrl(textValue(channel.link) || options.publicationInfo?.publicationUrl || options.sourceInputUrl),
    publicationDescription: cleanHtmlText(textValue(channel.description) || options.publicationInfo?.publicationDescription),
    publicationLogo: firstText(textValue(channel.image?.url), options.publicationInfo?.publicationLogo),
    publicationTopic: firstText(categoryValues(channel.category)[0], options.publicationInfo?.publicationTopic),
    authorName: firstText(
      textValue(channel['itunes:author']),
      textValue(channel.copyright),
      options.publicationInfo?.authorName,
    ),
    sourceInputUrl: options.sourceInputUrl,
  });

  const candidates = items
    .map((item) => rssItemToCandidate(item, {
      publicationInfo,
      sourceInputUrl: options.sourceInputUrl,
      scrapedAt: options.scrapedAt,
    }))
    .filter((candidate) => candidate.postUrl);

  return { publicationInfo, candidates };
}

export function parsePostHtml(html, pageUrl, options = {}) {
  const $ = cheerio.load(html || '');
  const jsonLd = extractJsonLd($);
  const canonicalUrl = normalizePostUrl(firstText(
    metaContent($, 'property', 'og:url'),
    $('link[rel="canonical"]').attr('href'),
    pageUrl,
  ));
  const articleText = extractArticleText($);
  const bodyText = compactText($('body').text());
  const metricText = extractMetricText($, bodyText);
  const isPaidPreview = detectPaidPreview($, bodyText);
  const accessStatus = !articleText
    ? ACCESS_STATUS.UNAVAILABLE
    : isPaidPreview
      ? ACCESS_STATUS.PREVIEW_ONLY
      : ACCESS_STATUS.PUBLIC;
  const byline = extractByline($, pageUrl);
  const title = firstText(
    metaContent($, 'property', 'og:title'),
    metaContent($, 'name', 'twitter:title'),
    jsonLd.headline,
    $('h1').first().text(),
    $('title').first().text(),
  );
  const publicationName = firstText(
    metaContent($, 'property', 'og:site_name'),
    options.publicationInfo?.publicationName,
    publicationNameFromTitle($('title').first().text()),
  );

  return {
    publicationName,
    publicationUrl: normalizePublicationUrl(options.publicationInfo?.publicationUrl || pageUrl),
    publicationDescription: options.publicationInfo?.publicationDescription || null,
    publicationLogo: firstText(options.publicationInfo?.publicationLogo, metaContent($, 'property', 'og:image')),
    publicationTopic: firstText(options.publicationInfo?.publicationTopic, extractPublicationTopic($)),
    postTitle: title || null,
    postUrl: canonicalUrl || normalizePostUrl(pageUrl),
    postSlug: postSlug(canonicalUrl || pageUrl),
    authorName: firstText(
      options.publicationInfo?.authorName,
      metaContent($, 'name', 'author'),
      jsonLd.authorName,
      byline.authorName,
    ),
    authorUrl: byline.authorUrl,
    publishedAt: normalizeTimestamp(firstText(
      metaContent($, 'property', 'article:published_time'),
      jsonLd.datePublished,
    )),
    updatedAt: normalizeTimestamp(firstText(
      metaContent($, 'property', 'article:modified_time'),
      jsonLd.dateModified,
    )),
    excerpt: cleanHtmlText(firstText(
      metaContent($, 'name', 'description'),
      metaContent($, 'property', 'og:description'),
      metaContent($, 'name', 'twitter:description'),
      jsonLd.description,
    )),
    publicPostText: articleText || null,
    isPaidPreview,
    isPubliclyReadable: accessStatus === ACCESS_STATUS.PUBLIC,
    accessStatus,
    likesCount: extractVisibleCount(metricText, ['like', 'likes']),
    commentsCount: extractVisibleCount(metricText, ['comment', 'comments']),
    imageUrl: firstText(metaContent($, 'property', 'og:image'), metaContent($, 'name', 'twitter:image')),
    tags: uniqueStrings([
      ...metaContents($, 'property', 'article:tag'),
      ...$('a[href*="/t/"]').map((_, element) => $(element).text()).get(),
    ]).slice(0, 25),
  };
}

export function finalizeResult(candidate, detail, input, options = {}) {
  const merged = {
    publicationName: firstText(detail.publicationName, candidate.publicationName),
    publicationUrl: firstText(detail.publicationUrl, candidate.publicationUrl),
    publicationDescription: firstText(detail.publicationDescription, candidate.publicationDescription),
    publicationLogo: firstText(detail.publicationLogo, candidate.publicationLogo),
    publicationTopic: firstText(detail.publicationTopic, candidate.publicationTopic),
    postTitle: firstText(detail.postTitle, candidate.postTitle),
    postUrl: normalizePostUrl(firstText(detail.postUrl, candidate.postUrl)),
    postSlug: firstText(detail.postSlug, candidate.postSlug, postSlug(candidate.postUrl)),
    authorName: firstText(detail.authorName, candidate.authorName),
    authorUrl: firstText(detail.authorUrl, candidate.authorUrl),
    publishedAt: firstText(detail.publishedAt, candidate.publishedAt),
    updatedAt: firstText(detail.updatedAt, candidate.updatedAt),
    excerpt: firstText(detail.excerpt, candidate.excerpt),
    publicPostText: firstText(detail.publicPostText, candidate.publicPostText),
    isPaidPreview: Boolean(detail.isPaidPreview ?? candidate.isPaidPreview),
    isPubliclyReadable: Boolean(detail.isPubliclyReadable ?? candidate.isPubliclyReadable),
    accessStatus: detail.accessStatus || candidate.accessStatus || ACCESS_STATUS.UNAVAILABLE,
    likesCount: detail.likesCount ?? candidate.likesCount ?? null,
    commentsCount: detail.commentsCount ?? candidate.commentsCount ?? null,
    imageUrl: firstText(detail.imageUrl, candidate.imageUrl),
    tags: uniqueStrings([...(candidate.tags || []), ...(detail.tags || [])]),
    sourceInputUrl: candidate.sourceInputUrl || options.sourceInputUrl || null,
    scrapedAt: options.scrapedAt || candidate.scrapedAt || new Date().toISOString(),
  };

  if (!input.includePublicationInfo) {
    merged.publicationName = null;
    merged.publicationUrl = null;
    merged.publicationDescription = null;
    merged.publicationLogo = null;
    merged.publicationTopic = null;
  }

  if (!input.includeAuthorInfo) {
    merged.authorName = null;
    merged.authorUrl = null;
  }

  if (!input.includeExcerpt) {
    merged.excerpt = null;
  }

  if (!input.includePostText) {
    merged.publicPostText = null;
  }

  return merged;
}

export function createUnavailableResult(candidate, input, options = {}) {
  return finalizeResult(candidate, {
    isPaidPreview: false,
    isPubliclyReadable: false,
    accessStatus: ACCESS_STATUS.UNAVAILABLE,
  }, input, options);
}

export function createPostCandidate(values) {
  const publicationInfo = values.publicationInfo || {};

  return {
    publicationName: publicationInfo.publicationName || values.publicationName || null,
    publicationUrl: publicationInfo.publicationUrl || values.publicationUrl || normalizePublicationUrl(values.postUrl),
    publicationDescription: publicationInfo.publicationDescription || values.publicationDescription || null,
    publicationLogo: publicationInfo.publicationLogo || values.publicationLogo || null,
    publicationTopic: publicationInfo.publicationTopic || values.publicationTopic || null,
    postTitle: values.postTitle || null,
    postUrl: normalizePostUrl(values.postUrl),
    postSlug: values.postSlug || postSlug(values.postUrl),
    authorName: values.authorName || publicationInfo.authorName || null,
    authorUrl: values.authorUrl || null,
    publishedAt: normalizeTimestamp(values.publishedAt),
    updatedAt: normalizeTimestamp(values.updatedAt),
    excerpt: cleanHtmlText(values.excerpt),
    publicPostText: cleanHtmlText(values.publicPostText),
    isPaidPreview: Boolean(values.isPaidPreview),
    isPubliclyReadable: Boolean(values.isPubliclyReadable),
    accessStatus: values.accessStatus || ACCESS_STATUS.UNAVAILABLE,
    likesCount: values.likesCount ?? null,
    commentsCount: values.commentsCount ?? null,
    imageUrl: values.imageUrl || null,
    tags: uniqueStrings(values.tags || []),
    sourceInputUrl: values.sourceInputUrl || values.postUrl || null,
    scrapedAt: values.scrapedAt || new Date().toISOString(),
  };
}

export function rssItemToCandidate(item, options = {}) {
  const publicationInfo = options.publicationInfo || {};
  const postUrl = normalizePostUrl(firstText(textValue(item.link), textValue(item.guid), item.guid?.['#text']));
  const contentHtml = firstText(textValue(item['content:encoded']), textValue(item.content));
  const excerpt = cleanHtmlText(firstText(textValue(item.description), textValue(item.summary)));

  return createPostCandidate({
    publicationInfo,
    postTitle: cleanHtmlText(textValue(item.title)),
    postUrl,
    postSlug: postSlug(postUrl),
    authorName: firstText(textValue(item['dc:creator']), textValue(item.author), publicationInfo.authorName),
    publishedAt: firstText(textValue(item.pubDate), textValue(item.published), textValue(item.created)),
    updatedAt: firstText(textValue(item['atom:updated']), textValue(item.updated)),
    excerpt,
    publicPostText: cleanHtmlText(contentHtml),
    imageUrl: extractRssImage(item, contentHtml),
    tags: categoryValues(item.category),
    sourceInputUrl: options.sourceInputUrl,
    scrapedAt: options.scrapedAt,
  });
}

export function resultMatchesDateFilter(result, input) {
  const timestamp = normalizeTimestamp(result.publishedAt || result.updatedAt);
  if (!timestamp) return true;

  const date = new Date(timestamp);
  if (input.dateFrom && date.getTime() < input.dateFrom.getTime()) return false;
  if (input.dateTo && date.getTime() > input.dateTo.getTime()) return false;

  return true;
}

export function postDedupeKey(result) {
  return normalizePostUrl(result.postUrl) || `${compactText(result.postTitle).toLowerCase()}-${stableHash(result.excerpt || '')}`;
}

export function normalizePublicationUrl(value) {
  const url = parseUrl(value);
  if (!url) return null;
  url.hash = '';
  url.search = '';
  url.pathname = '/';
  return trimTrailingSlash(url.toString());
}

export function normalizePostUrl(value) {
  const url = parseUrl(value);
  if (!url) return null;
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

export function postSlug(value) {
  const url = parseUrl(value);
  if (!url) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const pIndex = parts.findIndex((part) => part === 'p');
  return (pIndex >= 0 ? parts[pIndex + 1] : parts.at(-1)) || null;
}

export function cleanHtmlText(value) {
  const html = String(value || '');
  if (!html) return null;
  const $ = cheerio.load(`<main>${html}</main>`);
  $('script, style, noscript').remove();
  return normalizeWhitespace($('main').text()) || null;
}

export async function mapLimit(values, limit, handler) {
  const output = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      output[currentIndex] = await handler(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function extractPostLinksFromPublicationHtml(html, pageUrl) {
  const $ = cheerio.load(html || '');

  return uniqueStrings($('a[href]')
    .map((_, element) => absolutizeUrl($(element).attr('href'), pageUrl))
    .get()
    .filter((url) => POST_LINK_PATTERN.test(new URL(url).pathname))
    .map(normalizePostUrl));
}

function extractArticleText($) {
  const selectors = [
    '.available-content .body.markup',
    '.body.markup',
    '[data-testid="post-content"]',
    '.post-content',
    'article .body',
    'article',
  ];
  let bestText = '';

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const clone = $(element).clone();
      clone.find(UNWANTED_CONTENT_SELECTORS.join(',')).remove();
      const text = blockText($, clone);
      if (text.length > bestText.length) bestText = text;
    });
  }

  if (!bestText) {
    const body = $('body').clone();
    body.find(UNWANTED_CONTENT_SELECTORS.join(',')).remove();
    bestText = blockText($, body);
  }

  return bestText || null;
}

function blockText($, root) {
  const lines = [];
  const blockSelector = 'h1,h2,h3,h4,p,li,blockquote,pre';
  root.find(blockSelector).each((_, element) => {
    const text = compactText($(element).text());
    if (text) lines.push(text);
  });

  if (!lines.length) {
    const text = compactText(root.text());
    if (text) lines.push(text);
  }

  return lines
    .filter((line, index) => index === 0 || line !== lines[index - 1])
    .join('\n\n')
    .trim();
}

function detectPaidPreview($, bodyText) {
  if ($('[class*="paywall"], [class*="Paywall"], [data-testid*="paywall"], [data-testid*="Paywall"]').length) return true;

  return /(?:subscribe|upgrade)\s+(?:now\s+)?(?:to\s+)?(?:read|keep reading|continue reading)|this post is for paid|for paid subscribers only|paid subscribers only|unlock this post/i
    .test(bodyText.toLowerCase());
}

function extractByline($, pageUrl) {
  const candidates = [
    '.byline a[href]',
    '[class*="byline"] a[href]',
    '[class*="Byline"] a[href]',
    'a[href*="/profile/"]',
    'a[href*="substack.com/profile/"]',
  ];

  for (const selector of candidates) {
    const link = $(selector)
      .filter((_, element) => compactText($(element).text()).length > 1)
      .first();

    if (link.length) {
      return {
        authorName: compactText(link.text()) || null,
        authorUrl: absolutizeUrl(link.attr('href'), pageUrl),
      };
    }
  }

  return { authorName: null, authorUrl: null };
}

function extractJsonLd($) {
  const output = {};

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    const entries = safeJsonArray(raw);

    for (const entry of entries.flatMap(expandJsonLdGraph)) {
      output.headline ||= compactText(entry.headline || entry.name);
      output.description ||= compactText(entry.description);
      output.datePublished ||= compactText(entry.datePublished);
      output.dateModified ||= compactText(entry.dateModified);
      output.authorName ||= compactText(
        Array.isArray(entry.author)
          ? entry.author.map((author) => author?.name).filter(Boolean).join(', ')
          : entry.author?.name || entry.author,
      );
    }
  });

  return output;
}

function safeJsonArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function expandJsonLdGraph(entry) {
  if (!entry || typeof entry !== 'object') return [];
  if (Array.isArray(entry['@graph'])) return entry['@graph'];
  return [entry];
}

function extractPublicationTopic($) {
  return firstText(
    metaContent($, 'name', 'keywords')?.split(',')?.[0],
    $('a[href*="/browse/"], a[href*="/category/"]').first().text(),
  );
}

function extractRssImage(item, contentHtml) {
  const enclosure = toArray(item.enclosure).find((entry) => {
    const type = compactText(entry?.['@_type']).toLowerCase();
    return type.startsWith('image/') || entry?.['@_url'];
  });
  const media = toArray(item['media:content'] || item['media:thumbnail']).find((entry) => entry?.['@_url']);
  const firstImage = String(contentHtml || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];

  return firstText(enclosure?.['@_url'], media?.['@_url'], firstImage);
}

function extractVisibleCount(text, labels) {
  for (const label of labels) {
    const patterns = [
      new RegExp(`\\b([\\d,.]+\\s*[KkMm]?)\\s+${label}(?=$|[^A-Za-z])`, 'i'),
      new RegExp(`\\b${label}\\s+([\\d,.]+\\s*[KkMm]?)\\b`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      const number = parseHumanNumber(match?.[1]);
      if (number !== null) return number;
    }
  }

  return null;
}

function extractMetricText($, bodyText) {
  const shortLabels = $('button,a,span,div')
    .map((_, element) => compactText($(element).text()))
    .get()
    .filter((text) => text.length > 0 && text.length <= 80 && /likes?|comments?/i.test(text))
    .join(' ');

  return compactText(`${shortLabels} ${bodyText}`);
}

function parseHumanNumber(value) {
  const normalized = compactText(value);
  if (!normalized) return null;

  const match = normalized.match(/^([\d,.]+)\s*([KkMm])?$/);
  if (!match) return null;

  const number = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;

  const suffix = match[2]?.toLowerCase();
  if (suffix === 'k') return Math.round(number * 1000);
  if (suffix === 'm') return Math.round(number * 1000000);
  return number;
}

function categoryValues(value) {
  return uniqueStrings(toArray(value).map((entry) => textValue(entry)));
}

function metaContent($, attr, value) {
  return compactText($(`meta[${attr}="${value}"]`).attr('content')) || null;
}

function metaContents($, attr, value) {
  return $(`meta[${attr}="${value}"]`)
    .map((_, element) => compactText($(element).attr('content')))
    .get()
    .filter(Boolean);
}

function textValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return compactText(value);
  if (typeof value === 'object') return compactText(value['#text'] || value._ || value.value);
  return null;
}

function firstText(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) return text;
  }

  return null;
}

function mergePublicationInfo(primary = {}, secondary = {}) {
  return cleanPublicationInfo({
    publicationName: firstText(primary.publicationName, secondary.publicationName),
    publicationUrl: firstText(primary.publicationUrl, secondary.publicationUrl),
    publicationDescription: firstText(primary.publicationDescription, secondary.publicationDescription),
    publicationLogo: firstText(primary.publicationLogo, secondary.publicationLogo),
    publicationTopic: firstText(primary.publicationTopic, secondary.publicationTopic),
    authorName: firstText(primary.authorName, secondary.authorName),
    sourceInputUrl: firstText(primary.sourceInputUrl, secondary.sourceInputUrl),
  });
}

function cleanPublicationInfo(value = {}) {
  return {
    publicationName: compactText(value.publicationName) || null,
    publicationUrl: normalizePublicationUrl(value.publicationUrl) || null,
    publicationDescription: truncateText(value.publicationDescription, 1000),
    publicationLogo: value.publicationLogo || null,
    publicationTopic: compactText(value.publicationTopic) || null,
    authorName: compactText(value.authorName) || null,
    feedUrl: value.feedUrl || null,
    sourceInputUrl: value.sourceInputUrl || null,
  };
}

function stripSubstackDescription(value) {
  const text = compactText(value);
  if (!text) return null;

  return text
    .replace(/\s*Click to read .*? a Substack publication\.?$/i, '')
    .trim() || text;
}

function publicationNameFromTitle(value) {
  const parts = compactText(value)
    .replace(/\s*\|\s*Substack\s*$/i, '')
    .split(/\s+\|\s+/)
    .map(compactText)
    .filter(Boolean);

  return parts.length > 1 ? parts.at(-1) : null;
}

function normalizeDateFilter(value, boundary) {
  const text = compactText(value);
  if (!text) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${boundary === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`
    : text;
  const timestamp = Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${boundary === 'from' ? 'dateFrom' : 'dateTo'} must be a valid date.`);
  }

  return new Date(timestamp);
}

function normalizeTimestamp(value) {
  const text = compactText(value);
  if (!text) return null;

  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return text;

  return new Date(timestamp).toISOString();
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return null;

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function originUrl(value) {
  const url = parseUrl(value);
  return url ? trimTrailingSlash(url.origin) : null;
}

function parseUrl(value) {
  const text = compactText(value);
  if (!text) return null;

  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
