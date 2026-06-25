# Claim Extraction Prompt Assembly

Generated from live active DB rows only after the lean prompt replacement. Migration scripts were not used as prompt sources.

## Runtime Source Map

- `backend/src/core/processTaskClaims.js:60-89`: determines extraction mode. Live `evidence_search_config.extraction_mode` is `edge`.
- `backend/src/core/processTaskClaims.js:95-108`: sets `contentRole` to `case` for task content and `source` for reference content, then calls `analyzeContent`.
- `backend/src/core/claimsEngine.js:35-46`: normalizes `extractionMode`, `contentRole`, topic suffix, and replaces DB prompt tokens.
- `backend/src/core/claimsEngine.js:63-93`: active stack prompts are preferred before legacy edge/ranked/comprehensive prompts.
- `backend/src/core/promptManager.js:33-39`: reads live `llm_prompts` rows where `is_active = TRUE`.
- `backend/src/core/claimsEngine.js:326-334`: loads `claim_extraction_source_context_instruction` from DB when `taskClaimsContext` is present; the inline string is now only the no-DB fallback.
- `backend/src/core/claimsEngine.js:347-357`: builds the user prompt around DB prompt text and article text.
- `backend/src/core/claimsEngine.js:359-365`: claim extraction sends `schemaHint = ""`, so no hardcoded JSON schema suffix is appended.
- `backend/src/core/openAiLLM.js:121-135`: creates final OpenAI messages and appends schema hints only when non-empty.
- `backend/src/core/runEvidenceEngine.js:85-121`: builds transient search targets from `searchText` / attribution patterns.
- `backend/src/core/evidenceEngine.js:40-52`: uses direct search targets when present instead of another query-generation LLM call.

## Active DB Prompt Selection

```json
{
  "liveExtractionModeConfig": [
    {
      "config_key": "extraction_mode",
      "config_value": "edge"
    }
  ],
  "activeStackPromptsUsed": [
    {
      "prompt_name": "claim_extraction_stack_system",
      "prompt_type": "system",
      "version": 3,
      "chars": 1913,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 12,
        "minClaims": 5
      }
    },
    {
      "prompt_name": "claim_extraction_stack_with_topics",
      "prompt_type": "user",
      "version": 3,
      "chars": 2609,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 12,
        "minClaims": 5
      }
    },
    {
      "prompt_name": "claim_extraction_stack_no_topics",
      "prompt_type": "user",
      "version": 2,
      "chars": 2087,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 12,
        "minClaims": 5
      }
    },
    {
      "prompt_name": "claim_extraction_source_context_instruction",
      "prompt_type": "user",
      "version": 1,
      "chars": 1242,
      "max_claims": 12,
      "parameters": {}
    }
  ],
  "activeLegacyPromptsPresentButNotUsedByCurrentStackPath": [
    {
      "prompt_name": "claim_extraction_edge_for_source_system",
      "prompt_type": "system",
      "version": 5,
      "is_active": 1,
      "chars": 212,
      "max_claims": 12,
      "parameters": {}
    },
    {
      "prompt_name": "claim_extraction_edge_system",
      "prompt_type": "system",
      "version": 7,
      "is_active": 1,
      "chars": 82,
      "max_claims": 12,
      "parameters": {}
    },
    {
      "prompt_name": "claim_extraction_edge_with_topics",
      "prompt_type": "user",
      "version": 6,
      "is_active": 1,
      "chars": 1316,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 7,
        "minClaims": 3
      }
    },
    {
      "prompt_name": "claim_extraction_edge_no_topics",
      "prompt_type": "user",
      "version": 6,
      "is_active": 1,
      "chars": 867,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 7,
        "minClaims": 3
      }
    },
    {
      "prompt_name": "claim_extraction_ranked_system",
      "prompt_type": "system",
      "version": 1,
      "is_active": 1,
      "chars": 82,
      "max_claims": 12,
      "parameters": {}
    },
    {
      "prompt_name": "claim_extraction_ranked_with_topics",
      "prompt_type": "user",
      "version": 6,
      "is_active": 1,
      "chars": 9784,
      "max_claims": 12,
      "parameters": "{\"max_claims\": 9}"
    },
    {
      "prompt_name": "claim_extraction_ranked_no_topics",
      "prompt_type": "user",
      "version": 6,
      "is_active": 1,
      "chars": 9445,
      "max_claims": 12,
      "parameters": "\"{\\\"maxClaims\\\": 12, \\\"minClaims\\\": 3}\""
    },
    {
      "prompt_name": "claim_extraction_comprehensive_with_topics",
      "prompt_type": "user",
      "version": 1,
      "is_active": 1,
      "chars": 869,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 12,
        "minClaims": 5
      }
    },
    {
      "prompt_name": "claim_extraction_comprehensive_no_topics",
      "prompt_type": "user",
      "version": 1,
      "is_active": 1,
      "chars": 641,
      "max_claims": 12,
      "parameters": {
        "maxClaims": 12,
        "minClaims": 5
      }
    }
  ]
}
```


## [A. ALL THE PROMPTS FOR THE FIRST CHUNK CLAIM EXTRACTION - TASK/CASE CONTENT]

