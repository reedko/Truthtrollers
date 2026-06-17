# Governance and Trust Implementation Status

This file records the current implementation status for auditability, governance, reputation, anti-brigading, and evidence-corpus claims. Use this wording when describing the product unless the implementation changes and this status is updated.

## Tamper-Evident Audit Trail

Status: Implemented.

Claim/evidence links can be finalized into audit records. Each record stores a canonical JSON snapshot, a SHA-256 content hash, OpenTimestamps proof data, finalization metadata, and verification status. New audit snapshots include the linked user, source claim, target claim, rating fields, timestamps, and associated content/source metadata for the source and target claims.

Do not claim this alone prevents manipulation. It makes later changes detectable for finalized records and provides an externally anchored timestamp for the recorded snapshot.

Primary implementation:
- `backend/src/utils/auditSnapshot.js`
- `backend/src/services/timestampService.js`
- `backend/src/routes/audit/audit.routes.js`
- `backend/migrations/add_claim_link_audit_table.sql`
- `dashboard/src/pages/VerifyRecordPage.tsx`

## Governance

Status: Implemented for content-rating approval workflows.

Submitted evidence-chain ratings remain pending until peer review reaches the approval threshold. The current content-rating workflow requires two approve votes to mark a content rating approved, or two reject votes to mark it rejected. Evaluators can review users at the same or lower role level, so higher-role work is not reviewed by lower-role accounts through this route.

Do not claim this has been validated at scale. The implemented workflow is a governance mechanism, not proof that it resists coordinated abuse under real adversarial pressure.

Primary implementation:
- `backend/src/routes/evaluation/content-rating.routes.js`
- `backend/migrations/add_content_rating_system.sql`
- `backend/migrations/add_content_rating_system_v2.sql`
- `dashboard/src/pages/RatingEvaluationPage.tsx`

## Reputation

Status: Implemented for tracked content-rating performance and reviewer eligibility.

User reputation records track submitted, approved, rejected, and pending content ratings, approval rate, raw average content score, evaluator-reputation-weighted approved score, approved-volume confidence, evaluator activity, total points, veracity rating, reputation level, and reviewer activity. Reputation and role data are used in review views and eligibility checks.

The weighted reputation model is installed by `backend/migrations/add_weighted_reputation_model.sql`. It snapshots evaluator reputation when an evaluation is submitted, then recalculates user reputation from approval rate, evaluator-reputation-weighted scores on approved work, approved-rating volume confidence, and number of evaluations given.

Do not claim the reputation model is mature or adversarially tested. The current model is an operational scoring and eligibility layer.

Primary implementation:
- `backend/src/routes/evaluation/content-rating.routes.js`
- `backend/migrations/add_content_rating_system.sql`
- `backend/migrations/add_content_rating_system_v2.sql`
- `backend/migrations/add_weighted_reputation_model.sql`
- `CONTENT_RATING_SYSTEM.md`

## Anti-Brigading

Status: Partially implemented / designed, not validated at scale.

Current implemented defenses include peer confirmation, same-or-higher-role review gating, one evaluation per evaluator per content rating, reputation tracking, reputation-weighted scoring, manual approval paths in related posting flows, and tamper-evident audit records for finalized claim links.

Planned or documented defenses include reviewer diversity constraints, rate limits, suspicious-pattern flags, quarantine of suspicious clusters, and broader audit trail coverage. These should be described as planned or partially implemented unless the relevant code path is completed and tested.

Do not claim anti-brigading has been validated at scale.

## Evidence Corpus Moat

Status: Future thesis.

Current claim maps and claim/evidence links show the structure from which a reusable evidence corpus could grow. The moat depends on repeated use, quality review, source reuse, reviewer participation, and scale.

Do not describe this as an existing durable moat until there is demonstrated volume, reuse, quality control, and defensibility.
