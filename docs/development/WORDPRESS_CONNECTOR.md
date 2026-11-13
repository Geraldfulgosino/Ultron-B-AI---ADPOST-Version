# WordPress Connector

**Code:**
- `supabase/functions/_shared/integrations/wordpress.ts`
- service: `sync.ts`
- Edge: `integration-sync`

**Tests:** `src/test/integrations/wordpress.test.ts` (18 tests, including encryption), `sync.test.ts`.

## Operations (all GET, read-only)
| Function | Endpoint | Auth |
|---|---|---|
| `discoverWordPress` | `/wp-json/`, plus `per_page=1` counts on pages, posts, media, categories and tags | none |
| `listWordPressContent(type)` | `/wp/v2/{pages,posts,categories,tags,media}`. `per_page=100`, `orderby=id`, `_fields` limited, paginated by `X-WP-TotalPages` | none, or an Application Password |
| `testWordPressCredentials` | `/wp/v2/users/me?context=edit` | Application Password |

### Discovery detects
- **SEO plugin:** Rank Math, Yoast, AIOSEO or SEOPress, from REST namespaces.
- **Elementor** and **Google Site Kit**.
- Whether **Application Passwords** are available.
- **Content counts.**

### Discovery checks
- **Ownership:** the site's reported `home` must be the same site as the website record. Otherwise it fails with `site_mismatch`.

## Normalized record
- **Identity:** `externalId` (the WordPress id is preserved), `type`, `url`, `slug`, `title` (entities decoded, plain text).
- **Status and dates:** `status`, `publishedAt` and `modifiedAt` (GMT ISO), author, parent, featured media.
- **Taxonomy:** category and tag ids.
- **Text fields:** `excerpt` as plain text, at most 300 characters.
- **Media fields:** alt text, MIME type.
- **Fingerprint:** a hash of the visible fields. Re-syncs write only changed rows. Items missing after a *complete* listing are marked `removed_at`; nothing is deleted.

## Authentication
- **Application Passwords only, over HTTPS.** The main WordPress password is never requested.
- Use a dedicated WordPress user with the fewest capabilities. An administrator account triggers a warning.
- The credential is checked against WordPress first, then stored encrypted. See INTEGRATION_SECURITY.md.
- The `Authorization` header goes only to the site's origin and is dropped on any cross-origin redirect (tested).

## Pilot facts (live, public, 2026-11-13)
- WordPress REST API is open. Rank Math, Elementor, Site Kit, Fluent Forms and WPForms namespaces are present.
- Counts: 21 pages, 137 posts, 8 categories, 0 tags, and 1,076 media.
- Media are counted but not listed without authentication.
- A public page `/fluent-form-test/` exists. Review whether it should be public or indexed.

## SEO metadata
- Rank Math fields are not assumed to be in the REST API.
- SEO data comes from the **rendered HTML** of each page, through the crawler: title, meta description, canonical, robots, Open Graph, JSON-LD types, headings, image alt, links.
- Elementor source JSON is not read.

## Never
- No writes, publishing or plugin installs.
- No changes to Elementor templates, theme files or SEO settings.
- Demo (`.example`) websites are refused before any request.
