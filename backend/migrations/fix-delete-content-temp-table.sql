-- Fix delete_content_cascade - fix temp table subquery issue
-- The problem: Can't use temp table in subqueries with IN clause
-- Solution: Use JOIN instead of IN with subquery

DROP PROCEDURE IF EXISTS delete_content_cascade;

DELIMITER $$

CREATE PROCEDURE delete_content_cascade(IN content_id_to_delete INT)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        -- Rollback on error
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Step 0: Store claim IDs in a regular table (not temp) before we delete the junction table
    DROP TABLE IF EXISTS temp_claims_to_check;
    CREATE TABLE temp_claims_to_check (claim_id INT, INDEX(claim_id));

    INSERT INTO temp_claims_to_check (claim_id)
    SELECT DISTINCT claim_id FROM content_claims WHERE content_id = content_id_to_delete;

    -- Step 1: Delete reference_claim_task_links where task_claim_id is from this content
    DELETE rcl FROM reference_claim_task_links rcl
    INNER JOIN temp_claims_to_check tcc ON rcl.task_claim_id = tcc.claim_id;

    -- Step 2: Delete reference_claim_task_links where reference_claim_id is from this content
    DELETE rcl FROM reference_claim_task_links rcl
    INNER JOIN temp_claims_to_check tcc ON rcl.reference_claim_id = tcc.claim_id;

    -- Step 3: Delete claim_links where source or target is from this content
    DELETE cl FROM claim_links cl
    INNER JOIN temp_claims_to_check tcc ON cl.source_claim_id = tcc.claim_id OR cl.target_claim_id = tcc.claim_id;

    -- Step 4: Delete user_claim_ratings
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN temp_claims_to_check tcc ON ucr.claim_id = tcc.claim_id;

    -- Step 5: Delete content_claims links (removes junction)
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- Step 6: Delete claims ONLY if they're not referenced by any other content
    DELETE c FROM claims c
    INNER JOIN temp_claims_to_check tcc ON c.claim_id = tcc.claim_id
    LEFT JOIN content_claims cc ON c.claim_id = cc.claim_id
    WHERE cc.claim_id IS NULL;

    -- Clean up temp table
    DROP TABLE IF EXISTS temp_claims_to_check;

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

SELECT '✅ Stored procedure fixed: delete_content_cascade now uses JOINs instead of subqueries with temp table' AS status;
