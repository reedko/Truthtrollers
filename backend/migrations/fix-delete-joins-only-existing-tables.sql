-- Fix delete_content_cascade using JOINs with ONLY tables that actually exist
-- Based on the working production procedure

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

    -- Step 1: Delete reference_claim_task_links (task side) using JOIN
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Step 2: Delete reference_claim_task_links (reference side) using JOIN
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Step 3: Delete claim_links (source) using JOIN
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Step 4: Delete claim_links (target) using JOIN
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Step 5: Delete user_claim_ratings (task side) using JOIN
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Step 6: Delete user_claim_ratings (reference side) using JOIN
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- Step 7: Delete orphaned claims
    DELETE c FROM claims c
    INNER JOIN content_claims cc1 ON c.claim_id = cc1.claim_id
    LEFT JOIN content_claims cc2 ON c.claim_id = cc2.claim_id AND cc2.content_id != content_id_to_delete
    WHERE cc1.content_id = content_id_to_delete AND cc2.claim_id IS NULL;

    -- Step 8: Delete content_claims junction
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- Step 9: Delete content_relations (reference)
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;

    -- Step 10: Delete content_relations (main)
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;

    -- Step 11: Delete content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- Step 12: Delete user_reference_visibility
    DELETE FROM user_reference_visibility
    WHERE task_content_id = content_id_to_delete
    OR reference_content_id = content_id_to_delete;

    -- Step 13: Delete author/publisher relations
    DELETE FROM content_authors WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- Step 14: Delete molecule views
    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- Step 15: Delete discussion entries
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- Step 16: Finally delete the content
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Successfully deleted content_id ', content_id_to_delete, ' and all related records') AS message;

END$$

DELIMITER ;

SELECT '✅ Fixed: removed non-existent task_completions table' AS status;
