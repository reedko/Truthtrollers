-- Phase 5 only: add target-aware query prompt variants without replacing the
-- legacy evidence_query_generation_* prompts. Safe to rerun.

SET @target_query_system = 'You generate compact, evidence-targeted search queries for one atomic fact-checking claim. Return strict JSON only. Preserve named entities, dates, predicates, scope, and causal strength. Do not manufacture support/refute quotas.';

SET @target_query_user = 'CLAIM:\n{{claimText}}\n\nCONTEXT:\n{{context}}\n\nEVIDENCE NEED:\n{{evidenceNeed}}\n\nProduce at most {{n}} precise queries for the listed evidence targets. Every result must include evidenceTargetId, evidenceTargetType, stanceGoal, and bearingRequirement. You may include at most one bounded steelman query when it tests a direct opposing case. Do not broaden the claim.\n\nReturn JSON:\n{"queries":[{"query":"...","intent":"support|refute|both|context","stanceGoal":"support|refute|both|context|open|steelman","evidenceTargetId":"...","evidenceTargetType":"primary_source|original_study|systematic_review|dataset|official_statement|other","bearingRequirement":"direct_truth_value|source_attribution|causal_mechanism|warrant_test"}]}';

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'evidence_target_query_generation_system', 'system',
       @target_query_system, JSON_OBJECT('phase', 5, 'prompt_version', 1), 1, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'evidence_target_query_generation_system' AND version = 1
 );

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'evidence_target_query_generation_user', 'user',
       @target_query_user, JSON_OBJECT('phase', 5, 'prompt_version', 1, 'max_queries', 3), 1, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'evidence_target_query_generation_user' AND version = 1
 );

UPDATE llm_prompts
   SET prompt_text = @target_query_system,
       parameters = JSON_OBJECT('phase', 5, 'prompt_version', 1),
       is_active = TRUE
 WHERE prompt_name = 'evidence_target_query_generation_system' AND version = 1;

UPDATE llm_prompts
   SET prompt_text = @target_query_user,
       parameters = JSON_OBJECT('phase', 5, 'prompt_version', 1, 'max_queries', 3),
       is_active = TRUE
 WHERE prompt_name = 'evidence_target_query_generation_user' AND version = 1;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 120) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN (
   'evidence_target_query_generation_system',
   'evidence_target_query_generation_user'
 )
 ORDER BY prompt_name, version DESC;
