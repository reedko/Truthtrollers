# Publisher Enrichment: Current Pipeline

Last reviewed: 2026-06-27

This document describes the current publisher enrichment flow as implemented in:

- `backend/src/services/publisherEnrichmentService.js`
- `backend/services/sourceProviders/sourceProviderRegistry.js`
- `backend/services/providerSignalMapper.js`
- `backend/src/services/providerSignalPersistenceService.js`
- `backend/services/admiraltyEvaluator.js`

## Entry Points

Publisher enrichment currently runs through `enrichPublisherIfNeeded(...)`.

Main API callers:

- `POST /api/publishers/enrich-and-link`
- `POST /api/publishers/:publisherId/enrich`
- scrape/reference flows that have a resolved publisher

Interactive SourceCrest modal calls currently pass:

- `skipExternalSignals: true`
- `maxProviderConcurrency: 1`

That means interactive SourceCrest runs should only run the first-pass providers, one at a time, and should not run the heavier second-pass external signal sweep.

## High-Level Flow

1. Normalize the domain from `sourceUrl` or explicit `domain`.
2. Resolve `publisherId` by id, exact publisher name, or publisher domain.
3. Skip automatic enrichment for social platform URLs such as Facebook, X/Twitter, Instagram, and TikTok.
4. Check freshness for first-pass providers.
5. Run stale first-pass providers with a concurrency cap.
6. Optionally run second-pass provider signals if `skipExternalSignals` is false.
7. Re-evaluate and store Admiralty codes for the publisher and linked content.

## SourceCrest Semantics

SourceCrest deliberately keeps three signals separate:

- Letter `A-E`: source reliability.
- Alignment ribbon: disclosed institutional or material-interest alignment. The marker identifies the kind (`IND`, `ADV`, `GOV`, `CORP`, `PART`, `SPON`, or `STATE`) and its position represents alignment risk from 0-100.
- Number `1-5`: claim credibility based on claim evidence. Publisher identity, sponsorship, or industry alignment alone never creates a claim number; the number remains `Ø` without supporting/refuting evidence, authoritative sources, scientific consensus, or fact-check results.

The own-site organization-status pass scans About, membership, board/governance, policy/advocacy, sponsor, funding, and supporter pages. For a self-described industry trade association it emits an `IND` alignment ribbon with evidence and a material-interest score. This contextual signal can produce a `C` source letter, while an unevaluated claim remains `Ø` (for example, `CØ`, not `C3`).

The SourceCrest modal exposes one top-level **Force refresh** action. It refreshes provider ratings and rebuilds the crest for the currently linked publisher without opening a tab, queueing a scrape job, changing publisher identity, or re-running own-site organization discovery. The heavier **Open tab & re-scrape source** fallback lives under **Change publisher**; it explicitly opens a tab and queues the extension scrape. A detected publisher is presented for confirmation through **Save publisher link & force refresh** rather than silently replacing the link. That confirmation step replaces the content-to-publisher link, forces provider refresh, and re-runs own-site About/membership/governance/sponsor/funding discovery.

## First-Pass Providers

These are run directly inside `publisherEnrichmentService.js`.

| Provider | Resource/API | Enabled When | Stores | Current Admiralty Effect |
| --- | --- | --- | --- | --- |
| AllSides | Historical stored ratings only | Disabled by default while data/API permission is pending (`ALLSIDES_ENABLED=false`) | Existing `publisher_ratings` are retained | Context only. No lookup, Tavily search, or LLM call occurs while disabled. |
| Ad Fontes | Historical stored ratings only | Disabled by default (`ADFONTES_ENABLED=false`) | Existing `publisher_ratings` are retained | Existing ratings can still be displayed/evaluated; no new lookup occurs while disabled. |
| Wikipedia | Tavily search + page/profile extraction + LLM extraction | `TAVILY_API_KEY` exists and Wikipedia profile is stale/forced | `publisher_profiles`; may also write a Wikipedia `veracity` rating | Direct only if a veracity/reliability score is written. Profile-only Wikipedia is identity/context, not direct reliability. |
| Wikidata | Wikidata lookup via provider helper | stale/forced; no paid key required | `publisher_profiles` / identity context | Identity/provenance only. Helps identify source type, but is not direct reliability. |
| SCImago | SCImago/journal lookup | stale/forced and `looksLikeScholarlySourceName(...)` is true | `publisher_ratings` / academic profile context | Direct only for scholarly sources with a journal score/quartile; otherwise provenance/context. |

