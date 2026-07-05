-- 2026-07-01-02-version-argument-mapping-prompt-targets.sql
-- Versions argument_mapping_system and argument_mapping_user to require
-- a targets array with typed evaluation targets.
-- Run manually. Deactivates the current active versions before inserting.
-- Compatible with existing argument_mapping normalizer.

START TRANSACTION;

UPDATE llm_prompts
   SET is_active = FALSE
 WHERE prompt_name IN ('argument_mapping_system', 'argument_mapping_user')
   AND is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- argument_mapping_system v2
-- Adds target-typing guidance to the existing argument-mapping rules.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT next_id,
       'argument_mapping_system',
       'system',
       'You map extracted case claims to their function inside the article''s argument and decompose each claim into typed evaluation targets.\n\nReturn strict JSON only. Do not include markdown or commentary.\n\nDecide whether the article endorses each claim, rejects it, reports it neutrally, or uses it as an opposing claim to refute.\n\nThis is not fact-checking. Do not use outside knowledge. Use only the article text and extracted claims.\n\nFor attribution claims like "X says Y", distinguish the attribution wrapper from the object claim Y.\n\nscoreTransform controls how evidence about the object claim should affect the article:\n- normal: evidence supporting the object claim supports the article; evidence refuting it weakens the article.\n- invert: evidence supporting the object claim weakens the article; evidence refuting it supports the article.\n- none: the claim should not directly affect the article score.\n- review: unclear; human review needed before scoring.\n\nUse invert when the article presents a claim mainly as an opponent/ad/source claim that the article is trying to discredit.\nUse none for attribution-only, neutral reporting, or background that does not carry the argument.\n\nTARGET TYPES:\n- attribution: whether the named person or institution made the statement or allegation.\n- substantive: whether the underlying factual event or condition occurred. This is the primary evaluation target.\n- inference: whether the article''s conclusion follows from the underlying facts. Use when the claim implies causation, concealment, or a derived consequence.\n- study_identity: resolution of the exact study, dataset, document, population, subgroup, or protocol. Always set verdictEligible to false.\n\nATTRIBUTION RULE: Confirmed attribution (X said it) does NOT prove the substantive allegation (that it is true). Keep attribution and substantive targets separate.\n\nMISCONDUCT RULE: For misconduct words such as manipulated, suppressed, omitted, excluded, destroyed, or concealed, record the exact alleged action in allegedAction. Do not broaden or generalize.\n\nUNDERSPECIFIED RULE: If a study, dataset, population, or document is referenced but cannot be fully resolved from the article text, set resolutionStatus to "underspecified". Do not invent or broaden the scope.',
       JSON_OBJECT(),
       next_version,
       TRUE
  FROM (
    SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id,
           (SELECT COALESCE(MAX(p.version), 0) + 1
              FROM llm_prompts p
             WHERE p.prompt_name = 'argument_mapping_system') AS next_version
      FROM llm_prompts
  ) ids;

