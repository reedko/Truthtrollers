# Claim Evaluation Targets and Adaptive Bearing Plan

Status: approved plan; implementation not started

This document is the implementation checklist for extending VeriStrata's existing bearing pipeline. The work must preserve the bearing infrastructure already built. It must not replace the current evidence engine, snippet scorer, candidate selector, bearing packets, comparison exports, feature flags, or query plumbing.

## Terminology

- **Visible claim / `claim_text`**: the article claim displayed in the workspace.
- **Evaluation target**: an atomic proposition that evidence can evaluate. During migration, the primary substantive evaluation target remains available through `content_claims.object_claim_text`.
- **Attribution target**: whether the named person or institution made the statement or allegation.
- **Substantive target**: whether the underlying factual event or condition occurred.
- **Inference target**: whether the article's conclusion follows from the underlying facts.
- **Study-identity target**: resolution of the exact study, dataset, document, population, subgroup, or analysis involved. It is a search prerequisite, not verdict evidence.
- **Bearing claim**: a claim extracted from a source that actually addresses a particular evaluation target.

Example visible claim:

> William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC.

Example evaluation targets:

1. **Attribution:** Thompson made the specified allegation.
2. **Substantive:** CDC researchers improperly altered, omitted, or excluded analyses from the identified study.
3. **Inference:** Those actions concealed evidence of an MMR-autism association.
4. **Study identity:** Resolve the exact study, dataset, population, subgroup, and disputed analysis.

## Non-negotiable implementation constraints

- Preserve and extend existing bearing code; do not rebuild it.
- Continue using the existing promisified database `query` passed into routes and services.
- Keep existing claim IDs, claim hierarchy, `PILLAR SUPPORT` labels, feature flags, exports, and APIs working during migration.
- Keep prompts and configurable thresholds in the database where that infrastructure already exists.
- Never allow attribution verification to prove a substantive allegation.
- Never classify merely topical evidence as bearing on a different predicate.
- Never silently skip a visible claim or evaluation target.
- Never stop processing midway through a source that has already been scraped and entered claim extraction.

## Phase 0 - Backup and baseline

- [ ] Back up the current backend, dashboard, migrations, and prompt definitions.
- [ ] Record the current git state without overwriting unrelated user changes.
- [ ] Capture content `16337` as a regression fixture.
- [ ] Save its 12 visible claims, `claim_text`, `object_claim_text`, queries, candidate pools, snippet scores, scraped sources, links, and bearing packets.
- [ ] Add characterization tests around the existing bearing modules before modifying behavior.


## Phase X0 - Evidence Retrieval Gateway contract

Build this immediately after baseline capture because it preserves the current search contract while allowing Tavily, Brave, Serper, and later domain-specific providers to be added without forcing the rest of the evidence engine to care which provider ran.

This is an architectural compatibility layer, not a temporary kludge. It should replace the current Tavily/Bing-specific search module boundary with a provider-agnostic gateway that accepts the same input shape and returns the same output shape currently used by the platform.

### Goal

The existing evidence engine should continue calling search the same way it does now.

```text
existingSearchInput -> evidenceRetrievalGateway -> existingSearchOutput
```

Inside the gateway, VeriStrata may call Tavily, Brave, Serper, inactive Bing if still configured, or later academic/domain-specific providers. Outside the gateway, the result shape remains stable.

### Non-negotiable contract requirements

- [ ] Preserve the exact input shape currently passed into the Tavily/Bing search module.
- [ ] Preserve the exact output shape currently returned from Tavily/Bing into the evidence engine.
- [ ] Do not require evaluation-target schema changes for Phase X0.
- [ ] Do not change bearing scoring, candidate selection, snippet scoring, adaptive retrieval, evidence linking, or UI behavior in Phase X0.
- [ ] Add provider metadata additively where possible without breaking existing consumers.
- [ ] Keep Tavily as the initial default provider.
- [ ] Keep the inactive Bing adapter only if it already exists, but do not require Bing for production behavior.
- [ ] Make provider choice configurable without code changes.