Notes:

- The old Tavily-plus-OpenAI AllSides/Ad Fontes extraction path is additionally gated by `PUBLISHER_ENRICHMENT_ALLOW_SEARCH_LLM_FALLBACK=false`. Both the provider flag and this explicit fallback flag must be true before it can run.
- `SCImago` is intentionally skipped for non-scholarly publisher names/URLs.
- The first pass is the path used by SourceCrest interactive refresh after the recent performance changes.

## Second-Pass External Signal Providers

These are run through `lookupPublisherAllProviders(...)` only when `skipExternalSignals` is false.

Current `SECOND_PASS_PROVIDERS`:

```js
[
  "mbfc",
  "opensources",
  "newsguard",
  "crossref",
  "openalex",
  "wayback",
  "rdap",
  "opencorporates",
  "irs_teos",
  "sec_edgar",
  "gdelt",
]
```

The second pass persists rows to `publisher_external_signals`, then summarizes them onto the `publishers` table:

- `identity_confidence`
- `independent_footprint_score`
- `conflict_of_interest_score`
- `reliability_signal_present`
- `direct_reliability_score`
- `contextual_credibility_score`
- `provenance_score`
- `publication_legitimacy_score`
- `reliability_cap`
- `reliability_cap_reason`
- `reliability_signal_sources`
- `last_enriched_at`

Important current limitation: these stored external signal summaries are persisted and displayed, but the current `reEvaluateAdmiraltyForPublisher(...)` path primarily rebuilds Admiralty input from `publisher_ratings` and `publisher_profiles`. The persisted second-pass `publisher_external_signals` summary is not fully wired into the current source-letter derivation path.

## Second-Pass Provider Effects

| Provider | Resource/API | Current Config State | Signal Mapper Effect | Directly Changes Current Admiralty Code? |
| --- | --- | --- | --- | --- |
| MBFC | Local MBFC seed data | Enabled if seed file exists | Direct reliability if factuality/credibility exists; can cap D/E for high-risk classifications | Partially. Live second-pass signal is summarized, but current code changes mainly when MBFC is represented in `publisher_ratings` / providerResults. |
| OpenSources | Local categorized problematic-source seed | Enabled if seed file exists | Direct downgrade/cap. Dangerous flags can cap at E; other flags cap at D | Partially. Same limitation as MBFC unless represented in current evaluator providerResults. |
| NewsGuard | Licensed NewsGuard API | Disabled unless `NEWSGUARD_API_KEY` exists | Direct reliability if score exists; otherwise provider status/context | No in current default prod unless configured, and second-pass summaries are not fully applied to code. |
| Crossref | Crossref REST API | Enabled; no key required | Publication legitimacy/provenance. DOI/work/ISSN/source matches add publication legitimacy; mismatch or unverified claimed scholarly source can cap C | Not directly in current code path except as stored external signal summary. Also now gated to scholarly context, DOI, ISSN, journal, etc. |
| OpenAlex | Authenticated OpenAlex API | Enabled by default; requires `OPENALEX_API_KEY` | Publication legitimacy/provenance similar to Crossref | Uses the documented `api_key` query parameter and remains gated to DOI, ISSN, journal, or scholarly context. It never becomes a generic reliability rating. |
| Wayback | Internet Archive / Wayback availability API | Enabled; no key required | Domain footprint/provenance; weak/no archive footprint can cap C | Not directly in current code path except as stored external signal summary. |
| RDAP | RDAP domain registration lookup | Enabled; no key required | Domain age/provenance; very young domains can cap C | Not directly in current code path except as stored external signal summary. |
| OpenCorporates | OpenCorporates v0.4 API | `OPENCORPORATES_ENABLED=false` by default; later requires `OPENCORPORATES_API_KEY` | Legal identity/provenance only; inactive/dissolved entity can cap C | Uses conservative name/alias/jurisdiction scoring, reports ambiguity, and fetches details only after a strong match. Active or absent records do not alter reliability. |
| IRS TEOS | IRS TEOS nonprofit verification | Disabled unless `IRS_TEOS_API_KEY` exists | Identity/provenance; inactive/revoked/delinquent status can cap C | No in current default prod unless configured, and summaries are not fully applied to code. |
| SEC EDGAR | SEC/company identity provider stub | Disabled unless configured in optional provider code | Identity/provenance; inactive/problem status can cap C | No in current default prod unless configured, and summaries are not fully applied to code. |
| GDELT | GDELT DOC API | Enabled; no key required | Independent footprint/provenance; low footprint is a flag, not a direct reliability score | Not directly in current code path except as stored external signal summary. |

