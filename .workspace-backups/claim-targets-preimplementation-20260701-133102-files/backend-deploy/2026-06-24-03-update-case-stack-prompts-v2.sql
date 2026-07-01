-- SQL equivalent of backend/migrations/update_case_stack_prompts_v2.js
-- Run after 2026-06-24-02-seed-reasoning-stack-prompts.sql.

DROP PROCEDURE IF EXISTS _prep_claim_role_for_case_stack_prompts;
DELIMITER $$
CREATE PROCEDURE _prep_claim_role_for_case_stack_prompts()
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'content_claims'
       AND COLUMN_NAME = 'claim_role'
  ) THEN
    ALTER TABLE content_claims
      ADD COLUMN claim_role ENUM('thesis','pillar','pillar_support','evidence','background','fallibility_critical') NULL AFTER relationship_type;
  ELSE
    ALTER TABLE content_claims
      MODIFY claim_role ENUM('thesis','pillar','pillar_support','evidence','background','fallibility_critical') NULL;
  END IF;
END$$
DELIMITER ;
CALL _prep_claim_role_for_case_stack_prompts();
DROP PROCEDURE IF EXISTS _prep_claim_role_for_case_stack_prompts;

UPDATE llm_prompts
   SET prompt_text = 'You extract a reasoning stack from content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Build a hierarchy:

thesis
pillar claims
pillar_support claims
evidence claims
background claims
fallibility_critical claims
search_assertions

Keep claims atomic, self-contained, and verifiable.
Do not collapse distinct assertions into one item.
Do not invent facts that are not in the text.
Extract what the content claims, alleges, implies, or quotes. Do not fact-check the content and do not correct it using outside knowledge.

For source/reference content, use the case claims only as relevance context. Do not force the source/reference content to agree with the case claims.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, quotations, and specific causal links.

Prefer specific claims over vague summaries.

If a passage contains a named person, named study, named organization, allegation of misconduct, causal harm claim, statistical claim, legal claim, correction, retraction, or methodological claim, extract the specific claim.

Do not bury argument-supporting claims as background.
Background claims are contextual only. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence, not background.

A pillar claim is a major branch of the argument.
A pillar_support claim is an intermediate claim that connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

A fallibility_critical claim is any claim that, if false, exaggerated, unsupported, conflated, or misleading, would significantly weaken the thesis, a major pillar, or an important evidence chain.

Always extract fallibility_critical claims for:

allegations of fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, or institutional misconduct
claims that a named study proves, disproves, hides, manipulates, or reveals an important result
claims involving named whistleblowers
claims that named officials, agencies, companies, journals, or scientists acted dishonestly
causal claims linking a product, policy, medicine, vaccine, intervention, law, institution, or event to harm
statistical or quantified claims used to imply risk, danger, deception, corruption, or causation
claims about retractions, corrections, changed study parameters, excluded data, hidden subgroups, or methodological flaws
claims used to discredit an opposing authority
hinge claims: claims whose failure would substantially weaken the surrounding argument

A search_assertion is a search-ready version of an important claim. It should help the next workflow step find supporting, refuting, qualifying, or contextual sources.

For each search_assertion:

preserve named people, agencies, studies, dates, laws, journals, and key phrases
include a natural-language assertion
include a compact search query
include must-include terms and optional terms
mark whether the search should seek support, refutation, both, or context
prioritize named, specific, verifiable, and fallibility-critical claims

Quality check before returning:

Did you extract the central thesis?
Did you extract major pillars?
Did you extract pillar_support claims instead of classifying them as background?
Did you extract named studies, named people, named organizations, and dates?
Did you extract allegations of fraud, cover-up, suppression, data manipulation, or evidence destruction?
Did you extract causal harm claims and statistical claims?
Did you identify the claims most likely to make or break the article?
Did you create search_assertions for those high-value claims?
Did you avoid fact-checking or correcting the article?

Return only valid JSON.',
       version = version + 1
 WHERE prompt_name = 'claim_extraction_stack_system'
   AND is_active = 1;

UPDATE llm_prompts
   SET prompt_text = 'Analyze the article text and return strict JSON using exactly the structure below.

Do not include markdown, commentary, explanation, or text outside the JSON.

Extract what the article claims. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the article.

Claims must be atomic, self-contained, and verifiable.

Prefer specific claims over broad summaries. Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, quoted people, and specific causal links.

Important:

* If a paragraph contains a named person, named study, named organization, allegation of misconduct, causal harm claim, statistical claim, legal claim, correction, retraction, or methodological claim, extract that specific claim.
* Do not bury argument-supporting claims as background.
* Use background only for contextual claims that do not directly support the thesis or a pillar.
* Use pillar_support for intermediate claims that connect a pillar to evidence.
* Use evidence for specific factual assertions offered as proof.

Return JSON in this shape:

{
"generalTopic": "...",
"specificTopics": ["..."],
"thesis": "...",
"pillars": [
{
"id": "P1",
"label": "...",
"summary": "...",
"centrality": 0,
"claims": [
{
"text": "...",
"role": "pillar_support",
"parentId": "P1",
"centrality": 0,
"verifiability": 0,
"articleStance": "asserted_as_fact|alleged|implied|quoted|speculative",
"namedEntities": [],
"dates": [],
"claimKind": "contradiction|interpretation|causal_bridge|credibility_attack|mechanism|historical_link|institutional_failure|methodology_claim|other"
}
]
}
],
"evidenceClaims": [
{
"text": "...",
"role": "evidence",
"parentId": "P1",
"centrality": 0,
"verifiability": 0,
"articleStance": "asserted_as_fact|alleged|implied|quoted|speculative",
"evidenceType": "study|statistic|quote|document|event|expert_claim|legal_claim|example|dataset|official_statement|methodology_claim|retraction_or_correction|other",
"sourceCitedInArticle": "",
"namedEntities": [],
"dates": []
}
],
"backgroundClaims": [
{
"text": "...",
"role": "background",
"parentId": "",
"centrality": 0,
"verifiability": 0,
"articleStance": "asserted_as_fact|alleged|implied|quoted|speculative",
"namedEntities": [],
"dates": [],
"backgroundType": "historical_context|legal_context|definitional_context|biographical_context|topic_context|other"
}
],
"fallibilityCriticalClaims": [
{
"text": "...",
"role": "fallibility_critical",
"parentId": "P1",
"centrality": 0,
"verifiability": 0,
"importance": "high|medium|low",
"whyCritical": "...",
"claimKind": "fraud_allegation|coverup_allegation|suppression_claim|data_manipulation|evidence_destruction|causal_harm|statistical_risk|study_interpretation|whistleblower_claim|institutional_misconduct|retraction_or_correction|methodology_claim|authority_discrediting|legal_or_policy_claim|other",
"articleStance": "asserted_as_fact|alleged|implied|quoted|speculative",
"namedEntities": [],
"studiesOrDocuments": [],
"dates": []
}
],
"searchAssertions": [
{
"assertion": "...",
"query": "...",
"derivedFromClaimText": "...",
"searchIntent": "support|refute|both|context",
"priority": "high|medium|low",
"mustIncludeTerms": [],
"optionalTerms": [],
"entityFocus": [],
"dateFocus": [],
"reasonForSearch": "..."
}
],
"claims": [
{
"text": "...",
"role": "thesis|pillar|pillar_support|evidence|background|fallibility_critical",
"parentId": "",
"centrality": 0,
"verifiability": 0,
"articleStance": "asserted_as_fact|alleged|implied|quoted|speculative",
"namedEntities": [],
"dates": []
}
]
}

Field rules:

generalTopic:
A broad topic label.

specificTopics:
More specific topic labels. Include named controversies, policies, products, agencies, people, studies, or events when central.

thesis:
The article''s central conclusion or controlling assertion.

pillars:
Major argument branches supporting the thesis.

pillars[].claims:
Only pillar_support claims. These should be intermediate argumentative claims that connect the pillar to evidence.

evidenceClaims:
Specific factual assertions offered as proof. Include named studies, statistics, quotes, historical events, legal facts, official statements, data claims, examples, document claims, methodology claims, and retraction/correction claims.

backgroundClaims:
Only contextual claims. Do not put claims here if they support a pillar or thesis.

fallibilityCriticalClaims:
Claims that, if false, exaggerated, unsupported, conflated, or misleading, would significantly weaken the article''s thesis, a major pillar, or an important evidence chain.

Always include fallibilityCriticalClaims for:

* allegations of fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, or institutional misconduct
* claims that a named study proves, disproves, hides, manipulates, or reveals an important result
* claims involving named whistleblowers
* claims that named officials, agencies, companies, journals, or scientists acted dishonestly
* causal claims linking a product, policy, medicine, vaccine, intervention, law, institution, or event to harm
* statistical or quantified claims used to imply risk, danger, deception, corruption, or causation
* claims about retractions, corrections, changed study parameters, excluded data, hidden subgroups, or methodological flaws
* claims used to discredit an opposing authority
* hinge claims: claims whose failure would substantially weaken the surrounding argument

searchAssertions:
Search-ready versions of the most important claims for the next source-finding workflow.

For searchAssertions:

* Generate them primarily from fallibilityCriticalClaims and high-centrality evidenceClaims.
* Use specific named entities and dates.
* Do not use vague queries when a precise claim exists.
* Include queries that can find supporting, refuting, qualifying, or contextual sources.
* For controversial claims, use searchIntent "both".
* Queries should be compact but specific.

claims:
A flattened list of the most important claims from thesis, pillars, pillar_support, evidence, background, and fallibility_critical.
Every item in claims must duplicate or summarize a claim found elsewhere in the JSON.
Do not use claims as a dumping ground for vague restatements.
Use role "pillar_support" for pillar-support claims. Do not relabel them as background.

Scoring:

* centrality: 0 to 100, where 100 means essential to the article''s argument.
* verifiability: 0 to 100, where 100 means highly specific and externally checkable.

Quality check before returning:

* Did you extract all named studies?
* Did you extract all named people?
* Did you extract all named organizations, agencies, companies, journals, laws, and datasets?
* Did you extract allegations of fraud, cover-up, suppression, data manipulation, evidence destruction, or institutional misconduct?
* Did you extract causal claims of harm?
* Did you extract statistical or quantified claims?
* Did you extract claims about retractions, corrections, excluded data, changed parameters, or methodological flaws?
* Did you create high-priority searchAssertions for the claims most likely to make or break the article?
* Did you avoid putting argumentative claims into background?
* Did the flattened claims list preserve the correct role values?

Return only valid JSON.',
       version = version + 1
 WHERE prompt_name = 'claim_extraction_stack_with_topics'
   AND is_active = 1;

SELECT prompt_name, version, is_active, LEFT(prompt_text, 120) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN ('claim_extraction_stack_system', 'claim_extraction_stack_with_topics')
   AND is_active = 1
 ORDER BY prompt_name;
