-- SQL equivalent of backend/migrations/seed_reasoning_stack_prompts.js
-- Run after 2026-06-24-current-version-schema.sql.

SET @prompt_text = 'You extract a reasoning stack from content.
Return strict JSON only.

Build a hierarchy:
1. thesis
2. pillar claims
3. evidence claims
4. background claims

Keep claims atomic, self-contained, and verifiable.
Do not collapse distinct assertions into one item.
For source/reference content, use the case claims only as relevance context.
Do not invent facts that are not in the text.';
SET @params = JSON_OBJECT();
SET @prompt_id = (
  SELECT prompt_id FROM llm_prompts
  WHERE prompt_name = 'claim_extraction_stack_system'
  ORDER BY version DESC, prompt_id DESC LIMIT 1
);
UPDATE llm_prompts
   SET prompt_text = @prompt_text,
       parameters = @params,
       is_active = TRUE,
       max_claims = 12,
       min_sources = 2,
       max_sources = 4
 WHERE prompt_id = @prompt_id;
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active, max_claims, min_sources, max_sources)
SELECT next_id, 'claim_extraction_stack_system', 'system', @prompt_text, @params, 1, TRUE, 12, 2, 4
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE @prompt_id IS NULL;

SET @prompt_text = 'CONTENT ROLE: {{contentRole}}
EXTRACTION MODE: {{extractionMode}}

TASK
Extract a reasoning stack from the text.

Return JSON with:
{
  "generalTopic": "<string>",
  "specificTopics": ["<string>", "<string>"],
  "thesis": "<string>",
  "pillars": [
    {
      "id": "P1",
      "label": "<string>",
      "summary": "<string>",
      "centrality": 0-100,
      "claims": [
        {
          "text": "<claim>",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0-100,
          "verifiability": 0-100
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "<claim>",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "backgroundClaims": [
    {
      "text": "<claim>",
      "role": "background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "claims": [
    {
      "text": "<claim>",
      "role": "thesis|pillar|evidence|background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "testimonials": [
    { "text": "<testimonial1>", "name": "<optional>", "imageUrl": "<optional>" }
  ]
}

RULES
- CONTENT ROLE = case:
  - identify the article''s central thesis first.
  - group major supporting claims as pillars.
  - nest atomic evidence claims under the pillar they support.
  - background facts stay separate and should not outrank the thesis.

- CONTENT ROLE = source:
  - use the case claims only as relevance context if supplied by the caller.
  - extract claims actually present in the source.
  - prioritize claims that support, refute, or nuance the case claims.
  - do not invent or import the case claims into the source.

- EDGE: return only the sharpest, most consequential claims.
- RANKED: return the most important claims that build the reasoning stack.
- COMPREHENSIVE: return a fuller claim pool, but still keep the reasoning stack.
- Each claim must be atomic, self-contained, and directly verifiable.
- Return `claims` as the flat canonical list for persistence; keep nested fields for structure.
- If nothing fits a section, return an empty array.';
SET @params = JSON_OBJECT('minClaims', 5, 'maxClaims', 12);
SET @prompt_id = (
  SELECT prompt_id FROM llm_prompts
  WHERE prompt_name = 'claim_extraction_stack_with_topics'
  ORDER BY version DESC, prompt_id DESC LIMIT 1
);
UPDATE llm_prompts
   SET prompt_text = @prompt_text,
       parameters = @params,
       is_active = TRUE,
       max_claims = 12,
       min_sources = 2,
       max_sources = 4
 WHERE prompt_id = @prompt_id;
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active, max_claims, min_sources, max_sources)
SELECT next_id, 'claim_extraction_stack_with_topics', 'user', @prompt_text, @params, 1, TRUE, 12, 2, 4
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE @prompt_id IS NULL;

SET @prompt_text = 'CONTENT ROLE: {{contentRole}}
EXTRACTION MODE: {{extractionMode}}

TASK
Extract a reasoning stack from the text.

Return JSON with:
{
  "thesis": "<string>",
  "pillars": [
    {
      "id": "P1",
      "label": "<string>",
      "summary": "<string>",
      "centrality": 0-100,
      "claims": [
        {
          "text": "<claim>",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0-100,
          "verifiability": 0-100
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "<claim>",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "backgroundClaims": [
    {
      "text": "<claim>",
      "role": "background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ],
  "claims": [
    {
      "text": "<claim>",
      "role": "thesis|pillar|evidence|background",
      "parentId": "",
      "centrality": 0-100,
      "verifiability": 0-100
    }
  ]
}

RULES
- CONTENT ROLE = case:
  - identify the article''s central thesis first.
  - group major supporting claims as pillars.
  - nest atomic evidence claims under the pillar they support.
  - background facts stay separate and should not outrank the thesis.

- CONTENT ROLE = source:
  - use the case claims only as relevance context if supplied by the caller.
  - extract claims actually present in the source.
  - prioritize claims that support, refute, or nuance the case claims.
  - do not invent or import the case claims into the source.

- EDGE: return only the sharpest, most consequential claims.
- RANKED: return the most important claims that build the reasoning stack.
- COMPREHENSIVE: return a fuller claim pool, but still keep the reasoning stack.
- Each claim must be atomic, self-contained, and directly verifiable.
- Return `claims` as the flat canonical list for persistence; keep nested fields for structure.
- If nothing fits a section, return an empty array.';
SET @params = JSON_OBJECT('minClaims', 5, 'maxClaims', 12);
SET @prompt_id = (
  SELECT prompt_id FROM llm_prompts
  WHERE prompt_name = 'claim_extraction_stack_no_topics'
  ORDER BY version DESC, prompt_id DESC LIMIT 1
);
UPDATE llm_prompts
   SET prompt_text = @prompt_text,
       parameters = @params,
       is_active = TRUE,
       max_claims = 12,
       min_sources = 2,
       max_sources = 4
 WHERE prompt_id = @prompt_id;
INSERT INTO llm_prompts
  (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active, max_claims, min_sources, max_sources)
SELECT next_id, 'claim_extraction_stack_no_topics', 'user', @prompt_text, @params, 1, TRUE, 12, 2, 4
  FROM (SELECT COALESCE(MAX(prompt_id), 0) + 1 AS next_id FROM llm_prompts) ids
 WHERE @prompt_id IS NULL;

SELECT prompt_id, prompt_name, version, is_active, max_claims, min_sources, max_sources
  FROM llm_prompts
 WHERE prompt_name LIKE 'claim_extraction_stack%'
 ORDER BY prompt_name, version DESC;
