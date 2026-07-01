-- Phase 5 query contract v2.
-- Adds exact-claim anchoring, numeric/scope preservation, and explicit
-- evidence-target retrieval language. Safe to rerun.

SET @target_query_system_v2 = 'You generate compact, evidence-targeted search queries for one atomic fact-checking claim. Return strict JSON only. Preserve named entities, dates, predicates, populations, scope, and causal strength. Every query must contain enough claim anchors to be intelligible by itself. Never output a one-word query, a generic topic query, or an authority-only query. Do not manufacture support/refute quotas.';

SET @target_query_user_v2 = 'CLAIM:\n{{claimText}}\n\nBOUNDED CASE CONTEXT:\n{{context}}\n\nEVIDENCE NEED:\n{{evidenceNeed}}\n\nProduce at most {{n}} precise search queries for the listed evidence targets. Every result must include evidenceTargetId, evidenceTargetType, stanceGoal, and bearingRequirement. Preserve exact numbers, populations, dates, doses, and timeframes in at least one query when present. Each query must preserve at least two meaningful anchors from the exact claim. Use target-appropriate retrieval language such as registry, cohort, dataset, transcript, original study, systematic review, methodology, or limitations only when it fits the target. Use bounded case context only to disambiguate an underspecified claim; do not broaden or replace the claim. You may include at most one steelman query when it tests a direct opposing case.\n\nReturn JSON:\n{"queries":[{"query":"...","intent":"support|refute|both|context","stanceGoal":"support|refute|both|context|open|steelman","evidenceTargetId":"...","evidenceTargetType":"primary_source|original_study|systematic_review|dataset|official_statement|other","bearingRequirement":"direct_truth_value|source_attribution|causal_mechanism|warrant_test"}]}';

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'evidence_target_query_generation_system', 'system',
       @target_query_system_v2, JSON_OBJECT('phase', 5, 'prompt_version', 2), 2, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'evidence_target_query_generation_system' AND version = 2
 );

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'evidence_target_query_generation_user', 'user',
       @target_query_user_v2, JSON_OBJECT('phase', 5, 'prompt_version', 2, 'max_queries', 3), 2, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'evidence_target_query_generation_user' AND version = 2
 );

UPDATE llm_prompts
   SET prompt_text = @target_query_system_v2,
       parameters = JSON_OBJECT('phase', 5, 'prompt_version', 2),
       is_active = TRUE
 WHERE prompt_name = 'evidence_target_query_generation_system' AND version = 2;

UPDATE llm_prompts
   SET prompt_text = @target_query_user_v2,
       parameters = JSON_OBJECT('phase', 5, 'prompt_version', 2, 'max_queries', 3),
       is_active = TRUE
 WHERE prompt_name = 'evidence_target_query_generation_user' AND version = 2;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 140) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN (
   'evidence_target_query_generation_system',
   'evidence_target_query_generation_user'
 )
 ORDER BY prompt_name, version DESC;
