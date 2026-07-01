select *
 from claim_links where target_claim_id=35847;
 
 SELECT
    claim_link_id AS reference_claim_task_links_id,
    source_claim_id AS reference_claim_id,
    target_claim_id AS task_claim_id,
    CASE
      WHEN support_level > 0.5 THEN 'support'
      WHEN support_level < -0.5 THEN 'refute'
      WHEN support_level BETWEEN -0.5 AND 0.5 THEN 'nuance'
      ELSE 'insufficient'
    END AS stance,
    ROUND(ABS(support_level) * 100, 2) AS score,
    COALESCE(confidence, 0.7) AS confidence,
    support_level,
    rationale,
    NULL AS quote,
    created_by_ai,
    user_id AS verified_by_user_id,
    created_at,
    'claim_links:target' AS source_table
  FROM claim_links
  WHERE target_claim_id = 35847 AND disabled = 0;
Error Code: 1054. Unknown column 'rationale' in 'field list'

;
use truthtrollers;
SET SQL_SAFE_UPDATES = 0;
select *;delete from content where content_id=11399;
select *;delete from content_scores where content_id=11399;
Error Code: 1451. Cannot delete or update a parent row: a 
foreign key constraint fails (`truthtrollers`.`reference_claim_task_links`, 
CONSTRAINT `reference_claim_task_links_ibfk_2` FOREIGN KEY (`task_claim_id`) REFERENCES `claims` (`claim_id`))
