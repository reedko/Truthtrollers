-- Fix delete_content_cascade to remove temp table issues
-- This version uses direct subqueries instead of temporary tables

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

    -- Step 1: Delete reference_claim_task_links where task_claim_id is from this content
    DELETE FROM reference_claim_task_links
    WHERE task_claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = content_id_to_delete
    );

    -- Step 2: Delete reference_claim_task_links where reference_claim_id is from this content
    DELETE FROM reference_claim_task_links
    WHERE reference_claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = content_id_to_delete
    );

    -- Step 3: Delete claim_links where source or target is from this content
    DELETE FROM claim_links
    WHERE source_claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = content_id_to_delete
    )
    OR target_claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = content_id_to_delete
    );

    -- Step 4: Delete user_claim_ratings
    DELETE FROM user_claim_ratings
    WHERE claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = content_id_to_delete
    );

    -- Step 5: Delete claims ONLY if they're not referenced by any other content
    -- This prevents deleting shared claims
    -- Do this BEFORE deleting content_claims
    DELETE FROM claims
    WHERE claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = content_id_to_delete
    )
    AND claim_id NOT IN (
        SELECT DISTINCT claim_id FROM content_claims WHERE content_id != content_id_to_delete
    );

    -- Step 6: Delete content_claims links (removes junction)
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- Step 7: Delete content_relations where this is a reference
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;

    -- Step 8: Delete content_relations where this is the main content
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;

    -- Step 9: Delete content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- Step 10: Delete user_reference_visibility
    DELETE FROM user_reference_visibility
    WHERE task_content_id = content_id_to_delete
    OR reference_content_id = content_id_to_delete;

    -- Step 11: Delete author/publisher relations
    DELETE FROM content_authors WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- Step 12: Delete task completion records
    DELETE FROM task_completions WHERE content_id = content_id_to_delete;

    -- Step 13: Delete molecule view records (if table exists)
    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- Step 14: Delete discussion entries (pro/con arguments)
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- Step 15: Finally delete the content itself
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Successfully deleted content_id ', content_id_to_delete, ' and all related records') AS message;

END$$

DELIMITER ;

SELECT '✅ Stored procedure updated: delete_content_cascade now works without temp tables' AS status;
