-- Phase 3 only: seed the optional batched pre-scrape snippet-bearing prompts.
-- This changes prompt data, not schema. It is safe to rerun: version 1 rows are
-- inserted only when absent and then updated in place.

SET @snippet_bearing_system = 'You assess whether search-result titles and snippets are likely to contain evidence that bears on one exact case claim.\n\nBearing means likely truth-value impact on the specific claim. It is not source quality, authority, confidence, stance, political agreement, or broad topical relevance.\n\nReturn strict JSON only. Include every candidateKey exactly once.';

SET @snippet_bearing_user = 'CASE CLAIM:\n{{claimJson}}\n\nEVIDENCE NEED:\n{{evidenceNeedJson}}\n\nSEARCH CANDIDATES:\n{{candidatesJson}}\n\nFor every candidate, return candidateKey, url, bearingPreScore (0.0-1.0), expectedStance (support|refute|nuance|background|insufficient), bearingType (direct|indirect|context|origin|steelman|none), claimComponentAddressed (whole_claim|subject|relation|object|scope|attribution|warrant|none), triageDecision (scrape|maybe|skip), and one short reason.\n\nRules:\n1. Do not reward same-topic overlap alone. High bearing requires likely alignment with the claim''s subject, relation/predicate, object/outcome, scope, attribution, causal strength, or warrant.\n2. Do not use publisher prestige or domain authority as bearing. A high-authority page can have low bearing; a low-quality page can have high bearing.\n3. A snippet is high-bearing only if it likely contains evidence that could support, refute, or materially qualify the exact claim.\n4. Association/correlation only partially bears on a causal claim unless causal or mechanistic evidence is explicit.\n5. For "X said Y", whether X said Y and whether Y is true are separate. State which component the snippet appears to address.\n6. An article-level fact-check does not refute every embedded subclaim unless the snippet addresses this exact subclaim.\n7. Do not infer expected stance from the search query''s support/refute label.\n8. If a snippet is vague, score conservatively. Use maybe only when it appears to be an origin/primary source or a genuinely direct steelman path.\n9. Background that does not change scope or warrant is low-bearing.\n\nReturn exactly: {"results":[{"candidateKey":"c0","url":"...","bearingPreScore":0.0,"expectedStance":"insufficient","bearingType":"none","claimComponentAddressed":"none","triageDecision":"skip","reason":"..."}]}';

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id,
       'snippet_bearing_assessment_system',
       'system',
       @snippet_bearing_system,
       JSON_OBJECT('phase', 3, 'prompt_version', 1),
       1,
       TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'snippet_bearing_assessment_system' AND version = 1
 );

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT ids.next_id,
       'snippet_bearing_assessment_user',
       'user',
       @snippet_bearing_user,
       JSON_OBJECT('phase', 3, 'prompt_version', 1, 'max_candidates', 12),
       1,
       TRUE
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE NOT EXISTS (
       SELECT 1 FROM llm_prompts
        WHERE prompt_name = 'snippet_bearing_assessment_user' AND version = 1
 );

UPDATE llm_prompts
   SET prompt_text = @snippet_bearing_system,
       parameters = JSON_OBJECT('phase', 3, 'prompt_version', 1),
       is_active = TRUE
 WHERE prompt_name = 'snippet_bearing_assessment_system' AND version = 1;

UPDATE llm_prompts
   SET prompt_text = @snippet_bearing_user,
       parameters = JSON_OBJECT('phase', 3, 'prompt_version', 1, 'max_candidates', 12),
       is_active = TRUE
 WHERE prompt_name = 'snippet_bearing_assessment_user' AND version = 1;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 120) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN ('snippet_bearing_assessment_system', 'snippet_bearing_assessment_user')
 ORDER BY prompt_name, version DESC;
