-- Fix publisher FKs — split into separate ALTER statements so MySQL
-- doesn't try to validate the new name before executing the DROP.

-- publisher_profiles
ALTER TABLE publisher_profiles DROP FOREIGN KEY publisher_profiles_ibfk_1;
ALTER TABLE publisher_profiles ADD CONSTRAINT publisher_profiles_fk_cascade
  FOREIGN KEY (publisher_id) REFERENCES publishers(publisher_id) ON DELETE CASCADE;

-- publisher_enrichment_runs (skip if already fixed by fix-delete-content-comprehensive.sql)
ALTER TABLE publisher_enrichment_runs DROP FOREIGN KEY publisher_enrichment_runs_ibfk_1;
ALTER TABLE publisher_enrichment_runs ADD CONSTRAINT publisher_enrichment_runs_fk_cascade
  FOREIGN KEY (publisher_id) REFERENCES publishers(publisher_id) ON DELETE CASCADE;

SELECT '✅ publisher FKs updated to ON DELETE CASCADE' AS status;
