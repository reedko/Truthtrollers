# Claim Foundry CF1 — MCT

**MCT meaning:** Master Context Table / Master Control Thread.

**Status:** Design phase. No implementation is approved yet.

**Purpose:** Canonical context and constraint document for Claim Foundry, the separate agentic claim-package module/API. This first version is **CF1**.

---

## 1. Project goal

Create Claim Foundry: a consumer-neutral agentic module/API that produces selected, evidence-ready claim packages from supplied or persisted article content. VeriStrata is one consumer, not the API boundary.

This replaces the old deterministic/LLM multi-step claim-extraction pipeline as the producer of selected claim packets. It does not replace scraping, publisher/author handling, content persistence, or evidence gathering.

---

## 2. Current scope

### In scope

- Agentic selection and construction of evidence-ready claim packets.
- A standalone module boundary and API/data contract.
- Reuse of existing scraped content and publisher/author metadata.
- Persistence in the same database.
- Reuse of `content`, `claims`, `content_claims`, and `claim_evaluation_targets` where practical.
- Isolated invocation for development and testing.
- A consumer-neutral contract that does not expose VeriStrata database rows as the public API shape.

### Out of scope for the first phase

- Changes to evidence gathering.
- Wiring into the live scrape path.
- Deleting or rewriting the existing claim-extraction pipeline.
- Broad database redesign.

---

## 3. Mandatory module-size constraint

Claim Foundry must be composed of small, understandable, single-purpose modules.

- **Hard limit: every Claim Foundry implementation and test file must be 500 lines or fewer.**
- **Preferred target: every file should be fewer than 250 lines.**
- Files approaching 250 lines must be reviewed for a natural split by responsibility.
- Files may not cross 500 lines temporarily with a promise to split later.
- Generated files and third-party vendored files are excluded; handwritten project files are not.
- A file between 251 and 500 lines must retain one clear responsibility and include a brief explanation in the relevant review or design record for why splitting would reduce clarity.

Natural module boundaries include:

- API transport and request handling
- use-case orchestration
- agent prompt construction
- model invocation
- response parsing
- contract validation
- normalization
- claim selection policy
- persistence mapping
- transaction handling
- read/query access
- tests and fixtures

Do not combine these responsibilities merely to reduce the number of files.

---

## 4. Understandability requirements

- Each module exposes a small, explicit public contract.
- Inputs and outputs use named data structures rather than loosely shaped objects where practical.
- Dependencies are passed explicitly; avoid hidden mutable state.
- Persistence logic is separate from agent reasoning and API transport.
- Validation occurs at the boundary before persistence.
- Tests should exercise modules independently without requiring the entire pipeline.
- Orchestration code should read as a short sequence of named operations.

---

## 5. Compatibility constraints

- Use the existing database.
- Preserve existing content, scrape, publisher, author, and content-persistence behavior.
- Prefer the existing `content`, `claims`, `content_claims`, and `claim_evaluation_targets` tables.
- Any schema change requires an explicit contract gap that cannot be represented safely in those tables.
- Do not change evidence-gathering behavior during this project phase.
- Do not connect the new producer to live scraping until its contract and isolated behavior are reviewed.

---

## 6. Draft-file warning

There may be a new uncommitted file `backend/src/core/claimPackageAgent.js`; treat it as draft only. Its name does not establish the CF1 module or API naming.

It is not an approved architecture baseline. Before implementation begins, evaluate it against this MCT and the approved API/data contract, then delete it or decompose useful parts into compliant modules.

---

## 7. Initial acceptance gates

Implementation may begin only after review of:

1. The current claim-extraction and scrape-task paths.
2. The proposed module boundaries.
3. The API request/response contract.
4. The persistence mapping and transaction semantics.
5. Idempotency, replacement, and failure behavior.
6. A line-count plan showing every proposed file at 500 lines or fewer, with most below 250.

The first implementation must remain isolated from live scraping and evidence gathering.

---

## 8. Governing doctrine

```text
Agentic brain, deterministic bones.
```

Claim Foundry decides what the article is arguing, which assertions matter, how they relate, and what should be tested. Deterministic code preserves source structure and provenance, validates the package, enforces limits and enums, persists approved results, and prevents unsupported or malformed output.

Existing deterministic code has no preservation right. Retain a component only when it demonstrably improves grounding, safety, compatibility, observability, or understandability. Preserve useful principles even when their current implementation should be replaced.

