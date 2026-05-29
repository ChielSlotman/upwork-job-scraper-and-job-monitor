# Apify Store listing copy

## Store title

Substack Publication and Post Scraper

## Subtitle

Extract public Substack posts, authors, publication details, dates, URLs, excerpts, and article text for research and AI workflows.

## SEO title

Substack Publication and Post Scraper

## SEO description

Scrape public Substack posts, authors, publication data, dates, excerpts, URLs, and article text. Export newsletter data for research and AI workflows.

## Short marketing description

Extract clean public Substack publication and post data for content research, competitor tracking, AI summaries, and newsletter analysis.

## Long marketing description

Substack Publication and Post Scraper helps researchers, AI builders, marketers, agencies, founders, and newsletter operators collect structured data from public Substack publications and posts without manually opening every newsletter.

Enter one or more public Substack publication URLs or direct post URLs. The Actor reads public publication pages, public RSS feeds, and public post pages, then returns spreadsheet-ready data including publication metadata, post titles, URLs, slugs, authors, dates, excerpts, images, tags, visible engagement counts, and optional public article text.

This Actor is designed as a public research and content monitoring tool. It does not log in, bypass paywalls, scrape subscriber-only content, collect private user data, or access hidden private information. Paid or preview-only posts are clearly marked as `preview_only`, and only visible preview content is returned.

Use it to build public newsletter datasets, monitor competitor publications, power AI summarization workflows, track publishing frequency, export data to CSV/Excel/JSON, or connect public Substack content to Make, Zapier, n8n, Google Sheets, and custom APIs.

## Suggested categories

- Marketing
- Social media
- Content marketing
- News
- AI
- Research
- Automation

## Suggested tags

- substack
- newsletter
- newsletter scraper
- substack scraper
- content research
- competitor research
- market research
- public posts
- ai workflows
- article text
- newsletter monitoring
- make
- zapier
- n8n
- google sheets
- apify api

## Main value propositions

- Extract public Substack publication and post data in minutes.
- Collect public article text for AI summaries and research workflows.
- Support publication URLs, direct post URLs, or both.
- Mark posts as public, preview-only, or unavailable.
- Avoid duplicate posts across multiple inputs.
- Export clean spreadsheet-ready data to CSV, Excel, JSON, or API.
- Use public RSS feeds and public post pages without login sessions.

## Example use cases

- AI builders collect public newsletter posts for summarization.
- Marketers research competing newsletters in a niche.
- Agencies monitor public client and competitor content.
- Researchers study public authors, topics, and publishing frequency.
- Founders track market narratives across influential writers.
- Newsletter operators analyze similar publications.
- Operations teams send new public posts to Slack, Notion, Airtable, or Google Sheets.

## Suggested pricing

Start with pay per result:

- `$1.50` to `$3.00` per 1,000 public posts scraped

Alternative event pricing:

- `$0.002` to `$0.005` per public post result

Pay per result is easy for buyers to understand and maps directly to usable dataset rows. The Actor uses static HTTP requests instead of browser automation, which helps keep compute costs low.

## Responsible use note

This Actor extracts publicly visible Substack publication and post information for research, content monitoring, and analysis. It must not be used to bypass paywalls, scrape paid subscriber-only content, collect private user data, access login-only pages, or violate Substack's terms or creator rights. Paid or preview-only posts are returned only with publicly visible preview data and are marked as `preview_only`.

## Launch checklist

- Confirm Actor slug: `substack-publication-and-post-scraper`.
- Confirm title, subtitle, SEO title, and SEO description.
- Run a local smoke test with `examples/local-smoke-input.json`.
- Run an Apify cloud test with one public publication URL and `maxPostsPerPublication: 5`.
- Test direct `postUrls` input.
- Test `includePostText: true` and `includePostText: false`.
- Test date filters.
- Verify dataset schema and table view in Apify Console.
- Export CSV, JSON, and Excel to confirm spreadsheet-ready output.
- Confirm `RUN_SUMMARY` appears in the key-value store.
- Review responsible-use copy in README and Store listing.
- Add paid pricing.
- Publish as a commercial Apify Store Actor.

## Version 2 roadmap

- Scheduled monitoring with only-new-posts mode.
- Webhook alerts for new public posts.
- RSS-style monitoring output.
- AI topic classification.
- AI summary field.
- Author discovery.
- Newsletter discovery by topic.
- Keyword filtering inside posts.
- Google Sheets export preset.
- Competitor newsletter tracker.
- Substack trend monitor.