## Registry-Only Providers Not Used In Publisher Enrichment First/Second Pass

These exist in the provider registry but are not in `SECOND_PASS_PROVIDERS` for publisher enrichment:

| Provider | Purpose | Publisher Enrichment Use |
| --- | --- | --- |
| Google Fact Check | Official Fact Check Tools claims search; enabled by default with `GOOGLE_FACT_CHECK_API_KEY` | Claim text only. It is never publisher identity, bias, or reliability data; normalized verdicts may affect only claim credibility. |
| Diffbot | Article/entity extraction | Registered provider; requires `DIFFBOT_TOKEN`; not included in current publisher second-pass list. |

## How The Current Admiralty Code Is Recomputed

At the end of enrichment, `reEvaluateAdmiraltyForPublisher(...)`:

1. Loads `publisher_profiles`.
2. Loads system `publisher_ratings`.
3. Reconstructs providerResults from stored ratings/profiles.
4. Calls `evaluateAdmiraltyCode(...)` for the publisher and linked content.
5. Stores results in `admiralty_evaluations`.

The source-letter derivation currently uses:

- source type from profiles
- resolution level
- lineage signals when supplied
- veracity score from `publisher_ratings` with `rating_type = 'veracity'`
- MBFC reliability if represented in providerResults
- Ad Fontes reliability if represented in providerResults
- OpenSources flags if represented in providerResults
- Wikipedia/Wikidata presence as identity/profile context

Current source-letter behavior:

- No meaningful identity can stay `Ø`.
- Identity/profile-only evidence does not become reliability evidence.
- Institutional source types such as government, academic, primary, or reference can get a base letter only when sufficiently resolved.
- Direct veracity/reliability scores can move the letter up/down.
- Low MBFC/Ad Fontes reliability can downgrade.
- High MBFC/Ad Fontes reliability can upgrade C to B.
- OpenSources danger flags can force E.
- Excerpt/repost/pointer/platform lineage can downgrade.

## Practical “Enabled” Summary

Provider feature defaults:

```env
OPENALEX_ENABLED=true
GOOGLE_FACT_CHECK_ENABLED=true
OPENCORPORATES_ENABLED=false
ADFONTES_ENABLED=false
ALLSIDES_ENABLED=false
PUBLISHER_ENRICHMENT_ALLOW_SEARCH_LLM_FALLBACK=false
```

For SourceCrest interactive refresh:

- Enabled/run path: Wikipedia, Wikidata, and SCImago when stale/forced and prerequisites match.
- Disabled but historically visible: AllSides and Ad Fontes. Disabling them does not delete stored ratings.
- Disabled/skipped path: MBFC, OpenSources, NewsGuard, Crossref, OpenAlex, Wayback, RDAP, OpenCorporates, IRS TEOS, SEC EDGAR, GDELT because `skipExternalSignals: true`.

For non-interactive/full enrichment:

- Enabled without paid keys: Wikipedia, Wikidata, MBFC if seed exists, OpenSources if seed exists, Crossref, Wayback, RDAP, GDELT.
- Enabled with configured keys: OpenAlex for scholarly provenance and Google Fact Check for claim text.
- Disabled unless explicitly enabled/configured: OpenCorporates, NewsGuard, IRS TEOS, SEC EDGAR, and Diffbot.

## Current Performance Controls

- `PUBLISHER_ENRICHMENT_CONCURRENCY` controls default first-pass concurrency.
- SourceCrest modal passes `maxProviderConcurrency: 1`.
- SourceCrest modal passes `skipExternalSignals: true`.
- SourceCrest **Force refresh** never opens a browser tab; extension re-scraping is a separate explicit fallback under **Change publisher**.
- Extension/tab scraping is now only used by explicit “Open in tab” actions.

## Known Gaps

- Second-pass external signal summaries are persisted, but are not fully applied in the current `deriveSourceLetter(...)` path.
- Some providers are registered and health-checkable but are not part of publisher enrichment’s current second-pass list.
- `Crossref` and `OpenAlex` should remain restricted to DOI/ISSN/journal/scholarly contexts to avoid false scholarly matches for ordinary websites.
- Tavily-plus-LLM publisher-rating extraction is a non-authoritative fallback and is off by default.
