# SourceCrest Publisher Rating Summary

Last reviewed: 2026-07-30

## Purpose

This document summarizes how VeriStrata assigns and displays SourceCrest ratings for publishers, evidence sources/references, and content.

## Rating format

A SourceCrest uses an Admiralty-style two-character code:

```text
<publisher/source reliability><claim credibility>
```

Examples:

- `BØ` — usually reliable publisher/source; no claim-level assessment.
- `C2` — mixed or context-dependent source; claim is probably true.
- `D4` — questionable source; claim is doubtful.
- `ØØ` — insufficient source and claim evidence.

### Reliability letter

| Code | Meaning |
| --- | --- |
| `A` | Highly reliable; authoritative primary source with strong provenance |
| `B` | Usually reliable; good reputation or institutional process |
| `C` | Mixed or context-dependent; corroboration may be needed |
| `D` | Questionable; poor transparency, weak independence, or advocacy-heavy |
| `E` | Unreliable; known low quality, misleading framing, or problematic lineage |
| `Ø` | Not assessed; insufficient identity or reliability evidence |

### Claim credibility number

| Code | Meaning |
| --- | --- |
| `1` | Confirmed by authoritative evidence or scientific consensus |
| `2` | Probably true; strongly supported |
| `3` | Possibly true; plausible but needs corroboration |
| `4` | Doubtful; weakly supported, contested, or outweighed by refutation |
| `5` | Probably false; contradicted by stronger evidence or fact checks |
| `Ø` | No claim-level assessment |

Publisher-level crests normally end in `Ø`. Publisher identity or reputation is not evidence that a particular claim is true.

## Three separate signals

SourceCrest deliberately separates:

1. **Reliability letter (`A-E/Ø`)** — the source or publisher's reliability.
2. **Credibility number (`1-5/Ø`)** — the evidence for a particular claim.
3. **Alignment ribbon** — disclosed institutional or material-interest alignment, such as `IND`, `ADV`, `GOV`, `CORP`, `PART`, `SPON`, or `STATE`.

Alignment supplies context and may limit a reliability rating in relevant cases, but it does not itself create a claim-credibility number. For example, an industry trade association making an unevaluated health claim may receive `CØ`, not `C3`.

## What is rated

| Object | Stored target | What the crest represents |
| --- | --- | --- |
| Publisher | `admiralty_evaluations.target_type = 'publisher'` | General source reliability; normally ends in `Ø` |
| Evidence source/reference | The reference's linked `content` record and publisher | Content-specific source reliability, with publisher rating as fallback |
| Content/article | `admiralty_evaluations.target_type = 'content'` | Publisher reliability adjusted for that content's publication context and lineage |
| Claim | Claim evidence supplied to the evaluator | Adds the numeric credibility component when evidence exists |

A reference is therefore not assigned an independent publisher reputation. It resolves to a content record, that content is linked to a publisher through `content_publishers`, and SourceCrest uses the best applicable content/publisher evaluation.

## Resolution and display precedence

For a content record or evidence reference, the API resolves the crest in this order:

1. A valid **content-level** evaluation for the selected linked publisher.
2. A valid **publisher-level** evaluation as fallback.
3. No usable evaluation (`null`/unchecked), displayed as insufficient or unassessed.

The preferred publisher link is the primary link (`is_primary`) and then the newest link. Human-confirmed evaluations outrank community-reviewed evaluations, which outrank machine-suggested evaluations.

Content-level evaluation is authoritative because the same publisher can host news, opinion, press releases, reposts, or other contexts with different reliability implications.

## Publisher rating inputs

Publisher enrichment stores and evaluates several kinds of input. They must not be treated as interchangeable.

### Direct reliability inputs

These can directly change the reliability letter when usable:

- A `publisher_ratings` veracity or reliability score.
- SCImago journal score/quartile for a scholarly source.
- MBFC reliability when represented in the evaluator input.
- Ad Fontes reliability when represented in the evaluator input.
- OpenSources problematic-source flags when represented in the evaluator input.
- A justified Wikipedia-derived veracity score. A Wikipedia profile alone is not a rating.

