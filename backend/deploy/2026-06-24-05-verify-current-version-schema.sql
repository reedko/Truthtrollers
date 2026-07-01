-- Verification queries for the 2026-06-24 current-version production migration.

SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = DATABASE()
   AND table_name IN (
     'admiralty_evaluations',
     'publisher_domains',
     'source_identity_cache',
     'source_lineage_cache',
     'publisher_external_signals',
     'publisher_relationships'
   )
 ORDER BY table_name;

SELECT column_name, column_type
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND table_name = 'content_claims'
   AND column_name IN (
     'claim_role',
     'parent_claim_id',
     'claim_depth',
     'centrality_score',
     'verifiability_score',
     'claim_order',
     'object_claim_text',
     'is_attribution',
     'speaker_entity',
     'article_stance',
     'argument_function',
     'score_transform',
     'accountability_eligible',
     'argument_mapping_confidence',
     'argument_mapping_rationale'
   )
 ORDER BY ordinal_position;

SELECT column_name, column_type
  FROM information_schema.columns
 WHERE table_schema = DATABASE()
   AND table_name = 'publishers'
   AND column_name IN (
     'identity_confidence',
     'source_type',
     'source_type_confidence',
     'independent_footprint_score',
     'conflict_of_interest_score',
     'reliability_signal_present',
     'direct_reliability_score',
     'contextual_credibility_score',
     'provenance_score',
     'publication_legitimacy_score',
     'reliability_cap',
     'reliability_cap_reason',
     'reliability_signal_sources',
     'last_enriched_at'
   )
 ORDER BY ordinal_position;

SELECT index_name, non_unique, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
  FROM information_schema.statistics
 WHERE table_schema = DATABASE()
   AND table_name = 'admiralty_evaluations'
   AND index_name = 'uq_target'
 GROUP BY index_name, non_unique;

SELECT prompt_name, prompt_type, version, is_active, max_claims, min_sources, max_sources, LEFT(prompt_text, 100) AS prompt_preview
  FROM llm_prompts
 WHERE prompt_name IN (
   'argument_mapping_system',
   'argument_mapping_user',
   'claim_extraction_stack_system',
   'claim_extraction_stack_with_topics',
   'claim_extraction_stack_no_topics',
   'evidence_query_generation_system',
   'evidence_query_generation_user',
   'evidence_query_generation_user_balanced'
 )
 ORDER BY prompt_name, version DESC;