### Initial providers

Implement provider wrappers for:

- [ ] Tavily
- [ ] Brave Search API
- [ ] Serper Google Search API
- [ ] Existing Bing adapter only as an optional/inactive legacy provider if still present

Each provider wrapper must normalize results to the existing search-result object expected by the current evidence pipeline.

### Provider metadata exploration

Different providers may return useful metadata that Tavily does not return. Phase X0 must preserve and inspect that metadata without breaking the current evidence engine contract.

- [ ] Capture raw provider metadata for every provider result.
- [ ] Normalize the core fields to the existing output shape.
- [ ] Preserve provider-specific metadata in an additive field if the current schema already has a safe place for it, such as `metadata`, `raw`, `provider_metadata`, or equivalent.
- [ ] If no safe metadata field exists, temporarily serialize provider metadata into a clearly labeled JSON block appended to or embedded in the existing snippet-compatible field.
- [ ] Do not pollute the human-readable snippet unless no other existing schema field can carry provider metadata.
- [ ] Add a follow-up task to promote useful provider metadata into first-class schema fields after we observe what Brave, Serper, PubMed, Crossref, OpenAlex, and Semantic Scholar actually return.
- [ ] Track which metadata fields help bearing, source identity, freshness, authority, source type, citation discovery, or deduplication.

Temporary snippet-compatible metadata format, only if needed:

```text
[provider_metadata_json]
{
  "provider": "serper",
  "position": 3,
  "date": "2024-03-15",
  "source_type": "news",
  "sitelinks": [],
  "raw_keys": ["title", "link", "snippet", "date", "position"]
}
[/provider_metadata_json]
```

Metadata exploration must be bounded so snippets do not become enormous. Store only useful metadata keys and truncate raw payloads.

### Configuration

Add environment/config values:

```text
SEARCH_PROVIDER=tavily
SEARCH_PROVIDERS=tavily,brave,serper
SEARCH_PROVIDER_FALLBACKS=brave,serper,tavily
ENABLE_SEARCH_GATEWAY=true
ENABLE_BRAVE_SEARCH=false
ENABLE_SERPER_SEARCH=false
ENABLE_SEARCH_ENSEMBLE=false
ENABLE_PROVIDER_METADATA_CAPTURE=true
ENABLE_PROVIDER_METADATA_IN_SNIPPET_FALLBACK=false
SEARCH_MAX_RESULTS_PER_QUERY=10

TAVILY_API_KEY=
BRAVE_SEARCH_API_KEY=
SERPER_API_KEY=
BING_SEARCH_API_KEY=
PUBMED_API_KEY=
CROSSREF_MAILTO=
OPENALEX_MAILTO=
SEMANTIC_SCHOLAR_API_KEY=
```

### Admin panel controls

Add platform admin controls for search provider configuration.

- [ ] Add an admin-panel section named **Evidence Retrieval Providers**.
- [ ] Show checkboxes for Tavily, Brave, Serper, and any enabled domain-specific adapters.
- [ ] Show Bing only as legacy/inactive if the adapter still exists.
- [ ] Allow choosing default mode: `single`, `fallback`, or `ensemble`.
- [ ] Allow choosing default provider for single-provider mode.
- [ ] Allow ordering fallback providers.
- [ ] Allow setting max results per query.
- [ ] Allow toggling provider metadata capture.
- [ ] Allow toggling snippet fallback for metadata only if no safe metadata field exists.
- [ ] Show provider health status: configured, missing key, disabled, last error, last successful call.
- [ ] Persist these settings in the same configuration system used by the existing bearing/query infrastructure where possible.

The admin panel should not expose secret API key values after save. It may show whether a key exists.

### API key prompting and setup checks

