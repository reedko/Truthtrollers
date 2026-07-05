# Context-Rich Query and Evidence-Handoff Repair Plan

Date: 2026-07-01  
Status: Ready for implementation  
Supersedes completion claims for Phase 7 in `claim-evaluation-targets-adaptive-bearing-plan-best-bearing-pool.md`

## Purpose

Repair the two failures demonstrated by the Port Townsend test run (`content_id=16386`):

1. Query construction paraphrased incomplete propositions instead of producing context-rich discovery queries.
2. The evidence engine extracted useful target-bearing quotations, but the later source-claim pipeline discarded that work and attempted to rediscover and rematch assertions through a separate LLM path.

The bearing concept remains valid. The pipeline surrounding it must supply better candidates and must not lose bearing evidence after it has been found.

## Terminology

- **Visible case claim**: The claim shown in the workspace.
- **Object claim**: The atomic proposition being evaluated, currently stored as `object_claim_text` or represented by a substantive evaluation target.
- **Discovery context**: People, organizations, dates, studies, quotations, populations, locations, alleged actions, and nearby article context needed to locate evidence for the object claim.
- **Evaluation target**: A typed proposition such as attribution, substantive, inference, or study identity.
- **Candidate source**: A search result that may contain evidence.
- **Bearing assertion**: A source quotation or extracted source claim that directly addresses a specific evaluation target.
- **Document-level link**: A `reference_claim_links` row connecting a reference document to a case claim.
- **Claim-level link**: A `reference_claim_task_links` row connecting a persisted source assertion to a case claim.

## Confirmed baseline from run 16386

- 12 visible case claims.
- 34 AI references returned.
- 134 OpenAI calls.
- 515,851 total tokens.
- 303,182 evidence-engine tokens.
- 192,205 post-evidence tokens.
- 43 claim-level links persisted, but only across four case claims:
  - Claim 52876: 17 links.
  - Claim 52884: 2 links.
  - Claim 52885: 6 links.
  - Claim 52886: 18 links.
- Eight case claims received zero claim-level links, including:
  - William Thompson / CDC manipulation.
  - CDC evidence destruction.
  - Vaccine testing.
  - Vaccination and chronic disease.
  - 1986 liability law.
  - Outdoor immune-system comparison.

The evidence engine nevertheless extracted useful Thompson-related material from ABC News, including Thompson's statement, the omitted-data allegation, identification of the 2004 study, CDC's response, and criticism of Hooker's reanalysis. That evidence did not become a Thompson claim-level link.

## Confirmed defects

### Defect A - Object claims were used without discovery context

For claim 52881, the query generator produced:

1. `William Thompson claims that data linking the MMR vaccine to autism was manipulated by the CDC.`
2. `Examine the claims made by William Thompson about the CDC and the MMR vaccine data.`
3. `William Thompson primary source corroboration`
4. `Did the CDC destroy evidence related to the MMR vaccine and autism link?`
5. `William Thompson fact check contrary evidence`
6. `William Thompson official denial records`
7. `William Thompson`
8. `data linking the MMR vaccine to autism was manipulated by the CDC.`
9. `Investigate if there is evidence that the CDC manipulated data linking the MMR vaccine to autism.`

Queries 3, 5, 6, and 7 lack essential context. Queries 8 and 9 preserve the proposition but do not identify the concerned study. None includes DeStefano, Pediatrics, 2004, metropolitan Atlanta, African-American boys, first MMR vaccination, PMID `14754936`, or DOI `10.1542/peds.113.2.259`.

### Defect B - Study identity was not created or resolved

The Thompson claim received attribution and substantive targets but no study-identity target. Search repeatedly found PMID `14761240`, a related review, rather than the concerned study:

`Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects: a population-based study in metropolitan Atlanta`

- DeStefano, Bhasin, Thompson, Yeargin-Allsopp, Boyle.
- Pediatrics, 2004.
- PMID `14754936`.
- DOI `10.1542/peds.113.2.259`.

### Defect C - Mechanical 3-3-3 completion degraded specificity

The deterministic completion logic appended generic suffixes to the weakest target hint. It optimized for a nominal support/refute/nuance distribution rather than ensuring that each query retained the identifying anchor bundle.

### Defect D - Candidate dedupe collapsed target provenance

A source found through attribution and substantive queries could retain only one active `evidenceTargetId` even though `targetProvenance` recorded multiple occurrences. The source was then evaluated against only the winning target.

