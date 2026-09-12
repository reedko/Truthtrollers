DELETE FROM llm_prompts
 WHERE prompt_id = 447
   AND prompt_name = 'evidence_assertion_trace_support_user';

DROP TABLE IF EXISTS provenance_trace_support;
