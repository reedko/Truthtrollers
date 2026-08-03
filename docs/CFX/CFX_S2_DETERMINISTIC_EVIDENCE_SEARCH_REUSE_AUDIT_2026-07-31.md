# CFX S2 deterministic evidence-search reuse audit

Date: 2026-07-31
Scope: deterministic post-S2 handoff only
Architecture: current CFX S0/S1/S2 remains governing

## Outcome

CFX now attaches a host-derived `evidenceSearchHandoff` to every accepted
substantive-review proposition after model output validation. The canonical
`substantiveAssertion`, `assertionSource`, and `articleStance` are not rewritten.
The handoff is derived only from those literal fields, the proposition's
existing grounding-unit IDs and exact unit text, and linked citation metadata
when available.

No model call, search request, database operation, semantic selector, repair
loop, or old orchestration is used.

The corrected handoff separates:

- `literalIdentifiers`: people, organizations, laws, study titles, journals,
  years, date ranges, DOI, PMID, URLs, citation numbers, and acronyms;
- `lookupHints`: populations, exposures, outcomes, interventions, geography,
  document types, and literal controlled topics;
- `queries`: literal, source-qualified, and study-lookup queries.

`explicitStudyIdentityFound` is an independent fact. A false value never
suppresses lookup-hint extraction or query construction.

## Repository audit

| File | Exported functions | Existing tests | Decision |
|---|---|---|---|
| `backend/src/evidence-run/identityRegistry.js` | `normalizeDoi`, `normalizePmid`, `normalizeUrl`, `buildIdentityRegistry` | `backend/test/evidence-run/identityRegistry.test.js`; broader identity-plan coverage in `backend/test/evidence-run/queryPlannerRepair.test.js` | The three literal normalizers are safe unchanged. They were extracted into neutral shared infrastructure and remain re-exported here. `buildIdentityRegistry` is not reused because it constructs EvidenceRun tasks and priorities. |
| `backend/src/claim-foundry/identifierHints.js` | `normalizeIdentifierHints`, `identifierOccursInSource`, `findUngroundedIdentifierHints`, `isIdentifierFormatValid` | `backend/test/claim-foundry/identifierHints.test.js`; verification coverage in `backend/test/claim-foundry/verifyPackage.test.js` | Literal normalization and source-occurrence checks are safe. A CFX adapter is preferable to importing this ClaimFoundry package surface because its fixed hint shape and limits do not match the S2 handoff. |
| `backend/src/claim-foundry/article-document/citationSidecars.js` | `buildCitationSidecars` | `backend/test/claim-foundry/citationIdentity.test.js` | Safe unchanged at ingest. It deterministically maps citation anchors to reference IDs and exact links. CFX consumes its resolved sidecar shape when present; it does not re-resolve or guess references. |
| `backend/src/claim-foundry/article-document/fromHtml.js` | `articleDocumentFromHtml` | `backend/test/claim-foundry/citationIdentity.test.js`; ArticleDocument HTML tests | Safe unchanged for an HTML ingest path. It preserves link offsets and supplies the sidecars consumed by the adapter. It is not called by the post-S2 handoff. |
| `backend/src/claim-foundry/article-document/htmlBibliographicMetadata.js` | `extractHtmlBibliographicMetadata` | HTML bibliographic identity case in `backend/test/claim-foundry/citationIdentity.test.js` | Safe unchanged when metadata is literally present in HTML. No inferred bibliographic fields are accepted. |
| `backend/src/claim-foundry/article-document/links.js` | `resolveHttpUrl` | Link provenance cases in `backend/test/claim-foundry/citationIdentity.test.js` | Safe unchanged for deterministic URL resolution at ingest. |
| `backend/src/core/academicContentResolver.js` | `detectAcademicIdentifiers`, `parsePubmedArticleXml`, `parsePmcFullTextXml`, `fetchAcademicApiContent`, `buildAcademicPublishingIdentity`, others | `backend/test/bearing/academicContentResolver.test.js` | `detectAcademicIdentifiers` and the XML parsers are deterministic for supplied text/metadata, but need an adapter because this module also owns network resolution. Network functions and candidate enrichment are not reused at S2. |
| `backend/src/evidence-run/queryCompiler.js` | `compileTargetLanes`, `classifyContextWork`, `contextWorkQuery` | `backend/test/evidence-run/queryIdentityGating.test.js`; `backend/test/evidence-run/queryPlannerRepair.test.js` | Not reused. These functions infer evidence roles, classify works, add retrieval terms, and selectively inject identity/scope context. |
| `backend/src/evidence-run/queryPlanner.js` | `buildQueryLanePlan` | `backend/test/evidence-run/queryPlannerRepair.test.js` | Not reused. It routes, prioritizes, and budgets lanes using task and target semantics. |
| `backend/src/core/anchoredQueryPack.js` | `validateAnchoredQuery`, `buildDeterministicAnchoredQueries`, `buildAnchoredQueryPack` | `backend/test/bearing/anchoredQueryPack.test.js` | Not reused. Although deterministic, it adds purpose-lane terminology, validates semantic anchors, rejects candidates, and chooses fallbacks. |
| `backend/src/core/studyIdentityDiscovery.js` | `buildStudyIdentityDiscoveryQueries`, `resolveStudyIdentityCandidates`, `buildBibliographicResolutionQueries`, `discoverStudyIdentities` | `backend/test/bearing/studyIdentityDiscovery.test.js` | Not reused. Query building and candidate resolution infer/rank study identity. S2 emits study lookup queries only for literal DOI, PMID, URL, or explicit linked title metadata. |
| `backend/src/core/retrievalContext.js` | `buildRetrievalContextsForClaim`, `retrievalContextForTarget` | `backend/test/bearing/retrievalContext.test.js` | Not reused. It extracts useful strings but also selects nearby passages, classifies organizations, suppresses or promotes work identities, and decides whether study resolution is required. |
| `backend/src/core/evidenceNeed.js` | `normalizeBearingText`, `tokenizeBearingText`, evidence-need and query-lane builders | `backend/test/bearing/queryPlanGeneration.test.js`; `backend/test/bearing/evidenceNeedRouting.test.js` | Not reused for `normalizedAssertion`. It lowercases, removes diacritics and punctuation, applies stop words, infers claim type, and constructs semantic evidence targets. |
| `backend/src/utils/normalizeEvidenceClaim.js` | `normalizeEvidenceClaimText`, `classifyAttributionClaim`, `buildEvidenceClaimContext` | Used by older EvidenceRun paths | Prohibited here. It removes reporting/attribution language and therefore can alter the canonical assertion. |
| `backend/src/claim-foundry/normalizeAgentDraft.js` and CF1-CF7 experiment pipelines | draft/package normalization and semantic pipeline functions | extensive historical ClaimFoundry tests | Prohibited here. They assign IDs, rewrite references, classify source/claim roles, reconcile model output, or otherwise operate on superseded orchestration contracts. |

