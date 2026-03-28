-- ============================================================================
-- EVIDENCE QUERY GENERATION PROMPTS
-- Move hardcoded evidence query prompts from evidenceEngine.js to database
-- ============================================================================

-- Insert evidence_query_generation_system prompt
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

-- Insert evidence_query_generation_user prompt (standard mode)
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

-- Insert evidence_query_generation_user_balanced prompt (balanced search mode)
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
