# Claude SEO Capability Map

**Upstream:** https://github.com/AgriciDaniel/claude-seo at commit `6be93f45064ffbadced572b5d5c95f55fd263af0` (2026-10-22), inspected 2026-11-02.
**Licence:** MIT, "Copyright (c) 2026 agricidaniel". All 24 per-skill `LICENSE.txt` files are MIT and point to the root licence. The "Creative Commons" mentions are article text about the RSL standard, not asset licences. No differently licensed code was found. If any upstream code is copied verbatim, keep the MIT notice beside it.
**How it was inspected:** shallow clone into an isolated scratch folder. Files were read only: **no installer (`install.sh`/`install.ps1`), Python script or hook was executed.**

## What upstream is

A **Claude Code plugin**: 26 skills (`skills/*/SKILL.md`, markdown instructions with references), 19 sub-agent prompts (`agents/*.md`), about 60 Python scripts (`scripts/`), 9 optional paid or third-party extensions (`extensions/`), and hooks. Runtime: Python 3.11 with requests/lxml/bs4, Playwright (headless Chromium), trafilatura, matplotlib/weasyprint, and the Google API clients.

## Two environments, kept separate

| | Claude Code (developer machine) | ULTRON-B runtime (web app) |
|---|---|---|
| Who uses it | Developers, to build and test SEO features | Brand users through chat and SEO pages |
| Execution | Upstream skills and slash commands | Our skill registry → Edge Function / worker → model API |
| Authorization | Developer's own machine | RLS + `can_*` helpers + per-brand skill enablement |

Installing the plugin does **not** expose anything to web users. ULTRON-B never shells out to the Claude Code CLI or the upstream scripts from a chat request.

## Inventory and reuse decision

| Upstream area | What it gives | Reuse in ULTRON-B | External or paid dependency | Risk notes |
|---|---|---|---|---|
| `skills/seo-technical`, `seo-audit`, `seo-page` | Technical checklists, scoring | **Method** → system prompts and check lists for Technical SEO skills | none | — |
| `skills/seo-sitemap`, `seo-schema`, `seo-hreflang`, `seo-images` | Validation rules | **Method** → TS validators (planned) | none | — |
| `skills/seo-content`, `seo-content-brief`, `seo-cluster`, `seo-sxo`, `seo-plan`, `seo-flow` | E-E-A-T, briefs, clustering, intent, FLOW loop | **Method** → Content SEO / SEO Manager prompts | SERP-overlap clustering needs SERP data (DataForSEO) | Never invent volumes |
| `skills/seo-geo`, `seo-agentic` | GEO/AEO, AI crawlers, llms.txt, agent readiness | **Method** → AI-search skills | Lighthouse "agentic" needs headless Chrome (worker) | — |
| `skills/seo-local`, `seo-maps`, `seo-ecommerce`, `seo-programmatic`, `seo-competitor-pages` | Specialist audits | **Method** (local/ecommerce/programmatic). Maps and competitor pages deferred | Maps APIs, GBP API (credentials) | — |
| `skills/seo-backlinks`, `seo-dataforseo`, `extensions/{ahrefs,dataforseo,seranking,moz…}` | Backlink and keyword metrics | **Interface only**: skill requires an authorized provider credential | **Paid APIs** | Fake-metric guard (registry test) |
| `skills/seo-google`, `scripts/{gsc_*,ga4_report,pagespeed_check,crux_history}.py` | GSC, GA4, PSI, CrUX | **Method + API shapes** → future GA4/GSC Edge Functions (17K) | Google OAuth, PSI key | Tokens server-side only |
| `skills/seo-drift`, `scripts/drift_*.py` | Baseline/diff | **Method** → worker job (planned) | none | — |
| `scripts/url_safety.py` | SSRF guard with DNS pinning | **Design ported** → `src/domain/urlSafety.ts` (tested) | none | DNS pinning not possible in Edge Functions; see SEO_EXECUTION_SECURITY.md |
| `scripts/render_page.py`, `capture_screenshot.py`, `unlighthouse_run.py` | Headless rendering | **Deferred to durable worker** | Chromium | Heavy, long-running |
| `skills/seo-image-gen`, `extensions/banana` | Image generation (Gemini) | **Not adopted** | Paid image API | Out of scope |
| `hooks/`, `install.*` | Claude Code plugin plumbing | **Not adopted** | — | Not executed |

## Mapping to the six ULTRON-B agents

The 40 application skills and their agents are defined in code (`apps/adpost-web/src/domain/seoSkills.ts`) and listed in **SEO_SKILL_REGISTRY.md** (generated; a test fails on drift). A test guarantees each allowed agent already holds every tool its skills need.

- **SEO Manager:** prioritisation, roadmap, programmatic and international planning, reporting, backlinks (provider-gated).
- **Technical SEO:** the 12 technical skills, AI crawler access, llms.txt, local and e-commerce site checks, drift.
- **Content SEO:** quality, E-E-A-T, keyword mapping (from GSC only), briefs, clusters, intent, gaps, metadata, GEO/AEO.
- **Statistics SEO:** GA4, GSC, PageSpeed interpretation, change comparison, reports.
- **Web Design / Web Development:** no SEO *execution* skills yet. They receive SEO findings through delegation and tasks.

## Status

The registry and SSRF guard are **implemented and unit-tested**. No skill executes yet: each needs the model API (not authorized), and some also need Google, PageSpeed or provider credentials, or the worker.