### Defect E - Bearing evidence was discarded at the persistence handoff

`EvidenceEngine.extractEvidence()` already returned:

- Exact quotation.
- Case claim ID.
- Numeric evaluation target ID.
- Stance.
- Bearing score and type.
- Bearing rationale.
- Source URL and cached reference content ID.

`runEvidenceEngine()` collapsed those results into document-oriented `aiReferences`. The scrape route then:

1. Persisted document-level links.
2. Re-ran generic source-claim extraction over every full reference.
3. Re-ran an all-source-claims versus all-case-claims matcher.
4. Persisted only the second pipeline's matches as claim-level links.

Thus, already-discovered target-bearing assertions could disappear.

### Defect F - Broad claims absorbed specific evidence

The post-evidence matcher compared extracted claims with all twelve case claims. Broad claims such as “public health narratives may conceal risks” captured many matches while narrower claims received none.

### Defect G - Link persistence was not idempotent

A duplicate `(reference_claim_id, task_claim_id)` caused a batch `INSERT` failure instead of updating or safely ignoring the existing link.

### Defect H - UI progress concealed the pipeline state

Document rows appeared while claim-level links were buffered until the evidence engine and post-evidence processing completed. This produced a long and misleading zero-link period.

## Non-negotiable constraints

- Preserve the existing bearing scorer, packet builder, provider gateway, candidate cache, publisher pipeline, and evaluation-target schema.
- Do not build a third evidence evaluator or a third persistence path.
- Do not use snippet bearing as final exclusion authority.
- Do not fabricate three links when three bearing sources cannot be found; mark the target unresolved with an explicit reason.
- Do not add an LLM call merely to compensate for data already available in structured form.
- Reuse the existing query-generation call. Study resolution should begin with deterministic discovery search and structured identifiers.
- Keep prompts managed through the existing PromptManager/database mechanism. Provide explicit SQL only when a prompt change is required.
- Avoid migrations unless an existing table genuinely cannot represent the required relationship.
- Preserve current APIs additively.
- Make every write idempotent.
- Tests must directly prove a success criterion. Do not run another expensive comparison whose output cannot be evaluated.
- Do not change bearing thresholds, the 24-source delivery target, or unrelated UI behavior during the query/handoff repair. Isolate the repair first.

---

## Repair Phase R0 - Freeze and instrument the failure contract

Status: Complete on 2026-07-02.

### Work

- [x] Record the run-16386 counts above as the repair baseline.
- [x] Add one bounded query-pack audit record per case claim.
- [x] Add one bounded evidence-handoff audit record per bearing assertion.
- [x] Add one final per-claim accounting record:
  - Candidates retrieved.
  - Full sources processed.
  - Bearing assertions extracted.
  - Assertions persisted.
  - Claim-level links persisted.
  - Rejection reasons.

### Acceptance criteria

- [x] A developer can trace one assertion from query to source to evaluation
  target to its handoff outcome. If no assertion or claim-level link is
  persisted, that loss is recorded explicitly rather than disappearing between
  stages.
- [x] Counts reconcile; no stage silently loses assertions. Missing handoff
  records and assertions not directly persisted are explicit counted outcomes.
- [x] Logs do not include full documents or unbounded prompt responses.

### Implementation record

- Added `backend/src/core/evidenceRepairAudit.js`.
- Added structured log records:
  - `REPAIR_R0_BASELINE` once per evidence run.
  - `REPAIR_R0_QUERY_PACK` once per visible case claim.
  - `REPAIR_R0_EVIDENCE_HANDOFF` once per extracted bearing assertion.
  - `REPAIR_R0_CLAIM_ACCOUNTING` once per visible case claim after the
    post-evidence phase.
- Added `ENABLE_EVIDENCE_REPAIR_AUDIT=false` as an operational kill switch.
- Added `backend/test/bearing/evidenceRepairAudit.test.js` proving bounded
  records, deterministic trace IDs, count reconciliation, missing-handoff
  detection, and non-mutation of claims, queries, and evidence objects.
- Verification: focused R0 tests passed, JavaScript syntax checks passed, and
  the complete bearing test suite passed.
- No query construction, ordering, candidate selection, bearing thresholds,
  extraction, persistence behavior, or API response was changed in R0.

## Repair Phase R1 - Preserve and directly persist bearing assertions