Important score behavior:

- Scores `>= 80` can move a `C` or `D` source toward `B`.
- Scores `>= 70` can move `C` to `B` or `D` to `C`.
- Scores `< 40` downgrade stronger letters.
- Scores `< 25` produce `E`.
- High MBFC/Ad Fontes reliability can move `C` to `B`.
- Low MBFC/Ad Fontes reliability downgrades `A/B` to `C`, or `C` to `D`.
- Dangerous OpenSources types such as fake, conspiracy, propaganda, disinformation, or junk science can force `E`.

### Identity and contextual inputs

These identify or describe a publisher but do not normally prove reliability:

- Wikidata identity and relationships.
- Wikipedia profile without a reliability score.
- AllSides political-bias rating.
- Ownership, funding, nonprofit, corporate, government, or institutional identity.
- Domain/entity registration and independent footprint.

Identity-only evidence must not upgrade an ordinary publisher to `B`. Resolved institutional sources—primary, government, academic, or reference sources—may receive their source-type base letter when identity resolution is sufficiently strong.

### Provenance inputs

These verify existence, history, scholarly publication context, or relationships:

- Crossref and OpenAlex for scholarly/DOI/ISSN contexts.
- Wayback domain history.
- RDAP domain registration and age.
- OpenCorporates, IRS TEOS, and SEC identity/status data.
- GDELT independent publication footprint.

These are principally audit/provenance signals. Some may impose conservative caps or warnings, but they are not general factuality ratings.

## Source-type starting points

When reliability evidence is available, the evaluator starts from these source-type defaults:

| Source type | Base letter |
| --- | --- |
| Primary | `A` |
| Government | `B` |
| Academic | `B` |
| Journalism | `B` |
| Reference | `B` |
| Corporate | `C` |
| Opinion | `C` |
| Advocacy | `D` |
| Social/platform | `D` |
| Unknown | `Ø` |

Without real reliability evidence, ordinary journalism, corporate, opinion, advocacy, and social identity alone generally remain `Ø`. A sufficiently resolved institutional primary/government/academic/reference source may retain its base letter. A verified industry trade association may receive `C` as contextual treatment.

## Content and reference adjustments

When publisher enrichment finishes, the system:

1. Creates or updates one publisher-level evaluation.
2. Finds every content record linked to that publisher.
3. Re-evaluates each linked content record.
4. Stores a content-level SourceCrest and returns the updated code by `content_id`.

Content evaluation can differ from the publisher evaluation because it considers:

- Publication context: news, opinion, editorial, blog, press release, etc.
- Whether the page is an excerpt, repost, or pointer to an upstream source.
- The number of hops from the original source.
- Whether content is platform-hosted without a resolved publisher.
- A distinct web venue/publisher relationship.
- Topic-sensitive material interest, such as an industry-aligned source discussing health or safety.

Typical penalties include:

- Excerpts/reposts can reduce `A` to `B` or `B` to `C`.
- Pointer pages can reduce `A/B` to `C`.
- Each extra lineage hop can lower the letter, up to three steps.
- Unresolved platform-hosted content can fall to `D`.
- Opinion, blog, or editorial context can reduce `A` to `B` or `B` to `C`.
- A press release reduces `A` to `B`.

For a distinct web publication, automatic Wikipedia/Wikidata/SCImago ratings belonging to the broader publisher may be excluded from the content evaluation to avoid transferring an unrelated institutional rating to the venue.

## Claim-number inputs

The number remains `Ø` unless the evaluator receives actual claim evidence. Inputs include:

- Supporting and refuting evidence counts.
- Primary-source count.
- Authoritative-source count.
- Scientific-consensus match.
- Google Fact Check matches and normalized verdicts.

Current behavior:

