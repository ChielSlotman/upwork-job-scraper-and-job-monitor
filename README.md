# Substack Publication and Post Scraper

Extract clean public Substack publication, author, and post data for research, content monitoring, competitor analysis, market research, and AI workflows.

This Apify Actor reads public Substack publication pages, public RSS feeds, and public post pages. It does not log in, bypass paywalls, scrape private subscriber-only content, or collect hidden private data. If a post is paid or preview-only, the Actor returns only the publicly visible preview information and marks it as `preview_only`.

## What this Actor does

Substack Publication and Post Scraper lets you enter one or more Substack publication URLs and/or direct post URLs and receive spreadsheet-ready data in the default Apify dataset.

It can extract:

- Publication name, URL, description, logo, and visible topic/category
- Post title, URL, slug, dates, excerpt, image, tags, and public article text
- Public author name and author profile URL when visible
- Visible likes and comments counts when readable from the public page
- Public access status: `public`, `preview_only`, or `unavailable`
- Source input URL and scrape timestamp for every row

## Who it is for

- AI builders collecting public posts for summaries, RAG, and research datasets
- Content marketers researching newsletters and creators
- Agencies tracking public competitor content
- Researchers studying niche writers, media markets, or publication frequency
- Founders monitoring industry narratives and market trends
- Newsletter operators analyzing comparable publications
- Apify, Make, Zapier, n8n, Google Sheets, and API users building automations

## Main use cases

- Extract public posts from one or more Substack publications
- Build a dataset of public newsletter articles
- Monitor public posts from specific newsletters
- Research competitors in a niche
- Collect public content for AI summarization workflows
- Export Substack data to CSV, JSON, Excel, or API
- Track publishing frequency, authors, URLs, and topics
- Discover useful public authors and publications

## Input

| Field | Type | Description |
| --- | --- | --- |
| `publicationUrls` | array | Public Substack publication URLs, for example `https://astralcodexten.substack.com`. The Actor reads public metadata and public RSS feeds. |
| `postUrls` | array | Optional direct public Substack post URLs. Useful when you already know the exact posts to extract. |
| `maxPostsPerPublication` | integer | Maximum posts to collect from each publication feed. Default is `25`; maximum is `500`. |
| `includePostText` | boolean | Include publicly visible article body text or public preview text. Default is `true`. |
| `includeExcerpt` | boolean | Include public excerpts from RSS or page metadata. Default is `true`. |
| `includeAuthorInfo` | boolean | Include public author name and URL when visible. Default is `true`. |
| `includePublicationInfo` | boolean | Include publication name, URL, description, logo, and topic when available. Default is `true`. |
| `dateFrom` | string or null | Optional start date filter, such as `2026-01-01`. |
| `dateTo` | string or null | Optional end date filter, such as `2026-12-31`. |
| `deduplicateResults` | boolean | Remove duplicate posts across publication feeds and direct post URLs. Default is `true`. |
| `maxConcurrency` | integer | Advanced option for parallel public post page requests. Default is `5`. |
| `requestTimeoutSecs` | integer | Advanced request timeout. Default is `30`. |
| `maxRetries` | integer | Advanced retry count for temporary network errors. Default is `2`. |
| `saveDebugHtml` | boolean | Save fetched post HTML for troubleshooting. Keep disabled for normal runs. |

At least one `publicationUrls` or `postUrls` entry is required.

## Example input

```json
{
  "publicationUrls": ["https://astralcodexten.substack.com"],
  "postUrls": [],
  "maxPostsPerPublication": 10,
  "includePostText": true,
  "includeExcerpt": true,
  "includeAuthorInfo": true,
  "includePublicationInfo": true,
  "dateFrom": null,
  "dateTo": null,
  "deduplicateResults": true,
  "maxConcurrency": 5
}
```

Direct post example:

```json
{
  "publicationUrls": [],
  "postUrls": [
    "https://www.astralcodexten.com/p/book-review-the-dialectical-imagination"
  ],
  "maxPostsPerPublication": 1,
  "includePostText": true,
  "deduplicateResults": true
}
```

## Output

Each dataset item is one public Substack post record.

```json
{
  "publicationName": "Astral Codex Ten",
  "publicationUrl": "https://www.astralcodexten.com",
  "publicationDescription": "P(A|B) = [P(A)*P(B|A)]/P(B), all the rest is commentary.",
  "publicationLogo": "https://substackcdn.com/image/fetch/...",
  "publicationTopic": null,
  "postTitle": "Book Review: The Dialectical Imagination",
  "postUrl": "https://www.astralcodexten.com/p/book-review-the-dialectical-imagination",
  "postSlug": "book-review-the-dialectical-imagination",
  "authorName": "Scott Alexander",
  "authorUrl": null,
  "publishedAt": "2026-05-29T15:01:57.000Z",
  "updatedAt": "2026-05-29T15:01:57.859Z",
  "excerpt": "...",
  "publicPostText": "The visible public article text or public preview text...",
  "isPaidPreview": false,
  "isPubliclyReadable": true,
  "accessStatus": "public",
  "likesCount": 22,
  "commentsCount": null,
  "imageUrl": "https://substackcdn.com/image/fetch/...",
  "tags": [],
  "sourceInputUrl": "https://astralcodexten.substack.com",
  "scrapedAt": "2026-05-29T12:00:00.000Z"
}
```

The Actor also writes `RUN_SUMMARY` to the default key-value store with counts, warnings, and status. Possible statuses include:

