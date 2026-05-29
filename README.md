# Upwork Job Scraper and Job Monitor

Find and monitor public Upwork job listings by keyword, budget, skill, job type, experience level, and posted time. This Apify Actor returns clean opportunity data that freelancers, agencies, lead generators, and automation builders can review, export, and use in workflows.

This Actor is designed for job discovery and market research. It does not apply to jobs, scrape private messages, scrape freelancer profiles, collect client emails, or attempt to deanonymize clients.

## What this Actor does

The Actor opens public Upwork job search pages for your keywords, extracts visible job opportunity data, applies your filters, removes duplicates, and saves the results to the default Apify dataset.

It can collect fields such as:

- Job title and original Upwork job URL
- Posted time and scrape time
- Fixed-price budget or hourly range
- Experience level, estimated duration, and workload
- Skills and tags when visible
- Description snippet and optional full description
- Public client metadata when visible
- Proposal-count bucket when visible
- Source keyword, matched keywords, and a simple relevance score

## Who it is for

- Freelancers looking for new Upwork opportunities
- Agencies monitoring client-work demand
- Sales teams looking for buying intent
- Automation builders using Apify, Make, Zapier, n8n, or Google Sheets
- Recruiters and researchers tracking freelance market demand
- Operators building daily job alert workflows

## Main use cases

- Find new Upwork jobs by keyword
- Track high-budget Upwork jobs
- Monitor niche freelance opportunities
- Export jobs to CSV, Excel, JSON, or API
- Send job data into automations and alerts
- Research demand for specific freelance skills

## Input

| Field | Type | Description |
| --- | --- | --- |
| `keywords` | array | Search terms to monitor, for example `web scraping`, `python automation`, `n8n`, or `zapier`. |
| `maxResults` | integer | Maximum number of jobs to return across all keywords. |
| `minBudget` | integer or null | Optional minimum fixed-price budget in USD. |
| `maxBudget` | integer or null | Optional maximum fixed-price budget in USD. |
| `jobType` | string | `fixed`, `hourly`, or `both`. |
| `experienceLevel` | string | `entry`, `intermediate`, `expert`, or `all`. |
| `postedWithin` | string | `last24h`, `last7d`, or `all`. |
| `includeDescription` | boolean | When true, opens job pages and attempts to extract the full public description. |
| `includeSkills` | boolean | Extract public skills and tags when visible. |
| `deduplicateResults` | boolean | Remove duplicate jobs across keyword searches. |
| `proxyConfiguration` | object | Apify Proxy settings. Apify Proxy is recommended for cloud runs. |

## Example input

```json
{
  "keywords": ["web scraping", "python automation", "n8n", "zapier"],
  "maxResults": 50,
  "jobType": "both",
  "experienceLevel": "all",
  "postedWithin": "last7d",
  "minBudget": 500,
  "maxBudget": null,
  "includeDescription": false,
  "includeSkills": true,
  "deduplicateResults": true,
  "proxyConfiguration": {
    "useApifyProxy": true
  }
}
```

## Output

Each dataset item is a spreadsheet-ready job record.

```json
{
  "jobTitle": "Python web scraping automation specialist",
  "jobUrl": "https://www.upwork.com/jobs/Python-Scraper_~0123456789abcdef/",
  "jobId": "~0123456789abcdef",
  "postedAt": "2026-05-29T09:00:00.000Z",
  "scrapedAt": "2026-05-29T12:00:00.000Z",
  "jobType": "fixed",
  "fixedBudget": 1200,
  "hourlyMin": null,
  "hourlyMax": null,
  "experienceLevel": "intermediate",
  "estimatedDuration": "1 to 3 months",
  "workload": "Less than 30 hrs/week",
  "skills": ["Python", "Web Scraping", "Automation"],
  "descriptionSnippet": "We need a Python developer to build a reliable scraping workflow for public product data and export clean CSV files.",
  "fullDescription": null,
  "clientCountry": "United States",
  "clientRating": 4.9,
  "clientSpent": "$10K+ spent",
  "proposalsCount": "Less than 5",
  "sourceSearchKeyword": "web scraping",
  "matchedKeywords": ["web scraping", "python automation"],
  "relevanceScore": 88
}
```

The Actor also writes `RUN_SUMMARY` to the default key-value store. This is useful for monitoring scheduled runs because it includes `status`, counts, and warnings. Possible statuses include:

- `ok`: jobs were collected without warnings
- `partial`: jobs were collected, but some searches had warnings
- `no_results`: the run completed but no matching jobs were found
- `blocked`: Upwork returned an access challenge or HTTP 403/429
- `empty_pages`: pages loaded, but no job cards were detected
- `failed_requests`: all search requests failed before extraction

