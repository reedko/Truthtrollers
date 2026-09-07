-- Rollback for 2026-09-05-investor-portal-activity-emails_up.sql
ALTER TABLE investor_access_events
  DROP INDEX idx_summarized_at,
  DROP COLUMN summarized_at,
  DROP COLUMN duration_seconds;
