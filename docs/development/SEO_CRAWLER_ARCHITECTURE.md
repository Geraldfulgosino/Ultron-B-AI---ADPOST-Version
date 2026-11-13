# SEO Crawler Architecture

**Code:**
- `supabase/functions/_shared/integrations/crawler.ts`
- service: `runTechnicalCrawl` in `sync.ts`
- Edge action: `integration-sync`, action `crawl`

**Tests:** `src/test/integrations/crawler.test.ts` (7 tests).

## Configuration and defaults
| Setting | Default / cap |
|---|---|
| Start URL | Website origin. Must be one of the website's hosts |
| Allowed hosts | The website host and its `www`/apex twin only |
| `maxPages` | 50 (crawler cap 500; capped at **100 per Edge invocation**) |
| `maxDepth` | 3 (cap 10; capped at 5 per Edge invocation) |
| Concurrency | 1 (sequential) |
| Delay | 250 ms, or the robots `Crawl-delay` (max 5 s) |
| Request timeout | 15 s |
| Wall-clock budget | 110 s per invocation |
| Body cap | 3 MB per page, 5 MB per sitemap |
| User agent | `ULTRON-B-SEO-Crawler/0.1 (read-only; low rate)` |
| Robots | `robots.txt` path rules for our agent or `*`: longest match, Allow wins ties, `*` and `$` supported |
| Cancellation | `signal.cancelled` is checked before each page |

## Security
- **Every request and every redirect hop** goes through `safeFetch`:
  - http/https only, on default ports;
  - no credentials in URLs;
  - every DNS answer must be public, so loopback, private, CGNAT, link-local and metadata addresses (169.254.169.254, `metadata.google.internal`) are all rejected;
  - reserved `.example`/`.test`/`.invalid` domains are blocked.
- Redirects are followed manually and re-validated. A redirect off the site is recorded and not followed.
- **DNS rebinding:** DNS is resolved and checked on every request and hop. The tests cover a host that turns private mid-crawl. A residual time-of-check/time-of-use gap remains between the check and the connection inside the runtime's `fetch` (SEO_EXECUTION_SECURITY.md). Production hardening should pin the resolved IP, through a connector proxy.
- HTML is parsed as text. Scripts are never executed. Page text is untrusted data, and is never used as instructions for agents.

## Checks
**Observed (measured facts):**
- HTTP errors and fetch errors
- redirect chains longer than 1 hop
- missing title, meta description or H1
- noindex (high severity when the page is in the sitemap)
- missing canonical, or a canonical pointing elsewhere
- images without alt
- missing viewport
- invalid JSON-LD
- duplicate titles and descriptions
- broken internal links (only where the target was actually fetched)
- `robots.txt` missing, or without a Sitemap line
- no sitemap URLs

**Heuristics (guidelines, lower confidence):**
- title or description length
- multiple H1s
- heading-level skips
- thin content
- identical visible text (duplicate-content candidates)
- orphan-page candidates. These are reported only after a **complete** crawl, using sitemap URLs plus the WordPress inventory when it is complete.

**Every finding carries:**
- check id and kind (observed or heuristic);
- severity and confidence;
- subject URL and evidence, including `observedAt`;
- recommendation and an optional suggested task;
- a stable **fingerprint**, so re-runs do not duplicate.

Findings never claim that a page is indexed.

## Persistence
- `seo_crawl_jobs`: at most one active job per website.
- `seo_crawl_pages`.
- `seo_findings`: upserted by (website, fingerprint). Previously open crawler findings become `resolved` only after a complete crawl that no longer sees them.

## Scaling beyond one invocation
Large crawls should not run inside a single Edge Function. Recommended next step: a durable job runner that processes `seo_crawl_jobs` in batches, resuming from a stored frontier. Options are a scheduled Edge Function with a cursor, or a worker. Not implemented.

## Planned checks
- **Pages without Article/BlogPosting schema:** the live pilot crawl showed blog posts carry only site-level schema (Organization, WebSite, Place, ImageObject). Joining crawl pages with the WordPress post inventory would make this an observed finding.
- **Performance:** PageSpeed Insights / Core Web Vitals are not integrated. No performance numbers are produced.
