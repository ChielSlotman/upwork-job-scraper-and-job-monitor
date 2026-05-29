import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPublicJobSearchFilter,
  hasUpworkApiCredentials,
  mapPublicApiJob,
} from '../src/upwork-api.js';
import {
  buildSearchUrl,
  extractJobIdFromUrl,
  finalizeJob,
  jobMatchesFilters,
  normalizeInput,
  parseJobCard,
  parseRelativePostedAt,
} from '../src/upwork.js';

test('buildSearchUrl creates a recency-sorted Upwork search URL', () => {
  const url = new URL(buildSearchUrl('web scraping'));

  assert.equal(url.origin, 'https://www.upwork.com');
  assert.equal(url.pathname, '/nx/search/jobs/');
  assert.equal(url.searchParams.get('q'), 'web scraping');
  assert.equal(url.searchParams.get('sort'), 'recency');
});

test('extractJobIdFromUrl handles common Upwork job URL formats', () => {
  assert.equal(
    extractJobIdFromUrl('https://www.upwork.com/jobs/Python-Scraper_~0123456789abcdef/'),
    '~0123456789abcdef',
  );
  assert.equal(
    extractJobIdFromUrl('https://www.upwork.com/jobs/~02123456789abcdef?source=rss'),
    '~02123456789abcdef',
  );
});

test('parseRelativePostedAt normalizes relative posted times', () => {
  const now = new Date('2026-05-29T12:00:00.000Z');
  const parsed = parseRelativePostedAt('Posted 2 hours ago', now);

  assert.equal(parsed.postedAt, '2026-05-29T10:00:00.000Z');
  assert.equal(parsed.ageHours, 2);
});

test('parseJobCard extracts fixed-price job fields from listing text', () => {
  const now = new Date('2026-05-29T12:00:00.000Z');
  const job = parseJobCard({
    jobTitle: 'Python web scraping automation specialist',
    jobUrl: 'https://www.upwork.com/jobs/Python-Scraper_~0123456789abcdef/',
    text: `
Posted 3 hours ago
Python web scraping automation specialist
Fixed-price: $1,200
Intermediate
Est. time: 1 to 3 months, Less than 30 hrs/week
We need a Python developer to build a reliable scraping workflow for public product data and export clean CSV files.
Python
Web Scraping
Automation
Proposals: Less than 5
$10K+ spent
`,
  }, 'web scraping', { now, scrapedAt: now.toISOString() });

  assert.equal(job.jobTitle, 'Python web scraping automation specialist');
  assert.equal(job.jobId, '~0123456789abcdef');
  assert.equal(job.jobType, 'fixed');
  assert.equal(job.fixedBudget, 1200);
  assert.equal(job.experienceLevel, 'intermediate');
  assert.equal(job.estimatedDuration, '1 to 3 months');
  assert.equal(job.workload, 'Less than 30 hrs/week');
  assert.equal(job.proposalsCount, 'Less than 5');
  assert.equal(job.clientSpent, '$10K+ spent');
  assert.ok(job.skills.includes('Python'));
});

test('parseJobCard extracts hourly ranges', () => {
  const job = parseJobCard({
    text: `
Posted 1 hour ago
Zapier and n8n workflow builder
Hourly: $35.00 - $80.00
Expert
Est. time: More than 6 months, 30+ hrs/week
Build and maintain automations across Zapier, n8n, Airtable, and Google Sheets.
Zapier
n8n
API Integration
`,
  }, 'n8n', { now: new Date('2026-05-29T12:00:00.000Z') });

  assert.equal(job.jobType, 'hourly');
  assert.equal(job.hourlyMin, 35);
  assert.equal(job.hourlyMax, 80);
  assert.equal(job.experienceLevel, 'expert');
});

test('jobMatchesFilters applies budget, experience, type, and posted time filters', () => {
  const input = normalizeInput({
    keywords: ['web scraping'],
    maxResults: 10,
    jobType: 'fixed',
    experienceLevel: 'intermediate',
    postedWithin: 'last24h',
    minBudget: 500,
  });
  const matchingJob = parseJobCard({
    text: `
Posted 4 hours ago
Web scraping project
Fixed-price: $900
Intermediate
A public data extraction project with clear requirements and CSV export.
`,
  }, 'web scraping', { now: new Date('2026-05-29T12:00:00.000Z') });
  const oldJob = { ...matchingJob, _ageHours: 240 };

  assert.equal(jobMatchesFilters(matchingJob, input), true);
  assert.equal(jobMatchesFilters(oldJob, input), false);
});