## Reuse layer

The three tested identity normalizers were extracted without behavior changes to:

`backend/src/claimfoundry/shared/evidenceSearch/identityNormalization.js`

`backend/src/evidence-run/identityRegistry.js` continues to export the same
functions, so existing consumers and tests remain unchanged.

The CFX adapter is:

`backend/src/claimfoundry/cfx/evidenceSearch/buildEvidenceSearchHandoff.ts`

It performs only:

- NFKC and whitespace normalization into a separate `normalizedAssertion`;
- exact grounding-unit projection;
- literal regex extraction with source-order deduplication;
- consumption of already-resolved ArticleDocument citation sidecars;
- DOI, PMID, and URL normalization;
- exact-literal and source-qualified query construction;
- deterministic study-lookup query assembly from literal identifiers and
  lookup hints;
- exact-line co-occurrence when a date range anchors a study description, so
  terms from another grounding line do not displace the population, exposure,
  outcomes, geography, or document type beside that date range.

It never mutates the canonical S2 row. It does not infer a paper identity,
paraphrase an assertion, score candidates, or perform semantic ranking.
Controlled retrieval aliases such as `death rates` → `mortality` and
`received the most vaccines` → `vaccine doses` occur only in additional query
variants; the extracted literals remain unchanged.

## F03 result

CF1-F03 is a pasted-text fixture. Its current CFX S0 path correctly produces
empty ArticleDocument citation sidecars, and the fixture text contains no URL,
DOI, or PMID literals. Accordingly, the F03 handoffs do not invent
bibliographic identifiers. This does not block useful lookup construction.
Across 12 propositions:

- 12 have lookup hints;
- 11 have study-lookup queries;
- 28 study-lookup queries were produced;
- 8 identify at least one organization;
- 2 identify at least one person;
- 4 contain years or date ranges;
- 1 contains a law;
- 0 claim an explicit study identity.

P05 produces:

```json
{
  "people": ["William Thompson"],
  "organizations": ["CDC"],
  "years": ["2014"],
  "acronyms": ["CDC", "MMR"],
  "topics": ["data manipulation"],
  "studyLookup": [
    "CDC MMR autism data manipulation William Thompson",
    "William Thompson CDC MMR autism study",
    "CDC MMR vaccine autism data manipulation 2014"
  ]
}
```

P07 has `explicitStudyIdentityFound: false` and still produces:

```json
{
  "dateRanges": ["1990-2010"],
  "populations": ["children", "baby boomer", "infants"],
  "exposures": ["received the most vaccines"],
  "outcomes": ["chronic illnesses", "hospitalization", "death rates"],
  "geography": ["U.S."],
  "documentTypes": ["analysis"],
  "studyLookup": [
    "\"1990-2010\" infants vaccines hospitalization death rates",
    "U.S. infants vaccine doses hospitalization mortality study",
    "infants received the most vaccines worst hospitalization death rates analysis"
  ]
}
```

Citation-aware extraction remains covered with a synthetic resolved
ArticleDocument citation in the focused test.

## Verification

Commands:

```text
npm run verify:cfx
node --test test/evidence-run/identityRegistry.test.js test/claim-foundry/identifierHints.test.js test/claim-foundry/citationIdentity.test.js test/evidence-run/queryIdentityGating.test.js test/evidence-run/queryPlannerRepair.test.js
```

Results:

- CFX typecheck: pass
- CFX tests: 28/28 pass
- focused legacy regression tests: 35/35 pass
- model calls during derivation: 0
- external searches during derivation: 0

Final F03 deterministic handoff artifact:

`artifacts/claim-foundry/cfx/CF1-F03/cfx-s2-evidence-search-cfx-substantive-review-cf1-f03-20260730234738-20260731051936/evidence_search_handoffs.json`

Artifact aggregate SHA-256:

`3e4b06e726f0c1b067945851d81b1788cd0b526e94597e3bc55fef2db8f79ffa`