The implementation should prompt the operator/developer to add API keys only when a selected provider requires a missing credential.

- [ ] On backend startup, detect enabled providers with missing required credentials and log actionable setup prompts.
- [ ] In the admin panel, show a missing-key warning beside enabled providers.
- [ ] When a user/admin checks a provider whose key is missing, display setup guidance instead of failing silently.
- [ ] Do not block Tavily-only behavior because Brave or Serper keys are missing.
- [ ] Do not call disabled providers.
- [ ] Do not call providers with missing required credentials.
- [ ] Record skipped providers as `skipped_missing_api_key`, `skipped_disabled`, or `skipped_missing_config`.

Example setup prompts:

```text
Brave Search is enabled but BRAVE_SEARCH_API_KEY is missing.
Add BRAVE_SEARCH_API_KEY to the environment or disable Brave in Admin > Evidence Retrieval Providers.

Serper is enabled but SERPER_API_KEY is missing.
Add SERPER_API_KEY to the environment or disable Serper in Admin > Evidence Retrieval Providers.
```

### Provider modes

```text
single:
  Call only SEARCH_PROVIDER.

fallback:
  Call SEARCH_PROVIDER first.
  If it fails or returns no usable results, call configured fallbacks in order.

ensemble:
  Call SEARCH_PROVIDERS, dedupe, normalize, and return the same output shape.
```

Do not enable ensemble mode by default in Phase X0.

### Logging

For every search call, log bounded JSON:

```json
{
  "search_gateway_enabled": true,
  "mode": "single",
  "provider": "tavily",
  "query": "...",
  "raw_result_count": 10,
  "normalized_result_count": 10,
  "fallback_used": false,
  "provider_error": null,
  "provider_metadata_captured": true,
  "provider_metadata_storage": "metadata",
  "missing_api_key_providers": []
}
```

In ensemble mode, preserve per-provider result provenance even while returning the existing output shape.

### Acceptance criteria

- Existing Tavily behavior still works through the new gateway.
- The evidence engine can switch from Tavily to Brave or Serper by configuration only.
- Existing upstream callers do not change.
- Existing downstream evidence processing receives the same output shape as before.
- Provider provenance is logged.
- Useful provider-specific metadata is preserved without breaking the existing output contract.
- If no metadata field exists, a bounded JSON-style metadata block can be carried through a snippet-compatible field behind a feature flag.
- Admin panel checkboxes can enable/disable providers.
- Missing API keys are surfaced clearly in startup logs and admin-panel status.
- A provider failure does not crash the evidence run when fallbacks are configured.

## Phase 1 - One-to-many evaluation-target schema

Create `claim_evaluation_targets`, linked to the contextual claim through `content_id` and `claim_id`.

Planned columns:

```text
evaluation_target_id
content_id
claim_id
parent_target_id
target_type
target_text
subject_entity
predicate
object_text
alleged_action
study_title
study_authors
study_year
study_identifier
population_scope
source_excerpt
article_stance
score_transform
search_eligible
verdict_eligible
resolution_status
target_order
mapping_confidence
mapping_rationale
created_at
updated_at
```

Create `evaluation_target_evidence_links` so evidence attaches to a particular target rather than only to the broad visible claim.

- [ ] Write migration SQL but do not run it automatically.
- [ ] Backfill `content_claims.object_claim_text` as the primary `substantive` target.
- [ ] Preserve all existing evidence links.
- [ ] Dual-write target-level and legacy links during transition.
- [ ] Prevent dual-written records from being counted twice.
- [ ] Continue exposing `object_claim_text` as the primary substantive target for compatibility.

## Phase 2 - Extend the existing argument mapper

Extend `argumentMappingEngine`; do not replace it.

