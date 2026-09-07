-- Adds dwell-time tracking and digest-summarization bookkeeping to the
-- investor portal's event log. Additive only.
ALTER TABLE investor_access_events
  ADD COLUMN duration_seconds INT NULL DEFAULT NULL AFTER document_id,
  ADD COLUMN summarized_at TIMESTAMP NULL DEFAULT NULL AFTER duration_seconds,
  ADD INDEX idx_summarized_at (summarized_at);
