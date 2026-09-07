-- Remove abandoned TM4 evaluation-target storage from the active delete contract.
-- These tables have no consumers on current main and do not exist in production.
-- Safe to run repeatedly: tables are dropped with IF EXISTS and the procedure is replaced.

DROP PROCEDURE IF EXISTS delete_content_cascade;

DELIMITER $$

CREATE PROCEDURE `delete_content_cascade`(IN content_id_to_delete INT)
BEGIN
  DECLARE rows_added INT DEFAULT 0;
  DECLARE target_exists INT DEFAULT 0;
  DECLARE current_step VARCHAR(128) DEFAULT 'initialize';
  DECLARE failure_message TEXT;
  DECLARE reported_message TEXT;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 failure_message = MESSAGE_TEXT;
    ROLLBACK;
    SET reported_message = LEFT(CONCAT(current_step, ': ', failure_message), 128);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = reported_message;
  END;

  SELECT COUNT(*) INTO target_exists
    FROM content
   WHERE content_id=content_id_to_delete;
  IF target_exists <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='content_id does not exist';
  END IF;

  DROP TEMPORARY TABLE IF EXISTS tmp_delete_contents;
  DROP TEMPORARY TABLE IF EXISTS tmp_delete_contents_copy;
  DROP TEMPORARY TABLE IF EXISTS tmp_new_delete_contents;
  DROP TEMPORARY TABLE IF EXISTS tmp_delete_relations;
  DROP TEMPORARY TABLE IF EXISTS tmp_delete_claims;
  DROP TEMPORARY TABLE IF EXISTS tmp_exclusive_claims;
  DROP TEMPORARY TABLE IF EXISTS tmp_delete_authors;
  DROP TEMPORARY TABLE IF EXISTS tmp_delete_publishers;
  DROP TEMPORARY TABLE IF EXISTS tmp_orphan_authors;
  DROP TEMPORARY TABLE IF EXISTS tmp_orphan_publishers;

  CREATE TEMPORARY TABLE tmp_delete_contents (
    content_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  CREATE TEMPORARY TABLE tmp_delete_contents_copy LIKE tmp_delete_contents;
  CREATE TEMPORARY TABLE tmp_new_delete_contents LIKE tmp_delete_contents;
  INSERT INTO tmp_delete_contents(content_id) VALUES (content_id_to_delete);

  -- Recursively add only product references exclusively owned by the current
  -- closure. Reference ownership comes exclusively from content_relations;
  -- task/both rows and references with any external incoming relation remain.
  ownership_loop: LOOP
    TRUNCATE TABLE tmp_delete_contents_copy;
    INSERT INTO tmp_delete_contents_copy SELECT * FROM tmp_delete_contents;
    TRUNCATE TABLE tmp_new_delete_contents;

    INSERT IGNORE INTO tmp_new_delete_contents(content_id)
    SELECT relation.reference_content_id
      FROM content_relations relation
      JOIN tmp_delete_contents owner
        ON owner.content_id=relation.content_id
      JOIN content reference_content
        ON reference_content.content_id=relation.reference_content_id
      LEFT JOIN content_relations incoming
        ON incoming.reference_content_id=relation.reference_content_id
      LEFT JOIN tmp_delete_contents_copy internal_owner
        ON internal_owner.content_id=incoming.content_id
     WHERE reference_content.content_type='reference'
     GROUP BY relation.reference_content_id
    HAVING SUM(
      CASE
        WHEN incoming.content_relation_id IS NOT NULL
         AND internal_owner.content_id IS NULL THEN 1
        ELSE 0
      END
    )=0;

    INSERT IGNORE INTO tmp_delete_contents(content_id)
    SELECT content_id FROM tmp_new_delete_contents;
    SET rows_added=ROW_COUNT();
    IF rows_added=0 THEN
      LEAVE ownership_loop;
    END IF;
  END LOOP;

  TRUNCATE TABLE tmp_delete_contents_copy;
  INSERT INTO tmp_delete_contents_copy SELECT * FROM tmp_delete_contents;

  CREATE TEMPORARY TABLE tmp_delete_relations (
    content_relation_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT INTO tmp_delete_relations(content_relation_id)
  SELECT relation.content_relation_id
    FROM content_relations relation
    LEFT JOIN tmp_delete_contents owner
      ON owner.content_id=relation.content_id
    LEFT JOIN tmp_delete_contents_copy reference
      ON reference.content_id=relation.reference_content_id
   WHERE owner.content_id IS NOT NULL
      OR reference.content_id IS NOT NULL;

  CREATE TEMPORARY TABLE tmp_delete_claims (
    claim_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT IGNORE INTO tmp_delete_claims(claim_id)
  SELECT content_claim.claim_id
    FROM content_claims content_claim
    JOIN tmp_delete_contents owned
      ON owned.content_id=content_claim.content_id;

  CREATE TEMPORARY TABLE tmp_exclusive_claims (
    claim_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT INTO tmp_exclusive_claims(claim_id)
  SELECT candidate.claim_id
    FROM tmp_delete_claims candidate
    LEFT JOIN content_claims association
      ON association.claim_id=candidate.claim_id
    LEFT JOIN tmp_delete_contents_copy owned
      ON owned.content_id=association.content_id
   GROUP BY candidate.claim_id
  HAVING SUM(
    CASE
      WHEN association.cc_id IS NOT NULL AND owned.content_id IS NULL THEN 1
      ELSE 0
    END
  )=0;

  CREATE TEMPORARY TABLE tmp_delete_authors (
    author_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT IGNORE INTO tmp_delete_authors(author_id)
  SELECT content_author.author_id
    FROM content_authors content_author
    JOIN tmp_delete_contents owned
      ON owned.content_id=content_author.content_id;

  CREATE TEMPORARY TABLE tmp_delete_publishers (
    publisher_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT IGNORE INTO tmp_delete_publishers(publisher_id)
  SELECT content_publisher.publisher_id
    FROM content_publishers content_publisher
    JOIN tmp_delete_contents owned
      ON owned.content_id=content_publisher.content_id;

  CREATE TEMPORARY TABLE tmp_orphan_authors (
    author_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT INTO tmp_orphan_authors(author_id)
  SELECT candidate.author_id
    FROM tmp_delete_authors candidate
   WHERE NOT EXISTS (
     SELECT 1
       FROM content_authors association
       LEFT JOIN tmp_delete_contents owned
         ON owned.content_id=association.content_id
      WHERE association.author_id=candidate.author_id
        AND owned.content_id IS NULL
   );

  CREATE TEMPORARY TABLE tmp_orphan_publishers (
    publisher_id INT PRIMARY KEY
  ) ENGINE=MEMORY;
  INSERT INTO tmp_orphan_publishers(publisher_id)
  SELECT candidate.publisher_id
    FROM tmp_delete_publishers candidate
   WHERE NOT EXISTS (
     SELECT 1
       FROM content_publishers association
       LEFT JOIN tmp_delete_contents owned
         ON owned.content_id=association.content_id
      WHERE association.publisher_id=candidate.publisher_id
        AND owned.content_id IS NULL
   );

  START TRANSACTION;

  SET current_step='delete assertion links';
  DELETE assertion_link
    FROM reference_claim_task_links assertion_link
    JOIN tmp_delete_relations relation
      ON relation.content_relation_id=assertion_link.content_relation_id;
  DELETE assertion_link
    FROM reference_claim_task_links assertion_link
    JOIN tmp_exclusive_claims affected_claim
      ON affected_claim.claim_id=assertion_link.reference_claim_id
      OR affected_claim.claim_id=assertion_link.task_claim_id
   WHERE assertion_link.content_relation_id IS NULL
  ;

  SET current_step='delete document links';
  DELETE document_link
    FROM reference_claim_links document_link
    JOIN tmp_delete_relations relation
      ON relation.content_relation_id=document_link.content_relation_id;
  DELETE document_link
    FROM reference_claim_links document_link
    JOIN tmp_delete_contents owned
      ON owned.content_id=document_link.reference_content_id;
  DELETE document_link
    FROM reference_claim_links document_link
    LEFT JOIN tmp_exclusive_claims task_claim
      ON task_claim.claim_id=COALESCE(document_link.task_claim_id,document_link.claim_id)
   WHERE document_link.content_relation_id IS NULL
     AND task_claim.claim_id IS NOT NULL;

  SET current_step='delete claim links';
  DELETE claim_link
    FROM claim_links claim_link
    JOIN tmp_exclusive_claims affected_claim
      ON affected_claim.claim_id=claim_link.source_claim_id
      OR affected_claim.claim_id=claim_link.target_claim_id;

  DELETE retrieval_link
    FROM claim_retrieval_evidence retrieval_link
    JOIN tmp_exclusive_claims affected_claim
      ON affected_claim.claim_id=retrieval_link.case_claim_id
      OR affected_claim.claim_id=retrieval_link.source_claim_id;

  DELETE rating
    FROM user_claim_ratings rating
    JOIN tmp_exclusive_claims affected_claim
      ON affected_claim.claim_id=rating.reference_claim_id
      OR affected_claim.claim_id=rating.task_claim_id;

  SET current_step='delete source projections';
  DELETE source
    FROM claim_sources source
    JOIN tmp_delete_contents owned
      ON owned.content_id=source.reference_content_id;
  DELETE source
    FROM claim_sources source
    JOIN tmp_exclusive_claims claim
      ON claim.claim_id=source.claim_id;
  DELETE source
    FROM claims_references source
    JOIN tmp_delete_contents owned
      ON owned.content_id=source.reference_content_id;
  DELETE source
    FROM claims_references source
    JOIN tmp_exclusive_claims claim
      ON claim.claim_id=source.claim_id;
  DELETE score
    FROM claim_scores score
    JOIN tmp_delete_contents owned
      ON owned.content_id=score.content_id;

  SET current_step='delete content relations';
  DELETE relation
    FROM content_relations relation
    JOIN tmp_delete_relations target
      ON target.content_relation_id=relation.content_relation_id;

  SET current_step='delete retained content children';
  DELETE topic FROM content_topics topic
    JOIN tmp_delete_contents owned ON owned.content_id=topic.content_id;
  DELETE testimonial FROM content_testimonials testimonial
    JOIN tmp_delete_contents owned ON owned.content_id=testimonial.content_id;
  DELETE review FROM review_articles review
    JOIN tmp_delete_contents owned ON owned.content_id=review.content_id;
  DELETE score FROM content_scores score
    JOIN tmp_delete_contents owned ON owned.content_id=score.content_id;
  DELETE quality FROM content_source_quality quality
    JOIN tmp_delete_contents owned ON owned.content_id=quality.content_id;
  DELETE content_user FROM content_users content_user
    JOIN tmp_delete_contents owned ON owned.content_id=content_user.content_id;
  DELETE discussion FROM discussion_entries discussion
    JOIN tmp_delete_contents owned ON owned.content_id=discussion.content_id;
  DELETE visibility FROM user_reference_visibility visibility
    JOIN tmp_delete_contents owned ON owned.content_id=visibility.task_content_id;
  DELETE visibility FROM user_reference_visibility visibility
    JOIN tmp_delete_contents owned ON owned.content_id=visibility.reference_content_id;
  DELETE evaluation FROM admiralty_evaluations evaluation
    JOIN tmp_delete_contents owned ON owned.content_id=evaluation.target_id
   WHERE evaluation.target_type='content';
  DELETE job FROM scrape_jobs job
    LEFT JOIN tmp_delete_contents task ON task.content_id=job.task_content_id
    LEFT JOIN tmp_delete_contents_copy result ON result.content_id=job.result_content_id
   WHERE task.content_id IS NOT NULL OR result.content_id IS NOT NULL;
  DELETE argument FROM ttlive_conversation_arguments argument
    JOIN tmp_delete_contents owned ON owned.content_id=argument.evidence_content_id;
  DELETE evidence FROM ttlive_post_evidence evidence
    JOIN tmp_delete_contents owned ON owned.content_id=evidence.content_id;
  DELETE score FROM user_verimeter_scores score
    JOIN tmp_delete_contents owned ON owned.content_id=score.content_id;

  SET current_step='delete content claim associations';
  DELETE content_claim
    FROM content_claims content_claim
    JOIN tmp_delete_contents owned
      ON owned.content_id=content_claim.content_id;

  SET current_step='delete scoped orphan author data';
  DELETE affiliation FROM author_affiliations affiliation
    JOIN tmp_orphan_authors orphan ON orphan.author_id=affiliation.author_id;
  DELETE rating FROM author_ratings rating
    JOIN tmp_orphan_authors orphan ON orphan.author_id=rating.author_id;
  DELETE check_row FROM author_credibility_checks check_row
    JOIN tmp_orphan_authors orphan ON orphan.author_id=check_row.author_id;

  SET current_step='delete scoped orphan publisher data';
  DELETE signal_row FROM publisher_external_signals signal_row
    JOIN tmp_orphan_publishers orphan ON orphan.publisher_id=signal_row.publisher_id;
  DELETE relationship FROM publisher_relationships relationship
    JOIN tmp_orphan_publishers orphan ON orphan.publisher_id=relationship.publisher_id;
  DELETE evaluation FROM admiralty_evaluations evaluation
    JOIN tmp_orphan_publishers orphan ON orphan.publisher_id=evaluation.publisher_id;

  SET current_step='delete author and publisher associations';
  DELETE association FROM content_authors association
    JOIN tmp_delete_contents owned ON owned.content_id=association.content_id;
  DELETE association FROM content_publishers association
    JOIN tmp_delete_contents owned ON owned.content_id=association.content_id;

  SET current_step='delete scoped orphan authors and publishers';
  DELETE author FROM authors author
    JOIN tmp_orphan_authors orphan ON orphan.author_id=author.author_id;
  DELETE publisher FROM publishers publisher
    JOIN tmp_orphan_publishers orphan ON orphan.publisher_id=publisher.publisher_id;

  SET current_step='delete content closure';
  DELETE content_row
    FROM content content_row
    JOIN tmp_delete_contents owned
      ON owned.content_id=content_row.content_id;

  SET current_step='delete genuinely orphaned claims';
  DELETE claim
    FROM claims claim
    JOIN tmp_delete_claims candidate ON candidate.claim_id=claim.claim_id
   WHERE NOT EXISTS (
     SELECT 1 FROM content_claims consumer
      WHERE consumer.claim_id=claim.claim_id OR consumer.parent_claim_id=claim.claim_id
   )
     AND NOT EXISTS (
       SELECT 1 FROM claim_links consumer
        WHERE consumer.source_claim_id=claim.claim_id OR consumer.target_claim_id=claim.claim_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM claim_retrieval_evidence consumer
        WHERE consumer.case_claim_id=claim.claim_id OR consumer.source_claim_id=claim.claim_id
     )
     AND NOT EXISTS (SELECT 1 FROM claim_sources consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM claim_variants consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM claim_verifications consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM discussion_entries consumer WHERE consumer.linked_claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM discussion_units consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (
       SELECT 1 FROM reference_claim_links consumer
        WHERE consumer.claim_id=claim.claim_id OR consumer.task_claim_id=claim.claim_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM reference_claim_task_links consumer
        WHERE consumer.reference_claim_id=claim.claim_id OR consumer.task_claim_id=claim.claim_id
     )
     AND NOT EXISTS (SELECT 1 FROM user_activities consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (
       SELECT 1 FROM user_claim_ratings consumer
        WHERE consumer.reference_claim_id=claim.claim_id OR consumer.task_claim_id=claim.claim_id
     )
     AND NOT EXISTS (SELECT 1 FROM user_claim_visibility consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM veracity_history consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM veracity_relations consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM claim_scores consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM claims_references consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM ttlive_post_evidence consumer WHERE consumer.claim_id=claim.claim_id)
     AND NOT EXISTS (SELECT 1 FROM ttlive_posts consumer WHERE consumer.context_claim_id=claim.claim_id);

  COMMIT;

  SELECT
    content_id_to_delete AS deleted_content_id,
    (SELECT COUNT(*) FROM tmp_delete_contents) AS deleted_content_count,
    (SELECT COUNT(*) FROM tmp_delete_relations) AS deleted_relation_count,
    (SELECT COUNT(*) FROM tmp_delete_claims) AS candidate_claim_count,
    (SELECT COUNT(*) FROM tmp_orphan_authors) AS scoped_orphan_author_count,
    (SELECT COUNT(*) FROM tmp_orphan_publishers) AS scoped_orphan_publisher_count;
END
$$

DELIMITER ;

DROP TABLE IF EXISTS evaluation_target_evidence_links;
DROP TABLE IF EXISTS claim_evaluation_targets;

SELECT 'delete_content_cascade updated; abandoned TM4 evaluation-target tables removed' AS status;

