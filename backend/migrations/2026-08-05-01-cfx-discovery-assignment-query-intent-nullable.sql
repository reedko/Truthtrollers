-- Restores the Codex-approved v1 CFX query-planning and retrieval contract,
-- which never included a queryIntent concept. cfx_document_discovery_assignments
-- .query_intent was a v2-era column that no live application code has ever
-- read back (write-only, indexed but never queried) -- this migration makes it
-- nullable so future rows can omit it without fabricating a replacement
-- value. All 3,456 existing historical rows and their recorded values are
-- left untouched -- this statement changes only the column's nullability,
-- not any stored data.

ALTER TABLE cfx_document_discovery_assignments
  MODIFY COLUMN query_intent
  ENUM(
    'canonical',
    'entity_predicate',
    'source_identity',
    'independent_evidence',
    'counterevidence',
    'qualification'
  ) NULL;