-- ─────────────────────────────────────────────────────────────────────────────
-- argument_mapping_user v2
-- Requires a targets array with fully typed evaluation targets.
-- Preserves all existing scalar fields for backward compatibility.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
SELECT next_id,
       'argument_mapping_user',
       'user',
       'You are mapping article claims into evaluation targets for VeriStrata.\n\nYour job is to analyze each visible article claim and produce:\n1. The existing scalar argument-mapping fields required for backward compatibility.\n2. A new `targets` array containing atomic evaluation targets.\n\nDo not remove or rename existing scalar fields. Existing consumers still depend on them.\n\nDefinitions:\n\n- `claimText`: the visible claim extracted from the article.\n- `objectClaim`: the main substantive proposition being evaluated, excluding attribution wrappers when possible.\n- `attribution target`: whether a named person, institution, document, or source made the statement or allegation.\n- `substantive target`: whether the underlying factual event, condition, or conduct occurred.\n- `inference target`: whether the article''s conclusion follows from the underlying facts.\n- `study_identity target`: resolution of the exact study, dataset, document, population, subgroup, protocol, analysis, or source artifact involved.\n\nCritical rules:\n\n- Never allow attribution verification to prove a substantive allegation.\n- If a person allegedly "revealed," "said," "claimed," "admitted," "reported," or "testified" something, split that into:\n  1. whether they made the statement, and\n  2. whether the underlying statement is true.\n- If the claim involves a study, dataset, document, population, subgroup, protocol, or analysis, create a `study_identity` target when identification is necessary for search or evaluation.\n- If the article''s wording uses loaded terms like "manipulated," "suppressed," "destroyed," "covered up," "censored," or "debunked," preserve what specific action is alleged.\n- Do not silently broaden underspecified claims.\n- If the exact study, dataset, population, subgroup, protocol, or analysis cannot be resolved from the article context, mark the target as `underspecified`.\n- A target may be search-eligible even when it is not verdict-eligible.\n- Study identity is a search prerequisite, not by itself verdict evidence.\n- General topical evidence must not be treated as bearing on a different predicate.\n\nInput:\n\nYou will receive:\n- article thesis or summary\n- article excerpt\n- visible claims in JSON form\n\nFor each claim, return one mapping object.\n\nOutput must be valid JSON only.\n\nReturn this shape:\n\n{\n  "items": [\n    {\n      "claimId": "<existing claim id if provided>",\n      "claimText": "<original visible claim text>",\n\n      "objectClaim": "<primary substantive proposition to evaluate, excluding attribution wrapper where possible>",\n      "isAttribution": true,\n      "speakerEntity": "<person/institution/document being attributed, or null>",\n      "articleStance": "endorses|rejects|neutral|unclear",\n      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",\n      "scoreTransform": "normal|invert|none|review",\n      "accountabilityEligible": false,\n      "confidence": 0.0,\n      "rationale": "<brief rationale>",\n\n      "targets": [\n        {\n          "targetType": "attribution|substantive|inference|study_identity",\n          "targetText": "<atomic proposition or identity-resolution target>",\n          "subjectEntity": "<main actor/entity, or null>",\n          "predicateText": "<specific predicate/action/relation being evaluated>",\n          "objectText": "<object of the predicate, or null>",\n          "allegedAction": "<specific alleged act such as omitted, altered, excluded, suppressed, cancelled, caused, etc., or null>",\n          "studyTitle": "<exact study/document title if known, or null>",\n          "studyAuthors": "<authors if known, or null>",\n          "studyYear": "<year if known, or null>",\n          "studyIdentifier": "<DOI, PMID, URL, docket number, report id, etc. if known, or null>",\n          "populationScope": "<population, subgroup, dataset, geography, or sample if relevant, or null>",\n          "sourceExcerpt": "<short excerpt from the article supporting this target>",\n          "articleStance": "endorses|rejects|neutral|unclear",\n          "scoreTransform": "normal|invert|none|review",\n          "searchEligible": true,\n          "verdictEligible": true,\n          "resolutionStatus": "mapped|underspecified|resolved|unresolved",\n          "mappingConfidence": 0.0,\n          "mappingRationale": "<brief explanation of why this target exists>"\n        }\n      ]\n    }\n  ]\n}\n\nTarget construction rules:\n\n1. Attribution target\nCreate this when the visible claim depends on who said, revealed, reported, testified, admitted, published, or alleged something.\n\nExample:\nVisible claim:\n"William Thompson revealed that data linking the MMR vaccine to autism had been manipulated by the CDC."\n\nAttribution target:\n"William Thompson made a statement, disclosure, or allegation about CDC handling of MMR/autism data."\n\nThis target is verdict-eligible only for whether the statement was made. It must not prove the underlying allegation.\n\n2. Substantive target\nCreate this for the underlying factual allegation.\n\nExample:\n"CDC researchers improperly altered, omitted, or excluded analyses from an MMR-autism study."\n\nThis target evaluates the alleged conduct itself.\n\n3. Inference target\nCreate this when the visible claim implies a conclusion beyond the immediate event.\n\nExample:\n"The alleged data handling concealed or misrepresented evidence of an association between MMR vaccination and autism."\n\nThis target evaluates whether the article''s conclusion follows.\n\n4. Study-identity target\nCreate this when the evaluation requires resolving a specific study, document, dataset, population, subgroup, protocol, or analysis.\n\nExample:\n"Resolve the exact MMR/autism study, dataset, population, subgroup, and disputed analysis referenced by William Thompson."\n\nSet:\n- searchEligible: true\n- verdictEligible: false unless the article''s accuracy directly depends on the identity claim\n- resolutionStatus: "underspecified" if the article does not provide enough information\n\nFor the Thompson example, a good output would include:\n\n- attribution target:\n  "William Thompson made a statement, disclosure, or allegation about CDC handling of MMR/autism data."\n\n- study_identity target:\n  "Resolve the exact MMR/autism study, dataset, population, subgroup, and disputed analysis referenced by Thompson."\n\n- substantive target:\n  "CDC researchers improperly altered, omitted, or excluded analyses from the identified MMR/autism study."\n\n- inference target:\n  "The alleged alteration, omission, or exclusion concealed or misrepresented evidence of a link between MMR vaccination and autism."\n\nQuality requirements:\n\n- Keep targets atomic.\n- Avoid generic targets like "vaccines cause autism" unless the visible claim actually asserts that.\n- Preserve exact named entities.\n- Preserve the article''s allegation strength, but do not convert allegations into established facts.\n- If something is only alleged, say "alleged" or phrase the target as an allegation.\n- If study identity is unclear, do not invent it. Mark it underspecified.\n- Return only valid JSON.\n\nARTICLE EXCERPT:\n{{articleExcerpt}}\n\nEXTRACTED THESIS:\n{{articleThesis}}\n\nCLAIMS:\n{{claimsJson}}',
       JSON_OBJECT(),
       next_version,
       TRUE
  FROM (
    SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id,
           (SELECT COALESCE(MAX(p.version), 0) + 1
              FROM llm_prompts p
             WHERE p.prompt_name = 'argument_mapping_user') AS next_version
      FROM llm_prompts
  ) ids;

SELECT prompt_name, version, is_active, LEFT(prompt_text, 120) AS preview
  FROM llm_prompts
 WHERE prompt_name IN ('argument_mapping_system', 'argument_mapping_user')
 ORDER BY prompt_name, version DESC;

COMMIT;
