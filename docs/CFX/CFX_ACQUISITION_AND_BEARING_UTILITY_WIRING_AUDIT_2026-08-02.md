# CFX Acquisition and Bearing Utility Wiring Audit

Date: 2026-08-02
Status: **READ-ONLY CODE AUDIT — NO IMPLEMENTATION AUTHORIZED**
Purpose: Show the text-acquisition and target-relative bearing utilities that exist, what each one actually does, and the missing connection in the current CFX production path.

## 1. Finding

The governing specification required two distinct operations:

1. acquire the best available text automatically, using ordinary fetch, structured sources, public fallbacks, headless browsing, and only then user-assisted recovery;
2. read the acquired evidence text and extract explicit assertions that bear on the immutable case assertions.

Both kinds of utility exist in the repository, but the current CFX production coordinator connects only part of each chain.

The automatic ordinary-web acquisition ladder is **not connected to CFX**. CFX currently jumps from structured academic acquisition directly to a pending extension scrape job and a search-snippet fallback.

The document-centric bearing extractor **is connected**, but it runs only when a selected immutable text version has access level `full_text`, `substantial_excerpt`, or `abstract`. Therefore, ordinary web candidates that remain `snippet` never reach bearing extraction.

This is why the recent vertical slice reported:

```text
acquired=retrieval/snippet
bearing=snippet
```

No bearing model call ran because no usable document text was acquired.

## 2. Governing specification

Source:

`docs/CFX/CODEX_EVIDENCE_TEXT_ACQUISITION_AND_TARGETED_BEARING_EXTRACTION.md`

The required general-web ladder is:

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

The user-assisted stage is explicitly last. The specification says it begins only when ordinary and headless retrieval remain blocked.

The pipeline is therefore expected to run without user input and without a visible browser tab through all automatic acquisition stages.

## 3. Utility A: automatic text acquisition

### 3.1 Source

`backend/src/utils/fetchWithFallbacks.js`

Exports:

```js
looksLikeGenuineArticleText(extractedText, options)
fetchWaybackSnapshot(url, maxLength, options)
fetchTextWithFallbacks(url, maxLength, options)
```

### 3.2 Current implemented ladder

`fetchTextWithFallbacks()` currently performs:

```text
ordinary Axios HTTP request
→ blocked-content check
→ one headless Puppeteer attempt
→ blocked-content check
→ Wayback availability lookup
→ one headless Puppeteer load of the raw Wayback snapshot
→ failure
```

It records every attempt in an array with fields such as:

```ts
{
  method,
  status,
  httpStatus,
  error,
  charCount,
  elapsedMs,
  snapshotUrl
}
```

It returns approximately:

```ts
{
  text: string | null;
  method: "axios" | "puppeteer" | "wayback" | null;
  snapshotUrl?: string;
  attempts: AcquisitionAttempt[];
}
```

### 3.3 Headless behavior

The utility uses Puppeteer in headless mode. It does not open a visible user tab.

It:

- launches a headless Chromium process;
- sets the production user agent and headers;
- performs one bounded navigation;
- waits once for a possible challenge to resolve;
- captures the resulting HTML;
- closes the browser;
- releases the shared headless-concurrency slot in `finally`.

The shared headless concurrency limit is two.

### 3.4 Wayback behavior

`fetchWaybackSnapshot()`:

1. calls the public Wayback availability API;
2. resolves the closest public snapshot;
3. rewrites it to the raw `id_` snapshot URL;
4. loads that snapshot with the same bounded headless utility;
5. records the snapshot URL and outcome.

### 3.5 Text-quality guard

`looksLikeGenuineArticleText()` rejects:

- empty text;
- text below a configurable word count;
- navigation/menu-shaped text;
- heavily duplicated boilerplate.

This guard operates on extracted readable text, not raw HTML. The acquisition utility itself returns raw HTML/text, so a caller must still run article/readability extraction before applying this guard.

### 3.6 Tests currently present

`backend/test/utils/fetchWithFallbacks.test.js` tests only the deterministic `looksLikeGenuineArticleText()` guard:

- ordinary prose accepted;
- short snippet rejected;
- navigation shell rejected;
- duplicated boilerplate rejected;
- empty text rejected.

There is no focused CFX regression proving the complete automatic HTTP → headless → Wayback ladder, immutable attempt persistence, cleaned-text persistence, and transition to user assistance.

### 3.7 Important limitations

The utility exists, but it is not yet sufficient as the complete governed CFX adapter:

1. CFX does not call it.
2. It returns raw HTML/text rather than a fully cleaned article body.
3. Its default `maxLength` is 50,000 characters; CFX must not silently truncate a longer acquired document before immutable persistence.
4. The utility's current order is headless before Wayback, while the written CFX ladder lists Wayback before headless.
5. It does not itself persist attempts, redirect chains, raw responses, content hashes, or text versions.
6. It does not resolve alternate canonical copies, repositories, accepted manuscripts, or preprints.
7. Its network tiers lack focused deterministic mocked tests.
8. It does not transition to `user_action_required`; that belongs in the CFX acquisition coordinator.