test('normalizeInput defaults to residential proxy and low concurrency for Upwork', () => {
  const input = normalizeInput({
    keywords: ['web scraping'],
    maxResults: 10,
  });

  assert.equal(input.maxConcurrency, 1);
  assert.deepEqual(input.proxyConfiguration.apifyProxyGroups, ['RESIDENTIAL']);
  assert.equal(input.proxyConfiguration.apifyProxyCountry, undefined);
});

test('normalizeInput keeps official API mode and secret fields', () => {
  const input = normalizeInput({
    keywords: ['web scraping'],
    maxResults: 10,
    sourceMode: 'officialApi',
    upworkApiAccessToken: '  token-value  ',
    upworkApiTenantId: '  tenant-123  ',
  });

  assert.equal(input.sourceMode, 'officialApi');
  assert.equal(input.upworkApiAccessToken, 'token-value');
  assert.equal(input.upworkApiTenantId, 'tenant-123');
  assert.equal(hasUpworkApiCredentials(input, {}), true);
});

test('buildPublicJobSearchFilter uses official Upwork API pagination and posted filters', () => {
  const input = normalizeInput({
    keywords: ['python automation'],
    maxResults: 10,
    postedWithin: 'last7d',
  });
  const filter = buildPublicJobSearchFilter(input, 'python automation', {
    pageOffset: 20,
    pageSize: 10,
  });

  assert.deepEqual(filter, {
    searchExpression_eq: 'python automation',
    daysPosted_eq: 7,
    pagination: {
      pageOffset: 20,
      pageSize: 10,
    },
  });
});

test('mapPublicApiJob converts Upwork GraphQL jobs into dataset-ready records', () => {
  const job = mapPublicApiJob({
    id: '123',
    title: 'Build a Python web scraping workflow',
    publishedDateTime: '2026-05-29T10:00:00Z',
    type: 'FIXED',
    ciphertext: '~02123456789abcdef',
    description: '<p>Need a reliable scraper for public product data.</p>',
    skills: [
      { prettyName: 'Python' },
      { name: 'web-scraping', prettyName: 'Web Scraping' },
    ],
    amount: {
      rawValue: '1500',
      currency: 'USD',
      displayValue: '$1,500',
    },
    contractorTier: 'INTERMEDIATE',
    durationLabel: '1 to 3 months',
    engagement: 'Less than 30 hrs/week',
    totalApplicants: 8,
    client: {
      totalFeedback: 4.9,
      location: {
        country: 'United States',
      },
    },
  }, 'web scraping', { scrapedAt: '2026-05-29T12:00:00.000Z' });

  assert.equal(job.jobTitle, 'Build a Python web scraping workflow');
  assert.equal(job.jobUrl, 'https://www.upwork.com/jobs/~02123456789abcdef/');
  assert.equal(job.jobId, '~02123456789abcdef');
  assert.equal(job.jobType, 'fixed');
  assert.equal(job.fixedBudget, 1500);
  assert.equal(job.experienceLevel, 'intermediate');
  assert.equal(job.clientCountry, 'United States');
  assert.equal(job.clientRating, 4.9);
  assert.equal(job.proposalsCount, '8');
  assert.ok(job.skills.includes('Python'));
});

test('finalizeJob returns spreadsheet-ready output with keyword score', () => {
  const input = normalizeInput({
    keywords: ['web scraping', 'python automation'],
    maxResults: 10,
    includeSkills: true,
    includeDescription: true,
  });
  const job = parseJobCard({
    jobTitle: 'Python automation and web scraping expert',
    jobUrl: 'https://www.upwork.com/jobs/Python_~0123456789abcdef/',
    descriptionSnippet: 'Build a Python automation that performs web scraping and exports results.',
    skills: ['Python', 'Web Scraping'],
    text: 'Posted 1 hour ago\nHourly: $30.00 - $60.00\nExpert',
  }, 'web scraping', { now: new Date('2026-05-29T12:00:00.000Z') });
  const output = finalizeJob(job, input);

  assert.deepEqual(output.matchedKeywords, ['web scraping', 'python automation']);
  assert.equal(output.jobUrl, 'https://www.upwork.com/jobs/Python_~0123456789abcdef/');
  assert.equal(typeof output.relevanceScore, 'number');
  assert.ok(output.relevanceScore > 50);
  assert.equal(Object.hasOwn(output, '_rawText'), false);
});
