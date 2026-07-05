-- R7: constrain post-evidence source extraction to additional assertions for
-- unresolved originating targets. Safe to run repeatedly.
START TRANSACTION;

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT
  ids.next_id,
  'claim_extraction_unresolved_targets_instruction',
  'user',
  'The evidence engine already preserved the assertions listed under ALREADY CAPTURED.

UNRESOLVED EVALUATION TARGETS:
{{unresolvedTargets}}

ALREADY CAPTURED — DO NOT RE-EXTRACT OR PARAPHRASE:
{{existingAssertions}}

Extract ONLY additional, distinct assertions from the source text that directly address one of the unresolved targets. Do not extract general background, topic-adjacent facts, or assertions relevant only to other case claims. Return no claims if the text contains no additional target-bearing assertion.',
  JSON_OBJECT(),
  1,
  TRUE
FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
WHERE NOT EXISTS (
  SELECT 1 FROM llm_prompts
   WHERE prompt_name = 'claim_extraction_unresolved_targets_instruction'
     AND version = 1
);

COMMIT;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 160) AS preview
  FROM llm_prompts
 WHERE prompt_name = 'claim_extraction_unresolved_targets_instruction'
 ORDER BY version DESC;