- [ ] Version the database-managed mapping prompt to return a `targets` array.
- [ ] Preserve its current scalar response fields during transition.
- [ ] Use the existing mapping call rather than adding a routine second LLM call.
- [ ] Use the surrounding article passage and citations to ground each target.
- [ ] Resolve named studies, documents, datasets, populations, and disputed analyses when the article provides enough information.
- [ ] Record what words such as `manipulated`, `suppressed`, or `destroyed` specifically allege.
- [ ] Mark incomplete targets as `underspecified` rather than broadening them silently.
- [ ] Keep the primary substantive target synchronized to `object_claim_text` during migration.

## Phase 3 - One evaluation-target loader

Add one intended backend entry point:

```text
loadClaimEvaluationTargets(query, contentId, claimIds)
```

Use it from:

- [ ] Initial scrape evidence processing.
- [ ] `/api/run-evidence`.
- [ ] Single-claim evidence reruns.
- [ ] Incremental claim processing.
- [ ] Deep Evidence Search.
- [ ] Social/content ingestion routes.
- [ ] Reference-claim matching.

Fallback order during migration:

1. `claim_evaluation_targets`
2. `content_claims.object_claim_text`
3. `claims.claim_text`

## Phase 4 - Transparent query planning

Every visible claim must expose one of these states:

- Search planned
- Search running
- Search completed
- Background - not searched
- Skipped - explicit reason
- Unresolved - no bearing evidence

Every search-eligible evaluation target must log:

```text
claim_id
evaluation_target_id
target_type
target_text
queries
execution_status
skip_reason
```

- [ ] Apply the configured visible-claim limit to visible case claims, not to individual evaluation targets.
- [ ] Ensure all eligible visible claims receive a primary query plan.
- [ ] Never return an empty query set without recording why.
- [ ] Add a regression proving the Thompson substantive target reaches query generation.

## Phase 5 - Extend existing query generation

Continue using the current evidence-need and query-generation infrastructure.

Add these inputs to its existing data model:

- Evaluation-target ID and type
- Subject, predicate, and object
- Study/document identity
- Alleged action
- Population and scope constraints
- Named entities and citations

For the Thompson substantive target, queries must preserve combinations of:

- William Thompson
- CDC
- Exact study title, authors, and year when resolved
- Metropolitan Atlanta dataset when confirmed
- Alleged omitted or excluded analysis
- Disputed subgroup or protocol
- CDC/coauthor response

Required query lanes:

- [ ] Original study
- [ ] Attribution documents or statements
- [ ] Alleged conduct or methodology
- [ ] Official/coauthor response
- [ ] Independent methodological analysis

Generic vaccine-autism searches must not substitute for target-specific searches.


## Phase X1 - Multi-provider web search ensemble

Implement after Phase X0 and after the evaluation-target loader is stable enough to provide canonical target text into query planning. X1 expands the Evidence Retrieval Gateway from configurable single-provider search into controlled multi-provider web retrieval.

### Goal

Use Tavily, Brave, and Serper together when configured, while keeping the existing normalized output shape for the evidence engine.

### Provider roles

```text
Tavily:
  Research-oriented web discovery and summarized web results.

Brave:
  Independent-index broad web search and low-cost diversity.

Serper:
  Google-like exact-entity and exact-phrase search, especially for named controversies, quotes, local events, and older pages.
```

### Ensemble behavior

- [ ] Accept the existing search input.
- [ ] Execute the configured provider set.
- [ ] Normalize every provider result to the existing search result shape.
- [ ] Deduplicate by canonical URL.
- [ ] Preserve provider provenance additively.
- [ ] Preserve provider rank additively.
- [ ] Return a merged list compatible with existing evidence processing.
- [ ] Do not allow one provider's generic results to swamp exact-entity results from another provider.
- [ ] Prefer primary/source-proximate results when provider rank and snippet bearing are comparable.

### Provider provenance and metadata fields

Add additively where safe:

