# Codex Task: Evidence Text Acquisition and Targeted Bearing Extraction

Use the current validated CFX-to-retrieval pipeline as governing context.

## Objective

Extend EvidenceRun from candidate discovery into:

1. best-available evidence-text acquisition;
2. explicit access-level classification;
3. targeted extraction of assertions in evidence text that materially bear on the frozen fixture assertion;
4. exact excerpt and source-location preservation;
5. retry, Wayback, headless-browser, and existing user-assisted botwall recovery;
6. reporting that never overstates what was available.

Do not redesign CFX, rewrite fixture assertions, or add final evidence scoring or portfolio selection.

## Unit of work

```text
one immutable fixture assertion
× one evidence candidate
× the best text actually acquired
```

## Access record

```ts
type EvidenceTextAccess = {
  candidateId: string;
  accessLevel:
    | "full_text"
    | "substantial_excerpt"
    | "abstract"
    | "snippet"
    | "metadata_only"
    | "unavailable";

  textSource:
    | "provider"
    | "publisher_html"
    | "publisher_pdf"
    | "pubmed"
    | "pmc"
    | "doi_resolution"
    | "institutional_repository"
    | "preprint"
    | "wayback"
    | "headless_browser"
    | "user_assisted_browser"
    | "search_snippet"
    | "metadata";

  text: string | null;
  characterCount: number;
  wordCount: number;
  sourceUrl: string | null;
  canonicalUrl: string | null;
  doi: string | null;
  pmid: string | null;
  retrievalAttempts: EvidenceRetrievalAttempt[];
  accessDiagnostics: string[];
};
```

```ts
type EvidenceRetrievalAttempt = {
  method: string;
  status:
    | "success"
    | "partial"
    | "blocked"
    | "not_found"
    | "timeout"
    | "parse_failure"
    | "user_action_required"
    | "failed";
  url: string | null;
  httpStatus: number | null;
  contentType: string | null;
  characterCount: number;
  diagnostic: string | null;
};
```

## Acquisition ladder

### Scholarly candidates

```text
provider abstract/full text
→ DOI resolution
→ PubMed abstract
→ PMC full text
→ publisher HTML
→ publisher PDF
→ institutional repository
→ accepted manuscript
→ preprint
→ Wayback snapshot
→ headless browser
→ user-assisted browser recovery
→ search snippet
```

### General web candidates

```text
provider text
→ normal platform scrape
→ existing failed-scrape retry protocol
→ alternate canonical URL
→ Wayback snapshot
→ headless browser
→ user-assisted browser recovery
→ search snippet
```

Search the repository before writing new machinery. Reuse tested code for failed-scrape retry, Readability/article extraction, Puppeteer or Playwright, PDF extraction, DOI/PMID resolution, PubMed/PMC, Wayback, alternate copies, canonical URLs, browser-tab handoff, user-resume callbacks, diagnostics, and artifact persistence.

Do not import old claim mutation, semantic ranking, bearing scoring, or orchestration merely to reuse one helper.

## Botwalls and paywalls

Do not unlawfully bypass access controls or defeat authentication.

Allowed paths:

- normal retries;
- headless browser;
- redirects;
- publicly available alternate copies;
- Wayback public snapshots;
- repositories, preprints, accepted manuscripts, and PMC;
- the platform's existing user-assisted browser protocol.

### User-assisted protocol

When ordinary and headless retrieval remain blocked:

1. mark `user_action_required`;
2. open the candidate URL in a normal tab using the existing platform flow;
3. let the user complete CAPTCHA, consent, login, or botwall interaction;
4. return control to the platform;
5. retry extraction using that authorized browser session;
6. persist success or failure;
7. never store credentials or CAPTCHA responses.

The pipeline must resume at candidate level. A blocked candidate must not stop sibling candidates or propositions.

## Access ceilings

```text
full_text          → document-level extraction allowed
substantial_excerpt→ excerpt-level extraction allowed
abstract           → abstract-level extraction allowed
snippet            → provisional snippet-level extraction only
metadata_only      → no semantic extraction
unavailable        → inaccessible
```

A model cannot upgrade the access level.

## Candidate triage

Do not fetch and model-read every candidate.

First triage title, metadata, and snippet:

```ts
type CandidateTriage = {
  candidateId: string;
  plausibility: "likely" | "possible" | "unlikely";
  reason: string;
};
```

This only prioritizes acquisition. It is not final bearing adjudication.

Initial budget:

- up to 5 candidates per fixture assertion;
- preserve diversity across query lanes and providers;
- include support, challenge, or qualification candidates when available;
- retain strong primary-source or source-identity candidates where relevant.

## Targeted model extraction

For every candidate with usable text, call the model with:

```text
Read only the supplied evidence text.

Target assertion:
<immutable fixture assertion>

Find every explicit assertion in the evidence text that materially bears on the target assertion.

A bearing assertion must do at least one of these:

- provide evidence for the target;
- provide evidence against the target;
- materially qualify its scope, certainty, mechanism, population, timing, comparison, or conditions;
- report a study result, official finding, measurement, comparison, documented event, or methodological criticism relevant to evaluating it.

Do not extract statements that are merely about the same topic.

Use only the supplied evidence text.
Do not use outside knowledge.
Do not rewrite the target assertion.
Do not infer findings absent from the text.
Do not treat a title or snippet as the document's complete position.

For each bearing assertion return:

- evidenceAssertion
- bearingRelation: supports | challenges | qualifies | mixed
- exactExcerpt
- sourceLocation
- whyItBears
- limitationsVisibleInText

If no explicit assertion materially bears, return:
noBearingAssertionsFound: true
```

Strict output:

```ts
type EvidenceBearingExtraction = {
  candidateId: string;
  propositionId: string;
  accessLevel:
    | "full_text"
    | "substantial_excerpt"
    | "abstract"
    | "snippet";

  noBearingAssertionsFound: boolean;

  assertions: Array<{
    evidenceAssertion: string;
    bearingRelation:
      | "supports"
      | "challenges"
      | "qualifies"
      | "mixed";

    exactExcerpt: string;
    sourceLocation: {
      page: number | null;
      section: string | null;
      paragraph: number | null;
      blockId: string | null;
      charStart: number | null;
      charEnd: number | null;
    };

    whyItBears: string;
    limitationsVisibleInText: string[];
  }>;
};
```

## Host validation

Validate:

- proposition and candidate IDs exist;
- access level matches acquisition;
- each exact excerpt is a literal substring of supplied text;
- offsets or block IDs resolve;
- no model-added proposition or candidate;
- required fields are complete;
- `noBearingAssertionsFound` cannot coexist with non-empty assertions.

Normalize harmless unit-ID padding differences deterministically before validation.

Do not semantically rewrite evidence assertions in host code.

## Preserve separate states

```text
candidate discovered
candidate text acquired
bearing assertion extracted
bearing relation classified
document-level bearing confirmed
```

Recommended status:

```ts
type EvidenceCandidateStatus =
  | "discovered"
  | "triaged_unlikely"
  | "acquisition_pending"
  | "user_action_required"
  | "inaccessible"
  | "metadata_only"
  | "snippet_only"
  | "text_acquired"
  | "no_bearing_found"
  | "bearing_extracted";
```

## Reports

Generate HTML, Markdown, and JSON showing for every assertion and candidate:

- immutable target assertion;
- source and article stance;
- query lane and provider;
- all acquisition attempts;
- final access level and source;
- user assistance required or not;
- acquired text length;
- extracted bearing assertions;
- exact excerpts and locations;
- bearing relation;
- visible limitations;
- document-, abstract-, excerpt-, or snippet-level status;
- inaccessible candidates and reasons;
- no-bearing findings.

Summary metrics:

- candidates selected;
- full texts, excerpts, abstracts, snippets, metadata-only, and unavailable;
- user-assisted attempts and successes;
- bearing assertions extracted;
- no-bearing outcomes;
- model calls, retries, latency, tokens, and estimated cost.

## Required artifacts

```text
evidence-bearing/
  triage.json
  acquisition-plan.json
  acquisition-attempts.json
  acquired-text/
  bearing-extractions.json
  bearing-validation.json
  inaccessible-candidates.json
  user-assisted-pending.json
  report.html
  report.md
  run-manifest.json
  retrieval-accounting.json
  artifact-hashes.json
```

## First validation run

Use the frozen successful retrieval outputs.

For each fixture assertion:

- select up to 5 candidates;
- attempt the full acquisition ladder;
- invoke user-assisted recovery where required and available;
- run targeted extraction on the best acquired text;
- enforce access-level ceilings;
- generate reports.

Do not add final source-quality scoring or portfolio selection.

The report must answer:

1. How often was usable text acquired?
2. How often was full text available?
3. How often was only an abstract or snippet available?
4. How often did botwalls or paywalls block progress?
5. How often did user-assisted recovery succeed?
6. Did extraction find explicit bearing assertions?
7. Did topical-only candidates correctly return no bearing?
8. Which query lanes produced accessible and materially bearing evidence?
9. Were snippet conclusions kept provisional?
10. Is every result auditable?

## Acceptance criteria

Pass when:

- blocked candidates do not stop sibling work;
- every attempt is recorded;
- access levels are accurate;
- user-assisted recovery resumes cleanly;
- excerpts validate against acquired text;
- extraction returns explicit bearing assertions only;
- topical-only documents can return no bearing;
- snippet results remain provisional;
- document-level claims require document-level text;
- fixture assertions remain unchanged;
- no outside knowledge enters extraction;
- reports make failures diagnosable.

Stop after reports and recommendations. Do not promote to final scoring or portfolio selection yet.