Status: Implemented on 2026-07-02. Deterministic persistence and retry
acceptance tests pass; the named ABC/Thompson live acceptance remains for the
controlled R9 run rather than triggering another expensive scrape here.

### Goal

Make the existing evidence-engine result the authoritative path for assertions it has already evaluated.

### Work

- [x] Extend each `aiReference` additively with an `evidenceAssertions` array preserving:
  - `taskClaimId`.
  - `evaluationTargetId`.
  - `evaluationTargetType`.
  - `quote`.
  - `summary`.
  - `stance`.
  - `bearingScore`.
  - `bearingType`.
  - `bearingReason`.
  - `claimComponentAddressed`.
  - `sourceUrl`.
  - `referenceContentId`.
- [x] Persist each qualifying evidence assertion as a source claim using the existing claim persistence facade.
- [x] Directly persist its `reference_claim_task_links` row using the known task claim and target routing.
- [x] Dual-write the exact `evaluation_target_id` through the existing target-evidence link path.
- [x] Retain generic full-source claim extraction only to discover additional assertions not already extracted.
- [x] Deduplicate additional assertions against evidence-engine assertions before matching.
- [x] Never allow the secondary matcher to delete, downgrade, or replace a direct bearing link.

### Idempotency

- [x] Replace batch plain `INSERT` behavior with `INSERT ... ON DUPLICATE KEY UPDATE` or an equivalent safe upsert.
- [x] A duplicate pair updates stronger score/bearing metadata while preserving the stronger existing confidence, stance, and rationale.
- [x] One duplicate no longer fails other links; matches are deduplicated by pair and upserted independently.

### Acceptance criteria

- [ ] In the controlled live acceptance run, the ABC Thompson quotations become persisted source claims.
- [x] The direct-persistence test links a Thompson assertion to claim 52881 and numeric evaluation target 72.
- [x] A developer can trace each directly persisted bearing assertion from its
  query and source through the evaluation target to the exact persisted source
  claim and claim-level link.
- [x] Restarting or retrying persistence reuses the source claim, claim-level link, and target-evidence link without a duplicate error.
- [x] Every preserved evidence-engine assertion reaches the direct-persistence coordinator; duplicate assertions are explicitly counted and deduplicated there.
- [x] Generic source extraction may add links but is no longer required to preserve known evidence.

### Implementation record

- Added `backend/src/core/evidenceAssertionPersistence.js` as the narrow
  coordinator over the existing `persistClaims()` and
  `dualWriteTargetEvidenceLinks()` paths.
- `runEvidenceEngine()` now preserves every extracted bearing assertion on its
  document reference as `evidenceAssertions`; it does not collapse those
  assertions into one document summary.
- Direct persistence records the exact `referenceClaimId`,
  `reference_claim_task_links_id`, and
  `evaluation_target_evidence_link_id` against the R0 trace ID in
  `REPAIR_R1_ASSERTION_PERSISTENCE`.
- Generic reference-claim extraction remains enabled, but exact assertions
  already directly persisted are removed before the secondary matcher.
- Replaced the scrape route's batch plain insert with pair-deduplicated,
  stronger-wins idempotent upserts.
- Added `backend/test/bearing/evidenceAssertionPersistence.test.js` covering
  the additive handoff shape, non-mutation, generic dedupe, stronger-wins
  behavior, exact target routing, trace IDs, and retry idempotency.
- No migration, prompt change, new LLM call, retrieval change, bearing-threshold
  change, or external API response change was introduced.

## Repair Phase R2 - Build a retrieval-context contract

Status: Complete on 2026-07-02.

### Goal

Keep `object_claim_text` atomic while supplying query construction with the context needed to locate evidence.

### Runtime structure

```json
{
  "visibleClaimText": "...",
  "objectClaimText": "...",
  "evaluationTargetId": 72,
  "evaluationTargetType": "substantive",
  "targetText": "...",
  "speakerEntities": [],
  "organizations": [],
  "namedEntities": [],
  "dates": [],
  "numbersAndScope": [],
  "populations": [],
  "allegedActions": [],
  "studyClues": [],
  "sourceCitations": [],
  "articlePassageContext": "...",
  "resolvedWorks": [],
  "requiredAnchors": []
}
```

### Sources

- Existing visible claim metadata.
- Persisted evaluation targets.
- `searchAssertions`.
- `namedEntities`, `dates`, and `studiesOrDocuments` already produced by claim mapping.
- `sourceCitedInArticle`.
- A bounded nearby passage from the case article.
- Resolved identifiers found during discovery.