```json
{
  "provider": "serper",
  "providers_seen": ["serper", "brave"],
  "provider_rank": 3,
  "provider_query": "\"William Thompson\" CDC MMR autism data manipulation",
  "provider_metadata": {
    "date": "2024-03-15",
    "source_type": "news",
    "sitelinks": [],
    "raw_provider_keys": ["title", "link", "snippet", "date", "position"]
  }
}
```

If the current result shape cannot accept these fields directly, store them in an existing metadata/raw field. If no safe field exists, use the Phase X0 snippet-compatible metadata fallback behind a feature flag.

### Incremental provider comparison

Add diagnostics sufficient to answer:

```text
Did Brave or Serper find high-bearing sources that Tavily did not find?
```

Log per provider:

```json
{
  "provider": "brave",
  "queries": [],
  "results_returned": 20,
  "unique_candidates_added": 7,
  "deduped_against_existing": 13,
  "candidate_urls_added": []
}
```

Bearing yield can be computed later after snippet and source-claim scoring. X1 only needs to preserve enough provenance to compute it.

### Acceptance criteria

- Ensemble mode can run Tavily + Brave + Serper.
- Results are normalized into the existing search result shape.
- Dedupe prevents repeated URLs from inflating candidate count.
- Provider provenance survives into logs and candidate metadata.
- It is possible to compare which provider found which source.

## Phase 6 - Adaptive layered bearing retrieval

Preserve the existing snippet-bearing scorer, deterministic score, optional LLM score, logs, canonical candidate merge, origin protection, steelman protection, and candidate provenance.

Change snippet bearing from a final exclusion authority into the first prioritization layer.

### Layer 1 - Snippet prioritization

- [ ] Score every returned candidate using the existing snippet-bearing logic.
- [ ] Use snippet bearing, provider rank, and existing protections to order the first candidate tranche.
- [ ] Keep low or uncertain snippet candidates available for later expansion.
- [ ] Hard-reject only clear junk, duplicates, wrong entities/documents, unsupported results, and configured exclusions.
- [ ] Protect likely original studies, primary statements, official responses, and top provider-ranked results.

### Layer 2 - Complete source processing

For each selected source:

1. Scrape the source.
2. Complete claim extraction for the source.
3. Bearing-score every unique extracted claim against its evaluation target.
4. Persist every qualifying claim and its target-level evidence link.
5. Only after finishing that source, evaluate the stopping condition.

### Layer 3 - Adaptive expansion

Add the following database bearing configuration:

```json
{
  "minHighBearingClaimsPerTarget": 3,
  "finishActiveSourceOnThreshold": true
}
```

- [ ] Count unique high-bearing extracted claims per evaluation target.
- [ ] Materially equivalent repetitions count once.
- [ ] If three are found while processing a source, continue through the entire source.
- [ ] Retain all additional qualifying claims from that source.
- [ ] Check the threshold only between sources.
- [ ] If fewer than three qualify, process the next candidate tranche, including provider-ranked candidates whose snippets were weak or ambiguous.
- [ ] Continue until three qualifying claims exist or the configured source ceiling is exhausted.
- [ ] Record source diversity, but do not initially require it for the stopping condition.
- [ ] If the ceiling is exhausted below three, mark the target unresolved rather than filling it with topical evidence.

The adaptive loop is:

```text
Snippet prioritization
        |
Scrape and fully process one source
        |
Persist all unique high-bearing claims
        |
Accumulated count >= 3?
    | yes                  | no
Stop before next source    Expand to next candidate tranche
```


## Phase X2 - Domain-specific academic and biomedical adapters

Implement after Phases 1-5 produce target-aware query planning and after X0/X1 provide the provider gateway structure.

### Purpose

Generic web search is not enough for biomedical, academic, legal, or study-identity claims. Domain-specific adapters should plug into the Evidence Retrieval Gateway as providers, not as unrelated side paths.

### Initial adapters

Implement provider wrappers for:

- [ ] PubMed
- [ ] Crossref
- [ ] OpenAlex
- [ ] Semantic Scholar

