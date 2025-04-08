export const getNodesForEntity = (entityType) => {
  if (entityType === "task") {
    return `
        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id, t.content_id AS content_id, t.content_name AS label, t.url 
        FROM content t
        WHERE t.content_id = ?

        UNION

        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id, a.author_id AS author_id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
               NULL AS url
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        WHERE ca.content_id = ?
        

        UNION

        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id, p.publisher_id AS publisher_id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        WHERE tp.content_id = ?
        

        UNION

        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id, lr.content_id AS content_id, lr.content_name AS label, lr.url AS url
        FROM content lr
        JOIN content_relations tr ON lr.content_id = tr.reference_content_id
        WHERE tr.content_id = ?
        ;
      `;
  }

  if (entityType === "author") {
    return `
        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id, a.author_id AS author_id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label, 
               NULL AS url
        FROM authors a
        WHERE a.author_id = ?

        UNION

        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id, t.content_id AS content_id, t.content_name AS label, t.url
        FROM content t
        JOIN content_authors ca ON t.content_id = ca.content_id
        WHERE t.content_type='task' AND ca.author_id = ?
        

        UNION

        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id, lr.content_id AS content_id, lr.content_name AS label, lr.url AS url
        FROM content lr
        JOIN content_authors ca ON lr.content_id = ca.content_id
        WHERE lr.content_type='reference' AND ca.author_id = ?
        

        UNION

        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id, p.publisher_id AS publisher_id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN content_authors ca ON tp.content_id = ca.content_id
        WHERE ca.author_id = ?
        ;
      `;
  }

  if (entityType === "publisher") {
    return `
        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id, p.publisher_id AS publisher_id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        WHERE p.publisher_id = ?

        UNION

        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id, t.content_id AS content_id, t.content_name AS label, t.url
        FROM content t
        JOIN content_publishers tp ON t.content_id = tp.content_id
        WHERE t.content_type = 'task' AND tp.publisher_id = ?
        

        UNION

        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id, a.author_id AS author_id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label, 
               NULL AS url
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_publishers tp ON ca.content_id = tp.content_id
        WHERE tp.publisher_id = ?
        

        UNION

        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id, lr.content_id AS content_id, lr.content_name AS label, lr.url AS url
        FROM content lr
        JOIN content_publishers tp ON lr.content_id = tp.content_id
        WHERE lr.content_type = 'reference' AND tp.publisher_id = ?
        ;
      `;
  }

  if (entityType === "reference") {
    return `
        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id, lr.content_id AS content_id, lr.content_name AS label, lr.url AS url
        FROM content lr
        WHERE lr.content_id = ?

        UNION

        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id, t.content_id AS content_id, t.content_name AS label, t.url
        FROM content t
        JOIN content_relations tr ON t.content_id = tr.content_id
        WHERE tr.reference_content_id = ?
        

        UNION

        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id, a.author_id AS author_id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label, 
               NULL AS url
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_relations tr ON ca.content_id = tr.reference_content_id
        WHERE tr.reference_content_id = ?
        

        UNION

        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id, p.publisher_id AS publisher_id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN content_relations tr ON tp.content_id = tr.reference_content_id
        WHERE tr.reference_content_id = ?
        ;
      `;
  }

  return null;
};

