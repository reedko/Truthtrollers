-- ============================================================
-- delete_task_and_references
-- Deletes a task AND all its linked reference/source content rows
-- (including their claims, claim links, etc.)
-- Uses a cursor to call delete_content_cascade on each reference
-- first, then deletes the task itself.
-- Usage: CALL delete_task_and_references(1234);
-- ============================================================

DROP PROCEDURE IF EXISTS delete_task_and_references;

DELIMITER $$

CREATE PROCEDURE delete_task_and_references(IN task_id INT)
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE ref_id INT;

  DECLARE ref_cursor CURSOR FOR
    SELECT reference_content_id
    FROM content_relations
    WHERE content_id = task_id;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  -- Delete each reference and all its data
  OPEN ref_cursor;
  ref_loop: LOOP
    FETCH ref_cursor INTO ref_id;
    IF done THEN LEAVE ref_loop; END IF;
    CALL delete_content_cascade(ref_id);
  END LOOP;
  CLOSE ref_cursor;

  -- Now delete the task itself
  CALL delete_content_cascade(task_id);

  SELECT CONCAT('✅ Deleted task ', task_id, ' and all linked reference content') AS message;
END$$

DELIMITER ;

SELECT '✅ Stored procedure created: delete_task_and_references' AS status;
SELECT 'Usage: CALL delete_task_and_references(1234);' AS example;
