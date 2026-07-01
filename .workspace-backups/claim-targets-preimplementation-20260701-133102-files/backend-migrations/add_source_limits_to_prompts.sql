-- ============================================================================
-- ADD SOURCE LIMITS TO LLM_PROMPTS TABLE
-- Add min_sources and max_sources columns to control evidence gathering
-- ============================================================================

-- Add columns to llm_prompts table (ignore errors if columns already exist)
ALTER TABLE llm_prompts
ADD COLUMN min_sources INT DEFAULT 2 COMMENT 'Minimum number of sources to gather per claim',
ADD COLUMN max_sources INT DEFAULT 4 COMMENT 'Maximum number of sources to gather per claim';

-- Update existing prompts with reasonable defaults
UPDATE llm_prompts
SET min_sources = 2, max_sources = 4
WHERE prompt_type IN ('claim_extraction', 'evidence_search');

-- Reduce maxEvidenceCandidates in evidence_search_config to prevent pulling too many sources
UPDATE evidence_search_config
SET config_value = '{"high_quality_only":{"description":"Search only high-quality sources (Tavily + Bing)","queriesPerClaim":4,"maxEvidenceCandidates":3,"enableFringeSearch":false},"fringe_on_support":{"description":"High-quality sources + fringe sources when strong support found","queriesPerClaim":4,"maxEvidenceCandidates":3,"enableFringeSearch":true,"fringeTrigger":"support","fringeConfidenceThreshold":0.7,"topKFringeQueries":2,"topKFringeCandidates":2,"maxFringeEvidenceCandidates":2},"balanced_all_claims":{"description":"For every claim: 2 support, 2 refute, 2 nuance sources","queriesPerClaim":6,"supportQueries":2,"refuteQueries":2,"nuanceQueries":2,"maxEvidenceCandidates":6,"targetSupport":2,"targetRefute":2,"targetNuance":2,"enableBalancedSearch":true}}'
WHERE config_key = 'mode_config';
