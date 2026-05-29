import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCESS_STATUS,
  cleanHtmlText,
  createPostCandidate,
  finalizeResult,
  normalizeInput,
  normalizePostUrl,
  parsePostHtml,
  parsePublicationHtml,
  parseRssFeed,
  postDedupeKey,
  resultMatchesDateFilter,
} from '../src/substack.js';

test('normalizeInput accepts publication and post URL workflows', () => {
  const input = normalizeInput({
    publicationUrls: ['astralcodexten.substack.com/'],
    postUrls: ['https://example.substack.com/p/a-post?utm_source=x#comments'],
    maxPostsPerPublication: 5,
  });

  assert.deepEqual(input.publicationUrls, ['https://astralcodexten.substack.com']);
  assert.deepEqual(input.postUrls, ['https://example.substack.com/p/a-post']);
  assert.equal(input.includePostText, true);
  assert.equal(input.deduplicateResults, true);
  assert.equal(input.maxPostsPerPublication, 5);
});

test('normalizeInput requires at least one source URL', () => {
  assert.throws(() => normalizeInput({ publicationUrls: [], postUrls: [] }), /at least one/);
});

test('parsePublicationHtml extracts public publication metadata and feed URL', () => {
  const publication = parsePublicationHtml(`
    <html>
      <head>
        <title>Example Letters | Jane Writer | Substack</title>
        <meta name="description" content="Weekly notes about markets. Click to read Example Letters, by Jane Writer, a Substack publication.">
        <meta property="og:image" content="https://cdn.example/logo.png">
        <link rel="alternate" type="application/rss+xml" href="/feed">
      </head>
    </html>
  `, 'https://example.substack.com');

  assert.equal(publication.publicationName, 'Example Letters');
  assert.equal(publication.authorName, 'Jane Writer');
  assert.equal(publication.publicationDescription, 'Weekly notes about markets.');
  assert.equal(publication.publicationLogo, 'https://cdn.example/logo.png');
  assert.equal(publication.feedUrl, 'https://example.substack.com/feed');
});

test('parseRssFeed converts public RSS items to post candidates', () => {
  const feed = parseRssFeed(`<?xml version="1.0"?>
    <rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
      <channel>
        <title><![CDATA[Example Letters]]></title>
        <description><![CDATA[Public research notes]]></description>
        <link>https://example.substack.com</link>
        <image><url>https://cdn.example/logo.png</url></image>
        <item>
          <title><![CDATA[Public market memo]]></title>
          <description><![CDATA[Short public excerpt.]]></description>
          <content:encoded><![CDATA[<p>Full public RSS text.</p><img src="https://cdn.example/post.png" />]]></content:encoded>
          <link>https://example.substack.com/p/public-market-memo</link>
          <dc:creator><![CDATA[Jane Writer]]></dc:creator>
          <pubDate>Fri, 29 May 2026 12:00:00 GMT</pubDate>
          <category>Markets</category>
        </item>
      </channel>
    </rss>`, {
    sourceInputUrl: 'https://example.substack.com',
    scrapedAt: '2026-05-29T13:00:00.000Z',
  });

  assert.equal(feed.publicationInfo.publicationName, 'Example Letters');
  assert.equal(feed.candidates.length, 1);
  assert.equal(feed.candidates[0].postTitle, 'Public market memo');
  assert.equal(feed.candidates[0].postSlug, 'public-market-memo');
  assert.equal(feed.candidates[0].authorName, 'Jane Writer');
  assert.deepEqual(feed.candidates[0].tags, ['Markets']);
  assert.equal(feed.candidates[0].imageUrl, 'https://cdn.example/post.png');
  assert.equal(feed.candidates[0].publishedAt, '2026-05-29T12:00:00.000Z');
});

