-- Phase 6 claim-matching envelope v2.
-- openAiLLM uses response_format=json_object, so claim matching must return a
-- top-level object rather than the bare array requested by v1. Safe to rerun.

SET @bearing_match_system_v2 = 'You match reference claims to exact task claims for fact-checking. Return strict JSON only using the required top-level matches object. Judge stance relative to the task claim, not source credibility. Separately score bearing: topic overlap alone is bearingType none; a broad fact-check must address the exact component; association cannot fully support a causal claim; attribution proof and object-claim truth are separate.';

SET @bearing_match_user_v2 = 'TASK CLAIMS:\n{{taskClaims}}\n\nREFERENCE CLAIMS:\n{{referenceClaims}}\n\nReturn only reference/task pairs that materially bear on the exact task claim. For each return referenceClaimIndex, taskClaimIndex, stance, veracityScore, confidence, supportLevel, rationale, bearingScore, bearingType, claimComponentAddressed, causalStrength, and bearingReason.\n\nReturn exactly this top-level JSON object:\n{"matches":[{"referenceClaimIndex":1,"taskClaimIndex":1,"stance":"support|refute|nuance|insufficient","veracityScore":0.0,"confidence":0.15,"supportLevel":0.0,"rationale":"...","bearingScore":0.0,"bearingType":"direct|indirect|context|origin|steelman|none","claimComponentAddressed":"whole_claim|subject|relation|object|scope|attribution|warrant|none","causalStrength":"causal|mechanistic|associative|correlational|not_applicable|unclear","bearingReason":"..."}]}\n\nIf nothing matches, return {"matches":[]}.';

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'claim_matching_bearing_system', 'system', @bearing_match_system_v2,
       JSON_OBJECT('phase', 6, 'prompt_version', 2, 'response_envelope', 'matches'), 2, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'claim_matching_bearing_system' AND version = 2
 );

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'claim_matching_bearing_user', 'user', @bearing_match_user_v2,
       JSON_OBJECT('phase', 6, 'prompt_version', 2, 'response_envelope', 'matches'), 2, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'claim_matching_bearing_user' AND version = 2
 );

UPDATE llm_prompts
   SET prompt_text = @bearing_match_system_v2,
       parameters = JSON_OBJECT('phase', 6, 'prompt_version', 2, 'response_envelope', 'matches'),
       is_active = TRUE
 WHERE prompt_name = 'claim_matching_bearing_system' AND version = 2;

UPDATE llm_prompts
   SET prompt_text = @bearing_match_user_v2,
       parameters = JSON_OBJECT('phase', 6, 'prompt_version', 2, 'response_envelope', 'matches'),
       is_active = TRUE
 WHERE prompt_name = 'claim_matching_bearing_user' AND version = 2;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 140) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN ('claim_matching_bearing_system', 'claim_matching_bearing_user')
 ORDER BY prompt_name, version DESC;