export const getLinksForEntity = (entityType) => {
  if (entityType === "task") {
    return `
      SELECT 
        'authored' AS type, 
        CONCAT("conte-", ca.content_id) AS source, 
        CONCAT("autho-", ca.author_id) AS target,
        CONCAT("conte-", ca.content_id, "_autho-", ca.author_id) AS id
      FROM content_authors ca
      WHERE ca.content_id = ?

      UNION

      SELECT 
        'published_by' AS type, 
        CONCAT("conte-", tp.content_id) AS source, 
        CONCAT("publi-", tp.publisher_id) AS target,
        CONCAT("conte-", tp.content_id, "_publi-", tp.publisher_id) AS id
      FROM content_publishers tp
      WHERE tp.content_id = ?

      UNION

      SELECT 
        'references' AS type, 
        CONCAT("conte-", tr.content_id) AS source, 
        CONCAT("conte-", tr.reference_content_id) AS target,
        CONCAT("conte-", tr.content_id, "_conte-", tr.reference_content_id) AS id
      FROM content_relations tr
      WHERE tr.content_id = ?
    `;
  }

  if (entityType === "author") {
    return `
      SELECT 
        'authored' AS type, 
        CONCAT("autho-", ca.author_id) AS source, 
        CONCAT("conte-", ca.content_id) AS target,
        CONCAT("autho-", ca.author_id, "_conte-", ca.content_id) AS id
      FROM content_authors ca
      WHERE ca.author_id = ?

      UNION

      SELECT 
        'published_by' AS type, 
        CONCAT("autho-", ca.author_id) AS source, 
        CONCAT("publi-", p.publisher_id) AS target,
        CONCAT("autho-", ca.author_id, "_publi-", p.publisher_id) AS id
      FROM publishers p
      JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
      JOIN content_authors ca ON tp.content_id = ca.content_id
      WHERE ca.author_id = ?

      UNION

      SELECT 
        'auth_referenced' AS type, 
        CONCAT("autho-", ca.author_id) AS source, 
        CONCAT("conte-", ca.content_id) AS target,
        CONCAT("autho-", ca.author_id, "_conte-", ca.content_id) AS id
      FROM content_authors ca
      WHERE ca.author_id = ?
    `;
  }

  if (entityType === "publisher") {
    return `
      SELECT 
        'published' AS type, 
        CONCAT("publi-", tp.publisher_id) AS source, 
        CONCAT("conte-", tp.content_id) AS target,
        CONCAT("publi-", tp.publisher_id, "_conte-", tp.content_id) AS id
      FROM content_publishers tp
      WHERE tp.publisher_id = ?

      UNION

      SELECT 
        'has_author' AS type, 
        CONCAT("publi-", tp.publisher_id) AS source, 
        CONCAT("autho-", ca.author_id) AS target,
        CONCAT("publi-", tp.publisher_id, "_autho-", ca.author_id) AS id
      FROM content_authors ca
      JOIN content_publishers tp ON ca.content_id = tp.content_id
      WHERE tp.publisher_id = ?
    `;
  }

  if (entityType === "reference") {
    return `
      SELECT 
        'references' AS type, 
        CONCAT("conte-", cr.reference_content_id) AS source, 
        CONCAT("conte-", cr.content_id) AS target,
        CONCAT("conte-", cr.reference_content_id, "_conte-", cr.content_id) AS id
      FROM content_relations cr
      WHERE cr.reference_content_id = ?

      UNION

      SELECT 
        'referenced_by' AS type, 
        CONCAT("conte-", cr.content_id) AS source, 
        CONCAT("conte-", cr.reference_content_id) AS target,
        CONCAT("conte-", cr.content_id, "_conte-", cr.reference_content_id) AS id
      FROM content_relations cr
      WHERE cr.content_id = ?

      UNION

      SELECT 
        'has_author' AS type, 
        CONCAT("conte-", c.content_id) AS source, 
        CONCAT("autho-", ca.author_id) AS target,
        CONCAT("conte-", c.content_id, "_autho-", ca.author_id) AS id
      FROM content_authors ca
      JOIN content c ON ca.content_id = c.content_id
      WHERE c.content_type = 'reference' AND ca.content_id = ?

      UNION

      SELECT 
        'published' AS type, 
        CONCAT("publi-", tp.publisher_id) AS source, 
        CONCAT("conte-", tp.content_id) AS target,
        CONCAT("publi-", tp.publisher_id, "_conte-", tp.content_id) AS id
      FROM content_publishers tp
      WHERE tp.content_id = ?
    `;
  }

  return null;
};

// graphQueries.js

export const getLinkedClaimsAndLinksForTask = (taskId) => {
  return {
    claimNodeSql: `
      -- Task Claims
      SELECT DISTINCT 
        CONCAT('claim-', c.claim_id) AS id,
        c.claim_id,
        cc.content_id,
        c.claim_text AS label,
        'taskClaim' AS type
      FROM claims c
      JOIN content_claims cc ON c.claim_id = cc.claim_id
      WHERE cc.content_id = ?

      UNION

      -- Reference Claims that link to the task's claims
      SELECT DISTINCT 
        CONCAT('claim-', c2.claim_id) AS id,
        c2.claim_id,
        cc2.content_id,
        c2.claim_text AS label,
        'refClaim' AS type
      FROM claim_links cl
      JOIN claims c2 ON c2.claim_id = cl.source_claim_id
      JOIN content_claims cc2 ON c2.claim_id = cc2.claim_id
      WHERE cl.target_claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = ?
      );
    `,
    claimLinkSql: `
      -- Only include links where the target is a taskClaim for this task
      SELECT 
        cl.relationship AS relation,
        cl.support_level AS value,
        CONCAT('claim-', cl.source_claim_id) AS source,
        CONCAT('claim-', cl.target_claim_id) AS target,
        cl.claim_link_id,
        cl.notes,
        cl.created_at
      FROM claim_links cl
      WHERE cl.target_claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = ?
      );
    `,
    params: [taskId, taskId, taskId],
  };
};
