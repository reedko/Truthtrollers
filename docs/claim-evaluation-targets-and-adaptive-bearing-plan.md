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

## Phase 7 - Target-level bearing and linking

Extend the current post-scrape bearing evaluator rather than creating a second evaluator.

- [ ] Score each source claim against a specific `evaluation_target_id`.
- [ ] Treat general vaccine-autism evidence as non-bearing on CDC data manipulation.
- [ ] Attach Thompson statements to the attribution target only.
- [ ] Attach study methods, exclusions, and protocol evidence to the substantive target.
- [ ] Attach concealment consequences to the inference target.
- [ ] Apply the same target-level bearing requirement in later reference-claim matching.
- [ ] Prevent shared topics or entities from creating an evidence link without predicate-level bearing.

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

