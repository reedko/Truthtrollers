-- Comprehensive fix for delete_content_cascade
-- Adds all missing table deletions to the stored procedure:
--   content_users, admiralty_evaluations, publisher_enrichment_runs (via orphan cleanup)
-- Uses JOIN approach throughout to avoid MySQL subquery-on-same-table restrictions.
--
-- Also fixes publisher_enrichment_runs FK to cascade on publisher deletion,
-- so if any trigger auto-removes orphaned publishers it no longer hits a FK error.

ALTER TABLE publisher_enrichment_runs
  DROP FOREIGN KEY publisher_enrichment_runs_ibfk_1,
  ADD CONSTRAINT publisher_enrichment_runs_ibfk_1
    FOREIGN KEY (publisher_id) REFERENCES publishers(publisher_id) ON DELETE CASCADE;

SELECT '✅ publisher_enrichment_runs FK updated to ON DELETE CASCADE' AS status;

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

    -- 7. claims — only orphaned ones (not shared with other content)
    DELETE c FROM claims c
    INNER JOIN content_claims cc1 ON c.claim_id = cc1.claim_id
    LEFT JOIN content_claims cc2 ON c.claim_id = cc2.claim_id AND cc2.content_id != content_id_to_delete
    WHERE cc1.content_id = content_id_to_delete AND cc2.claim_id IS NULL;

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
    WHERE task_content_id = content_id_to_delete
       OR reference_content_id = content_id_to_delete;

    -- 13a. publisher_enrichment_runs — for publishers that are ONLY linked to this content
    --      (guards against any trigger that auto-deletes orphaned publishers)
    DELETE per FROM publisher_enrichment_runs per
    INNER JOIN content_publishers cp ON per.publisher_id = cp.publisher_id
    WHERE cp.content_id = content_id_to_delete
      AND per.publisher_id NOT IN (
          SELECT cp2.publisher_id FROM content_publishers cp2
          WHERE cp2.content_id != content_id_to_delete
      );

    -- 13b. content_authors / content_publishers
    DELETE FROM content_authors    WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- 14. molecule_views (pins first, then view rows)
    DELETE mvp FROM molecule_view_pins mvp
    INNER JOIN molecule_views mv ON mvp.view_id = mv.id
    WHERE mv.content_id = content_id_to_delete;

    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- 15. discussion_entries
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- 16. content_users  ← was missing; caused ER_ROW_IS_REFERENCED_2
    DELETE FROM content_users WHERE content_id = content_id_to_delete;

    -- 17. admiralty_evaluations (target_type = 'content')
    DELETE FROM admiralty_evaluations
    WHERE target_type = 'content' AND target_id = content_id_to_delete;

    -- 18. Finally delete the content row
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Deleted content_id ', content_id_to_delete) AS message;

END$$

DELIMITER ;

SELECT '✅ delete_content_cascade updated (content_users + admiralty_evaluations added)' AS status;