### Rules

- Resolve pronouns and underspecified nouns for retrieval without rewriting the atomic target.
- “The study,” “the data,” “the report,” and “they” must be accompanied by discovery context.
- Do not persist invented authors, dates, titles, identifiers, or populations as resolved facts.

### Acceptance criteria

- [x] The Thompson substantive target retains its atomic proposition.
- [x] Its retrieval context contains William Thompson, CDC, MMR/autism, 2004, and the fact that a study must be resolved.
- [x] The contract is shared by query planning, provider routing, candidate provenance, and bounded logs. The later Relevance Scan drawer phase consumes this same contract rather than defining another shape.

### Implementation record

- Added `backend/src/core/retrievalContext.js` with one bounded context per
  evaluation target and no LLM call.
- Context fields are sourced from existing claim metadata, evaluation targets,
  search assertions, and a bounded nearby case-article passage.
- Unresolved study/document clues are explicitly marked and never promoted to
  `resolvedWorks` without a title or identifier already present in evidence.
- `buildEvidenceQueryContexts()` supplies the same object to query planning;
  provider calls and candidate provenance carry the matching target context.
- Added `RETRIEVAL_CONTEXT` bounded logs and
  `backend/test/bearing/retrievalContext.test.js`.

## Repair Phase R3 - Add study/document identity discovery

Status: Implemented on 2026-07-02; controlled live retrieval remains part of
the R9 acceptance run.

### Goal

Resolve a referenced work before generating evidence queries that depend on it.

### Work

- Create a study-identity target whenever a claim refers to a study, dataset, report, analysis, protocol, paper, authors' results, or unnamed evidence whose identity affects adjudication.
- When identity is unresolved, run one or two compact discovery queries before the 3-3-3 evidence pack.
- Prefer natural anchor queries over proposition paraphrases.
- Feed discovery results through the existing academic adapters from Phase X2.
- Extract and normalize:
  - Title.
  - Authors.
  - Year.
  - Journal or institution.
  - DOI.
  - PMID/PMCID.
  - Dataset or report identifier.
  - Population/subgroup.
- Preserve candidates when identity remains ambiguous and mark the target unresolved rather than guessing.

### Thompson discovery example

```text
William Thompson CDC 2004 study MMR autism
William Thompson CDC study African American boys MMR
```

Expected resolution:

```text
DeStefano et al.
Age at first measles-mumps-rubella vaccination in children with autism and school-matched control subjects
Pediatrics 2004
Metropolitan Atlanta
PMID 14754936
DOI 10.1542/peds.113.2.259
```

### Acceptance criteria

- [x] The deterministic acceptance fixture selects PMID `14754936` and DOI
  `10.1542/peds.113.2.259`, not the related review PMID `14761240`; live provider
  confirmation remains for R9.
- [x] The study-identity finding is stored separately on its non-verdict
  `study_identity` target.
- [x] The resolved work is propagated into retrieval context while remaining
  ineligible to prove manipulation.

### Implementation record

- Argument mapping now deterministically adds a missing `study_identity`
  target when a referenced study, dataset, report, analysis, protocol, or
  unnamed evidence materially affects adjudication.
- Added `backend/src/core/studyIdentityDiscovery.js` with at most two bounded
  natural-anchor discovery queries before evidence-query generation.
- Reused the existing retrieval gateway and academic adapters; no new LLM call
  or migration was added.
- Resolution normalizes title, authors, year, venue, PMID, DOI, population,
  provider, and URL. Ambiguous results remain unresolved.
- Added `STUDY_IDENTITY_DISCOVERY` logs separating discovery from evidence
  queries and `backend/test/bearing/studyIdentityDiscovery.test.js`.

## Repair Phase R4 - Replace mechanical query completion with anchored query packs

Status: Complete on 2026-07-02.

### Goal

Generate queries a knowledgeable person would plausibly enter into a search engine.

### Query sequence

1. Resolve required study/document identity when needed.
2. Assemble the required anchor bundle.
3. Generate support, refute, and methodology/nuance queries.
4. Validate every query before provider execution.
5. Use deterministic context-rich fallback queries if the LLM response is invalid or unavailable.

### 3-3-3 rule

Retain up to three support-oriented, three refutation-oriented, and three methodology/nuance queries, but never fill a quota by dropping required anchors or appending generic suffixes to a person's name.

