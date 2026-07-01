-- Standalone repair/seed for argument-mapping prompts.
-- Run this if verification does not show active argument_mapping_system
-- and argument_mapping_user rows.

UPDATE llm_prompts
   SET is_active = FALSE
 WHERE prompt_name IN ('argument_mapping_system', 'argument_mapping_user');

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT next_id,
       'argument_mapping_system',
       'system',
       'You map extracted case claims to their function inside the article''s argument.\n\nReturn strict JSON only. Do not include markdown or commentary.\n\nDecide whether the article endorses each claim, rejects it, reports it neutrally, or uses it as an opposing claim to refute.\n\nThis is not fact-checking. Do not use outside knowledge. Use only the article text and extracted claims.\n\nFor attribution claims like "X says Y", distinguish the attribution wrapper from the object claim Y.\n\nscoreTransform controls how evidence about the object claim should affect the article:\n- normal: evidence supporting the object claim supports the article; evidence refuting it weakens the article.\n- invert: evidence supporting the object claim weakens the article; evidence refuting it supports the article.\n- none: the claim should not directly affect the article score.\n- review: unclear; human review needed before scoring.\n\nUse invert when the article presents a claim mainly as an opponent/ad/source claim that the article is trying to discredit.\nUse none for attribution-only, neutral reporting, or background that does not carry the argument.',
       JSON_OBJECT(),
       next_version,
       TRUE
  FROM (
    SELECT
      COALESCE(MAX(prompt_id), 0) + 1 AS next_id,
      (SELECT COALESCE(MAX(p.version), 0) + 1
         FROM llm_prompts p
        WHERE p.prompt_name = 'argument_mapping_system') AS next_version
      FROM llm_prompts
  ) ids;

INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT next_id,
       'argument_mapping_user',
       'user',
       'Analyze this article excerpt and extracted claims.\n\nARTICLE EXCERPT:\n{{articleExcerpt}}\n\nEXTRACTED THESIS:\n{{articleThesis}}\n\nCLAIMS:\n{{claimsJson}}\n\nReturn JSON with exactly this structure:\n{\n  "articleThesis": "",\n  "claims": [\n    {\n      "claimId": 0,\n      "objectClaim": "",\n      "isAttribution": false,\n      "speakerEntity": "",\n      "articleStanceTowardObjectClaim": "endorses|rejects|neutral|unclear",\n      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",\n      "scoreTransform": "normal|invert|none|review",\n      "accountabilityEligible": false,\n      "confidence": 0,\n      "rationale": ""\n    }\n  ]\n}\n\nRules:\n- Include one output item for every input claim.\n- objectClaim is the factual assertion evidence search should evaluate.\n- For "X said/stated/claimed/alleged that Y", objectClaim should be Y.\n- If the article uses Y as an example of what is wrong or false, use argumentFunction opposing_claim_to_refute and scoreTransform invert.\n- If the article uses Y to support its own thesis, use normal.\n- If the article merely says who said something and the object claim does not carry the article argument, use none.\n- Keep rationales short.',
       JSON_OBJECT(),
       next_version,
       TRUE
  FROM (
    SELECT
      COALESCE(MAX(prompt_id), 0) + 1 AS next_id,
      (SELECT COALESCE(MAX(p.version), 0) + 1
         FROM llm_prompts p
        WHERE p.prompt_name = 'argument_mapping_user') AS next_version
      FROM llm_prompts
  ) ids;

SELECT prompt_name, prompt_type, version, is_active, LEFT(prompt_text, 120) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN ('argument_mapping_system', 'argument_mapping_user')
 ORDER BY prompt_name, version DESC;
