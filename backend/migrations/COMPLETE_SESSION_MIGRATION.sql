-- ============================================================================
-- COMPLETE SESSION MIGRATION - All Database Changes from Today's Session
-- Date: 2026-03-27
-- ============================================================================
-- This file combines ALL database changes made during today's session:
-- 1. Add max_claims column to llm_prompts
-- 2. Add min_sources and max_sources columns to llm_prompts
-- 3. Add 3 evidence query generation prompts
-- 4. Add 10 remaining hardcoded prompts (source quality, triage, etc.)
-- ============================================================================

-- ============================================================================
-- PART 1: ADD max_claims COLUMN
-- ============================================================================

ALTER TABLE llm_prompts
ADD COLUMN IF NOT EXISTS max_claims INT DEFAULT 12 COMMENT 'Maximum number of claims to extract from article';

-- Set default max_claims for claim extraction prompts
UPDATE llm_prompts
SET max_claims = 12
WHERE prompt_type LIKE 'claim_extraction%'
  AND max_claims IS NULL;

-- ============================================================================
-- PART 2: ADD min_sources AND max_sources COLUMNS
-- ============================================================================

ALTER TABLE llm_prompts
ADD COLUMN IF NOT EXISTS min_sources INT DEFAULT 2 COMMENT 'Minimum number of sources to gather per claim',
ADD COLUMN IF NOT EXISTS max_sources INT DEFAULT 4 COMMENT 'Maximum number of sources to gather per claim';

-- Set default source limits for evidence search prompts
UPDATE llm_prompts
SET min_sources = 2, max_sources = 4
WHERE prompt_type IN ('claim_extraction', 'evidence_search')
  AND min_sources IS NULL
  AND max_sources IS NULL;

-- Update evidence search configuration with new mode settings
UPDATE evidence_search_config
SET config_value = '{"high_quality_only":{"description":"Search only high-quality sources (Tavily + Bing)","queriesPerClaim":4,"maxEvidenceCandidates":3,"enableFringeSearch":false},"fringe_on_support":{"description":"High-quality sources + fringe sources when strong support found","queriesPerClaim":4,"maxEvidenceCandidates":3,"enableFringeSearch":true,"fringeTrigger":"support","fringeConfidenceThreshold":0.7,"topKFringeQueries":2,"topKFringeCandidates":2,"maxFringeEvidenceCandidates":2},"balanced_all_claims":{"description":"For every claim: 2 support, 2 refute, 2 nuance sources","queriesPerClaim":6,"supportQueries":2,"refuteQueries":2,"nuanceQueries":2,"maxEvidenceCandidates":6,"targetSupport":2,"targetRefute":2,"targetNuance":2,"enableBalancedSearch":true}}'
WHERE config_key = 'mode_config';

-- ============================================================================
-- PART 3: EVIDENCE QUERY GENERATION PROMPTS (3 prompts)
-- ============================================================================

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  100,
  'evidence_query_generation_system',
  'system',
  'You generate diverse, high-precision search queries for fact-checking. CRITICAL: You must create queries designed to find sources that SUPPORT, REFUTE, and provide NUANCED perspectives on the claim.',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  101,
  'evidence_query_generation_user',
  'user',
  'Claim: {{claimText}}
Context: {{context}}

Task: Produce {{n}} queries across intents with the following distribution:
- At least 2 queries designed to find sources that SUPPORT the claim (prefer 3)
- At least 2 queries designed to find sources that REFUTE the claim (prefer 3)
- At least 1 query designed to find sources that provide NUANCED perspective on the claim (prefer 3)
- The remaining queries can cover background or factbox information

IMPORTANT: Design your queries to actively seek out sources with different perspectives. For refute queries, look for credible counterarguments, debunking sites, fact-checks, or alternative evidence. For support queries, look for sources that would confirm or provide evidence for the claim. For nuance queries, look for sources that provide context, caveats, or partial support/refutation.',
  '{"n": 6}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  102,
  'evidence_query_generation_user_balanced',
  'user',
  'Claim: {{claimText}}