Runtime conditions:
```json
{
  "contentRole": "case",
  "includeTopicsAndTestimonials": true,
  "taskClaimsContext": "absent",
  "extractionModeFromLiveConfig": "edge",
  "schemaSource": "DB prompt text only; claim extraction passes schemaHint=\"\" and appends no hardcoded schema."
}
```

[1. System prompt from DB field prompt_text with prompt_name=claim_extraction_stack_system]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_system",
  "prompt_type": "system",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 3,
  "is_active": 1,
  "chars": 1913,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
You extract atomic claims from scraped content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Extract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.

Each claim must be atomic, self-contained, and specific enough to search.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.

Classify each claim with one role:
thesis, pillar, pillar_support, evidence, or background.

Use background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.

A pillar is a major argument branch.
A pillar_support claim connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

Give high priority to claims involving:
fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.

When a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.

Example:
Displayed claim:
"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study."

Good searchText:
"William Thompson CDC MMR autism DeStefano Hooker data manipulation"

Bad searchText:
"William Thompson said CDC destroyed data and therefore vaccines cause autism"

Return only valid JSON.
```


[2. User prompt from DB field prompt_text with prompt_name=claim_extraction_stack_with_topics]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_with_topics",
  "prompt_type": "user",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 3,
  "is_active": 1,
  "chars": 2609,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
Analyze the article text and return strict JSON using exactly this structure.

Extract what the article claims. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the article.

Return between 5 and 12 total items in the flat claims list unless the text clearly contains fewer worthy claims.

OUTPUT:
{
  "generalTopic": "",
  "specificTopics": [],
  "thesis": "",
  "pillars": [
    {
      "id": "P1",
      "label": "",
      "summary": "",
      "centrality": 0,
      "claims": [
        {
          "text": "",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0,
          "verifiability": 0,
          "priority": 0,
          "searchText": ""
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "backgroundClaims": [
    {
      "text": "",
      "role": "background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "claims": [
    {
      "text": "",
      "role": "thesis|pillar|pillar_support|evidence|background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "testimonials": [
    {
      "text": "",
      "name": "",
      "imageUrl": ""
    }
  ]
}

RULES:
- The flat "claims" array is the canonical list for persistence.
- Nested pillar/evidence/background arrays are for structure.
- Every important nested claim should also appear in "claims".
- Do not use role values other than thesis, pillar, pillar_support, evidence, or background.
- Do not create fallibility_critical as a role.
- Use priority to mark claims that are especially important to verify.
- Use centrality for importance to the article's argument.
- Use verifiability for how externally checkable the claim is.
- Use searchText as a compact search-ready version of the claim.
- searchText should preserve names, dates, studies, agencies, and distinctive terms.
- If a claim is compound, searchText should target the most useful search formulation, not repeat the whole sentence.
- If a claim says "X said Y", make searchText focus on attribution and key entities: X, Y keywords, study/event names.
- Background claims should have low priority unless they contain concrete dates, numbers, laws, studies, or named events.
- If nothing fits a section, return an empty array.
```


[3. Hardcoded wrapper from backend/src/core/claimsEngine.js lines 347-357]
```text
You are a fact-checking assistant.

${tasks}

${testimonialsText}

TEXT:
${chunk}
```

[4. Empty schemaHint from backend/src/core/claimsEngine.js line 359]
```text
const schemaHint = "";
```

[5. OpenAI message assembly from backend/src/core/openAiLLM.js lines 121-135]
```text
messages: [
  { role: "system", content: system },
  {
    role: "user",
    content: schemaHint
      ? user + "\n\nReturn ONLY valid JSON. JSON shape hint: " + schemaHint
      : user,
  },
]
```

[FINAL API-READY MESSAGE ASSEMBLY]

