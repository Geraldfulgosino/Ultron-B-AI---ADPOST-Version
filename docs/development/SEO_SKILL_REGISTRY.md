# SEO Skill Registry

<!-- GENERATED from apps/adpost-web/src/domain/seoSkills.ts. Do not edit by hand: run `UPDATE_DOCS=1 npx vitest run src/domain/seoSkills.test.ts`. -->

40 application skills. Methods are adapted from [claude-seo](https://github.com/AgriciDaniel/claude-seo) at `6be93f45064f` (MIT, Copyright (c) 2026 agricidaniel). Skills run only through ULTRON-B's backend, never as Claude Code commands.

**No skill is live yet.** `planned` means it needs only the model API. `requires_credentials` means it also needs the listed third-party access. `requires_worker` means it needs the durable worker, which is not provisioned. Every skill is disabled by default per brand.

| ID | Skill | Runtime | Agents | Credentials | Upstream method | Status |
|---|---|---|---|---|---|---|
| `tech.full_site_audit` | Full Site Audit | worker | technical_seo | Model API | seo-audit, seo-technical | requires_worker |
| `tech.page_audit` | Single Page Audit | edge | technical_seo | Model API | seo-page | planned |
| `tech.robots` | Robots.txt Analysis | edge | technical_seo | Model API | seo-technical | planned |
| `tech.sitemap` | XML Sitemap Analysis | edge | technical_seo | Model API | seo-sitemap | planned |
| `tech.canonical` | Canonical Audit | edge | technical_seo | Model API | seo-technical | planned |
| `tech.redirects` | Redirect Audit | edge | technical_seo | Model API | seo-technical | planned |
| `tech.indexability` | Indexability Review | edge | technical_seo | Model API | seo-technical, seo-google | planned |
| `tech.structured_data` | Structured Data Audit | edge | technical_seo | Model API | seo-schema | planned |
| `tech.images` | Image SEO Audit | edge | technical_seo | Model API | seo-images | planned |
| `tech.hreflang` | Hreflang Audit | edge | technical_seo | Model API | seo-hreflang | planned |
| `tech.internal_links` | Internal Linking Audit | worker | technical_seo | Model API | seo-audit | requires_worker |
| `tech.performance` | Page Performance Analysis | edge | technical_seo | Model API, PageSpeed API key | seo-google | requires_credentials |
| `content.quality` | Content Quality Audit | edge | content_seo | Model API | seo-content | planned |
| `content.eeat` | E-E-A-T Review | edge | content_seo | Model API | seo-content | planned |
| `content.keyword_mapping` | Keyword Mapping | llm | content_seo | Model API | seo-cluster | planned |
| `content.brief` | Content Brief Generation | llm | content_seo | Model API | seo-content-brief | planned |
| `content.topic_clusters` | Topic Cluster Planning | llm | content_seo | Model API | seo-cluster | planned |
| `content.search_intent` | Search Intent Analysis | llm | content_seo | Model API | seo-sxo | planned |
| `content.gap` | Content Gap Review | llm | content_seo | Model API | seo-plan | planned |
| `content.metadata` | Metadata Optimization | llm | content_seo | Model API | seo-page | planned |
| `content.internal_link_recs` | Internal Link Recommendations | llm | content_seo | Model API | seo-cluster | planned |
| `ai.geo_aeo` | GEO/AEO Review | edge | content_seo | Model API | seo-geo | planned |
| `ai.readiness` | AI Search Readiness | edge | technical_seo | Model API | seo-geo, seo-agentic | planned |
| `ai.crawler_access` | AI Crawler Accessibility | edge | technical_seo | Model API | seo-geo | planned |
| `ai.llms_txt` | llms.txt Assessment | edge | technical_seo | Model API | seo-geo | planned |
| `ai.structured_answers` | Structured Answer Readiness | edge | content_seo | Model API | seo-geo, seo-schema | planned |
| `ai.citation_opportunities` | AI Citation Opportunity Analysis | llm | content_seo | Model API | seo-geo | planned |
| `spec.local` | Local SEO Review | edge | technical_seo | Model API | seo-local | planned |
| `spec.ecommerce` | E-Commerce SEO Review | edge | technical_seo | Model API | seo-ecommerce | planned |
| `spec.programmatic` | Programmatic SEO Planning | llm | seo_manager | Model API | seo-programmatic | planned |
| `spec.international` | International SEO Review | llm | seo_manager | Model API | seo-hreflang | planned |
| `spec.backlinks` | Backlink Analysis | edge | seo_manager | Model API, Backlink data provider | seo-backlinks, seo-dataforseo | requires_credentials |
| `spec.drift` | SEO Drift Monitoring | worker | technical_seo | Model API | seo-drift | requires_worker |
| `analytics.ga4` | GA4 Interpretation | llm | statistics_seo | Model API, Google OAuth | seo-google | requires_credentials |
| `analytics.gsc` | GSC Performance Analysis | llm | statistics_seo | Model API, Google OAuth | seo-google | requires_credentials |
| `analytics.pagespeed` | PageSpeed Interpretation | edge | statistics_seo | Model API, PageSpeed API key | seo-google | requires_credentials |
| `analytics.priority_scoring` | SEO Priority Scoring | llm | seo_manager | Model API | seo-audit, seo-flow | planned |
| `analytics.roadmap` | SEO Improvement Roadmap | llm | seo_manager | Model API | seo-plan, seo-flow | planned |
| `analytics.report` | SEO Report Generation | llm | seo_manager, statistics_seo | Model API | seo-google | planned |
| `analytics.change_comparison` | Technical SEO Change Comparison | llm | statistics_seo, seo_manager | Model API | seo-drift | planned |