## 4. Utility B1: original per-assertion targeted bearing extractor

### 4.1 Source

`backend/src/claimfoundry/cfx/evidenceBearing/targetedExtraction.ts`

Governed prompt:

`backend/src/claimfoundry/cfx/evidenceBearing/targeted-bearing-v1.json`

Schema:

`backend/src/claimfoundry/cfx/evidenceBearing/schema.ts`

Primary exports:

```ts
buildCfxEvidenceBlocks(text)
buildCfxTargetedBearingRequest(input)
validateCfxTargetedBearingExtraction(input)
runCfxTargetedBearingExtraction(input)
```

### 4.2 What it does

It takes:

```text
one immutable case assertion
+ one acquired evidence text
```

and gives the model this governed instruction:

```text
Read only the supplied evidence text.

Target assertion:
<immutable fixture assertion>

Find every explicit assertion in the evidence text that materially bears on the target assertion.
```

The prompt defines bearing as material that:

- provides evidence for the target;
- provides evidence against it;
- materially qualifies scope, certainty, mechanism, population, timing, comparison, or conditions;
- reports a relevant study result, official finding, measurement, documented event, or methodological criticism.

It explicitly rejects same-topic-only extraction and outside knowledge.

For every extracted assertion it requests:

- `evidenceAssertion`;
- `bearingRelation`;
- `exactExcerpt`;
- `sourceLocation`;
- `whyItBears`;
- pair confidence;
- pair quality/usefulness;
- text-visible limitations.

### 4.3 Validation

The validator checks:

- candidate ID;
- proposition ID;
- access-level immutability;
- `noBearingAssertionsFound` consistency;
- exact excerpt literal presence;
- declared evidence-block membership;
- exact character offsets;
- strict schema limits.

Tests:

`backend/test/claimfoundry/cfx/targetedBearingExtraction.test.ts`

### 4.4 Current role

This is the older target-document primitive. It remains available, but the current production pipeline defaults to the document-centric replacement described below so that one acquired document is not reread separately for every case assertion.

## 5. Utility B2: current document-centric bearing extractor

### 5.1 Source

`backend/src/claimfoundry/cfx/evidenceBearing/documentExtraction.ts`

Governed prompt:

`backend/src/claimfoundry/cfx/evidenceBearing/document-bearing-v1.json`

Schema:

`backend/src/claimfoundry/cfx/evidenceBearing/documentSchema.ts`

Production coordinator:

`backend/src/services/cfxEvidenceCoordinator.js::processCfxDocumentEvidenceBinding()`

### 5.2 What it does

It takes:

```text
one canonical acquired evidence document
+ the complete immutable case-assertion inventory
```

The governed prompt asks the model to find, for every case assertion, every explicit assertion in the supplied document that materially bears on it.

This is the intended smarter cousin of the original per-pair mechanism:

- one document read;
- all case assertions visible;
- zero or more evidence assertions;
- one evidence assertion may link to several case assertions;
- bearing classified independently for each target;
- no query intent visible to the model;
- no outside knowledge;
- exact excerpts and locations required.

### 5.3 Access ceiling

The document-centric extractor runs only for:

- `full_text`;
- `substantial_excerpt`;
- `abstract`.

It refuses:

- `snippet`;
- `metadata_only`;
- `unavailable`.

That refusal is appropriate. A search snippet must not be treated as the complete position of an evidence document.

### 5.4 Request construction

The utility:

1. freezes the complete target inventory;
2. hashes the target inventory;
3. hashes the selected immutable text version;
4. splits only the evidence document into literal blocks;
5. repeats the complete target inventory for every necessary document part;
6. requires exactly one target envelope per proposition ID;
7. uses strict structured output;
8. uses zero retries and `store: false`.

The default document-part boundary is 60,000 characters. Multiple requests require an explicit provider-call allowance; the current coordinator default allows one call and returns `multipart_authorization_required` if more are necessary.

### 5.5 Validation and persistence

The document validator independently evaluates target rows and evidence assertions. It validates exact excerpt presence, block identity, offsets, immutable IDs, and access level.

The coordinator persists:

- exact requests;
- raw provider responses before validation;
- response metadata and usage;
- validation diagnostics;
- accepted evidence assertions;
- links to every applicable case assertion;
- assessed document relations and compatibility metrics;
- semantic execution identity preventing duplicate accepted executions.

Tests include:

- `backend/test/claimfoundry/cfx/documentBearing.test.ts`;
- `backend/test/claimfoundry/cfx/phase3DocumentExtraction.test.ts`;
- `backend/test/claimfoundry/cfx/evidenceCoordinator.test.ts`;
- `backend/test/claimfoundry/cfx/phase3ExecutionBoundary.test.ts`.

## 6. Current CFX production wiring