For simple claims, deduplicated high-quality queries may be fewer than nine. Specificity is more important than filling a nominal quota.

### Required-anchor rules

- A named-person query must include disambiguating organization/topic context.
- A study-dependent substantive query must contain a resolved title/author/identifier or a sufficient study clue bundle.
- Exact dates, populations, numeric thresholds, comparisons, doses, and timeframes must be preserved where material.
- Attribution queries must contain the speaker plus the specific statement/action.
- Substantive queries must contain the actor, alleged conduct, and concerned object/study.
- Methodology queries must contain the concerned work and disputed analytic choice.

### Reject queries that

- Contain only a person's name.
- Merely restate an object claim containing unresolved references.
- Add generic phrases such as “primary source corroboration,” “official denial records,” or “contrary evidence” without adding identity.
- Lose the organization, topic, study, population, date, or numeric scope needed to disambiguate the claim.
- Broaden the causal or misconduct allegation.

### Thompson evidence-query examples

```text
William Thompson CDC DeStefano 2004 MMR autism omitted data
Thompson statement African American boys MMR before 36 months
CDC MMR Atlanta study final protocol not followed
CDC response William Thompson DeStefano omitted data allegation
DeStefano study birth certificate sample African American boys explanation
fact check Thompson CDC MMR study data manipulation
DeStefano 2004 Atlanta MMR autism study methodology
Hooker reanalysis DeStefano CDC data statistical criticism
Pediatrics 2004 MMR study protocol African American subgroup
```

### Acceptance criteria

- [x] No processed Thompson query can be a bare `William Thompson` query.
- [x] Every Thompson query must carry sufficient organization/topic/study context.
- [x] Query generation failure produces context-rich deterministic fallbacks.
- [x] `STUDY_IDENTITY_DISCOVERY` and `ANCHORED_QUERY_PACK` logs separate discovery queries from evidence queries.

### Implementation record

- Added `backend/src/core/anchoredQueryPack.js`.
- Removed mechanical quota completion using generic suffixes.
- LLM-generated and deterministic queries now pass target-aware anchor
  validation before provider execution.
- The pack retains at most three support, three refute, and three
  methodology/nuance queries, but does not fabricate weak queries merely to
  reach nine.
- Added `backend/test/bearing/anchoredQueryPack.test.js`; the full 171-test
  bearing suite passes.

## Repair Phase R5 - Preserve multi-target and multi-query provenance

Status: Complete on 2026-07-02.

### Goal

Do not let URL dedupe erase why a source was retrieved.

### Work

- Fetch each canonical URL once.
- Preserve every relevant query occurrence and target assignment.
- Evaluate the fetched source against every applicable target, not merely the occurrence with the highest provider score.
- Keep attribution, substantive, inference, and study-identity results separate.
- Deduplicate equivalent quotations only within the same target.
- Do not count one passage repeatedly toward the same target threshold.

### Acceptance criteria

- [x] A source first found through Thompson attribution can also be evaluated against attribution.
- [x] The same fetched source is separately evaluated against substantive,
  inference, and other preserved target assignments.
- [x] Attribution evidence retains its attribution target ID and cannot prove a substantive manipulation target.
- [x] A substantive finding is not lost because the URL was first discovered through an attribution query.

### Implementation record

- Added `backend/src/core/evidenceTargetProvenance.js` to expand a canonically
  deduplicated candidate into distinct target assignments.
- Adaptive and non-adaptive extraction fetch canonical content once and run
  target-specific extraction for every preserved assignment.
- Equivalent quotations remain separable across targets while existing
  per-target threshold dedupe prevents one passage from counting repeatedly
  within the same target.
- Added `backend/test/bearing/evidenceTargetProvenance.test.js`; the complete
  173-test bearing suite passes.

## Repair Phase R6 - Follow primary-source citations within the existing budget

Status: Complete on 2026-07-02; live Port Townsend confirmation remains in R9.

### Goal

Turn promising secondary sources and snippets into primary-source candidates.

### Work

- When a processed candidate identifies a DOI, PMID, PMCID, exact title, report number, court document, dataset, or official statement, enqueue that primary source.
- Prefer the direct identifier over another broad web query.
- Use existing PubMed/Crossref/OpenAlex/Semantic Scholar adapters for academic identifiers.
- Use the current PDF extractor and add a bounded fallback when a high-value PDF produces no text or no claims.
- Record citation-derived provenance.
- Citation expansion must remain within the same source-attempt budget unless Deep Evidence Search is explicitly requested.