Claim Foundry ends with a verified claim package. It does not search for evidence, fetch evidence URLs, judge source stance, or score article truth.

---

## 9. Principles carried forward

CF1 retains these organizational principles from the current system:

1. Raw extracted assertions are not automatically evaluation claims.
2. Only selected evaluation claims proceed to evidence planning and later EvidenceRun.
3. A displayed claim may require multiple distinct test targets.
4. Attribution is separate from the truth of the attributed proposition.
5. Study, document, dataset, law, filing, transcript, or record identity may be a separate research target.
6. `scoreTransform`, `searchEligible`, and `verdictEligible` express different decisions and must remain separate.
7. Every selected claim and target must retain article-grounded provenance.
8. Bearing criteria must explain what would and would not address the exact target.
9. Concrete identifiers and research anchors must be preserved before query planning.
10. Uncertainty must remain explicit rather than being converted into a confident default.
11. The final package must pass deterministic verification before persistence.
12. Intermediate artifacts and diagnostics must make every important decision inspectable.

CF1 does not commit to preserving the existing deterministic reconciliation, weighted selector, regex targetizer, sibling-term expansion, query-lane multiplication, or fixture-specific rules.

---

## 10. Semantic block model

Claim Foundry must not treat an article as a flat bag of sentences or fixed-size chunks. It must preserve and reason over semantic blocks.

Deterministic preprocessing may propose structural blocks from headings, paragraphs, lists, quotations, captions, DOM hierarchy, and source offsets. The agent assigns or revises their semantic functions.

A semantic block may function as:

- article thesis or framing
- background or chronology
- article-endorsed assertion
- opponent position
- rebuttal or counterargument
- supporting evidence or example
- study or document description
- methodological criticism
- causal explanation
- qualification or concession
- policy conclusion
- anecdote or testimonial
- call to action
- unclear or mixed function

Each block must retain:

```js
{
  blockId,
  heading,
  text,
  structuralType,
  semanticFunction,
  articleStance,
  speakerEntities,
  sourceOffsets,
  relatedBlockIds,
  confidence
}
```

Block labels are interpretations, not immutable preprocessing facts. Later blocks may revise the interpretation of earlier blocks.

---

## 11. Theme, thesis, and pillars

CF1 must determine what the article is trying to establish before selecting evaluation claims.

The article map contains:

- **Theme:** the subject and central dispute addressed by the article.
- **Thesis:** the article's principal conclusion or position about that theme.
- **Pillars:** the major load-bearing propositions that jointly support the thesis.
- **Clusters:** groups of related assertions, events, sources, or reasoning moves.
- **Opponent positions:** assertions the article presents to criticize, reject, qualify, or rebut.
- **Qualifications:** limits or concessions that constrain the thesis or pillars.

The initial theme is provisional. It must guide orientation without filtering out raw assertions. Claims from every meaningful semantic block must remain available so later material can expand, narrow, contradict, or replace the provisional theme.

The final article map must cite the blocks and assertions from which it was derived:

```js
{
  theme,
  thesis: { text, sourceBlockIds },
  pillars: [
    { pillarId, text, sourceBlockIds, importance }
  ],
  clusters: [],
  opponentPositions: [],
  qualifications: []
}
```

---

## 12. Claim relevance and selection

A selected evaluation claim must be relevant to the article's argument, not merely related to its topic.

The central selection question is:

```text
If this assertion were supported, refuted, qualified, or left unresolved,
would that materially change how strong the article's thesis or a major pillar is?
```

Each candidate claim must state its relationship to the article map:

- supports thesis
- supports pillar
- challenges thesis
- challenges pillar
- opponent claim the article seeks to rebut
- qualification or scope condition
- evidence offered for a pillar
- internal-consistency hinge
- background/context only
- unrelated or non-material

Each selected claim must identify related pillar IDs, materiality, and counterfactual impact. Deterministic validation checks those references and portfolio coverage; it does not assign semantic relevance scores.

Selection should normally yield a compact portfolio, approximately 8–12 claims, but quality and article structure take priority over filling a quota. Explicit exceptions are allowed for short, sparse, or unusually complex articles.

Research convenience must not replace argumentative importance. A central but difficult claim should not lose merely because a peripheral claim contains an easier study name or statistic.

---

