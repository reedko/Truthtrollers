-- Fix delete_content_cascade - simplified version without user_claim_ratings
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

    -- Delete content_relations
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete OR content_id = content_id_to_delete;

    -- Delete content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- Delete user_reference_visibility
    DELETE FROM user_reference_visibility WHERE task_content_id = content_id_to_delete OR reference_content_id = content_id_to_delete;

    -- Delete author/publisher relations
    DELETE FROM content_authors WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- Delete task completion records
    DELETE FROM task_completions WHERE content_id = content_id_to_delete;

    -- Delete molecule view records
    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- Delete discussion entries
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- Delete content_claims (leave claims intact for other content)
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- Finally delete the content itself
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('✅ Successfully deleted content_id ', content_id_to_delete) AS message;

END$$

DELIMITER ;
