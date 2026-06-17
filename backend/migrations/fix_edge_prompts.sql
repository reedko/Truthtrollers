-- ============================================================
-- Fix scrambled claim_extraction_edge_* prompts
-- Step 1: Deactivate the bad versions (keeps them as history)
-- ============================================================
UPDATE llm_prompts
SET is_active = FALSE
WHERE prompt_name IN (
  'claim_extraction_edge_system',
  'claim_extraction_edge_with_topics',
  'claim_extraction_edge_no_topics'
);

-- ============================================================
-- Step 2: Reserve 3 consecutive IDs from the current max
-- ============================================================
SET @id1 = (SELECT MAX(prompt_id) + 1 FROM llm_prompts);
SET @id2 = @id1 + 1;
SET @id3 = @id2 + 1;

-- SYSTEM PROMPT
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (
  @id1,
  'claim_extraction_edge_system',
  'system',
  'You are a precise claim extraction assistant. You must return strictly valid JSON.',
  '{}',
  (SELECT COALESCE(MAX(v), 0) + 1 FROM (SELECT version AS v FROM llm_prompts WHERE prompt_name = 'claim_extraction_edge_system') AS t),
  TRUE
);

-- WITH TOPICS (first batch)
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (
  @id2,
  'claim_extraction_edge_with_topics',
  'user',
  'TASKS\n1) Identify the single most general topic (max 2 words).\n2) List 2-5 specific subtopics under that topic.\n3) Extract the {{minClaims}}-{{maxClaims}} SHARPEST, most impactful verifiable claims from the text.\n\n   EDGE MODE - be ruthless. Only extract claims that meet ALL of:\n   a) SPECIFICITY: concrete numbers, dates, named entities, or clearly falsifiable assertions\n   b) CONTROVERSY: genuinely disputed, surprising, or counterintuitive\n   c) MATERIALITY: central to the article main argument or thesis\n\n   CRITICAL: Extract ATOMIC claims - break compound statements into separate claims:\n   - Study findings (what the study found, with specifics)\n   - Comparative claims (X compared to Y, X higher/lower than Y)\n   - Causal claims (X caused Y)\n   - Historical precedents (past events, previous decisions)\n   - Expert opinions/statements with concrete content\n\n   REQUIREMENTS:\n   - Each claim must be FALSIFIABLE: can be proven true or false with evidence\n   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)\n   - Phrase each claim as a complete, specific sentence\n   - Return only the top {{maxClaims}} highest-impact claims\n\n4) Extract any testimonials/first-person case studies if present (objects with "text", optional "name", optional "imageUrl").',
  '{"minClaims": 3, "maxClaims": 7}',
  (SELECT COALESCE(MAX(v), 0) + 1 FROM (SELECT version AS v FROM llm_prompts WHERE prompt_name = 'claim_extraction_edge_with_topics') AS t),
  TRUE
);

-- NO TOPICS (all later batches)
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (
  @id3,
  'claim_extraction_edge_no_topics',
  'user',
  'TASKS\n1) Extract the {{minClaims}}-{{maxClaims}} SHARPEST, most impactful verifiable claims from the text.\n\n   EDGE MODE - be ruthless. Only extract claims that meet ALL of:\n   a) SPECIFICITY: concrete numbers, dates, named entities, or clearly falsifiable assertions\n   b) CONTROVERSY: genuinely disputed, surprising, or counterintuitive\n   c) MATERIALITY: central to the article main argument or thesis\n\n   CRITICAL: Extract ATOMIC claims - break compound statements into separate claims.\n\n   REQUIREMENTS:\n   - Each claim must be FALSIFIABLE: can be proven true or false with evidence\n   - Each claim must be SELF-CONTAINED: resolve pronouns, include full context (time/place/subject/numbers)\n   - Phrase each claim as a complete, specific sentence\n   - Return only the top {{maxClaims}} highest-impact claims\n\n2) Do NOT invent topics or testimonials in this mode.',
  '{"minClaims": 3, "maxClaims": 7}',
  (SELECT COALESCE(MAX(v), 0) + 1 FROM (SELECT version AS v FROM llm_prompts WHERE prompt_name = 'claim_extraction_edge_no_topics') AS t),
  TRUE
);

-- ============================================================
-- Verify
-- ============================================================
SELECT prompt_name, version, is_active, LEFT(prompt_text, 100) AS preview
FROM llm_prompts
WHERE prompt_name LIKE 'claim_extraction_edge%'
ORDER BY prompt_name, version;
