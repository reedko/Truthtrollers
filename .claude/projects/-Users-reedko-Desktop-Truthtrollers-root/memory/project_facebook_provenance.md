---
name: Facebook group post provenance system
description: How Facebook group posts are scraped, who is publisher vs author, SOC sash on SourceCrest
type: project
---

Facebook group post provenance is fully implemented as of 2026-06-27.

**Extension (background.js) extraction:**
- `containerName` (group name) comes from `document.title` first part after stripping `(20+)` notification badge — format is `"(NOTIFS) GROUP_NAME | ARTICLE_TITLE | Facebook"`
- `directSocialPublisher` (poster) found by scanning whole page for `/groups/{id}/user/{userId}` links that are OUTSIDE all `role="article"` elements (post header is not inside any article; comment authors are inside their article)
- `postEl` selected as the article element that contains other articles (link preview cards)

**Backend (facebookProvenance.js) chooseFacebookPublisher priority:**
1. sharedSourceUrl + resolved linked publisher → substantive_publisher (article's publisher wins)
2. containerName → social_container with `"GROUP_NAME (Facebook Group)"` display name
3. directSocialPublisher → direct_social_publisher (fallback)

**Author persistence (scrapeReference.js):**
- `directSocialPublisher` saved as `{ name: "..." }` to `authors` array only for pure posts (`!sharedSourceUrl`)
- For article-link posts, the article's own authors take precedence

**Enrichment:**
- `isSocialPlatformUrl` guard in publisherEnrichmentService.js now only skips enrichment when publisher name IS a generic social platform name (facebook, twitter, etc.)
- Named group publishers like "Neil deGrasse Tyson (Facebook Group)" get enriched via Wikipedia etc.

**SOC sash on SourceCrest:**
- Driven by `alignment.marker === "SOC"` — never inferred from `sourceType`
- Reference list and modal both check source URL regex for facebook/twitter/instagram/tiktok to set SOC alignment marker
- Purple/indigo gradient, same font size as IND/GOV/CORP markers

**Why:** Prevents article title from appearing as publisher, correctly identifies group as publisher and poster as author, gives visual social context without false positives on academic social networks like ResearchGate.