### Acceptance criteria

- [x] An R3-resolved DeStefano work and any source naming PMID `14754936`
  produce a direct PubMed primary-source candidate.
- [x] A high-value PDF receives a bounded second parser attempt before being
  declared empty.
- [x] Citation-derived sources retain originating source, query, provider, and
  evaluation-target provenance.

### Implementation record

- Added `backend/src/core/citationExpansion.js`.
- Extracts bounded direct DOI, PMID, PMCID, academic, government-document, and
  PDF citation candidates without an LLM call.
- R3 resolved works enter candidate selection as protected origin sources and
  preserve every applicable target assignment.
- Citation candidates are inserted immediately after the revealing source and
  are followed even when that source satisfied the local bearing count, while
  still obeying the existing global and per-claim attempt ceilings.
- Citation-only empty sources can enqueue their primary references without an
  evidence-extraction call on empty text.
- Added bounded `CITATION_EXPANSION` provenance logs and
  `backend/test/bearing/citationExpansion.test.js`.
- The complete 178-test bearing suite passes; no migration, prompt change, or
  new LLM call was added.

## Repair Phase R7 - Make source-claim extraction additive, not destructive

Status: Implemented on 2026-07-02. Live post-evidence token reduction remains
for the controlled R9 measurement.

### Goal

Retain the value of full-source claim extraction without making it a second mandatory rediscovery pipeline.

### Work

- Seed source claims with direct evidence assertions already extracted by EvidenceEngine.
- Ask full-source extraction only for additional distinct assertions relevant to unresolved targets.
- Match additional source claims only against the target(s) that caused the source to be processed, plus explicitly discovered cross-target provenance.
- Prevent broad thesis claims from absorbing assertions routed to a specific target.
- Preserve complete-source processing once a source is opened.
- Stop reprocessing snippet-only stubs as though they contained full assertions.

### Acceptance criteria

- [x] Direct bearing links are persisted before additional extraction begins
  and survive an extraction timeout or schema failure.
- [x] A broad claim cannot steal a target-routed assertion; the secondary
  matcher receives only the originating visible claim and unresolved target IDs.
- [ ] The controlled R9 run must measure materially fewer post-evidence calls
  and tokens than run 16386. Deterministic tests prove the completed-target path
  makes no secondary extraction or matcher call.
- [x] Invalid LLM indices remain logged and cannot erase already-persisted
  direct links.

### Implementation record

- Every preserved assertion now carries `evaluationTargetText` and explicit
  `targetUnresolved` state from adaptive extraction.
- Completed originating targets skip generic source-claim extraction entirely.
- Unresolved targets use the existing extraction call with already-captured
  quotes as exclusions and an instruction to return only additional distinct
  target-bearing assertions.
- Secondary matching is restricted to the originating case claim and exact
  unresolved target set; unrelated broad claims are not sent to the matcher.
- Exact direct assertions no longer create redundant snippet claims.
- Snippet-only stubs remain excluded from full-source assertion extraction.
- Added `backend/test/bearing/additiveSourceExtraction.test.js`; the complete
  181-test bearing suite passes.
- Added the database-managed prompt seed
  `backend/deploy/2026-07-02-01-seed-unresolved-target-extraction-prompt.sql`.
  Runtime fallback is identical, but the SQL should be run before the live R9
  acceptance test so production uses the managed prompt.

## Repair Phase R8 - Progress and UI consistency

Status: Implemented on 2026-07-02; live count reconciliation remains part of
the controlled R9 run.

### Work

- [x] Expose separate progress counts for:
  - Sources discovered.
  - Sources processed.
  - Bearing assertions found.
  - Claim-level links persisted.
- [x] Persist direct links incrementally after each completed source/target evaluation.
- [x] Refresh the workspace and Relevance Scan modal when links are persisted.
- [x] Continue distinguishing dotted document-level links from claim-level assertion links.
- [x] Display unresolved reasons when a claim has document candidates but no qualifying assertion links.

### Implementation record

- Adaptive extraction now awaits an incremental direct-persistence callback
  after each source is completely evaluated against its assigned targets.
- The existing final upsert remains as an idempotent reconciliation pass.
- Scrape status exposes bounded discovered, processed, assertion, and persisted
  link counts plus per-claim unresolved reasons and a monotonic refresh version.