The phrase `messages[0] role=system` means the first chat message sent to OpenAI has role `system`; `messages[1] role=user` means the second chat message has role `user`. For claim extraction, no hardcoded schema suffix is appended because `schemaHint` is empty.

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "response_format": {
    "type": "json_object"
  },
  "messages": [
    {
      "role": "system",
      "content": "You extract atomic claims from scraped content.\n\nReturn strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.\n\nExtract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.\n\nEach claim must be atomic, self-contained, and specific enough to search.\n\nPreserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.\n\nClassify each claim with one role:\nthesis, pillar, pillar_support, evidence, or background.\n\nUse background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.\n\nA pillar is a major argument branch.\nA pillar_support claim connects a pillar to evidence.\nAn evidence claim is a specific factual assertion offered as proof.\nA background claim is contextual information that does not directly carry the argument.\n\nGive high priority to claims involving:\nfraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.\n\nWhen a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.\n\nExample:\nDisplayed claim:\n\"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study.\"\n\nGood searchText:\n\"William Thompson CDC MMR autism DeStefano Hooker data manipulation\"\n\nBad searchText:\n\"William Thompson said CDC destroyed data and therefore vaccines cause autism\"\n\nReturn only valid JSON."
    },
    {
      "role": "user",
      "content": "You are a fact-checking assistant.\n\nAnalyze the article text and return strict JSON using exactly this structure.\n\nExtract what the article claims. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the article.\n\nReturn between 5 and 12 total items in the flat claims list unless the text clearly contains fewer worthy claims.\n\nOUTPUT:\n{\n  \"generalTopic\": \"\",\n  \"specificTopics\": [],\n  \"thesis\": \"\",\n  \"pillars\": [\n    {\n      \"id\": \"P1\",\n      \"label\": \"\",\n      \"summary\": \"\",\n      \"centrality\": 0,\n      \"claims\": [\n        {\n          \"text\": \"\",\n          \"role\": \"pillar_support\",\n          \"parentId\": \"P1\",\n          \"centrality\": 0,\n          \"verifiability\": 0,\n          \"priority\": 0,\n          \"searchText\": \"\"\n        }\n      ]\n    }\n  ],\n  \"evidenceClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"evidence\",\n      \"parentId\": \"P1\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"backgroundClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"claims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"thesis|pillar|pillar_support|evidence|background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"testimonials\": [\n    {\n      \"text\": \"\",\n      \"name\": \"\",\n      \"imageUrl\": \"\"\n    }\n  ]\n}\n\nRULES:\n- The flat \"claims\" array is the canonical list for persistence.\n- Nested pillar/evidence/background arrays are for structure.\n- Every important nested claim should also appear in \"claims\".\n- Do not use role values other than thesis, pillar, pillar_support, evidence, or background.\n- Do not create fallibility_critical as a role.\n- Use priority to mark claims that are especially important to verify.\n- Use centrality for importance to the article's argument.\n- Use verifiability for how externally checkable the claim is.\n- Use searchText as a compact search-ready version of the claim.\n- searchText should preserve names, dates, studies, agencies, and distinctive terms.\n- If a claim is compound, searchText should target the most useful search formulation, not repeat the whole sentence.\n- If a claim says \"X said Y\", make searchText focus on attribution and key entities: X, Y keywords, study/event names.\n- Background claims should have low priority unless they contain concrete dates, numbers, laws, studies, or named events.\n- If nothing fits a section, return an empty array.\n\nTEXT:\n<<<ARTICLE_TEXT_CHUNK>>>"
    }
  ]
}
```

Comments:
- There is now one extraction schema source: the selected DB user prompt.
- `fallibilityCriticalClaims` and `searchAssertions` are no longer requested by the active stack DB prompts.
- The flat `claims` array remains canonical for persistence.
- Optional `priority` and `searchText` fields are parsed in memory and used by source search.



## [B. ALL THE PROMPTS FOR SUBSEQUENT CHUNK CLAIM EXTRACTIONS - TASK/CASE CONTENT]

Runtime conditions:
```json
{
  "contentRole": "case",
  "includeTopicsAndTestimonials": false,
  "taskClaimsContext": "absent",
  "extractionModeFromLiveConfig": "edge",
  "schemaSource": "DB prompt text only; claim extraction passes schemaHint=\"\" and appends no hardcoded schema."
}
```

[1. System prompt from DB field prompt_text with prompt_name=claim_extraction_stack_system]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_system",
  "prompt_type": "system",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 3,
  "is_active": 1,
  "chars": 1913,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
You extract atomic claims from scraped content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Extract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.

Each claim must be atomic, self-contained, and specific enough to search.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.

Classify each claim with one role:
thesis, pillar, pillar_support, evidence, or background.

Use background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.

A pillar is a major argument branch.
A pillar_support claim connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

Give high priority to claims involving:
fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.

When a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.

Example:
Displayed claim:
"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study."

Good searchText:
"William Thompson CDC MMR autism DeStefano Hooker data manipulation"

Bad searchText:
"William Thompson said CDC destroyed data and therefore vaccines cause autism"

Return only valid JSON.
```


[2. User prompt from DB field prompt_text with prompt_name=claim_extraction_stack_no_topics]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_no_topics",
  "prompt_type": "user",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 2,
  "is_active": 1,
  "chars": 2087,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
CONTENT ROLE: case
EXTRACTION MODE: edge

Extract a reasoning stack from the text.

Return strict JSON only.