The current implemented chain is:

```text
selected canonical document
→ try structured academic resolver
   → PMC full text, PubMed abstract, or Crossref metadata/text
→ if structured text exists:
   → persist immutable text version
   → run document-centric bearing extraction
→ otherwise:
   → enqueue production scrape_specific_url job
   → persist search snippet as selected text version
   → return snippet access
   → do not run bearing extraction
```

The missing section is:

```text
ordinary HTTP fetch
→ readable article extraction
→ genuine-article validation
→ automatic headless fetch
→ readable article extraction
→ genuine-article validation
→ public Wayback fallback
→ readable article extraction
→ genuine-article validation
→ immutable acquisition-attempt and text-version persistence
```

## 7. Current browser behavior

When structured academic acquisition fails, CFX calls:

`backend/src/services/cfxCanonicalDocumentStore.js::retryCfxCanonicalAcquisition()`

That creates a pending production job with:

```text
scrape_mode = scrape_specific_url
status = pending
```

The extension polls `/api/scrape-jobs/pending`. For a `scrape_specific_url` job it searches the user's existing tabs for a matching URL.

It does not automatically open that URL for this background job. If no matching tab exists, the job remains pending.

Current behavior is therefore:

```text
queue job
→ wait for a matching normal browser tab
→ no automatic ordinary fetch
→ no automatic headless fetch
→ no automatic Wayback fetch
```

This is not the specified default acquisition behavior. A normal tab belongs only to the explicit final user-assisted recovery stage.

## 8. The intended connected workflow

The correct coordinator boundary is:

```text
selected canonical document
→ acquire best available text without considering evidence stance
   1. structured academic/provider text
   2. ordinary HTTP/platform fetch
   3. canonical/alternate public copy
   4. governed Wayback and headless fallbacks in the approved order
   5. persist every attempt
   6. persist and hash complete cleaned text
→ if usable text exists
   → classify access level
   → select immutable text version
   → run one document-centric bearing extraction against all case assertions
→ if all automatic paths fail
   → set user_action_required
   → notify Workspace
   → open/reuse a visible tab only after explicit user action
   → resume exactly this canonical document after successful extension scrape
→ if user recovery is declined or fails
   → preserve snippet/metadata/unavailable terminal state
```

The acquisition operation should be document-centric and assertion-independent. It should acquire the complete accessible document, not select only passages that appear to bear on the assertion. The subsequent bearing extractor determines which exact assertions and excerpts bear on which case assertions.

This separation prevents deterministic retrieval code from silently discarding evidence and permits one document to apply to multiple case assertions.

## 9. Exact missing implementation seam

The missing seam is inside or immediately before:

`backend/src/services/cfxProductionEvidencePipeline.js::persistCfxAcquiredText()`

Today, after structured academic acquisition fails, it immediately queues `retryCfxCanonicalAcquisition()`.

The missing adapter must instead:

1. invoke the governed automatic acquisition ladder;
2. record each method's raw result and diagnostic in `cfx_evidence_acquisition_attempts`;
3. run the production article/readability extraction on successful HTML;
4. reject challenge pages, navigation shells, and redirected summary/pointer pages as full text;
5. preserve requested, resolved, canonical, archive, and mirror URLs separately;
6. persist complete cleaned text and hash before semantic extraction;
7. classify the honest access ceiling;
8. call `processCfxDocumentEvidenceBinding()` only when the ceiling permits;
9. create a browser-assist job only after every automatic method fails;
10. never wait synchronously for user action while sibling documents are processable.

## 10. Required verification before calling the chain complete

Offline and mocked integration tests must prove:

- ordinary HTTP success requires no browser tab;
- ordinary blocked response advances automatically;
- headless success requires no visible browser tab;
- Wayback success preserves the snapshot URL and archive lineage;
- acquisition order matches the approved governing order;
- every failed and successful attempt is persisted;
- long acquired text is not silently truncated before immutable persistence;
- readable-text validation rejects navigation shells and redirected summaries;
- no visible tab opens during automatic acquisition;
- a browser-assist job is created only after automatic exhaustion;
- one blocked document does not block sibling acquisition;
- successful user recovery resumes exactly one binding;
- snippet-only access causes zero bearing calls;
- full text, substantial excerpt, and abstract can enter document-centric bearing;
- document-centric bearing sees the complete immutable case-assertion inventory;
- one evidence assertion can link to multiple case assertions;
- no duplicate legacy semantic sequence fires;
- raw acquisition and model responses survive validation or persistence failure.

## 11. Bottom line

The target-relative bearing utility the specification called for does exist and is connected for sufficiently acquired text.

The automatic text-acquisition utility also exists, but is not connected to CFX.

Consequently, the current end-to-end chain cannot reliably reach the bearing utility for ordinary web evidence. It usually stops at a pending extension job or a search snippet. The missing work is not a new semantic model design; it is the governed automatic acquisition adapter and its forensic persistence wiring.