- Workspace and Relevance Scan poll only the lightweight status endpoint and
  refresh durable references, links, and scores when that version advances.
- Relevance Scan retains separate document-level and claim-level sections and
  no longer labels an active run as an empty completed scan.

### Acceptance criteria

- The UI no longer displays a misleading zero-link state while qualifying links sit only in memory.
- A backend interruption does not discard all previously completed claim-level links.
- Counts shown in the UI reconcile with database counts.

## Repair Phase R9 - Focused tests and controlled rollout

Status: Deterministic suite implemented on 2026-07-02. The single controlled
Port Townsend acceptance run remains user-triggered and pending.

### Deterministic tests

- [x] Bare-person queries are rejected.
- [x] Required anchors survive every query transformation.
- [x] Unresolved study references trigger discovery.
- [x] PMID `14754936` is distinguished from PMID `14761240`.
- [x] Query-generation failure produces anchored fallbacks.
- [x] URL dedupe preserves all target provenance.
- [x] One source can produce separate attribution and substantive findings.
- [x] Direct evidence assertions persist without generic rematching.
- [x] Duplicate link writes are idempotent.
- [x] A post-evidence timeout cannot remove direct links.

### Controlled acceptance run

Use the Port Townsend article once after deterministic tests pass.

Require:

- The exact DeStefano study is retrieved.
- Thompson's statement is retrieved.
- CDC's response is retrieved.
- The methodological dispute is retrieved.
- No unrelated William Thompsons enter the processed tranche.
- Claim 52881 receives legitimate claim-level links.
- Claim 52882 receives links only for evidence specifically bearing on an order to destroy evidence; otherwise it is explicitly unresolved.
- ABC evidence is routed to the appropriate attribution and substantive targets.
- All direct evidence assertions reconcile with persisted source claims and links.
- Total tokens are at least 50% lower than run 16386 while producing better target coverage.
- The resulting evaluation can be inspected directly in the Relevance Scan modal and bounded logs; no opaque comparison export is required.

---

# Carried-Forward Roadmap from Phase X2 Through Final Acceptance

The prior plan did not genuinely complete Phase 7. The following phases are retained here so implementation can continue from one document after the repairs above.

## Phase X2 - Domain-specific academic and biomedical adapters

Status: Implemented infrastructure; must be revalidated and correctly wired to study-identity discovery.

Existing adapters:

- PubMed.
- Crossref.
- OpenAlex.
- Semantic Scholar.

Required repair integration:

- [ ] Route resolved academic/biomedical study targets through the existing adapters.
- [ ] Preserve DOI, PMID, PMCID, title, authors, venue, year, abstract, citation, correction, and retraction metadata.
- [ ] Prefer exact identifiers after discovery.
- [ ] Prove that the Thompson discovery query resolves PMID `14754936`.
- [ ] Do not treat a related review as the concerned primary study.

## Phase 7 - Target-level bearing and linking — REOPENED

Status: Incomplete. Earlier checks proved local guards, but run 16386 proved that target-bearing evidence can still be lost before claim-level persistence.

- [ ] Score each assertion against a numeric `evaluation_target_id`.
- [ ] Preserve target identity through query generation, candidate dedupe, fetch, extraction, persistence, and UI retrieval.
- [ ] Evaluate a multi-provenance source against every applicable target.
- [ ] Persist direct bearing assertions without requiring a second generic matcher.
- [ ] Treat general vaccine-autism evidence as non-bearing on CDC manipulation.
- [ ] Attach Thompson statements to attribution only.
- [ ] Attach study methods, exclusions, protocol, and analytic evidence to substantive/methodology targets.
- [ ] Attach concealment consequences only to inference targets.
- [ ] Prevent shared topics, entities, or broad thesis claims from creating or absorbing target-specific links.
- [ ] Make all target-level writes idempotent.
- [ ] Prove exact target routing in the database and Relevance Scan modal.

## Phase X3 - Retrieval modes and budget-aware provider routing

Status: Pending; implement only after R1-R7 and reopened Phase 7 pass.

Retrieval modes:

- `broad_web`
- `exact_entity`
- `primary_official`
- `academic_biomedical`
- `news_timeline`
- `local_event`
- `rebuttal_discovery`
- `source_identity`

Work:

