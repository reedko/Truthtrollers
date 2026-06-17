-- ============================================================
-- PROD MIGRATION  2026-06-04
-- Fixes:
--   1. All publisher child-table FKs → ON DELETE CASCADE
--      (publisher_profiles, publisher_enrichment_runs, publisher_ratings,
--       and any other table referencing publishers.publisher_id without CASCADE)
--   2. delete_content_cascade stored procedure — comprehensive version
--      adds content_users, admiralty_evaluations, publisher_enrichment_runs
--      orphan cleanup, and correct molecule_view_pins handling
-- ============================================================
-- Safe to run more than once (idempotent via information_schema checks).
-- ============================================================


-- ── Helper: fix a single publisher FK to ON DELETE CASCADE ────────────────────
DROP PROCEDURE IF EXISTS _tt_fix_publisher_fk;

DELIMITER //
CREATE PROCEDURE _tt_fix_publisher_fk(
  IN p_table      VARCHAR(64),
  IN p_old_name   VARCHAR(128),
  IN p_new_name   VARCHAR(128)
)
BEGIN
  -- Drop the old constraint if it still exists (with NO ACTION)
  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND constraint_name   = p_old_name
      AND delete_rule        = 'NO ACTION'
  ) THEN
    SET @_sql = CONCAT('ALTER TABLE `', p_table, '` DROP FOREIGN KEY `', p_old_name, '`');
    PREPARE _s FROM @_sql; EXECUTE _s; DEALLOCATE PREPARE _s;
  END IF;

  -- Add the CASCADE version if not already present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND constraint_name   = p_new_name
  ) THEN
    SET @_sql = CONCAT(
      'ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_new_name, '` ',
      'FOREIGN KEY (`publisher_id`) REFERENCES `publishers` (`publisher_id`) ON DELETE CASCADE'
    );
    PREPARE _s FROM @_sql; EXECUTE _s; DEALLOCATE PREPARE _s;
  END IF;
END //
DELIMITER ;

-- Fix each known FK
CALL _tt_fix_publisher_fk('publisher_profiles',       'publisher_profiles_ibfk_1',       'publisher_profiles_fk_cascade');
CALL _tt_fix_publisher_fk('publisher_enrichment_runs','publisher_enrichment_runs_ibfk_1', 'publisher_enrichment_runs_fk_cascade');
CALL _tt_fix_publisher_fk('publisher_ratings',        'publisher_ratings_ibfk_1',         'publisher_ratings_fk_cascade');

DROP PROCEDURE IF EXISTS _tt_fix_publisher_fk;

SELECT '✅ publisher child-table FKs updated to ON DELETE CASCADE' AS status;


-- ── delete_content_cascade — comprehensive replacement ───────────────────────
DROP PROCEDURE IF EXISTS delete_content_cascade;

DELIMITER $$

CREATE PROCEDURE delete_content_cascade(IN content_id_to_delete INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- 1. reference_claim_task_links — task side
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 2. reference_claim_task_links — reference side
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 3. claim_links — source side
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 4. claim_links — target side
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 5. user_claim_ratings — task side
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 6. user_claim_ratings — reference side
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 7. claims — orphaned only (not shared with other content)
    DELETE c FROM claims c
    INNER JOIN content_claims cc1 ON c.claim_id = cc1.claim_id
    LEFT  JOIN content_claims cc2 ON c.claim_id = cc2.claim_id
                                  AND cc2.content_id != content_id_to_delete
    WHERE cc1.content_id = content_id_to_delete
      AND cc2.claim_id IS NULL;

    -- 8. content_claims junction
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- 9. content_relations — as reference
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;

    -- 10. content_relations — as task
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;

    -- 11. content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- 12. user_reference_visibility
    DELETE FROM user_reference_visibility
    WHERE task_content_id      = content_id_to_delete
       OR reference_content_id = content_id_to_delete;

    -- 13. publisher_enrichment_runs for publishers that will become orphaned
    --     (belt-and-suspenders before the junction row is removed)
    DELETE per FROM publisher_enrichment_runs per
    INNER JOIN content_publishers cp ON per.publisher_id = cp.publisher_id
    WHERE cp.content_id = content_id_to_delete
      AND per.publisher_id NOT IN (
          SELECT cp2.publisher_id FROM content_publishers cp2
          WHERE cp2.content_id != content_id_to_delete
      );

    -- 14. content_authors / content_publishers
    DELETE FROM content_authors    WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- 15. molecule_view_pins (child rows first, then the view rows)
    DELETE mvp FROM molecule_view_pins mvp
    INNER JOIN molecule_views mv ON mvp.view_id = mv.id
    WHERE mv.content_id = content_id_to_delete;

    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- 16. discussion_entries
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- 17. content_users
    DELETE FROM content_users WHERE content_id = content_id_to_delete;

    -- 18. admiralty_evaluations
    DELETE FROM admiralty_evaluations
    WHERE target_type = 'content' AND target_id = content_id_to_delete;

    -- 19. content row
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Deleted content_id ', content_id_to_delete) AS message;

END$$

DELIMITER ;

SELECT '✅ delete_content_cascade updated' AS status;
