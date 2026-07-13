-- Scope AI-suggested evidence links to the concrete task/reference relation.
--
-- The old model could infer a task/source relationship through shared claim IDs
-- even when that source was no longer linked to the task in content_relations.
-- These columns make the task_content_id/reference_content_id pair explicit via
-- content_relations.content_relation_id while preserving the existing tables.

ALTER TABLE reference_claim_links
  ADD COLUMN content_relation_id INT NULL AFTER claim_id,
  ADD COLUMN task_claim_id INT NULL AFTER content_relation_id;

ALTER TABLE reference_claim_task_links
  ADD COLUMN content_relation_id INT NULL AFTER reference_claim_task_links_id;

UPDATE reference_claim_links
SET task_claim_id = claim_id
WHERE task_claim_id IS NULL;

UPDATE reference_claim_links rcl
JOIN (
  SELECT
    rcl2.ref_claim_link_id,
    MIN(cr.content_relation_id) AS content_relation_id,
    COUNT(DISTINCT cr.content_relation_id) AS relation_count
  FROM reference_claim_links rcl2
  JOIN content_claims cc
    ON cc.claim_id = rcl2.claim_id
  JOIN content_relations cr
    ON cr.content_id = cc.content_id
   AND cr.reference_content_id = rcl2.reference_content_id
  GROUP BY rcl2.ref_claim_link_id
  HAVING relation_count = 1
) scoped
  ON scoped.ref_claim_link_id = rcl.ref_claim_link_id
SET rcl.content_relation_id = scoped.content_relation_id
WHERE rcl.content_relation_id IS NULL;

UPDATE reference_claim_task_links rctl
JOIN (
  SELECT
    rctl2.reference_claim_task_links_id,
    MIN(cr.content_relation_id) AS content_relation_id,
    COUNT(DISTINCT cr.content_relation_id) AS relation_count
  FROM reference_claim_task_links rctl2
  JOIN content_claims task_cc
    ON task_cc.claim_id = rctl2.task_claim_id
  JOIN content_claims ref_cc
    ON ref_cc.claim_id = rctl2.reference_claim_id
  JOIN content_relations cr
    ON cr.content_id = task_cc.content_id
   AND cr.reference_content_id = ref_cc.content_id
  GROUP BY rctl2.reference_claim_task_links_id
  HAVING relation_count = 1
) scoped
  ON scoped.reference_claim_task_links_id = rctl.reference_claim_task_links_id
SET rctl.content_relation_id = scoped.content_relation_id
WHERE rctl.content_relation_id IS NULL;

ALTER TABLE reference_claim_links
  ADD INDEX idx_rcl_content_relation (content_relation_id),
  ADD INDEX idx_rcl_task_claim (task_claim_id),
  ADD CONSTRAINT fk_rcl_content_relation
    FOREIGN KEY (content_relation_id)
    REFERENCES content_relations(content_relation_id)
    ON DELETE CASCADE,
  ADD CONSTRAINT fk_rcl_task_claim
    FOREIGN KEY (task_claim_id)
    REFERENCES claims(claim_id)
    ON DELETE CASCADE;

ALTER TABLE reference_claim_task_links
  ADD INDEX idx_rctl_content_relation (content_relation_id),
  ADD INDEX idx_rctl_claim_pair (reference_claim_id, task_claim_id),
  ADD CONSTRAINT fk_rctl_content_relation
    FOREIGN KEY (content_relation_id)
    REFERENCES content_relations(content_relation_id)
    ON DELETE CASCADE;