- [ ] Classify retrieval mode using the complete retrieval-context contract.
- [ ] Route unresolved studies to `academic_biomedical` plus exact-entity discovery.
- [ ] Route allegations/statements to exact-entity and primary-document discovery.
- [ ] Route laws, agencies, regulations, and court matters to primary official sources.
- [ ] Start with the cheapest appropriate providers.
- [ ] Expand providers only when full-source bearing remains insufficient.
- [ ] Preserve candidates and provenance through the existing bearing pipeline.
- [ ] Log providers used, skipped providers, reasons, and budget state.
- [ ] Make Standard and Deep Evidence Search use meaningfully different budgets.

## Phase 8 - Separate findings and aggregation

Status: Pending.

- [ ] Keep one visible article claim with nested target findings.
- [ ] False attribution may refute the attribution finding.
- [ ] Verified attribution must not prove the substantive target.
- [ ] Substantive evidence determines whether alleged conduct occurred.
- [ ] Inference evidence determines whether the article's conclusion follows.
- [ ] Study identity is a prerequisite, not verdict evidence.
- [ ] Do not blindly average target findings.
- [ ] Do not count one passage repeatedly under equivalent targets.
- [ ] Continue producing a compatibility verdict for existing consumers.

## Phase 9 - Relevance Scan evaluation-target drawer

Status: Pending.

- [ ] Add an Evaluation Targets control to the Relevance Scan modal.
- [ ] Show the full visible claim and every untruncated target.
- [ ] Show target type, dependency, study identity, search status, queries, sources processed, bearing assertion count, links persisted, and unresolved reason.
- [ ] Keep the selected target active while reviewing evidence.
- [ ] Rename actions to `Scan Existing Sources` and `Deep Evidence Search`.
- [ ] Make Deep Evidence Search use the persisted target and context-rich query plan.
- [ ] Refresh incrementally as target assertions and links persist.
- [ ] Preserve current claim hierarchy labels and compact claim-list boxes.

## Phase 10 - Compatibility, rollout, and observability

Status: Pending.

- [ ] Preserve current APIs while adding target-level fields.
- [ ] Preserve feature flags and readable comparison/export tooling.
- [ ] Keep `object_claim_text` synchronized during transition.
- [ ] Log bounded target-level discovery, query, retrieval, bearing, handoff, persistence, and unresolved events.
- [ ] Add readable export fields for visible claim, target, query, source, source assertion, bearing, stance, rationale, and persistence outcome.
- [ ] Keep an immediate rollback flag for multi-target behavior.
- [ ] Run only the controlled acceptance test defined in R9 before default activation.

## Phase X4 - Incremental bearing yield and provider ROI

Status: Pending; implement after provider provenance survives into persisted target links.

Measure per provider and retrieval mode:

- Unique candidates added.
- Full sources successfully processed.
- High-bearing assertions added.
- Primary sources added.
- Official responses added.
- Study-identity sources added.
- Generic noise rate.
- Cost estimate.
- Incremental bearing yield.
- Cost per persisted high-bearing assertion.

Acceptance criteria:

- [ ] Determine whether Brave or Serper found useful sources Tavily missed.
- [ ] Attribute every persisted assertion to its retrieval provider(s) and query.
- [ ] Tune provider order by retrieval mode using measured outcomes.
- [ ] Keep cost-saver mode available.
- [ ] Do not pay permanently for providers that add no incremental bearing yield.

## Final acceptance run

Rescrape the Port Townsend article and confirm:

- [ ] All eligible visible claims enter query planning.
- [ ] Every query contains sufficient discovery context.
- [ ] The Thompson claim has grounded attribution, substantive, inference, and study-identity targets where applicable.
- [ ] PMID `14754936` and the disputed analysis are resolved or explicitly marked unresolved.
- [ ] Snippet bearing prioritizes without deleting the candidate pool.
- [ ] Every started source is completely processed.
- [ ] Every qualifying evidence assertion is persisted and linked to the correct case claim and target.
- [ ] General vaccine-autism material does not become evidence for or against CDC manipulation.
- [ ] The CDC-destruction claim is not supported or refuted without evidence about the alleged order or destruction.
- [ ] Failure to find adequate bearing evidence produces `unresolved`, never an invented verdict.
- [ ] Claim-level links appear incrementally and reconcile with database counts.
- [ ] Token usage is materially lower than run 16386.
- [ ] The final output is directly understandable in the workspace and Relevance Scan modal.
