-- Update delete_content_cascade for TM4/evidence package rows.
--
-- The older routine predates claim_evaluation_targets and TM4 package
-- persistence. Those rows can leave stale target/evidence state behind, or
-- block full task cleanup, even when the content row itself is removed.

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

    -- 1. Phase 3 target package. evaluation_target_evidence_links cascade from
    --    claim_evaluation_targets via fk_target_evidence_target.
    DELETE FROM claim_evaluation_targets
    WHERE content_id = content_id_to_delete;

    -- 2. TM4 package rows. Raw/selected TM4 rows cascade from tm4_claim_packages.
    DELETE FROM tm4_claim_packages
    WHERE content_id = content_id_to_delete;

    -- 3. content_topics has no FK to content.
    DELETE FROM content_topics
    WHERE content_id = content_id_to_delete;

    -- 4. reference_claim_task_links — task side
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 5. reference_claim_task_links — reference side
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 6. claim_links — source side
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 7. claim_links — target side
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 8. user_claim_ratings — task side
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 9. user_claim_ratings — reference side
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 10. claims — orphaned only (not shared with other content)
    DELETE c FROM claims c
    INNER JOIN content_claims cc1 ON c.claim_id = cc1.claim_id
    LEFT  JOIN content_claims cc2 ON c.claim_id = cc2.claim_id
                                  AND cc2.content_id != content_id_to_delete
    WHERE cc1.content_id = content_id_to_delete
      AND cc2.claim_id IS NULL;

    -- 11. content_claims junction
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- 12. content_relations — as reference
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;

    -- 13. content_relations — as task
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;

    -- 14. content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- 15. user_reference_visibility
    DELETE FROM user_reference_visibility
    WHERE task_content_id      = content_id_to_delete
       OR reference_content_id = content_id_to_delete;

    -- 16. publisher_enrichment_runs for publishers that will become orphaned
    --     (belt-and-suspenders before the junction row is removed)
    DELETE per FROM publisher_enrichment_runs per
    INNER JOIN content_publishers cp ON per.publisher_id = cp.publisher_id
    WHERE cp.content_id = content_id_to_delete
      AND per.publisher_id NOT IN (
          SELECT cp2.publisher_id FROM content_publishers cp2
          WHERE cp2.content_id != content_id_to_delete
      );

    -- 17. content_authors / content_publishers junction rows. Master author and
    --     publisher rows are intentionally retained because they may be shared.
    DELETE FROM content_authors    WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- 18. molecule_view_pins (child rows first, then the view rows)
    DELETE mvp FROM molecule_view_pins mvp
    INNER JOIN molecule_views mv ON mvp.view_id = mv.id
    WHERE mv.content_id = content_id_to_delete;

    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- 19. discussion_entries
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- 20. content_users
    DELETE FROM content_users WHERE content_id = content_id_to_delete;

    -- 21. admiralty_evaluations
    DELETE FROM admiralty_evaluations
    WHERE target_type = 'content' AND target_id = content_id_to_delete;

    -- 22. content row
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('Deleted content_id ', content_id_to_delete) AS message;

END$$

DELIMITER ;
