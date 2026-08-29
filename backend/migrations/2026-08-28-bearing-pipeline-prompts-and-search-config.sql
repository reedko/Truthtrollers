-- Materialize the reviewed dev bearing-pipeline prompt and search configuration.
--
-- This migration intentionally makes no schema changes. The active code's
-- required link fields, including reference_claim_task_links.rationale, already
-- exist in both the inspected dev and production databases.
--
-- Prompt IDs are manually assigned in this database. Abort rather than
-- overwrite an unrelated prompt if one of the reviewed IDs is occupied.

DROP PROCEDURE IF EXISTS apply_20260828_bearing_pipeline_config;

DELIMITER $$

CREATE PROCEDURE apply_20260828_bearing_pipeline_config()
BEGIN
  DECLARE collision_count INT DEFAULT 0;
  DECLARE active_count INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT COUNT(*)
    INTO collision_count
  FROM llm_prompts
  WHERE (prompt_id = 434 AND prompt_name <> 'evidence_query_generation_system')
     OR (prompt_id = 435 AND prompt_name <> 'evidence_query_generation_user_balanced')
     OR (prompt_id = 444 AND prompt_name <> 'evidence_bearing_extraction_user')
     OR (prompt_id = 445 AND prompt_name <> 'evidence_assertion_bearing_user')
     OR (prompt_id = 446 AND prompt_name <> 'evidence_snippet_bearing_user');

  IF collision_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reviewed bearing prompt_id collision';
  END IF;

  UPDATE llm_prompts
  SET is_active = 0
  WHERE prompt_name IN (
    'evidence_query_generation_system',
    'evidence_query_generation_user_balanced',
    'evidence_bearing_extraction_user',
    'evidence_assertion_bearing_user',
    'evidence_snippet_bearing_user'
  );

  INSERT INTO llm_prompts (
    prompt_id,
    prompt_name,
    prompt_type,
    prompt_text,
    parameters,
    version,
    is_active,
    max_claims,
    min_sources,
    max_sources
  ) VALUES (
    434,
    'evidence_query_generation_system',
    'system',
    'You generate precise search queries for fact-checking.
Return strict JSON only.

Preserve the exact atomic assertion being checked. If the input includes both an original claim and a core factual assertion, optimize queries for the core factual assertion while retaining named people, institutions, works, dates, and identifiers from the supplied input when useful.

Do not broaden a narrow allegation into a generic topic claim. Queries must target the alleged action, event, condition, or relationship itself. Never add a person, institution, study, date, identifier, or allegation that is absent from the supplied claim and context.',
    '{}',
    3,
    1,
    12,
    2,
    4
  ) ON DUPLICATE KEY UPDATE
    prompt_name = VALUES(prompt_name),
    prompt_type = VALUES(prompt_type),
    prompt_text = VALUES(prompt_text),
    parameters = VALUES(parameters),
    version = VALUES(version),
    is_active = VALUES(is_active),
    max_claims = VALUES(max_claims),
    min_sources = VALUES(min_sources),
    max_sources = VALUES(max_sources);

  INSERT INTO llm_prompts (
    prompt_id,
    prompt_name,
    prompt_type,
    prompt_text,
    parameters,
    version,
    is_active,
    max_claims,
    min_sources,
    max_sources
  ) VALUES (
    435,
    'evidence_query_generation_user_balanced',
    'user',
    'CLAIM TO VERIFY:
{{claimText}}

CONTEXT:
{{context}}

TASK: Generate EXACTLY {{n}} high-precision search queries for this exact claim:

1. SUPPORT — a query designed to retrieve evidence that would support or corroborate the substantive claim.
2. REFUTE — a query designed to retrieve evidence that would contradict, rebut, or provide an alternative explanation for the substantive claim.

QUERY DESIGN RULES:
- Preserve the exact proposition being tested. Do not broaden it into the surrounding topic.
- Keep the query tightly anchored to the specific event, study, dispute, institution, action, population, date, or other identifying details supplied in the claim or context.
- A named person or source may be retained when that identity materially disambiguates the specific event, study, dispute, or evidence at issue.
- If a named person, institution, study, document, event, or other identity in the supplied context materially identifies the specific dispute or evidence at issue, retain that identity in the query.
- Do not drop such an identity merely because the substantive proposition can be expressed without it.
- Omit an identity only when it is merely an attribution wrapper and does not help distinguish the specific dispute, study, event, or evidence being searched.
- Do not include a person''s identity merely to verify that the person made the claim.
- For attribution wrappers, target the underlying substantive assertion unless attribution itself is independently material.
- For misconduct allegations, preserve the exact alleged action and object.
- Do not invent names, studies, dates, identifiers, or facts not present in the supplied claim or context.
- Do not generate a separate nuance query. Nuance will be determined from the retrieved evidence.

DIRECTIONALITY RULES:
- SUPPORT and REFUTE must pursue genuinely different evidentiary possibilities, not cosmetic rewrites of the same search.
- For negative, absence, or "no evidence/studies" claims:
  - SUPPORT should seek evidence consistent with the claimed absence, non-association, or lack of credible evidence.
  - REFUTE should seek evidence demonstrating the allegedly absent study, effect, association, event, or evidence.
- Do not create a refute query merely by adding words such as "controversy", "not", "false", "refutation", or "debunked".
- Formulate the substantive alternative that, if supported, would make the claim false.

Return JSON only:
{"queries":[
  {"query":"...","intent":"support"},
  {"query":"...","intent":"refute"}
]}',
    '{"n": 2}',
    7,
    1,
    12,
    2,
    4
  ) ON DUPLICATE KEY UPDATE
    prompt_name = VALUES(prompt_name),
    prompt_type = VALUES(prompt_type),
    prompt_text = VALUES(prompt_text),
    parameters = VALUES(parameters),
    version = VALUES(version),
    is_active = VALUES(is_active),
    max_claims = VALUES(max_claims),
    min_sources = VALUES(min_sources),
    max_sources = VALUES(max_sources);

  INSERT INTO llm_prompts (
    prompt_id,
    prompt_name,
    prompt_type,
    prompt_text,
    parameters,
    version,
    is_active,
    max_claims,
    min_sources,
    max_sources
  ) VALUES (
    444,
    'evidence_bearing_extraction_user',
    'user',
    'You are given one case assertion and a set of evidence documents.

Return every factual assertion in the supplied evidence documents that is relevant to evaluating the case assertion.

Evaluate relevance to the case assertion as stated. Shared subject matter alone is not sufficient.

For every supplied document, return all relevant factual assertions from that document even when another supplied document contains the same, similar, stronger, or more detailed evidence.

Do not omit a relevant assertion because substantially similar information was returned from another document.

Do not evaluate whether an evidence assertion supports or refutes the case assertion.
Do not assign a score, stance, relationship, or bearing direction.
Do not use outside knowledge.
Do not return general document summaries or assertions that are merely topically related.

Each evidence assertion must faithfully preserve the factual meaning and material scope of its source document.

Each evidence assertion is a concise factual abstraction.

State each evidence assertion neutrally and concisely; do not reproduce emotionally charged phrasing from the source verbatim.

Preserve the referenceContentId of the document from which each evidence assertion was extracted.

An assertion about a different person, event, study, time period, or object is not relevant to the case assertion unless it directly bears on the specific event described by the case assertion.

Return no assertion for a document when that document contains nothing relevant to evaluating the case assertion.

CASE ASSERTION

{{caseAssertion}}

EVIDENCE DOCUMENTS

{{evidenceDocuments}}',
    '{"evidenceText": "full acquired evidence document text", "caseAssertions": "JSON array of supplied case assertions"}',
    6,
    1,
    12,
    2,
    4
  ) ON DUPLICATE KEY UPDATE
    prompt_name = VALUES(prompt_name),
    prompt_type = VALUES(prompt_type),
    prompt_text = VALUES(prompt_text),
    parameters = VALUES(parameters),
    version = VALUES(version),
    is_active = VALUES(is_active),
    max_claims = VALUES(max_claims),
    min_sources = VALUES(min_sources),
    max_sources = VALUES(max_sources);

  INSERT INTO llm_prompts (
    prompt_id,
    prompt_name,
    prompt_type,
    prompt_text,
    parameters,
    version,
    is_active,
    max_claims,
    min_sources,
    max_sources
  ) VALUES (
    445,
    'evidence_assertion_bearing_user',
    'user',
    'You are given one case assertion and a set of evidence assertions.

For each evidence assertion, determine its evidentiary bearing on the case assertion.

A material bearing exists when, assuming the evidence assertion is true, learning it would rationally change how likely the case assertion as stated is to be true.

Evidence may bear directly on the specific event asserted.

Evidence may also bear indirectly when it describes the same actor, organization, or relevant decision-making authority engaging in a structurally similar action, close enough in time, kind, and context that observing it would rationally update belief about a different, unconfirmed instance of that actor doing the same thing.

Mere similarity of subject matter, institution, vocabulary, or action is not sufficient. The evidence must provide a rational reason to update belief about the case assertion.

Indirect or pattern evidence should receive a score reflecting only the amount by which it changes the plausibility of the case assertion, not the strength with which it establishes the separate event it describes.

bearingScore is:

null when learning the evidence assertion would not materially change belief in the case assertion.

-1 when the evidence assertion strongly makes the case assertion less likely to be true.

0 when the evidence assertion materially qualifies the case assertion but does not make it more or less likely to be true overall.

1 when the evidence assertion strongly makes the case assertion more likely to be true.

Values between -1 and 1 represent direction and strength of bearing.

For every non-null bearingScore, provide a concise rationale explaining why the evidence assertion changes how the case assertion should be evaluated.

The rationale should state the evidentiary connection between the two assertions rather than merely restating them.

When bearingScore is null, rationale must be null.

Evaluate the case assertion exactly as stated and preserve its meaning and scope.

bearingScore represents evidentiary bearing only. It does not represent source quality, model confidence, or retrieval relevance.

Use only the supplied assertions. Do not use outside knowledge.

CASE ASSERTION

{{caseAssertion}}

EVIDENCE ASSERTIONS

{{evidenceAssertions}}

INFORMAL OUTPUT CONTRACT

results[]
  evidenceAssertionId   string
  bearingScore          number [-1,1] | null
  rationale             string | null

null bearingScore means NO BEARING.',
    '{"evidenceText": "full acquired evidence document text", "caseAssertions": "JSON array of supplied case assertions"}',
    2,
    1,
    12,
    2,
    4
  ) ON DUPLICATE KEY UPDATE
    prompt_name = VALUES(prompt_name),
    prompt_type = VALUES(prompt_type),
    prompt_text = VALUES(prompt_text),
    parameters = VALUES(parameters),
    version = VALUES(version),
    is_active = VALUES(is_active),
    max_claims = VALUES(max_claims),
    min_sources = VALUES(min_sources),
    max_sources = VALUES(max_sources);

  INSERT INTO llm_prompts (
    prompt_id,
    prompt_name,
    prompt_type,
    prompt_text,
    parameters,
    version,
    is_active,
    max_claims,
    min_sources,
    max_sources
  ) VALUES (
    446,
    'evidence_snippet_bearing_user',
    'user',
    'You are given one case assertion and search-result snippets for possible evidence documents.

CASE ASSERTION

{{caseAssertion}}

CANDIDATES

{{candidates}}

For each candidate, determine whether the information stated in its snippet materially bears on the case assertion.

A material bearing must address the same specific proposition and its material scope.
Match the relevant population, intervention or exposure, outcome, event, actor and action, quantity, time period, or causal relationship required by the case assertion.
Shared subject matter alone is not material bearing.

bearingScore is:

null when learning the information in the snippet would not materially change belief in the case assertion.

-1 when the information strongly makes the case assertion less likely to be true.

0 when the information materially qualifies the case assertion but does not make it more or less likely to be true overall.

1 when the information strongly makes the case assertion more likely to be true.

Values between -1 and 1 represent direction and strength of bearing.

For every non-null bearingScore, provide a concise rationale explaining why the information in the snippet changes how the case assertion should be evaluated.

The rationale should state the evidentiary connection between the snippet and the case assertion rather than merely restating either one.

When bearingScore is null, rationale must be null.

Return every supplied candidateIndex exactly once.

Return JSON only:

{
  "candidates": [
    {
      "candidateIndex": 0,
      "bearingScore": 0.9,
      "rationale": "The snippet directly reports information bearing on the specific proposition asserted in the case assertion."
    }
  ]
}',
    '{"candidates": "JSON candidate snippet array", "caseAssertion": "JSON case assertion"}',
    2,
    1,
    20,
    1,
    20
  ) ON DUPLICATE KEY UPDATE
    prompt_name = VALUES(prompt_name),
    prompt_type = VALUES(prompt_type),
    prompt_text = VALUES(prompt_text),
    parameters = VALUES(parameters),
    version = VALUES(version),
    is_active = VALUES(is_active),
    max_claims = VALUES(max_claims),
    min_sources = VALUES(min_sources),
    max_sources = VALUES(max_sources);

  INSERT INTO evidence_search_config (
    config_key,
    config_value,
    description,
    updated_by
  ) VALUES (
    'search_mode',
    'balanced_all_claims',
    'Evidence search strategy: high_quality_only | fringe_on_support | balanced_all_claims',
    NULL
  ) ON DUPLICATE KEY UPDATE
    config_value = VALUES(config_value),
    description = VALUES(description),
    updated_by = VALUES(updated_by);

  INSERT INTO evidence_search_config (
    config_key,
    config_value,
    description,
    updated_by
  ) VALUES (
    'mode_config',
    '{"fringe_on_support": {"description": "High-quality   sources + fringe sources when strong support   found", "fringeTrigger": "support", "queriesPerClaim": 4, "topKFringeQueries": 2, "enableFringeSearch": true, "topKFringeCandidates": 2, "maxEvidenceCandidates": 3, "fringeConfidenceThreshold": 0.7, "maxFringeEvidenceCandidates": 2}, "high_quality_only": {"description": "Search   only high-quality sources (Tavily +   Bing)", "queriesPerClaim": 4, "enableFringeSearch": false, "maxEvidenceCandidates": 3}, "balanced_all_claims": {"description": "For every claim: 1 support and 1 refute query", "targetNuance": 0, "targetRefute": 2, "nuanceQueries": 0, "refuteQueries": 1, "targetSupport": 2, "supportQueries": 1, "topKCandidates": 5, "queriesPerClaim": 2, "enableBalancedSearch": true, "maxEvidenceCandidates": 6}}',
    'Configuration parameters for each search mode',
    NULL
  ) ON DUPLICATE KEY UPDATE
    config_value = VALUES(config_value),
    description = VALUES(description),
    updated_by = VALUES(updated_by);

  SELECT COUNT(*)
    INTO active_count
  FROM llm_prompts
  WHERE is_active = 1
    AND prompt_name IN (
      'evidence_query_generation_system',
      'evidence_query_generation_user_balanced',
      'evidence_bearing_extraction_user',
      'evidence_assertion_bearing_user',
      'evidence_snippet_bearing_user'
    );

  IF active_count <> 5 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Expected exactly one active version of each reviewed prompt';
  END IF;

  SELECT COUNT(*)
    INTO active_count
  FROM (
    SELECT prompt_name
    FROM llm_prompts
    WHERE is_active = 1
      AND prompt_name IN (
        'evidence_query_generation_system',
        'evidence_query_generation_user_balanced',
        'evidence_bearing_extraction_user',
        'evidence_assertion_bearing_user',
        'evidence_snippet_bearing_user'
      )
    GROUP BY prompt_name
    HAVING COUNT(*) = 1
  ) AS exactly_one_active;

  IF active_count <> 5 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reviewed prompt activation verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM llm_prompts
    WHERE prompt_id = 434
      AND is_active = 1
      AND SHA2(prompt_text, 256) = '22252cd9e9b02dae286d57a360227f944858f34560ae3f17d5ce2d8c9ccafa51'
  ) OR NOT EXISTS (
    SELECT 1
    FROM llm_prompts
    WHERE prompt_id = 435
      AND is_active = 1
      AND SHA2(prompt_text, 256) = 'd58c135289ccb46c1a5601f940abb3e91b16c2c732b9238579280ad1685d1df4'
  ) OR NOT EXISTS (
    SELECT 1
    FROM llm_prompts
    WHERE prompt_id = 444
      AND is_active = 1
      AND SHA2(prompt_text, 256) = 'a909179db936a943ff1663d840c4e24f017610a7c25451eafa90dc780ffca2ed'
  ) OR NOT EXISTS (
    SELECT 1
    FROM llm_prompts
    WHERE prompt_id = 445
      AND is_active = 1
      AND SHA2(prompt_text, 256) = 'bbcc4b114e36bf7b2ca02a44a63082c84b953bf1a48bed0218dd2bf8c70c8256'
  ) OR NOT EXISTS (
    SELECT 1
    FROM llm_prompts
    WHERE prompt_id = 446
      AND is_active = 1
      AND SHA2(prompt_text, 256) = 'cdefa670863ae3cd373db7be14b77d6aafe11b51194ade12174842024679bfe6'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reviewed prompt content verification failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM evidence_search_config
    WHERE config_key = 'search_mode'
      AND config_value = 'balanced_all_claims'
  ) OR NOT EXISTS (
    SELECT 1
    FROM evidence_search_config
    WHERE config_key = 'mode_config'
      AND SHA2(config_value, 256) = 'de9db769aed02927e89cde298f5b248e1540afc54f37986b1c8d0b5374af2d17'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reviewed evidence search configuration verification failed';
  END IF;

  COMMIT;
END$$

DELIMITER ;

CALL apply_20260828_bearing_pipeline_config();

DROP PROCEDURE IF EXISTS apply_20260828_bearing_pipeline_config;
