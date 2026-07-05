-- 2026-07-04-03 fix document synthesis consolidation
-- Updated claim_document_synthesis prompt to actually consolidate near-duplicates.
-- Previous version told LLM to return assignments for all input claims,
-- resulting in no consolidation (still 68 fragments after synthesis).
-- New version tells LLM to identify duplicates and return claimAssignments
-- ONLY for canonical representatives (~11 instead of 68).
-- applyDocumentSynthesis now filters: keeps only claims with assignments.
--
-- prompt_type = 'combined' (split on /\n\s*USER:\s*\n/)

SET @synthesis_text = 'SYSTEM:
Consolidate and organize local claim fragments into one article-level argument map.\n\nCONSOLIDATION IS CRITICAL: The input includes many near-duplicate fragments (e.g., the same\nallegation stated identically dozens of times, or trivial variations). Group these duplicates\nand return a SINGLE canonical representative for each group. Return claimAssignments ONLY for\ncanonical claims — omit duplicates entirely from the result.\n\nIdentify canonical claims as: claims with distinct substantive content, claims marked as\nthesis/pillar/evidence (not generic fragments), and for duplicates, the earliest or most\ncomplete instance.\n\nReturn strict JSON only. Do not fact-check and do not use outside knowledge. The article body\nis intentionally absent. Use the claim texts, exact local excerpts, local role suggestions,\nstance, and candidate markers already extracted from each chunk.\n\nDo not rewrite claims or invent missing local context. For each canonical claim, assign a\nfinal role and article stance. Prefer a claim explicitly marked thesisCandidate for the global\nthesis. Pillars must be load-bearing propositions, not generic topics.

USER:
STRUCTURED LOCAL CLAIMS:\n{{claimsJson}}\n\nTASK: Identify all groups of near-duplicate claims (same core allegation, same target, same\nstance, but repeated across different chunks or with minor wording variations). For each group,\nselect ONE canonical representative (the most complete, earliest, or most specific instance).\n\nReturn ONLY claimAssignments for canonical claims — omit all duplicates from the result. The\nengine will drop non-canonical claims automatically.\n\nReturn:\n{\n  "globalThesis": "",\n  "globalPillars": [\n    { "text": "", "memberClaimIds": [] }\n  ],\n  "claimRelationships": [\n    { "fromClaimId": "", "toClaimId": "", "relationship": "supports|opposes|evidence_for|background_to" }\n  ],\n  "claimAssignments": [\n    {\n      "localClaimId": "",\n      "finalRole": "thesis|pillar|evidence|background|opposing_claim|unclear",\n      "articleStance": "endorses|rejects|neutral|unclear",\n      "parentClaimId": "",\n      "thesisLoadScore": 0\n    }\n  ]\n}\n\nReturn claimAssignments for CANONICAL claims only. Do not include duplicate/variant instances\nin the claimAssignments list.';
UPDATE llm_prompts SET is_active = FALSE WHERE prompt_name = 'claim_document_synthesis';
SET @syn_id = (SELECT COALESCE(MAX(CAST(prompt_id AS UNSIGNED)), 0) + 1 FROM llm_prompts);
SET @syn_ver = (SELECT COALESCE(MAX(version), 0) + 1 FROM llm_prompts WHERE prompt_name = 'claim_document_synthesis');
INSERT INTO llm_prompts (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active)
VALUES (@syn_id, 'claim_document_synthesis', 'combined', @synthesis_text, '{}', @syn_ver, TRUE);


System prompt length: [33m1132[39m
User prompt length: [33m1091[39m
Combined: [33m2287[39m
