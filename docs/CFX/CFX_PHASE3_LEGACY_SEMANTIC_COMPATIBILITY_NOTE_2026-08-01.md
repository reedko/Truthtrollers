# CFX Phase 3 legacy semantic compatibility note

Date: 2026-08-01
Status: implemented and verified offline; no model call made

## 1. Automatic legacy calls suppressed for a CFX canonical document

A reference scrape carrying a row from `cfx_evidence_acquisition_bindings`
already enters acquisition-only mode in `POST /api/scrape-reference` and
returns immediately after immutable capture. That early return suppresses, for
the bound CFX document:

- `processTaskClaims({ claimType: "reference" })`;
- ClaimExtractor reference chunk/frame/fusion/reduction calls;
- `matchClaimsToTaskClaims()`;
- the manual route's full-text `extractBestQuote()` validation loop;
- its automatic `upsertReferenceClaimTaskLinks()` and
  `dualWriteTargetEvidenceLinks()` writes from the legacy semantic result.

The CFX retrieval route (`POST /api/run-evidence`) invokes
`runCfxProductionEvidencePipeline()` and does not invoke legacy
`runEvidenceEngine`, so its per-case `extractQuotesAndScoreQuality()` path is
also absent. The emergency rollback route remains explicitly separate behind
`CFX_LEGACY_EVIDENCE_ENABLED=true`.

The automatic legacy chain under `POST /api/scrape-task` remains intact as a
non-CFX route. A CFX canonical evidence document is acquired either through
the CFX binding/outbox path or the structured-academic acquisition path; it
does not enter that task-scrape semantic chain.

Manual pair reassessment endpoints remain available after CFX publication.

## 2. Production components retained

CFX continues to reuse:

- production reference content and `content_relations` identity;
- scrape jobs, retry, redirect/tab correlation, user-assisted capture, and
  terminal outbox;
- immutable acquisition attempts and selected text versions;
- publisher identity, publisher enrichment, SourceCrest, and source-quality
  persistence;
- canonical `claims`, `content_claims`, and `claim_sources` persistence;
- `reference_claim_task_links`, its AI provenance, and existing metric columns;
- `dualWriteTargetEvidenceLinks()` where the production compatibility flag
  requires the newer evaluation-target tables.

## 3. Legacy output fields preserved by Phase 3

For every accepted evidence-assertion/target pair, Phase 3 preserves:

- separately persisted reference/evidence claim;
- task-claim link, including one evidence claim linked to several targets;
- target-relative stance (`support`, `refute`, `nuance` projection);
- pair confidence;
- score and signed support level;
- rationale;
- `created_by_ai = 1`;
- quote/excerpt;
- `reference_claim_task_links` and conditional dual-write compatibility.

Human-verified link values remain protected by the existing upsert rules.

## 4. New or stronger Phase 3 fields

- immutable target-inventory hash;
- immutable selected-text-version hash;
- prompt/schema/request hashes;
- exact source excerpt plus block and character offsets;
- four-way governed relation including `mixed` before legacy projection;
- document-scoped evidence-assertion fingerprint;
- row-level quarantine and forensic raw provider artifacts;
- explicit access-level limitation;
- deterministic long-document part identity and merge provenance.

## 5. Non-CFX behavior

The boundary is the presence of a CFX acquisition binding/canonical execution.
No global change to `processTaskClaims`, ClaimExtractor,
`matchClaimsToTaskClaims`, `extractQuotesAndScoreQuality`, or the manual
reassessment routes is required. Unbound legacy references retain their current
route behavior. The explicit legacy evidence rollback remains unchanged.

## 6. Duplicate-execution prevention

The governed execution identity is:

```text
(run_id, canonical_document_id, selected_text_version_id,
 target_inventory_hash, prompt_hash, schema_hash)
```

Phase 3 claims one durable `cfx_document_semantic_executions` record under a
database unique key before invoking the provider. An accepted record is reused
with zero provider calls. An active claim returns `in_progress` with zero
provider calls. A rejected, provider-failed, or stale execution may be
reclaimed as a replacement attempt while the same execution row retains its
attempt count and only one accepted terminal state. Completion is guarded by
the claim's processing token, so a stale worker cannot overwrite its
replacement. Raw requests, responses, usage, and validation records remain in
the append-only targeted-bearing run history.

## 7. Duplication found and corrected

The audit found one Phase 3 split: terminal scrape text used the
document-centric multi-target processor while structured academic text
defaulted to the older one-target processor. That split is corrected.

Both acquired-text paths now default to
`processCfxDocumentEvidenceBinding()`. Accepted pairs use the existing
conditional dual-write adapter. The old one-target primitive remains callable
only by explicit import for repair/comparison and is not a production default.
Static boundary tests also prove that the production CFX pipeline and
coordinator do not import or call `processTaskClaims`,
`matchClaimsToTaskClaims`, or `extractQuotesAndScoreQuality`.

No current CFX Phase 3 path runs the new document-centric extractor and the
legacy reference semantic sequence for the same bound canonical document.
