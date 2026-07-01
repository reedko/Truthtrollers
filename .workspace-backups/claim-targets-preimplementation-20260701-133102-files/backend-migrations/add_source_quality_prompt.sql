-- Add source quality scoring prompt to llm_prompts table
-- This moves the hardcoded prompt from sourceQualityScorer.js to database

INSERT INTO llm_prompts (prompt_key, prompt_name, system_prompt, user_prompt, schema_hint, description, created_at, updated_at)
VALUES (
  'source_quality_scoring',
  'Source Quality Scoring',
  'You are a source quality evaluator. Return only valid JSON with scores 0-10.',
  'Evaluate this source across multiple quality dimensions. Score each 0-10.

SOURCE METADATA:
- URL: {{url}}
- Domain: {{domain}}
- Author: {{author}}
- Publisher: {{publisher}}

CONTENT PREVIEW (first 2000 chars):
{{content_text}}

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
   10 = Extensive citations and primary sources
   5 = Some evidence, limited citations
   0 = Opinion without evidence

4. claim_specificity: Concrete testable claims vs vague rhetoric?
   10 = Specific, falsifiable claims with details
   5 = Mix of specific and vague
   0 = All vague assertions

RELIABILITY:
5. correction_behavior: Track record of corrections visible in this content?
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

Return JSON with these exact keys and brief reasoning.',
  '{
  "author_transparency": 5.0,
  "publisher_transparency": 5.0,
  "evidence_density": 5.0,
  "claim_specificity": 5.0,
  "correction_behavior": 5.0,
  "original_reporting": 5.0,
  "sensationalism_score": 5.0,
  "monetization_pressure": 5.0,
  "reasoning": "brief explanation"
}',
  'Scores source quality across 8 dimensions (removed domain_reputation as LLM cannot assess historical fact-check records)',
  NOW(),
  NOW()
)
ON DUPLICATE KEY UPDATE
  system_prompt = VALUES(system_prompt),
  user_prompt = VALUES(user_prompt),
  schema_hint = VALUES(schema_hint),
  description = VALUES(description),
  updated_at = NOW();
