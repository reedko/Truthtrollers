-- Fix publisher_ratings accumulation: add UNIQUE constraint so saveRating upserts.
-- Using stored-procedure pattern (MySQL has no CREATE INDEX IF NOT EXISTS).

DROP PROCEDURE IF EXISTS _add_publisher_ratings_unique;
DELIMITER //
CREATE PROCEDURE _add_publisher_ratings_unique()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name   = 'publisher_ratings'
      AND index_name   = 'uq_pub_source_type'
  ) THEN
    ALTER TABLE publisher_ratings
      ADD UNIQUE INDEX uq_pub_source_type (publisher_id, source(80), rating_type);
  END IF;
END//
DELIMITER ;
CALL _add_publisher_ratings_unique();
DROP PROCEDURE IF EXISTS _add_publisher_ratings_unique;
