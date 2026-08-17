-- Fix InsertOrGetPublisher so duplicate publisher_name rows do not
-- raise ER_TOO_MANY_ROWS during evidence/reference processing.
--
-- Existing contract is preserved:
--   exact publisher_name lookup
--   reuse an existing publisher when found
--   otherwise create one
--   return publisherId
--
-- Deterministic choice among existing duplicate names:
--   lowest publisher_id

DROP PROCEDURE IF EXISTS InsertOrGetPublisher;

DELIMITER $$

CREATE DEFINER=`root`@`localhost` PROCEDURE `InsertOrGetPublisher`(
    IN publisherName VARCHAR(255),
    IN publisherOwner VARCHAR(255),
    IN publisherIcon VARCHAR(255),
    OUT publisherId INT
)
BEGIN
    SET publisherId = NULL;

    SELECT publisher_id
    INTO publisherId
    FROM publishers
    WHERE publisher_name = publisherName
    ORDER BY publisher_id ASC
    LIMIT 1;

    IF publisherId IS NULL THEN
        INSERT INTO publishers (
            publisher_name,
            publisher_owner,
            publisher_icon
        )
        VALUES (
            publisherName,
            publisherOwner,
            publisherIcon
        );

        SET publisherId = LAST_INSERT_ID();
    END IF;

    SELECT publisherId;
END$$

DELIMITER ;