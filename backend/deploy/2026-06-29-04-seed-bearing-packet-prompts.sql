-- Phase 6 shadow packet prompts. These are additive variants; legacy
-- claim_matching_* prompts remain active and unchanged. Safe to rerun.

SET @bearing_match_system = 'You match reference claims to exact task claims for fact-checking. Return strict JSON only. Judge stance relative to the task claim, not source credibility. Separately score bearing: topic overlap alone is bearingType none; a broad fact-check must address the exact component; association cannot fully support a causal claim; attribution proof and object-claim truth are separate.';

SET @bearing_match_user = 'TASK CLAIMS:\n{{taskClaims}}\n\nREFERENCE CLAIMS:\n{{referenceClaims}}\n\nReturn only reference/task pairs that materially bear on the exact task claim. For each return referenceClaimIndex, taskClaimIndex, stance, veracityScore, confidence, supportLevel, rationale, bearingScore, bearingType, claimComponentAddressed, causalStrength, and bearingReason.\n\nReturn JSON array:\n[{"referenceClaimIndex":1,"taskClaimIndex":1,"stance":"support|refute|nuance|insufficient","veracityScore":0.0,"confidence":0.15,"supportLevel":0.0,"rationale":"...","bearingScore":0.0,"bearingType":"direct|indirect|context|origin|steelman|none","claimComponentAddressed":"whole_claim|subject|relation|object|scope|attribution|warrant|none","causalStrength":"causal|mechanistic|associative|correlational|not_applicable|unclear","bearingReason":"..."}]';

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'claim_matching_bearing_system', 'system', @bearing_match_system,
       JSON_OBJECT('phase', 6, 'prompt_version', 1), 1, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'claim_matching_bearing_system' AND version = 1
 );

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id, 'claim_matching_bearing_user', 'user', @bearing_match_user,
       JSON_OBJECT('phase', 6, 'prompt_version', 1), 1, TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'claim_matching_bearing_user' AND version = 1
 );

UPDATE llm_prompts
   SET prompt_text = @bearing_match_system,
       parameters = JSON_OBJECT('phase', 6, 'prompt_version', 1),
       is_active = TRUE
 WHERE prompt_name = 'claim_matching_bearing_system' AND version = 1;

UPDATE llm_prompts
   SET prompt_text = @bearing_match_user,
       parameters = JSON_OBJECT('phase', 6, 'prompt_version', 1),
       is_active = TRUE
 WHERE prompt_name = 'claim_matching_bearing_user' AND version = 1;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 120) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN ('claim_matching_bearing_system', 'claim_matching_bearing_user')
 ORDER BY prompt_name, version DESC;