Context: {{context}}

Task: Produce EXACTLY {{n}} queries with BALANCED intent distribution:
- {{supportQueries}} queries to find sources that SUPPORT the claim
- {{refuteQueries}} queries to find sources that REFUTE the claim
- {{nuanceQueries}} queries to find sources that provide NUANCED perspective

CRITICAL: Design queries to actively find OPPOSING viewpoints. For refute queries, search for debunking, fact-checks, counterarguments, alternative interpretations. For support queries, search for confirmatory evidence, corroboration, similar findings. For nuance queries, search for context, caveats, limitations, partial agreements.',
  '{"n": 9, "supportQueries": 3, "refuteQueries": 3, "nuanceQueries": 3}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

-- ============================================================================
-- PART 4: SOURCE QUALITY SCORER PROMPTS (2 prompts)
-- ============================================================================

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  103,
  'source_quality_evaluation_system',
  'system',
  'You are a source quality evaluator. Return only valid JSON with scores 0-10 (matching GameSpace scoring scale).',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  104,
  'source_quality_evaluation_user',
  'user',
  'Evaluate this source across multiple quality dimensions. Score each 0-10 (same scale as GameSpace points).

SOURCE METADATA:
- URL: {{url}}
- Domain: {{domain}}
- Author: {{author}}
- Publisher: {{publisher}}
- Date: {{date}}
{{citationInfo}}

CONTENT PREVIEW (first 2000 chars):
{{contentPreview}}

SCORE EACH DIMENSION (0-10 scale):

TRANSPARENCY:
1. author_transparency: Named author with credentials and traceable identity?
   10 = Named expert with verifiable credentials
   5 = Named author, unclear credentials
   0 = Anonymous or pseudonymous

2. publisher_transparency: Clear about page, editorial standards, ownership?
   10 = Major publication with clear standards
   5 = Some transparency, unclear ownership
   0 = No transparency, hidden ownership

EVIDENCE QUALITY:
3. evidence_density: Citations, documents, data, primary source quotations?
   {{citationNote}}
   10 = Extensive citations and primary sources (15+ citations)
   5 = Some evidence, limited citations (3-10 citations)
   0 = Opinion without evidence (0-2 citations)

4. claim_specificity: Concrete testable claims vs vague rhetoric?
   10 = Specific, falsifiable claims with details
   5 = Mix of specific and vague
   0 = All vague assertions

RELIABILITY:
5. correction_behavior: Corrections/updates visible in this content?
   10 = Clear corrections/updates visible
   5 = Some corrections visible
   0 = No corrections visible

ORIGINALITY:
6. original_reporting: Firsthand reporting vs recycled assertions?
   10 = Original investigative reporting
   5 = Mix of original and aggregated
   0 = All recycled content, no original work

RISK INDICATORS (higher = riskier):
7. sensationalism_score: Emotional framing, certainty inflation, outrage bait?
   10 = Extreme sensationalism, all-caps, outrage maximization
   5 = Some emotional language, moderate framing
   0 = Neutral, measured tone

8. monetization_pressure: Visible signs of aggressive monetization?
   10 = Heavy affiliate links, clickbait structure
   5 = Some promotional content
   0 = Minimal commercial pressure evident

Return JSON:
{
  "author_transparency": 0-10,
  "publisher_transparency": 0-10,
  "evidence_density": 0-10,
  "claim_specificity": 0-10,
  "correction_behavior": 0-10,
  "original_reporting": 0-10,
  "sensationalism_score": 0-10,
  "monetization_pressure": 0-10,
  "reasoning": "brief explanation"
}',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