### When to use

Use academic/biomedical adapters when an evaluation target includes:

- biomedical terms
- vaccines, disease, adverse events, clinical outcomes, drugs, diagnoses, public health claims
- study title, DOI, PMID, journal, authors, publication year
- CDC, FDA, NIH, WHO, ACIP, EMA or similar health/science institutions
- article claims involving a specific paper, dataset, subgroup, protocol, analysis, correction, or retraction

### Adapter outputs

Each adapter must normalize to the existing search result shape while preserving academic metadata additively.

#### PubMed metadata

- PMID
- title
- authors
- journal
- year
- abstract/snippet
- publication type
- retraction/correction indicators when available
- URL

#### Crossref metadata

- DOI
- title
- authors
- publisher
- journal/container title
- publication date
- relation metadata when available
- URL

#### OpenAlex metadata

- work ID
- DOI
- title
- authorships
- institutions
- venue
- publication year
- cited-by count
- concepts/topics
- related works when requested
- URL

#### Semantic Scholar metadata

- paper ID
- DOI/PMID when available
- title
- authors
- abstract
- venue
- year
- citation count
- influential citation count
- references/citations when requested
- URL

### Study-identity support

For study-identity targets, domain adapters should help resolve:

- exact title
- authors
- year
- journal
- DOI/PMID
- dataset
- study population
- disputed subgroup
- corrections, retractions, expressions of concern

### Acceptance criteria

- Biomedical/academic targets can retrieve PubMed/Crossref/OpenAlex/Semantic Scholar candidates through the same gateway contract.
- The normalized output remains compatible with the existing evidence engine.
- Academic identifiers are preserved in metadata.
- Study-identity targets can use adapter results to resolve exact papers and identifiers.

## Phase 7 - Target-level bearing and linking

Extend the current post-scrape bearing evaluator rather than creating a second evaluator.

- [ ] Score each source claim against a specific `evaluation_target_id`.
- [ ] Treat general vaccine-autism evidence as non-bearing on CDC data manipulation.
- [ ] Attach Thompson statements to the attribution target only.
- [ ] Attach study methods, exclusions, and protocol evidence to the substantive target.
- [ ] Attach concealment consequences to the inference target.
- [ ] Apply the same target-level bearing requirement in later reference-claim matching.
- [ ] Prevent shared topics or entities from creating an evidence link without predicate-level bearing.


## Phase X3 - Retrieval modes and budget-aware provider routing

Implement after target-aware query planning and the initial web/academic providers are available.

### Purpose

The caller should be able to pass a claim or evaluation target without caring which provider is best. The gateway should classify retrieval need, choose providers, and stay within cost limits.

### Retrieval modes

Add retrieval modes:

```ts
type RetrievalMode =
  | "broad_web"
  | "exact_entity"
  | "primary_official"
  | "academic_biomedical"
  | "news_timeline"
  | "local_event"
  | "rebuttal_discovery"
  | "source_identity";
```

### Auto mode

If the caller does not specify a mode, classify automatically using:

- target type
- subject, predicate, object
- alleged action
- named people
- institutions
- dates
- study/document fields
- source domain
- article passage context

Example rules:

```text
If target has study/journal/DOI/PMID/biomedical terms:
  academic_biomedical

If target names a statement, allegation, interview, whistleblower, testimony:
  exact_entity plus attribution-document search

If target involves cancellation, removal, festival, theater, newspaper, platform, or local dispute:
  news_timeline or local_event

If target involves an agency, law, regulation, compensation program, court, official guidance:
  primary_official

If target involves publisher, author, journal, or source identity:
  source_identity
```

### Budget profiles

Add budget profiles:

```json
{
  "minimal": {
    "maxProviders": 1,
    "maxQueriesPerTarget": 3,
    "maxResultsPerQuery": 5
  },
  "standard": {
    "maxProviders": 3,
    "maxQueriesPerTarget": 5,
    "maxResultsPerQuery": 10
  },
  "deep": {
    "maxProviders": 7,
    "maxQueriesPerTarget": 8,
    "maxResultsPerQuery": 10
  }
}
```