- No evidence produces `Ø`.
- The evidence-present default is `3`.
- A false/misleading fact-check result can produce `5`.
- A clear true/accurate fact-check result can produce `2`.
- Primary evidence or at least two authoritative sources can improve a result to `2`.
- Scientific consensus can produce `1`.
- Refuting evidence can move a result to `4`.
- At least three supporting sources with no refutation can produce `2`.

The source letter and claim number are independent: a weak publisher can carry a well-supported claim, and a strong publisher can carry an unevaluated or doubtful claim.

## Current enrichment modes

### Interactive SourceCrest refresh

The modal's **Force refresh** action refreshes the currently linked publisher without changing publisher identity or opening a browser tab. It runs first-pass providers one at a time and skips the heavier external-signal sweep.

The normal interactive provider path is:

- Wikipedia, when configured and stale/forced.
- Wikidata.
- SCImago only for likely scholarly sources.

AllSides and Ad Fontes live lookup are disabled by default, although historical stored rows remain visible and evaluable.

### Full/non-interactive enrichment

Full enrichment may additionally run MBFC, OpenSources, Crossref, OpenAlex, Wayback, RDAP, OpenCorporates, IRS TEOS, SEC EDGAR, GDELT, and other configured providers.

Google Fact Check is claim-text-only. It must never be used as publisher identity, bias, or general publisher reliability data.

## Important current limitation

Second-pass provider results are persisted in `publisher_external_signals` and summarized on the publisher, but those summaries are not yet fully applied by `reEvaluateAdmiraltyForPublisher()`. The current letter derivation primarily rebuilds its input from:

- `publisher_ratings`
- `publisher_profiles`
- stored provider signals that the evaluator explicitly understands

Consequently, a provider can appear in the SourceCrest detail modal as provenance/context without changing the displayed letter.

## Main data stores

| Store | Purpose |
| --- | --- |
| `publishers` | Canonical publisher identity and aggregate enrichment fields |
| `content_publishers` | Links evidence/content records to publishers |
| `content_publishing_context` | Venue, observed publisher, article type, and publication context |
| `publisher_ratings` | Stored bias, veracity, reliability, and provider rating rows |
| `publisher_profiles` | Provider-derived publisher descriptions and source types |
| `publisher_external_signals` | Normalized provider attempts, matches, scores, flags, caps, explanations, and evidence URLs |
| `publisher_relationships` | Ownership, operation, sponsorship, alias, and related-entity links |
| `admiralty_evaluations` | Publisher- and content-level SourceCrest results, status, rationale, and audit data |

## Main implementation files

- `backend/services/admiraltyEvaluator.js` — derives letters, numbers, warnings, confidence, and recommended actions.
- `backend/src/services/publisherEnrichmentService.js` — runs enrichment and re-evaluates publishers and linked content.
- `backend/src/routes/publishers/publishers.routes.js` — returns content/publisher crest data and detail-modal enrichment data.
- `backend/services/providerSignalMapper.js` — maps external provider results into normalized signal roles.
- `backend/src/services/providerSignalPersistenceService.js` — stores normalized provider signals.
- `dashboard/src/components/SourceCrest.tsx` — renders the crest and alignment ribbon.
- `dashboard/src/components/modals/SourceDetailModal.tsx` — displays rating/profile/provider evidence and refresh controls.
- `dashboard/src/components/ReferenceList.tsx` — displays SourceCrests for evidence references.

## Interpretation checklist

When reviewing a SourceCrest:

1. Read the letter as publisher/source reliability, not claim truth.
2. Read the number as claim evidence, not publisher reputation.
3. Treat `Ø` as insufficient assessment, not a negative rating.
4. Check whether the displayed result is content-specific or a cached publisher fallback.
5. Inspect provider evidence and URLs; a provider match may be contextual only.
6. Treat alignment as disclosure/context, not automatic falsity.
7. Prefer the original source when the content is an excerpt, repost, or pointer.