-- ============================================================================
-- PART 5: CLAIM TRIAGE ENGINE PROMPTS (2 prompts)
-- ============================================================================

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  105,
  'claim_triage_system',
  'system',
  'You are a claim triage classifier. Return only valid JSON.',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  106,
  'claim_triage_user',
  'user',
  'Given this extracted claim and retrieval evidence, determine whether it should proceed to public evaluation.

CLAIM: "{{claim}}"

RETRIEVAL EVIDENCE:
- Retrieved source claims: {{retrieval_count}}
- Distinct sources/domains: {{distinct_source_count}}
- Max relevance: {{max_relevance}}
- Avg top-3 relevance: {{avg_top3_relevance}}
- Quality-weighted evidence: {{quality_weighted_evidence_mass}}

CLAIM PROPERTIES:
- Centrality to source: {{claim_centrality}}
- Specificity: {{claim_specificity}}
- Consequence: {{claim_consequence}}
- Contestability: {{claim_contestability}}
- Novelty: {{claim_novelty}}

TRIAGE OPTIONS:
1. ACTIVE_EVALUATION - Has enough evidence, worth public evaluation
2. BACKGROUND_CLAIM - Low salience/consequence, uncontested
3. INSUFFICIENT_RELEVANT_SOURCES - Not enough retrieved source claims
4. NEEDS_REWRITE_FOR_RETRIEVAL - Poorly phrased for retrieval
5. NOVEL_BUT_IMPORTANT - Sparse evidence but high centrality/consequence
6. LOW_PRIORITY - Some evidence but weak

CONSIDER:
- Number of genuinely relevant retrieved source claims
- Diversity of sources (distinct domains/documents)
- Whether the claim is central to the source case
- Whether the claim is specific and contestable
- Whether it has real-world consequence
- Whether retrieval failure appears due to weak phrasing vs lack of interest

Return JSON: {
  "triage_status": "ACTIVE_EVALUATION|BACKGROUND_CLAIM|...",
  "reasoning": "brief explanation of decision",
  "confidence": 0.0-1.0
}',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

-- ============================================================================
-- PART 6: CLAIM PROPERTIES EVALUATION PROMPTS (2 prompts)
-- ============================================================================

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  107,
  'claim_properties_evaluation_system',
  'system',
  'You are a claim property evaluator. Return only valid JSON with scores 0.00-1.00.',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  108,
  'claim_properties_evaluation_user',
  'user',
  'Evaluate this claim across multiple dimensions. Score each 0.00-1.00.

CLAIM: "{{claim_text}}"

SOURCE DOCUMENT PREVIEW (first 1500 chars):
{{source_document_preview}}

SCORE EACH DIMENSION (0.00-1.00):

1. claim_centrality: How central is this claim to the source document''s argument?
   1.00 = Core thesis or primary claim
   0.50 = Important supporting claim
   0.00 = Tangential mention or background

2. claim_specificity: How specific and falsifiable is this claim?
   1.00 = Concrete, specific, includes numbers/dates/names
   0.50 = Somewhat specific but vague details
   0.00 = Vague, generic, subjective opinion

3. claim_consequence: What are the real-world stakes of this claim?
   1.00 = High consequence (public health, major policy, safety)
   0.50 = Moderate consequence (personal decisions, local impact)
   0.00 = Low consequence (trivial, low-stakes)

4. claim_contestability: Would reasonable people dispute this claim?
   1.00 = Highly contested, significant disagreement
   0.50 = Some debate, mixed evidence
   0.00 = Widely accepted fact or obvious statement

5. claim_novelty: Is this a novel/obscure/fringe assertion?
   1.00 = Novel, unusual, rarely discussed
   0.50 = Somewhat novel, emerging discussion
   0.00 = Well-known, commonly discussed

Return JSON:
{
  "claim_centrality": 0.00-1.00,
  "claim_specificity": 0.00-1.00,
  "claim_consequence": 0.00-1.00,
  "claim_contestability": 0.00-1.00,
  "claim_novelty": 0.00-1.00,
  "reasoning": "brief explanation"
}',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

