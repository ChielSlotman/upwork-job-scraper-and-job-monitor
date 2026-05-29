import assert from 'node:assert/strict';
import test from 'node:test';
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