## 13. Compelling and bearing-legible claim wording

Selected claims are product-facing statements. They must be compelling in the sense that a reader immediately understands the point and why it matters to the article.

A selected claim must:

- express a clear, consequential assertion rather than a topic label
- identify the relevant actor, action, object, population, scope, date, or named work when the article supplies them
- preserve material qualifications and uncertainty
- avoid rhetorical padding and unnecessary attribution wrappers
- remain faithful to what the article asserts or relies upon
- be understandable without rereading the entire source block
- make the potential truth-value dispute visible
- make it clear how another assertion or source could support, refute, qualify, contextualize, or fail to bear upon it

Compelling does not mean sensational, overstated, or rewritten for drama. It means crisp, concrete, material, and legible as a testable proposition.

CF1 may separate display wording from a narrower evidence-facing target, but both must link to the same grounded proposition and provenance. Claim wording may not be changed later by EvidenceRun.

---

## 14. Internal consistency across blocks

CF1 must compare assertions across semantic blocks and identify potentially material internal-consistency problems, including:

- direct contradiction
- scope or population shift
- association-to-causation shift
- allegation-to-established-fact shift
- numerical inconsistency
- study, document, actor, or event identity inconsistency
- incompatible chronology
- qualification omitted in a later restatement
- inconsistent standards applied to supporting and opposing sources
- thesis or pillar conflict

An internal-consistency finding must cite all relevant block and claim IDs, describe the exact tension, state its materiality, and distinguish an unresolved conflict from an apparent conflict resolved by context.

The agent interprets whether two assertions genuinely conflict. Deterministic code validates references and may flag structured polarity, number, date, or scope mismatches for agent review.

Internal-consistency findings inform selection but do not automatically become evaluation claims.

---

## 15. Selected claims and Phase 3 targets

Raw claims remain private working material and provenance. Only selected evaluation claims may produce Phase 3 targets.

A selected claim may generate one or more targets:

- article-endorsed substantive proposition
- opponent substantive proposition
- attribution or provenance
- study/document/record identity
- inference or warrant
- contextual or scope condition

Targets must preserve:

```js
{
  targetId,
  selectedClaimId,
  targetText,
  targetType,
  scoreTransform,
  searchEligible,
  verdictEligible,
  sourceBlockIds,
  sourceClaimIds,
  sourceExcerpt,
  mappingStatus,
  mappingRationale
}
```

Allowed `scoreTransform` values are `normal`, `invert`, and `none`. Review or uncertainty is recorded in `mappingStatus`, not encoded as a transform.

---

## 16. Evidence Need Cards

Every searchable target must receive an Evidence Need Card describing the future research task without executing it.

Each card includes:

- target and selected-claim IDs
- evidence roles actually needed
- target-specific bearing criteria
- query-lane seeds
- identifier hints
- canonical source identifiers already present in the article/package
- explicit rejection rules for merely topical or repetitive material

Generic evidence roles include:

- target-primary
- study-identity
- attribution-provenance
- official-response
- methodology-reanalysis
- primary-record
- context-background
- advocacy-restatement
- identifier-search

CF1 chooses only the roles justified by the target. It does not automatically multiply every target into every possible research lane.

`bearingCriteria` must contain `mustMatch`, `shouldMatch`, `rejectIfOnly`, and `weak`. `rejectIfOnly` must make clear why same-topic discussion, allegation repetition, identity-only material, or broad context would not address the target.

Identifier hints must generically preserve DOI, PMID, exact title, author/year, named study, filing, law, report, transcript, dataset, or quoted document name. A canonical identifier is not the same as a fetchable URL. CF1 may preserve the former but must not discover the latter.

---

## 17. Agentic and deterministic responsibilities

The agentic layer decides:

- semantic block function and article stance
- theme, thesis, pillars, clusters, and opponent positions
- semantic reconciliation among repeated or paraphrased assertions
- internal-consistency findings
- claim relevance, materiality, and portfolio selection
- compelling, faithful selected-claim wording
- target decomposition
- evidence roles, bearing criteria, and query-lane intent
- whether an identifier from another block genuinely belongs to a selected claim

The deterministic layer handles:

- structural block proposals and source offsets
- schema and enum validation
- ID and cross-reference integrity
- provenance preservation
- exact identifier normalization
- exact duplicate detection
- count and size limits
- selected-claim-only target enforcement
- one Evidence Need Card per searchable target
- package hashing, persistence, artifacts, and audit diagnostics
- one repair-pass limit
- prohibition of evidence search inside CF1