ALTER TABLE reference_claim_task_links
  DROP INDEX unique_claim_pair,
  ADD UNIQUE KEY uq_rctl_relation_claim_pair (content_relation_id, reference_claim_id, task_claim_id);

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

    -- 4. Scoped AI document links for task/reference relations involving this content.
    DELETE rcl FROM reference_claim_links rcl
    INNER JOIN content_relations cr
      ON cr.content_relation_id = rcl.content_relation_id
    WHERE cr.content_id = content_id_to_delete
       OR cr.reference_content_id = content_id_to_delete;

    -- 5. Scoped AI claim links for task/reference relations involving this content.
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_relations cr
      ON cr.content_relation_id = rctl.content_relation_id
    WHERE cr.content_id = content_id_to_delete
       OR cr.reference_content_id = content_id_to_delete;

    -- 6. Legacy document links without content_relation_id — task side.
    DELETE rcl FROM reference_claim_links rcl
    INNER JOIN content_claims cc ON COALESCE(rcl.task_claim_id, rcl.claim_id) = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 7. Legacy document links without content_relation_id — reference side.
    DELETE FROM reference_claim_links
    WHERE reference_content_id = content_id_to_delete;

    -- 8. Legacy claim links without content_relation_id — task side.
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 9. Legacy claim links without content_relation_id — reference side.
    DELETE rctl FROM reference_claim_task_links rctl
    INNER JOIN content_claims cc ON rctl.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 10. claim_links — source side
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 11. claim_links — target side
    DELETE cl FROM claim_links cl
    INNER JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 12. user_claim_ratings — task side
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.task_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 13. user_claim_ratings — reference side
    DELETE ucr FROM user_claim_ratings ucr
    INNER JOIN content_claims cc ON ucr.reference_claim_id = cc.claim_id
    WHERE cc.content_id = content_id_to_delete;

    -- 14. claims — orphaned only (not shared with other content)
    DELETE c FROM claims c
    INNER JOIN content_claims cc1 ON c.claim_id = cc1.claim_id
    LEFT  JOIN content_claims cc2 ON c.claim_id = cc2.claim_id
                                  AND cc2.content_id != content_id_to_delete
    WHERE cc1.content_id = content_id_to_delete
      AND cc2.claim_id IS NULL;

    -- 15. content_claims junction
    DELETE FROM content_claims WHERE content_id = content_id_to_delete;

    -- 16. content_relations. Scoped AI links above also cascade through FK.
    DELETE FROM content_relations WHERE reference_content_id = content_id_to_delete;
    DELETE FROM content_relations WHERE content_id = content_id_to_delete;

    -- 17. content_scores
    DELETE FROM content_scores WHERE content_id = content_id_to_delete;

    -- 18. user_reference_visibility
    DELETE FROM user_reference_visibility
    WHERE task_content_id      = content_id_to_delete
       OR reference_content_id = content_id_to_delete;

    -- 19. publisher_enrichment_runs for publishers that will become orphaned.
    DELETE per FROM publisher_enrichment_runs per
    INNER JOIN content_publishers cp ON per.publisher_id = cp.publisher_id
    WHERE cp.content_id = content_id_to_delete
      AND per.publisher_id NOT IN (
          SELECT cp2.publisher_id FROM content_publishers cp2
          WHERE cp2.content_id != content_id_to_delete
      );

    -- 20. content_authors / content_publishers junction rows. Master author and
    --     publisher rows are intentionally retained because they may be shared.
    DELETE FROM content_authors    WHERE content_id = content_id_to_delete;
    DELETE FROM content_publishers WHERE content_id = content_id_to_delete;

    -- 21. molecule_view_pins (child rows first, then the view rows)
    DELETE mvp FROM molecule_view_pins mvp
    INNER JOIN molecule_views mv ON mvp.view_id = mv.id
    WHERE mv.content_id = content_id_to_delete;

    DELETE FROM molecule_views WHERE content_id = content_id_to_delete;

    -- 22. discussion_entries
    DELETE FROM discussion_entries WHERE content_id = content_id_to_delete;

    -- 23. content_users
    DELETE FROM content_users WHERE content_id = content_id_to_delete;

    -- 24. admiralty_evaluations
    DELETE FROM admiralty_evaluations
    WHERE target_type = 'content' AND target_id = content_id_to_delete;

    -- 25. content row
    DELETE FROM content WHERE content_id = content_id_to_delete;

    COMMIT;

    SELECT CONCAT('Deleted content_id ', content_id_to_delete) AS message;

END$$

DELIMITER ;