-- ============================================================================
-- PART 7: CLAIM MATCHING PROMPTS (2 prompts)
-- ============================================================================

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  109,
  'claim_matching_system',
  'system',
  'You are a fact-checking assistant that analyzes how reference claims relate to task claims.

For each reference claim, determine:
1. Which task claim(s) it addresses (if any)
2. The stance: support, refute, nuance, or insufficient
3. Veracity score (0-1): How truthful/reliable is this reference claim?
   - 0.9-1.0: Highly verified, strong evidence
   - 0.7-0.89: Well-supported, credible sources
   - 0.5-0.69: Moderate support, some evidence
   - 0.3-0.49: Weak support, limited evidence
   - 0.0-0.29: Unverified, questionable, or contradicted
4. Confidence (0.15-0.98): How confident are you in this match?
5. Support level (-1.2 to +1.2): Directional strength
   - Positive: supports the task claim
   - Negative: refutes the task claim
   - Magnitude: strength of support/refutation

Return ONLY matches where the reference claim meaningfully addresses a task claim.',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  110,
  'claim_matching_user',
  'user',
  'TASK CLAIMS (what we''re fact-checking):
{{taskClaims}}

REFERENCE CLAIMS (from evidence source):
{{referenceClaims}}

For each reference claim that addresses a task claim, return a match object.
ONLY include matches where there''s a clear relationship.

Return JSON array of matches:
[
  {
    "task_claim_index": 0-based index,
    "reference_claim_index": 0-based index,
    "stance": "support|refute|nuance|insufficient",
    "veracity": 0.0-1.0,
    "confidence": 0.15-0.98,
    "support_level": -1.2 to +1.2,
    "reasoning": "brief explanation"
  }
]',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

-- ============================================================================
-- PART 8: CLAIM RELEVANCE ASSESSMENT PROMPTS (2 prompts)
-- ============================================================================

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  111,
  'claim_relevance_assessment_system',
  'system',
  'You are assessing whether a reference claim is relevant to a task claim.

Guidelines:
- "support": Reference claim provides evidence FOR the task claim
- "refute": Reference claim provides evidence AGAINST the task claim
- "nuance": Reference claim adds context or partial support/refutation
- "insufficient": Reference claim is not relevant or doesn''t provide meaningful evidence

- confidence: 0-1 (how certain you are of the stance)
- quality: 0-1.2 (how strong/useful the reference claim is as evidence)
- rationale: 1-2 sentences explaining WHY this stance applies',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

INSERT INTO llm_prompts (
  prompt_id,
  prompt_name,
  prompt_type,
  prompt_text,
  parameters,
  version,
  is_active
) VALUES (
  112,
  'claim_relevance_assessment_user',
  'user',
  'TASK CLAIM:
"{{taskClaimText}}"

REFERENCE CLAIM:
"{{referenceClaimText}}"

Analyze whether the reference claim supports, refutes, nuances, or is insufficient for evaluating the task claim.{{customInstructions}}

Return JSON:
{
  "stance": "support|refute|nuance|insufficient",
  "confidence": 0.0-1.0,
  "quality": 0.0-1.2,
  "rationale": "brief explanation"
}',
  '{}',
  1,
  TRUE
) ON DUPLICATE KEY UPDATE
  prompt_text = VALUES(prompt_text),
  parameters = VALUES(parameters);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Summary:
-- - Added max_claims column to llm_prompts table
-- - Added min_sources and max_sources columns to llm_prompts table
-- - Updated evidence_search_config with new mode settings
-- - Added 15 total prompts to database (prompt_id 100-112):
--   * 3 evidence query generation prompts (100-102)
--   * 2 source quality evaluation prompts (103-104)
--   * 2 claim triage prompts (105-106)
--   * 2 claim properties evaluation prompts (107-108)
--   * 2 claim matching prompts (109-110)
--   * 2 claim relevance assessment prompts (111-112)
-- ============================================================================
