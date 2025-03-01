export const getNodesForEntity = (entityType) => {
  if (entityType === "task") {
    return `
        SELECT 'task' AS type, t.content_id AS id, t.content_name AS label, t.url 
        FROM content t
        WHERE t.content_id = ?

        UNION

        SELECT 'author' AS type, a.author_id AS id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
               NULL AS url
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        WHERE ca.content_id = ?
        

        UNION

        SELECT 'publisher' AS type, p.publisher_id AS id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        WHERE tp.content_id = ?
        

        UNION

        SELECT 'reference' AS type, lr.content_id AS id, lr.content_name AS label, lr.url AS url
        FROM content lr
        JOIN content_relations tr ON lr.content_id = tr.reference_content_id
        WHERE tr.content_id = ?
        ;
      `;
  }

  if (entityType === "author") {
    return `
        SELECT 'author' AS type, a.author_id AS id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label, 
               NULL AS url
        FROM authors a
        WHERE a.author_id = ?

        UNION

        SELECT 'task' AS type, t.content_id AS id, t.content_name AS label, t.url
        FROM content t
        JOIN content_authors ca ON t.content_id = ca.content_id
        WHERE t.content_type='task' AND ca.author_id = ?
        

        UNION

        SELECT 'reference' AS type, lr.content_id AS id, lr.content_name AS label, lr.url AS url
        FROM content lr
        JOIN content_authors ca ON lr.content_id = ca.content_id
        WHERE lr.content_type='reference' AND ca.author_id = ?
        

        UNION

        SELECT 'publisher' AS type, p.publisher_id AS id, p.publisher_name AS label, 
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
        SELECT 'publisher' AS type, p.publisher_id AS id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        WHERE p.publisher_id = ?

        UNION

        SELECT 'task' AS type, t.content_id AS id, t.content_name AS label, t.url
        FROM content t
        JOIN content_publishers tp ON t.content_id = tp.content_id
        WHERE t.content_type = 'task' AND tp.publisher_id = ?
        

        UNION

        SELECT 'author' AS type, a.author_id AS id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label, 
               NULL AS url
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_publishers tp ON ca.content_id = tp.content_id
        WHERE tp.publisher_id = ?
        

        UNION

        SELECT 'reference' AS type, lr.content_id AS id, lr.content_name AS label, lr.url AS url
        FROM content lr
        JOIN content_publishers tp ON lr.content_id = tp.content_id
        WHERE lr.content_type = 'reference' AND tp.publisher_id = ?
        ;
      `;
  }

  if (entityType === "reference") {
    return `
        SELECT 'reference' AS type, lr.content_id AS id, lr.content_name AS label, lr.url AS url
        FROM content lr
        WHERE lr.content_id = ?

        UNION

        SELECT 'task' AS type, t.content_id AS id, t.content_name AS label, t.url
        FROM content t
        JOIN content_relations tr ON t.content_id = tr.content_id
        WHERE tr.reference_content_id = ?
        

        UNION

        SELECT 'author' AS type, a.author_id AS id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label, 
               NULL AS url
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_relations tr ON ca.content_id = tr.reference_content_id
        WHERE tr.reference_content_id = ?
        

        UNION

        SELECT 'publisher' AS type, p.publisher_id AS id, p.publisher_name AS label, 
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
        SELECT 'authored' AS type, ca.content_id AS source, ca.author_id AS target
        FROM content_authors ca
        WHERE ca.content_id = ?
        

        UNION

        SELECT 'published_by' AS type, tp.content_id AS source, tp.publisher_id AS target
        FROM content_publishers tp
        WHERE tp.content_id = ?
        

        UNION

        SELECT 'references' AS type, tr.content_id AS source, tr.reference_content_id AS target
        FROM content_relations tr
        WHERE tr.content_id = ?
        ;
      `;
  }

  if (entityType === "author") {
    return `
        SELECT 'authored' AS type, ca.author_id AS source, ca.content_id AS target
        FROM content_authors ca
        WHERE ca.author_id = ?
        

        UNION

        SELECT 'published_by' AS type, ca.author_id AS source, p.publisher_id AS target
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN content_authors ca ON tp.content_id = ca.content_id
        WHERE ca.author_id = ?
        

        UNION

        SELECT 'auth_referenced' AS type, ca.author_id AS source, ca.content_id AS target
        FROM content_authors ca
        WHERE ca.author_id = ?
        ;
      `;
  }

  if (entityType === "publisher") {
    return `
        SELECT 'published' AS type, tp.publisher_id AS source, tp.content_id AS target
        FROM content_publishers tp
        WHERE tp.publisher_id = ?
        

        UNION

        SELECT 'has_author' AS type, tp.publisher_id AS source, ca.author_id AS target
        FROM content_authors ca
        JOIN content_publishers tp ON ca.content_id = tp.content_id
        WHERE tp.publisher_id = ?
        ;
      `;
  }

  if (entityType === "reference") {
    return `
        SELECT 'references' AS type, cr.reference_content_id AS source, cr.content_id AS target
        FROM content_relations cr
        WHERE cr.reference_content_id = ?
        

        UNION

        SELECT 'referenced_by' AS type, cr.content_id AS source, cr.reference_content_id AS target
        FROM content_relations cr
        WHERE cr.content_id = ?
        UNION

         SELECT 'has_author' AS type, c.content_id AS source, ca.author_id AS target
        FROM content_authors ca
        JOIN content c ON ca.content_id = c.content_id
        WHERE c.content_type='reference' and ca.content_id = ?

        UNION

        SELECT 'published' AS type, tp.publisher_id AS source, tp.content_id AS target
        FROM content_publishers tp
        WHERE tp.content_id = ?
        ;
      `;
  }

  return null;
};