Blocked or empty runs do not create fake dataset rows. Check `RUN_SUMMARY` and the run log for the reason.

## How to run

### On Apify

1. Open the Actor in Apify Console.
2. Enter one or more keywords.
3. Choose `maxResults` and optional filters.
4. Run the Actor.
5. Open the Dataset tab to view, filter, or export results.

### Locally

```bash
npm install
npm start
```

For local runs, Apify SDK reads input from local storage. You can create `storage/key_value_stores/default/INPUT.json` using `examples/input.json`.

You can also run a tiny local smoke test without Apify Proxy:

```bash
npx apify-cli run --purge --input-file examples/local-smoke-input.json
```

Upwork often returns HTTP 403 or a challenge page from residential/local networks. That is expected in some environments; cloud runs should use Apify Proxy.

## Exporting results

Apify datasets can be exported as:

- CSV
- Excel
- JSON
- JSONL
- XML
- RSS

From Apify Console, open the Actor run, go to Dataset, and choose Export. You can also fetch results through the Dataset API.

## API usage

Run the Actor through the Apify API:

```bash
curl "https://api.apify.com/v2/acts/YOUR_USERNAME~upwork-job-scraper-and-job-monitor/runs?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/input.json
```

After the run finishes, read the dataset items:

```bash
curl "https://api.apify.com/v2/datasets/DATASET_ID/items?format=json&clean=true&token=YOUR_APIFY_TOKEN"
```

## Make, Zapier, n8n, and Google Sheets

This Actor works well in no-code and automation workflows:

- Schedule the Actor to run daily or hourly in Apify.
- Use Apify integrations to trigger Make, Zapier, or n8n after a run finishes.
- Export the default dataset to Google Sheets.
- Filter by `relevanceScore`, `fixedBudget`, `hourlyMin`, `postedAt`, or `sourceSearchKeyword`.
- Send high-fit jobs to Slack, email, Airtable, Notion, a CRM, or a review queue.

For daily monitoring, set `postedWithin` to `last24h`, keep `deduplicateResults` enabled, and schedule the Actor in Apify.

## Pricing suggestion

Suggested commercial pricing:

- Pay per result: `$1.50` to `$3.00` per 1,000 jobs scraped.
- Alternative: `$0.01` per matched job result.

For the first Store version, pay-per-result is simpler for buyers because value maps directly to usable job opportunities. Keep `includeDescription` off by default because opening every job page increases compute usage.

## Limitations

- Upwork may show access challenges or change page structure. The Actor detects challenge pages and writes useful logs.
- Upwork is strict about automated access. For production monitoring, use Apify Proxy and consider residential proxy groups if your account has access.
- Some fields are only returned when publicly visible on the listing or job page.
- `includeDescription` is slower because it opens each job page.
- Posted-time filters depend on visible text such as `Posted 2 hours ago`.
- This Actor does not replace Upwork's own search, saved searches, or account features.

## Responsible use

Use this Actor only for discovering and reviewing public job opportunities. Do not use it to spam clients, automate proposals, scrape private messages, scrape freelancer profiles, collect emails, bypass Upwork account controls, or violate Upwork's terms. Always click through to Upwork and apply manually through Upwork's normal workflow.

## FAQ

### Does this Actor auto-apply to jobs?

No. It only returns public job opportunity data and the original Upwork URL.

### Does it scrape freelancer profiles?

No. The scope is public job listings and public job post pages only.

### Can I monitor jobs every day?

Yes. Create an Apify schedule and use `postedWithin: "last24h"` for daily monitoring.

### Why are some fields null?

Upwork does not show every field on every listing. The Actor returns `null` when a field is unavailable instead of inventing data.

### Can I export to Google Sheets?

Yes. Use Apify's dataset export or Apify integrations to send results to Google Sheets.

### What should I do if Upwork returns a challenge page?

Use Apify Proxy, reduce concurrency, keep runs moderate, and try again later. Enable `saveDebugHtml` only when troubleshooting.

## Version 2 ideas

- Stateful monitoring that returns only jobs not seen in previous runs
- Webhook alerts
- Slack, Discord, Telegram, and email alert templates
- AI job fit scoring
- High-budget job finder mode
- Low-competition job finder mode
- Skill demand analysis
- Saved search presets
- Client quality scoring from public fields

## Development

```bash
npm install
npm test
npm run lint
```

The parser has unit tests so basic extraction behavior can be validated without making live Upwork requests.