Deterministic code may flag possible conflicts or malformed output. It must not silently decide article meaning when the agent's interpretation is absent or unresolved.

---

## 18. Planned CF1 flow

```text
load persisted article and metadata
→ propose structural blocks deterministically
→ agent labels semantic blocks
→ agent extracts block-grounded raw assertions
→ agent reconciles semantic duplicates while preserving occurrences
→ agent builds final theme, thesis, pillars, clusters, and opponent map
→ agent reviews cross-block internal consistency
→ agent selects a compact portfolio of compelling evaluation claims
→ agent creates selected-claim Phase 3 targets
→ agent creates Evidence Need Cards
→ deterministic package verification
→ at most one targeted agent repair pass
→ deterministic reverification
→ persist approved package and artifacts
```

No evidence search, URL discovery, evidence fetch, source-stance decision, or article truth score occurs in this flow.

---

## 19. CF1 package acceptance principles

A valid CF1 package must demonstrate that:

1. The complete article was considered through source-grounded semantic blocks.
2. The final theme, thesis, and pillars cite their supporting blocks.
3. Raw assertions retain block and source provenance.
4. Reconciliation preserves every occurrence and does not erase contextual differences.
5. Every selected claim materially relates to the thesis, a pillar, an opponent position, a qualification, or an internal-consistency hinge.
6. Selected claims are compelling, faithful, concrete, and bearing-legible.
7. The selected portfolio represents the article's main reasoning rather than merely its easiest research anchors.
8. Every selected searchable claim has one or more grounded Phase 3 targets.
9. No raw or non-selected claim becomes a direct EvidenceRun target.
10. Every searchable target has a complete Evidence Need Card.
11. Attribution, substantive truth, identity, inference, stance, and score transformation remain distinct.
12. All uncertainty, exceptions, warnings, and repair actions are auditable.

---

## 20. Token and model-call budget

CF1 must obtain its semantic advantage from coherent article-level reasoning, not from multiplying model calls.

For a typical article that fits comfortably in context:

- use one primary Claim Foundry call
- allow at most one repair call, only after deterministic verification fails
- do not make per-block, per-claim, or per-target model calls
- do not run a routine critique or rewrite call
- do not resend the complete article during repair when affected blocks and package fragments are sufficient

For an unusually long article:

- use deterministic structural blocks
- allow bounded, compact block-analysis calls only when one-pass processing is not reliable
- send compact block observations into one final article-level synthesis call
- still allow at most one targeted repair call

All runs must:

- produce a bounded working assertion inventory rather than exhaustive sentence atomization
- keep rationales, excerpts, criteria, and query seeds concise
- generate no evidence-search, URL-fetch, per-source, or truth-scoring calls
- record model-call count, input tokens, output tokens, cached input tokens when available, repair count, duration, tokens per selected claim, and tokens per valid target

The primary efficiency metric is `tokensPerVerifiedClaimPackage`, supported by `tokensPerSelectedClaim` and `tokensPerValidTarget`. CF1 should be compared against the current pipeline on the same article fixtures before live integration.

---

## 21. API-first persistence and EvidenceRun handoff

CF1 must accept a consumer-neutral article input or a consumer-supplied content reference through adapters. VeriStrata-specific loading and table mapping remain outside the core agent contract.

A verified package should be stored durably before downstream evidence work. The handoff unit is an immutable `claimPackageId` plus `schemaVersion`, `packageHash`, and status—not a large in-process object or a direct CF1-to-EvidenceRun function call.

Recommended lifecycle:

```text
submitted → running → verification_failed | ready_for_evidence → evidence_running → evidence_complete | evidence_failed
```

CF1 owns states through `ready_for_evidence`. A later EvidenceRun worker or agent claims a ready package by ID, reads only selected claims, Phase 3 targets, and Evidence Need Cards, and writes evidence results separately. Raw working claims remain provenance and are never EvidenceRun inputs.

For CF1, use the existing database as the durable system of record and return the verified package or package ID from the API. Do not add a queue, broker, scheduler, or automatic EvidenceRun invocation in the first milestone. Add asynchronous dispatch later only when actual concurrency, retry, or deployment needs justify it.