- `ok`: results were collected without warnings
- `partial`: results were collected, but some posts were preview-only, unavailable, or had warnings
- `no_results`: the run completed but no matching posts were found
- `failed_or_empty`: publication or post requests failed and no dataset items were produced

## How to run

### On Apify

1. Open the Actor in Apify Console.
2. Enter one or more public Substack publication URLs or direct post URLs.
3. Choose `maxPostsPerPublication` and optional date filters.
4. Run the Actor.
5. Open the Dataset tab to view, filter, or export results.

### Locally

```bash
npm install
npm start
```

For local Apify SDK runs, create `storage/key_value_stores/default/INPUT.json` or run with the Apify CLI:

```bash
npx apify-cli run --purge --input-file examples/local-smoke-input.json
```

## Exporting results

Apify datasets can be exported as:

- CSV
- Excel
- JSON
- JSONL
- XML
- RSS

From Apify Console, open a run, go to Dataset, and choose Export. You can also fetch results through the Dataset API.

## API usage

Run the Actor through the Apify API:

```bash
curl "https://api.apify.com/v2/acts/YOUR_USERNAME~substack-publication-and-post-scraper/runs?token=YOUR_APIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d @examples/input.json
```

After the run finishes, read dataset items:

```bash
curl "https://api.apify.com/v2/datasets/DATASET_ID/items?format=json&clean=true&token=YOUR_APIFY_TOKEN"
```

Read the run summary:

```bash
curl "https://api.apify.com/v2/key-value-stores/STORE_ID/records/RUN_SUMMARY?token=YOUR_APIFY_TOKEN"
```

## Make, Zapier, n8n, and Google Sheets

This Actor is built for automation workflows:

- Schedule it in Apify to monitor public newsletters daily or hourly.
- Use Apify integrations to trigger Make, Zapier, or n8n after a run finishes.
- Export the default dataset to Google Sheets.
- Filter by `publicationName`, `authorName`, `publishedAt`, `accessStatus`, `tags`, or `sourceInputUrl`.
- Send new public posts to Slack, email, Airtable, Notion, a CRM, or an AI summarization pipeline.

For monitoring, keep `deduplicateResults` enabled and use `dateFrom`/`dateTo` or a scheduled run window.

## Responsible use

Use this Actor only for public research, content monitoring, and analysis of publicly visible Substack pages. Do not use it to bypass paywalls, access paid subscriber-only content, collect private user data, scrape login-only pages, or violate Substack's terms or any creator's rights.

The Actor does not use login sessions. It reads public RSS feeds and public post pages. If a paid post exposes only a preview, the Actor returns only that public preview and marks `accessStatus` as `preview_only`.

## Pricing suggestion

Suggested commercial Store pricing:

- Pay per result: `$1.50` to `$3.00` per 1,000 public posts scraped
- Alternative event pricing: `$0.002` to `$0.005` per public post result

Pay per result is simple for buyers because value maps directly to usable post records. Keep `includePostText` available by default for AI workflows, and use moderate `maxPostsPerPublication` values for efficient runs.

## Limitations

- The Actor only collects data visible on public pages or public RSS feeds.
- It does not access paid subscriber-only content, private content, drafts, comments behind login, or hidden private APIs.
- RSS feeds may include only recent posts, depending on the publication.
- Some fields are `null` when Substack or the publication does not expose them publicly.
- Likes and comments counts are returned only when visible and parseable from the public page.
- Custom-domain Substacks are supported when they expose a standard public RSS feed and public post pages.
- Very large `publicPostText` fields can make CSV/Excel exports heavier.

## FAQ

### Does this Actor bypass Substack paywalls?

No. It only reads public pages and public RSS feeds. Paid or preview-only posts are marked as `preview_only`, and only visible preview text is returned.

### Does it require a Substack login?

No. The Actor does not use login sessions, cookies, or subscriber accounts.

### Can I scrape direct post URLs?

Yes. Put direct public post URLs in `postUrls`. You can use `publicationUrls`, `postUrls`, or both.

### Why are some fields null?

Substack does not expose every field on every public page. The Actor returns `null` instead of guessing.

### Can I use this for AI summaries?

Yes. Enable `includePostText` and send `publicPostText`, `postTitle`, `authorName`, and `postUrl` into your AI workflow.

### Can I export to Google Sheets?

Yes. Use Apify dataset export, Apify integrations, Make, Zapier, n8n, or the Apify API.

### How do I monitor new posts?

Create an Apify schedule and set a date filter or process only new dataset rows in your downstream automation. A future version can add stateful "new posts only" mode.

## Version 2 ideas

- Scheduled monitoring with "return only new posts since last run"
- Webhook alert templates
- RSS-style monitoring output
- AI topic classification
- AI summary field
- Author discovery
- Newsletter discovery by topic
- Keyword filtering inside public posts
- Google Sheets export preset
- Competitor newsletter tracker
- Substack trend monitor

## Launch checklist

- Confirm Actor name: `substack-publication-and-post-scraper`
- Confirm Store title: `Substack Publication and Post Scraper`
- Run a smoke test with `examples/local-smoke-input.json`
- Verify dataset columns in the Apify Output tab
- Export CSV, JSON, and Excel to confirm spreadsheet-ready fields
- Test publication URL input and direct post URL input
- Test `includePostText: true` and `includePostText: false`
- Test date filters
- Review `RUN_SUMMARY` after a successful run
- Review responsible-use copy before publishing
- Add paid pricing in Apify Console
- Publish as a commercial Apify Store Actor

## Development

```bash
npm install
npm test
npm run lint
```

The parser has unit tests for input normalization, RSS parsing, public post extraction, paid-preview classification, date filtering, and output shaping.