### Adaptive provider expansion

- [ ] Start with the cheapest/most appropriate provider set.
- [ ] Score snippets and preserve candidates through the existing bearing pipeline.
- [ ] Expand to additional providers only when the target has fewer than the configured high-bearing threshold.
- [ ] Stop before additional provider calls when threshold is already met.
- [ ] Record skipped providers and skip reasons.

### Acceptance criteria

- The evidence engine can pass a target and budget profile without selecting providers directly.
- Provider selection is deterministic and logged.
- Deep Evidence Search can use a deeper budget profile.
- Standard scans remain cost-bounded.

## Phase 8 - Separate findings and aggregation

Keep one visible article claim with nested findings.

- [ ] False attribution may refute the article's attribution.
- [ ] Verified attribution must not prove the substantive target.
- [ ] Substantive evidence determines the alleged-conduct finding.
- [ ] Inference evidence determines whether the article's conclusion follows.
- [ ] Study identity remains a prerequisite rather than verdict evidence.
- [ ] Do not blindly average target findings.
- [ ] Do not count one passage repeatedly under equivalent targets.
- [ ] Continue producing a compatibility verdict for current consumers while retaining target-level findings.

## Phase 9 - Relevance Scan evaluation-target drawer

The claim-list boxes will remain compact. The existing truncated `object_claim_text` preview may remain as a short indicator, but detailed evaluation-target information belongs in a drawer inside the Relevance Scan modal.

### Drawer behavior

- [ ] Add an **Evaluation Targets** control to the Relevance Scan modal.
- [ ] Open a right-side drawer within/above the modal without navigating away from the claim or closing the modal.
- [ ] Load targets for the currently selected visible claim.
- [ ] Preserve the existing `PILLAR SUPPORT` and other hierarchy labels.
- [ ] Show the full visible `claim_text` at the top.
- [ ] Show every evaluation target without one-line truncation.
- [ ] Keep the currently selected target visually active while reviewing its evidence.

Example drawer summary:

```text
Evaluates

Attribution            Completed
Substantive allegation Searching
Inference              Unresolved
Study identity         Resolved
```

Each expandable target section will show:

- Full target text
- Target type and parent/dependency
- Study/document identity and scope
- Search eligibility and verdict eligibility
- Search status
- Queries generated
- Sources processed
- Unique high-bearing claim count, shown as `n / 3`
- Skip or unresolved reason
- Target-specific evidence claims and rationales

### Scan actions

Rename the current operations:

- **Scan Existing Sources**: reassess claims already extracted from workspace references.
- **Deep Evidence Search**: perform new web retrieval against the selected evaluation target.

- [ ] Make Deep Evidence Search call the existing evidence engine with deep-mode configuration.
- [ ] Use the persisted evaluation target, never only the visible attribution wrapper.
- [ ] Use the existing deeper source ceiling and adaptive retrieval loop.
- [ ] Refresh the drawer as target search states and bearing counts change.
- [ ] Do not claim completion merely because three claims were encountered midway through an active source.

## Phase 10 - Compatibility, rollout, and observability

- [ ] Preserve existing APIs while adding target-level fields additively.
- [ ] Preserve existing feature flags and comparison exports.
- [ ] Add `ENABLE_MULTI_TARGET_EVIDENCE` for controlled activation.
- [ ] Keep `object_claim_text` synchronized during the transition.
- [ ] Log target-level query, retrieval, expansion, stopping, and unresolved decisions using bounded JSON.
- [ ] Add readable export columns for visible claim, evaluation target, target type, query, source, source claim, bearing score, stance, and rationale.
- [ ] Run a controlled regression before enabling target-level behavior by default.


