-- ============================================================================
-- ADD MAX_CLAIMS TO LLM_PROMPTS TABLE
-- Control the maximum number of claims extracted from articles
-- ============================================================================

-- Add max_claims column to llm_prompts table
ALTER TABLE llm_prompts
ADD COLUMN max_claims INT DEFAULT 12 COMMENT 'Maximum number of claims to extract from article';

-- Update existing claim_extraction prompts with max_claims = 12
UPDATE llm_prompts
SET max_claims = 12
WHERE prompt_type LIKE 'claim_extraction%';
