-- 2026-07-04-02 seed purpose-lane evidence-query prompts
-- The query-generation refactor (docs/evidence-query-stance-analysis.md) changed
-- the code to fetch NEW prompt names `evidence_purpose_query_generation_system`
-- and `_user` (replacing the stance-quota evidence_query_generation_* prompts).
-- No SQL seeded these new names, so query generation always fell back to code
-- ("No active prompt found: evidence_purpose_query_generation_*"), bypassing any
-- DB-tuned evidence-query prompt. This seeds them from the code fallback so the
-- DB is authoritative again and the fallback warnings stop.
--
-- Two separate rows (prompt_type 'system' and 'user'), matching how
-- EvidenceEngine.generateQueries() consumes them. Idempotent: inserts version 1
-- only if that (name, version) does not already exist. Safe to rerun.

-- evidence_purpose_query_generation_system
SET @system_text = 'You generate compact search queries for one atomic fact-checking claim. Return strict JSON only. Generate search queries that retrieve documents bearing on the target. Do NOT try to force support, refutation, or nuance — stance will be classified later from retrieved content. Each query should pursue a distinct evidentiary purpose (a purposeLane). Preserve named entities, dates, predicates, scope, and causal strength; every query must contain enough claim anchors to be intelligible by itself. Do not output generic topic queries except when purposeLane is causal_background.';
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'evidence_purpose_query_generation_system', 'system', @system_text, JSON_OBJECT('prompt_version', 1), 1, TRUE
  FROM (SELECT COALESCE(MAX(CAST(prompt_id AS UNSIGNED)), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'evidence_purpose_query_generation_system' AND version = 1
 );

-- evidence_purpose_query_generation_user
SET @user_text = 'Claim: {{claimText}}\nContext: {{context}}\nEvidence need: {{evidenceNeed}}\n\nGenerate up to {{n}} search queries that retrieve documents bearing on the listed evidence targets. Do not try to force support, refutation, or nuance; stance is classified later from retrieved content. Each query must pursue a distinct evidentiary purpose. Assign each query a purposeLane from: attribution_record, study_identity, original_document, alleged_conduct, official_response, independent_methodology, independent_reanalysis, causal_background, inference_limitations, legal_or_policy_context, source_context. Prefer covering several DIFFERENT purpose lanes over repeating one. Every result must include queryText, purposeLane, evidenceTargetId (the supplied lane id), evidenceTargetType, and reasonForQuery. Preserve exact numbers, populations, dates, doses, and timeframes in at least one query when present. Use purpose-appropriate retrieval language such as registry, cohort, dataset, transcript, original study, systematic review, reanalysis, methodology, or limitations only when it fits the purpose. Do not broaden the claim, do not restate the claim verbatim, and do not write instruction-like queries ("Review whether...", "Investigate...").';
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'evidence_purpose_query_generation_user', 'user', @user_text, JSON_OBJECT('prompt_version', 1, 'max_queries', 9), 1, TRUE
  FROM (SELECT COALESCE(MAX(CAST(prompt_id AS UNSIGNED)), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'evidence_purpose_query_generation_user' AND version = 1
 );