OUTPUT:
{
  "thesis": "",
  "pillars": [
    {
      "id": "P1",
      "label": "",
      "summary": "",
      "centrality": 0,
      "claims": [
        {
          "text": "",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0,
          "verifiability": 0,
          "priority": 0,
          "searchText": ""
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "backgroundClaims": [
    {
      "text": "",
      "role": "background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "claims": [
    {
      "text": "",
      "role": "thesis|pillar|pillar_support|evidence|background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ]
}

RULES:
- Return `claims` as the flat canonical list for persistence.
- Allowed roles only: thesis, pillar, pillar_support, evidence, background.
- EDGE: return only the sharpest, most consequential claims.
- RANKED: return the most important claims that build the reasoning stack.
- COMPREHENSIVE: return a fuller claim pool, but keep claims atomic.
- Each claim must be atomic, self-contained, and directly verifiable when possible.
- Use priority 80-100 for hinge claims, named allegations, named studies, statistics, causal harm claims, misconduct claims, correction/retraction claims, or claims likely to drive source search.
- Use searchText for the query seed.
- If a claim is compound, simplify searchText into the best searchable form.
- If a claim says "X said/alleged Y", searchText should include X, the key Y terms, and any named study/event, rather than the whole sentence.
- If nothing fits a section, return an empty array.
```


[3. Hardcoded wrapper from backend/src/core/claimsEngine.js lines 347-357]
```text
You are a fact-checking assistant.

${tasks}

${testimonialsText}

TEXT:
${chunk}
```

[4. Empty schemaHint from backend/src/core/claimsEngine.js line 359]
```text
const schemaHint = "";
```

[5. OpenAI message assembly from backend/src/core/openAiLLM.js lines 121-135]
```text
messages: [
  { role: "system", content: system },
  {
    role: "user",
    content: schemaHint
      ? user + "\n\nReturn ONLY valid JSON. JSON shape hint: " + schemaHint
      : user,
  },
]
```

[FINAL API-READY MESSAGE ASSEMBLY]

The phrase `messages[0] role=system` means the first chat message sent to OpenAI has role `system`; `messages[1] role=user` means the second chat message has role `user`. For claim extraction, no hardcoded schema suffix is appended because `schemaHint` is empty.

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "response_format": {
    "type": "json_object"
  },
  "messages": [
    {
      "role": "system",
      "content": "You extract atomic claims from scraped content.\n\nReturn strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.\n\nExtract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.\n\nEach claim must be atomic, self-contained, and specific enough to search.\n\nPreserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.\n\nClassify each claim with one role:\nthesis, pillar, pillar_support, evidence, or background.\n\nUse background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.\n\nA pillar is a major argument branch.\nA pillar_support claim connects a pillar to evidence.\nAn evidence claim is a specific factual assertion offered as proof.\nA background claim is contextual information that does not directly carry the argument.\n\nGive high priority to claims involving:\nfraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.\n\nWhen a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.\n\nExample:\nDisplayed claim:\n\"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study.\"\n\nGood searchText:\n\"William Thompson CDC MMR autism DeStefano Hooker data manipulation\"\n\nBad searchText:\n\"William Thompson said CDC destroyed data and therefore vaccines cause autism\"\n\nReturn only valid JSON."
    },
    {
      "role": "user",
      "content": "You are a fact-checking assistant.\n\nCONTENT ROLE: case\nEXTRACTION MODE: edge\n\nExtract a reasoning stack from the text.\n\nReturn strict JSON only.\n\nOUTPUT:\n{\n  \"thesis\": \"\",\n  \"pillars\": [\n    {\n      \"id\": \"P1\",\n      \"label\": \"\",\n      \"summary\": \"\",\n      \"centrality\": 0,\n      \"claims\": [\n        {\n          \"text\": \"\",\n          \"role\": \"pillar_support\",\n          \"parentId\": \"P1\",\n          \"centrality\": 0,\n          \"verifiability\": 0,\n          \"priority\": 0,\n          \"searchText\": \"\"\n        }\n      ]\n    }\n  ],\n  \"evidenceClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"evidence\",\n      \"parentId\": \"P1\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"backgroundClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"claims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"thesis|pillar|pillar_support|evidence|background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ]\n}\n\nRULES:\n- Return `claims` as the flat canonical list for persistence.\n- Allowed roles only: thesis, pillar, pillar_support, evidence, background.\n- EDGE: return only the sharpest, most consequential claims.\n- RANKED: return the most important claims that build the reasoning stack.\n- COMPREHENSIVE: return a fuller claim pool, but keep claims atomic.\n- Each claim must be atomic, self-contained, and directly verifiable when possible.\n- Use priority 80-100 for hinge claims, named allegations, named studies, statistics, causal harm claims, misconduct claims, correction/retraction claims, or claims likely to drive source search.\n- Use searchText for the query seed.\n- If a claim is compound, simplify searchText into the best searchable form.\n- If a claim says \"X said/alleged Y\", searchText should include X, the key Y terms, and any named study/event, rather than the whole sentence.\n- If nothing fits a section, return an empty array.\n\nTEXT:\n<<<ARTICLE_TEXT_CHUNK>>>"
    }
  ]
}
```

Comments:
- There is now one extraction schema source: the selected DB user prompt.
- `fallibilityCriticalClaims` and `searchAssertions` are no longer requested by the active stack DB prompts.
- The flat `claims` array remains canonical for persistence.
- Optional `priority` and `searchText` fields are parsed in memory and used by source search.



## [C. ALL THE PROMPTS FOR THE FIRST CHUNK CLAIM EXTRACTION - SOURCE/REFERENCE CONTENT WITH TASK CLAIM CONTEXT]

Runtime conditions:
```json
{
  "contentRole": "source",
  "includeTopicsAndTestimonials": true,
  "taskClaimsContext": "present",
  "extractionModeFromLiveConfig": "edge",
  "schemaSource": "DB prompt text only; claim extraction passes schemaHint=\"\" and appends no hardcoded schema."
}
```

[1. System prompt from DB field prompt_text with prompt_name=claim_extraction_stack_system]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_system",
  "prompt_type": "system",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 3,
  "is_active": 1,
  "chars": 1913,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
You extract atomic claims from scraped content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Extract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.

Each claim must be atomic, self-contained, and specific enough to search.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.

Classify each claim with one role:
thesis, pillar, pillar_support, evidence, or background.

Use background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.

A pillar is a major argument branch.
A pillar_support claim connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

Give high priority to claims involving:
fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.

When a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.

Example:
Displayed claim:
"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study."

Good searchText:
"William Thompson CDC MMR autism DeStefano Hooker data manipulation"

Bad searchText:
"William Thompson said CDC destroyed data and therefore vaccines cause autism"

Return only valid JSON.
```


[2. Source context prompt from DB field prompt_text with prompt_name=claim_extraction_source_context_instruction]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_source_context_instruction",
  "prompt_type": "user",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 1,
  "is_active": 1,
  "chars": 1242,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {}
}
```

```text
⚠️ CONTEXT - The SOURCE article being fact-checked contains these claims:
  1. "<<<TASK_CLAIM_1>>>"
  2. "<<<TASK_CLAIM_2>>>"

⚠️ DO NOT extract the above SOURCE claims themselves.

EXTRACTION INSTRUCTIONS:
1) Extract factual claims from the TEXT BELOW following the standard criteria (materiality, verifiability, specificity).

2) PRIORITIZE claims that:
   - Directly support, contradict, refute, or respond to the SOURCE claims above
   - Provide counter-arguments, rebuttals, or alternative perspectives
   - Include expert opinions or commentary about those specific topics
   → These responsive statements should be ranked HIGHER than general background claims

3) STILL EXTRACT general factual claims even if they don't directly address SOURCE claims:
   - Extract background claims with concrete data (numbers, percentages, dates)
   - Extract relevant factual context about the topic
   - These general claims are LOWER PRIORITY but should still be included if they meet quality criteria

4) Extract responsive statements EVEN IF they are argumentative or evaluative rather than purely factual.

→ Extract ALL worthy claims, but RANK responsive claims higher than general background.
→ ONLY extract NEW statements from the TEXT below, NOT the SOURCE claims listed above.
```


[3. User prompt from DB field prompt_text with prompt_name=claim_extraction_stack_with_topics]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_with_topics",
  "prompt_type": "user",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 3,
  "is_active": 1,
  "chars": 2609,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
Analyze the article text and return strict JSON using exactly this structure.

Extract what the article claims. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the article.

Return between 5 and 12 total items in the flat claims list unless the text clearly contains fewer worthy claims.

OUTPUT:
{
  "generalTopic": "",
  "specificTopics": [],
  "thesis": "",
  "pillars": [
    {
      "id": "P1",
      "label": "",
      "summary": "",
      "centrality": 0,
      "claims": [
        {
          "text": "",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0,
          "verifiability": 0,
          "priority": 0,
          "searchText": ""
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "backgroundClaims": [
    {
      "text": "",
      "role": "background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "claims": [
    {
      "text": "",
      "role": "thesis|pillar|pillar_support|evidence|background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "testimonials": [
    {
      "text": "",
      "name": "",
      "imageUrl": ""
    }
  ]
}

RULES:
- The flat "claims" array is the canonical list for persistence.
- Nested pillar/evidence/background arrays are for structure.
- Every important nested claim should also appear in "claims".
- Do not use role values other than thesis, pillar, pillar_support, evidence, or background.
- Do not create fallibility_critical as a role.
- Use priority to mark claims that are especially important to verify.
- Use centrality for importance to the article's argument.
- Use verifiability for how externally checkable the claim is.
- Use searchText as a compact search-ready version of the claim.
- searchText should preserve names, dates, studies, agencies, and distinctive terms.
- If a claim is compound, searchText should target the most useful search formulation, not repeat the whole sentence.
- If a claim says "X said Y", make searchText focus on attribution and key entities: X, Y keywords, study/event names.
- Background claims should have low priority unless they contain concrete dates, numbers, laws, studies, or named events.
- If nothing fits a section, return an empty array.
```


[4. Hardcoded wrapper from backend/src/core/claimsEngine.js lines 347-357]
```text
You are a fact-checking assistant.

${taskClaimsInstruction}
${tasks}

${testimonialsText}

TEXT:
${chunk}
```

[5. Empty schemaHint from backend/src/core/claimsEngine.js line 359]
```text
const schemaHint = "";
```

[6. OpenAI message assembly from backend/src/core/openAiLLM.js lines 121-135]
```text
messages: [
  { role: "system", content: system },
  {
    role: "user",
    content: schemaHint
      ? user + "\n\nReturn ONLY valid JSON. JSON shape hint: " + schemaHint
      : user,
  },
]
```

[FINAL API-READY MESSAGE ASSEMBLY]

The phrase `messages[0] role=system` means the first chat message sent to OpenAI has role `system`; `messages[1] role=user` means the second chat message has role `user`. For claim extraction, no hardcoded schema suffix is appended because `schemaHint` is empty.

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "response_format": {
    "type": "json_object"
  },
  "messages": [
    {
      "role": "system",
      "content": "You extract atomic claims from scraped content.\n\nReturn strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.\n\nExtract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.\n\nEach claim must be atomic, self-contained, and specific enough to search.\n\nPreserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.\n\nClassify each claim with one role:\nthesis, pillar, pillar_support, evidence, or background.\n\nUse background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.\n\nA pillar is a major argument branch.\nA pillar_support claim connects a pillar to evidence.\nAn evidence claim is a specific factual assertion offered as proof.\nA background claim is contextual information that does not directly carry the argument.\n\nGive high priority to claims involving:\nfraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.\n\nWhen a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.\n\nExample:\nDisplayed claim:\n\"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study.\"\n\nGood searchText:\n\"William Thompson CDC MMR autism DeStefano Hooker data manipulation\"\n\nBad searchText:\n\"William Thompson said CDC destroyed data and therefore vaccines cause autism\"\n\nReturn only valid JSON."
    },
    {
      "role": "user",
      "content": "You are a fact-checking assistant.\n\n⚠️ CONTEXT - The SOURCE article being fact-checked contains these claims:\n  1. \"<<<TASK_CLAIM_1>>>\"\n  2. \"<<<TASK_CLAIM_2>>>\"\n\n⚠️ DO NOT extract the above SOURCE claims themselves.\n\nEXTRACTION INSTRUCTIONS:\n1) Extract factual claims from the TEXT BELOW following the standard criteria (materiality, verifiability, specificity).\n\n2) PRIORITIZE claims that:\n   - Directly support, contradict, refute, or respond to the SOURCE claims above\n   - Provide counter-arguments, rebuttals, or alternative perspectives\n   - Include expert opinions or commentary about those specific topics\n   → These responsive statements should be ranked HIGHER than general background claims\n\n3) STILL EXTRACT general factual claims even if they don't directly address SOURCE claims:\n   - Extract background claims with concrete data (numbers, percentages, dates)\n   - Extract relevant factual context about the topic\n   - These general claims are LOWER PRIORITY but should still be included if they meet quality criteria\n\n4) Extract responsive statements EVEN IF they are argumentative or evaluative rather than purely factual.\n\n→ Extract ALL worthy claims, but RANK responsive claims higher than general background.\n→ ONLY extract NEW statements from the TEXT below, NOT the SOURCE claims listed above.\n\nAnalyze the article text and return strict JSON using exactly this structure.\n\nExtract what the article claims. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the article.\n\nReturn between 5 and 12 total items in the flat claims list unless the text clearly contains fewer worthy claims.\n\nOUTPUT:\n{\n  \"generalTopic\": \"\",\n  \"specificTopics\": [],\n  \"thesis\": \"\",\n  \"pillars\": [\n    {\n      \"id\": \"P1\",\n      \"label\": \"\",\n      \"summary\": \"\",\n      \"centrality\": 0,\n      \"claims\": [\n        {\n          \"text\": \"\",\n          \"role\": \"pillar_support\",\n          \"parentId\": \"P1\",\n          \"centrality\": 0,\n          \"verifiability\": 0,\n          \"priority\": 0,\n          \"searchText\": \"\"\n        }\n      ]\n    }\n  ],\n  \"evidenceClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"evidence\",\n      \"parentId\": \"P1\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"backgroundClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"claims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"thesis|pillar|pillar_support|evidence|background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"testimonials\": [\n    {\n      \"text\": \"\",\n      \"name\": \"\",\n      \"imageUrl\": \"\"\n    }\n  ]\n}\n\nRULES:\n- The flat \"claims\" array is the canonical list for persistence.\n- Nested pillar/evidence/background arrays are for structure.\n- Every important nested claim should also appear in \"claims\".\n- Do not use role values other than thesis, pillar, pillar_support, evidence, or background.\n- Do not create fallibility_critical as a role.\n- Use priority to mark claims that are especially important to verify.\n- Use centrality for importance to the article's argument.\n- Use verifiability for how externally checkable the claim is.\n- Use searchText as a compact search-ready version of the claim.\n- searchText should preserve names, dates, studies, agencies, and distinctive terms.\n- If a claim is compound, searchText should target the most useful search formulation, not repeat the whole sentence.\n- If a claim says \"X said Y\", make searchText focus on attribution and key entities: X, Y keywords, study/event names.\n- Background claims should have low priority unless they contain concrete dates, numbers, laws, studies, or named events.\n- If nothing fits a section, return an empty array.\n\nTEXT:\n<<<ARTICLE_TEXT_CHUNK>>>"
    }
  ]
}
```

Comments:
- There is now one extraction schema source: the selected DB user prompt.
- `fallibilityCriticalClaims` and `searchAssertions` are no longer requested by the active stack DB prompts.
- The flat `claims` array remains canonical for persistence.
- Optional `priority` and `searchText` fields are parsed in memory and used by source search.



## [D. ALL THE PROMPTS FOR SUBSEQUENT CHUNK CLAIM EXTRACTIONS - SOURCE/REFERENCE CONTENT WITH TASK CLAIM CONTEXT]

Runtime conditions:
```json
{
  "contentRole": "source",
  "includeTopicsAndTestimonials": false,
  "taskClaimsContext": "present",
  "extractionModeFromLiveConfig": "edge",
  "schemaSource": "DB prompt text only; claim extraction passes schemaHint=\"\" and appends no hardcoded schema."
}
```

[1. System prompt from DB field prompt_text with prompt_name=claim_extraction_stack_system]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_system",
  "prompt_type": "system",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 3,
  "is_active": 1,
  "chars": 1913,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
You extract atomic claims from scraped content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Extract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.

Each claim must be atomic, self-contained, and specific enough to search.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.

Classify each claim with one role:
thesis, pillar, pillar_support, evidence, or background.

Use background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.

A pillar is a major argument branch.
A pillar_support claim connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

Give high priority to claims involving:
fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.

When a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.

Example:
Displayed claim:
"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study."

Good searchText:
"William Thompson CDC MMR autism DeStefano Hooker data manipulation"

Bad searchText:
"William Thompson said CDC destroyed data and therefore vaccines cause autism"

Return only valid JSON.
```


[2. Source context prompt from DB field prompt_text with prompt_name=claim_extraction_source_context_instruction]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_source_context_instruction",
  "prompt_type": "user",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 1,
  "is_active": 1,
  "chars": 1242,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {}
}
```

```text
⚠️ CONTEXT - The SOURCE article being fact-checked contains these claims:
  1. "<<<TASK_CLAIM_1>>>"
  2. "<<<TASK_CLAIM_2>>>"

⚠️ DO NOT extract the above SOURCE claims themselves.

EXTRACTION INSTRUCTIONS:
1) Extract factual claims from the TEXT BELOW following the standard criteria (materiality, verifiability, specificity).

2) PRIORITIZE claims that:
   - Directly support, contradict, refute, or respond to the SOURCE claims above
   - Provide counter-arguments, rebuttals, or alternative perspectives
   - Include expert opinions or commentary about those specific topics
   → These responsive statements should be ranked HIGHER than general background claims

3) STILL EXTRACT general factual claims even if they don't directly address SOURCE claims:
   - Extract background claims with concrete data (numbers, percentages, dates)
   - Extract relevant factual context about the topic
   - These general claims are LOWER PRIORITY but should still be included if they meet quality criteria

4) Extract responsive statements EVEN IF they are argumentative or evaluative rather than purely factual.

→ Extract ALL worthy claims, but RANK responsive claims higher than general background.
→ ONLY extract NEW statements from the TEXT below, NOT the SOURCE claims listed above.
```


[3. User prompt from DB field prompt_text with prompt_name=claim_extraction_stack_no_topics]

[DB PROMPT VALUE]
```json
{
  "prompt_name": "claim_extraction_stack_no_topics",
  "prompt_type": "user",
  "source_table": "llm_prompts",
  "source_field": "prompt_text",
  "version": 2,
  "is_active": 1,
  "chars": 2087,
  "max_claims": 12,
  "min_sources": 2,
  "max_sources": 4,
  "parameters": {
    "maxClaims": 12,
    "minClaims": 5
  }
}
```

```text
CONTENT ROLE: source
EXTRACTION MODE: edge

Extract a reasoning stack from the text.

Return strict JSON only.

OUTPUT:
{
  "thesis": "",
  "pillars": [
    {
      "id": "P1",
      "label": "",
      "summary": "",
      "centrality": 0,
      "claims": [
        {
          "text": "",
          "role": "pillar_support",
          "parentId": "P1",
          "centrality": 0,
          "verifiability": 0,
          "priority": 0,
          "searchText": ""
        }
      ]
    }
  ],
  "evidenceClaims": [
    {
      "text": "",
      "role": "evidence",
      "parentId": "P1",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "backgroundClaims": [
    {
      "text": "",
      "role": "background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ],
  "claims": [
    {
      "text": "",
      "role": "thesis|pillar|pillar_support|evidence|background",
      "parentId": "",
      "centrality": 0,
      "verifiability": 0,
      "priority": 0,
      "searchText": ""
    }
  ]
}

RULES:
- Return `claims` as the flat canonical list for persistence.
- Allowed roles only: thesis, pillar, pillar_support, evidence, background.
- EDGE: return only the sharpest, most consequential claims.
- RANKED: return the most important claims that build the reasoning stack.
- COMPREHENSIVE: return a fuller claim pool, but keep claims atomic.
- Each claim must be atomic, self-contained, and directly verifiable when possible.
- Use priority 80-100 for hinge claims, named allegations, named studies, statistics, causal harm claims, misconduct claims, correction/retraction claims, or claims likely to drive source search.
- Use searchText for the query seed.
- If a claim is compound, simplify searchText into the best searchable form.
- If a claim says "X said/alleged Y", searchText should include X, the key Y terms, and any named study/event, rather than the whole sentence.
- If nothing fits a section, return an empty array.
```


[4. Hardcoded wrapper from backend/src/core/claimsEngine.js lines 347-357]
```text
You are a fact-checking assistant.

${taskClaimsInstruction}
${tasks}

${testimonialsText}

TEXT:
${chunk}
```

[5. Empty schemaHint from backend/src/core/claimsEngine.js line 359]
```text
const schemaHint = "";
```

[6. OpenAI message assembly from backend/src/core/openAiLLM.js lines 121-135]
```text
messages: [
  { role: "system", content: system },
  {
    role: "user",
    content: schemaHint
      ? user + "\n\nReturn ONLY valid JSON. JSON shape hint: " + schemaHint
      : user,
  },
]
```

[FINAL API-READY MESSAGE ASSEMBLY]

The phrase `messages[0] role=system` means the first chat message sent to OpenAI has role `system`; `messages[1] role=user` means the second chat message has role `user`. For claim extraction, no hardcoded schema suffix is appended because `schemaHint` is empty.

```json
{
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "response_format": {
    "type": "json_object"
  },
  "messages": [
    {
      "role": "system",
      "content": "You extract atomic claims from scraped content.\n\nReturn strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.\n\nExtract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.\n\nEach claim must be atomic, self-contained, and specific enough to search.\n\nPreserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links.\n\nClassify each claim with one role:\nthesis, pillar, pillar_support, evidence, or background.\n\nUse background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.\n\nA pillar is a major argument branch.\nA pillar_support claim connects a pillar to evidence.\nAn evidence claim is a specific factual assertion offered as proof.\nA background claim is contextual information that does not directly carry the argument.\n\nGive high priority to claims involving:\nfraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.\n\nWhen a claim contains both attribution and a substantive allegation, do not let the search text fuse them into one confusing query. Keep the displayed claim readable, but make searchText target the most searchable form.\n\nExample:\nDisplayed claim:\n\"William Thompson alleged that CDC researchers manipulated data in a 2004 MMR-autism study.\"\n\nGood searchText:\n\"William Thompson CDC MMR autism DeStefano Hooker data manipulation\"\n\nBad searchText:\n\"William Thompson said CDC destroyed data and therefore vaccines cause autism\"\n\nReturn only valid JSON."
    },
    {
      "role": "user",
      "content": "You are a fact-checking assistant.\n\n⚠️ CONTEXT - The SOURCE article being fact-checked contains these claims:\n  1. \"<<<TASK_CLAIM_1>>>\"\n  2. \"<<<TASK_CLAIM_2>>>\"\n\n⚠️ DO NOT extract the above SOURCE claims themselves.\n\nEXTRACTION INSTRUCTIONS:\n1) Extract factual claims from the TEXT BELOW following the standard criteria (materiality, verifiability, specificity).\n\n2) PRIORITIZE claims that:\n   - Directly support, contradict, refute, or respond to the SOURCE claims above\n   - Provide counter-arguments, rebuttals, or alternative perspectives\n   - Include expert opinions or commentary about those specific topics\n   → These responsive statements should be ranked HIGHER than general background claims\n\n3) STILL EXTRACT general factual claims even if they don't directly address SOURCE claims:\n   - Extract background claims with concrete data (numbers, percentages, dates)\n   - Extract relevant factual context about the topic\n   - These general claims are LOWER PRIORITY but should still be included if they meet quality criteria\n\n4) Extract responsive statements EVEN IF they are argumentative or evaluative rather than purely factual.\n\n→ Extract ALL worthy claims, but RANK responsive claims higher than general background.\n→ ONLY extract NEW statements from the TEXT below, NOT the SOURCE claims listed above.\n\nCONTENT ROLE: source\nEXTRACTION MODE: edge\n\nExtract a reasoning stack from the text.\n\nReturn strict JSON only.\n\nOUTPUT:\n{\n  \"thesis\": \"\",\n  \"pillars\": [\n    {\n      \"id\": \"P1\",\n      \"label\": \"\",\n      \"summary\": \"\",\n      \"centrality\": 0,\n      \"claims\": [\n        {\n          \"text\": \"\",\n          \"role\": \"pillar_support\",\n          \"parentId\": \"P1\",\n          \"centrality\": 0,\n          \"verifiability\": 0,\n          \"priority\": 0,\n          \"searchText\": \"\"\n        }\n      ]\n    }\n  ],\n  \"evidenceClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"evidence\",\n      \"parentId\": \"P1\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"backgroundClaims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ],\n  \"claims\": [\n    {\n      \"text\": \"\",\n      \"role\": \"thesis|pillar|pillar_support|evidence|background\",\n      \"parentId\": \"\",\n      \"centrality\": 0,\n      \"verifiability\": 0,\n      \"priority\": 0,\n      \"searchText\": \"\"\n    }\n  ]\n}\n\nRULES:\n- Return `claims` as the flat canonical list for persistence.\n- Allowed roles only: thesis, pillar, pillar_support, evidence, background.\n- EDGE: return only the sharpest, most consequential claims.\n- RANKED: return the most important claims that build the reasoning stack.\n- COMPREHENSIVE: return a fuller claim pool, but keep claims atomic.\n- Each claim must be atomic, self-contained, and directly verifiable when possible.\n- Use priority 80-100 for hinge claims, named allegations, named studies, statistics, causal harm claims, misconduct claims, correction/retraction claims, or claims likely to drive source search.\n- Use searchText for the query seed.\n- If a claim is compound, simplify searchText into the best searchable form.\n- If a claim says \"X said/alleged Y\", searchText should include X, the key Y terms, and any named study/event, rather than the whole sentence.\n- If nothing fits a section, return an empty array.\n\nTEXT:\n<<<ARTICLE_TEXT_CHUNK>>>"
    }
  ]
}
```

Comments:
- There is now one extraction schema source: the selected DB user prompt.
- `fallibilityCriticalClaims` and `searchAssertions` are no longer requested by the active stack DB prompts.
- The flat `claims` array remains canonical for persistence.
- Optional `priority` and `searchText` fields are parsed in memory and used by source search.


## Bottom-Line Comments

- The active DB prompts are leaner: no `fallibilityCriticalClaims`, no `searchAssertions`, no duplicate hardcoded output schema.
- `extraction_mode=edge` still reaches the stack prompt family first; the no-topics DB prompt now explicitly includes mode-specific behavior rules.
- Source search now uses claim ordering by `priority`, `verifiability`, then `centrality`, and uses `searchText` where present.
- Compound attribution claims are split into transient `matchedPart` targets: `attribution`, `object_claim`, `study_or_event_identity`, and `context`.