test('parsePostHtml extracts visible post text and classifies public posts', () => {
  const post = parsePostHtml(`
    <html>
      <head>
        <meta property="og:title" content="Public market memo">
        <meta property="og:site_name" content="Example Letters">
        <meta property="og:url" content="https://example.substack.com/p/public-market-memo">
        <meta property="article:published_time" content="2026-05-29T12:00:00.000Z">
        <meta property="article:modified_time" content="2026-05-29T13:00:00.000Z">
        <meta property="og:description" content="Short public excerpt.">
        <meta property="og:image" content="https://cdn.example/post.png">
        <meta property="article:tag" content="Markets">
      </head>
      <body>
        <div class="byline"><a href="/profile/jane">Jane Writer</a></div>
        <article><div class="available-content"><div class="body markup">
          <p>First public paragraph.</p>
          <p>Second public paragraph.</p>
        </div></div></article>
        <button>12 Likes</button><a>3 Comments</a>
      </body>
    </html>
  `, 'https://example.substack.com/p/public-market-memo');

  assert.equal(post.postTitle, 'Public market memo');
  assert.equal(post.publicationName, 'Example Letters');
  assert.equal(post.authorName, 'Jane Writer');
  assert.equal(post.authorUrl, 'https://example.substack.com/profile/jane');
  assert.equal(post.publishedAt, '2026-05-29T12:00:00.000Z');
  assert.equal(post.updatedAt, '2026-05-29T13:00:00.000Z');
  assert.equal(post.accessStatus, ACCESS_STATUS.PUBLIC);
  assert.equal(post.isPubliclyReadable, true);
  assert.equal(post.isPaidPreview, false);
  assert.equal(post.likesCount, 12);
  assert.equal(post.commentsCount, 3);
  assert.equal(post.publicPostText, 'First public paragraph.\n\nSecond public paragraph.');
  assert.deepEqual(post.tags, ['Markets']);
});

test('parsePostHtml marks paid preview without bypassing it', () => {
  const post = parsePostHtml(`
    <html>
      <head><meta property="og:title" content="Paid memo"></head>
      <body>
        <article><div class="available-content"><div class="body markup">
          <p>This is the public preview paragraph.</p>
        </div></div></article>
        <div class="paywall">Subscribe to keep reading</div>
      </body>
    </html>
  `, 'https://example.substack.com/p/paid-memo');

  assert.equal(post.accessStatus, ACCESS_STATUS.PREVIEW_ONLY);
  assert.equal(post.isPaidPreview, true);
  assert.equal(post.isPubliclyReadable, false);
  assert.equal(post.publicPostText, 'This is the public preview paragraph.');
});

test('finalizeResult applies include toggles while preserving spreadsheet shape', () => {
  const input = normalizeInput({
    postUrls: ['https://example.substack.com/p/public-market-memo'],
    maxPostsPerPublication: 1,
    includePostText: false,
    includeExcerpt: false,
    includeAuthorInfo: false,
    includePublicationInfo: false,
  });
  const candidate = createPostCandidate({
    postUrl: 'https://example.substack.com/p/public-market-memo',
    sourceInputUrl: 'https://example.substack.com/p/public-market-memo',
  });
  const output = finalizeResult(candidate, {
    publicationName: 'Example Letters',
    publicationUrl: 'https://example.substack.com',
    postTitle: 'Public market memo',
    authorName: 'Jane Writer',
    excerpt: 'Short public excerpt.',
    publicPostText: 'Full public text.',
    isPubliclyReadable: true,
    accessStatus: ACCESS_STATUS.PUBLIC,
  }, input, {
    scrapedAt: '2026-05-29T13:00:00.000Z',
  });

  assert.equal(output.publicationName, null);
  assert.equal(output.authorName, null);
  assert.equal(output.excerpt, null);
  assert.equal(output.publicPostText, null);
  assert.equal(output.postTitle, 'Public market memo');
  assert.equal(output.accessStatus, ACCESS_STATUS.PUBLIC);
});

test('date filtering and URL dedupe helpers are stable', () => {
  const input = normalizeInput({
    postUrls: ['https://example.substack.com/p/public-market-memo'],
    dateFrom: '2026-05-01',
    dateTo: '2026-05-31',
  });
  const result = {
    postUrl: 'https://example.substack.com/p/public-market-memo?utm_source=x',
    publishedAt: '2026-05-29T12:00:00.000Z',
  };

  assert.equal(resultMatchesDateFilter(result, input), true);
  assert.equal(normalizePostUrl(result.postUrl), 'https://example.substack.com/p/public-market-memo');
  assert.equal(postDedupeKey(result), 'https://example.substack.com/p/public-market-memo');
});

test('cleanHtmlText strips markup and normalizes whitespace', () => {
  assert.equal(cleanHtmlText('<p>Hello <strong>public</strong> world.</p>'), 'Hello public world.');
});
