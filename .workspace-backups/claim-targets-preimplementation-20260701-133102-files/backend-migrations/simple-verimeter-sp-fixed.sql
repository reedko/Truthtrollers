DROP PROCEDURE IF EXISTS compute_simple_verimeter_for_content;

DELIMITER $$

CREATE PROCEDURE compute_simple_verimeter_for_content(
    IN p_content_id INT,
    IN p_user_id INT
)
BEGIN
    DECLARE v_claim_id INT;
    DECLARE done1 INT DEFAULT 0;
    DECLARE v_verimeter DECIMAL(5,3);

    DECLARE cur_claims CURSOR FOR
        SELECT claim_id
        FROM content_claims
        WHERE content_id = p_content_id;
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done1 = 1;

    OPEN cur_claims;
    claims_loop: LOOP
        FETCH cur_claims INTO v_claim_id;
        IF done1 THEN
            LEAVE claims_loop;
        END IF;

        -- Calculate simple average of support_levels for this claim
        SELECT COALESCE(AVG(support_level), 0)
        INTO v_verimeter
        FROM claim_links
        WHERE target_claim_id = v_claim_id
          AND disabled = 0
          AND support_level != 0
          AND (p_user_id IS NULL OR user_id = p_user_id);

        -- Clamp to valid range
        IF v_verimeter > 1.0 THEN
            SET v_verimeter = 1.0;
        ELSEIF v_verimeter < -1.0 THEN
            SET v_verimeter = -1.0;
        END IF;

        -- Store per-claim verimeter score using new syntax
        INSERT INTO claim_scores (
            claim_id,
            content_id,
            user_id,
            verimeter_score,
            last_updated
        ) VALUES (
            v_claim_id,
            p_content_id,
            p_user_id,
            v_verimeter,
            NOW()
        ) AS new_values
        ON DUPLICATE KEY UPDATE
            verimeter_score = new_values.verimeter_score,
            last_updated = new_values.last_updated;

    END LOOP;
    CLOSE cur_claims;

    -- Calculate content-level score
    SELECT COALESCE(AVG(verimeter_score), 0)
    INTO v_verimeter
    FROM claim_scores
    WHERE content_id = p_content_id
      AND (user_id IS NULL OR user_id = p_user_id);

    -- Clamp to valid range
    IF v_verimeter > 1.0 THEN
        SET v_verimeter = 1.0;
    ELSEIF v_verimeter < -1.0 THEN
        SET v_verimeter = -1.0;
    END IF;

    -- Store content-level score
    IF p_user_id IS NULL THEN
        INSERT INTO content_scores (content_id, verimeter_score, last_updated)
        VALUES (p_content_id, v_verimeter, NOW())
        AS new_values
        ON DUPLICATE KEY UPDATE
            verimeter_score = new_values.verimeter_score,
            last_updated = new_values.last_updated;
    ELSE
        INSERT INTO user_verimeter_scores (user_id, content_id, verimeter_score, last_updated)
        VALUES (p_user_id, p_content_id, v_verimeter, NOW())
        AS new_values
        ON DUPLICATE KEY UPDATE
            verimeter_score = new_values.verimeter_score,
            last_updated = new_values.last_updated;
    END IF;

END$$

DELIMITER ;