## Phase X4 - Incremental bearing yield and provider ROI

Implement after provider provenance survives through snippet scoring, source processing, and target-level bearing links.

### Purpose

VeriStrata should not permanently pay for providers that do not improve evidence quality. Provider use should be justified by measured incremental bearing yield.

### Metrics

For each provider and retrieval mode, compute:

```text
unique_candidates_added
high_bearing_candidates_added
primary_sources_added
official_responses_added
allegation_sources_added
study_identity_sources_added
generic_noise_rate
cost_estimate
incremental_bearing_yield
cost_per_high_bearing_candidate
```

Definition:

```text
Incremental Bearing Yield =
  high-bearing unique candidates from this provider
  that were not already found by earlier providers.
```

### Reporting

Expose provider ROI in logs, exports, and optionally the Relevance Scan target drawer:

- providers called
- queries by provider
- high-bearing candidate count by provider
- incremental bearing yield
- provider cost estimate
- skipped provider reasons
- whether more provider expansion is available

### Routing feedback

Use aggregate diagnostics to improve routing:

- If Serper consistently finds exact-entity sources Tavily misses, favor Serper for exact-entity mode.
- If Brave adds low-cost diversity but high noise for a target class, lower its rank for that class.
- If PubMed resolves biomedical primary studies cheaply, favor it before generic web search for biomedical study targets.
- If Tavily supplies useful broad context but weak primary-source yield, use it later in the tranche for certain modes.

### Acceptance criteria

- The system can answer whether Brave or Serper found useful sources Tavily missed.
- Provider use can be tuned by retrieval mode using logged outcomes.
- Cost-per-bearing-source is visible enough to guide defaults.

## Required regression tests

- [ ] Twelve eligible visible claims produce twelve primary query plans.
- [ ] The Thompson substantive target generates real queries.
- [ ] Every route loads the same persisted evaluation targets.
- [ ] Standard and deep modes perform meaningfully different retrieval.
- [ ] Snippet-low provider-ranked candidates remain available for adaptive expansion.
- [ ] Retrieval expands when fewer than three high-bearing claims are found.
- [ ] Retrieval stops before the next source once the threshold is satisfied.
- [ ] Processing never stops midway through an active scraped source.
- [ ] Duplicate source claims do not inflate the success count.
- [ ] Additional qualifying claims from the threshold-reaching source are retained.
- [ ] Generic vaccine-autism evidence is rejected for the manipulation target.
- [ ] Attribution evidence cannot prove manipulation.
- [ ] Evidence links persist the correct `evaluation_target_id`.
- [ ] Existing bearing packets, exports, feature flags, APIs, and claim hierarchy remain compatible.
- [ ] The Relevance Scan drawer displays complete target text and live status without crowding the claim-list boxes.
- [ ] Search provider gateway preserves existing Tavily input and output shape.
- [ ] Admin panel can enable/disable Tavily, Brave, and Serper without code changes.
- [ ] Enabled providers with missing API keys are skipped with explicit setup prompts.
- [ ] Provider-specific metadata is preserved in an existing metadata field or bounded snippet-compatible fallback.
- [ ] Ensemble mode records which provider found each candidate source.

## Final acceptance run

Rescrape the Port Townsend article and confirm:

- All eligible visible claims enter query planning.
- The Thompson claim has grounded attribution, substantive, inference, and study-identity targets where applicable.
- The study and disputed analysis are resolved or explicitly marked unresolved.
- Target-specific queries are visible in logs and in the Relevance Scan drawer.
- Snippet bearing prioritizes the first sources without deleting the remaining candidate pool.
- Retrieval expands automatically when the first sources yield fewer than three unique high-bearing claims.
- Every started source is completely processed.
- All qualifying claims from a processed source are retained.
- Generic vaccine-safety material does not become evidence of or against data manipulation.
- Failure to find adequate bearing evidence produces `unresolved`, never an invented verdict.

