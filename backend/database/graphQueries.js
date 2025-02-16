export const getNodesForEntity = (entityType) => {
  if (entityType === "task") {
    return `
        SELECT 'task' AS type, t.task_id AS id, t.task_name AS label, t.url 
        FROM tasks t
        WHERE t.task_id = ?

        UNION

        SELECT 'author' AS type, a.author_id AS id, 
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
               NULL AS url
        FROM authors a
        JOIN task_authors ta ON a.author_id = ta.author_id
        WHERE ta.task_id = ?

        UNION

        SELECT 'publisher' AS type, p.publisher_id AS id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        JOIN task_publishers tp ON p.publisher_id = tp.publisher_id
        WHERE tp.task_id = ?

        UNION

        SELECT 'lit_reference' AS type, lr.lit_reference_id AS id, lr.lit_reference_title AS label, lr.lit_reference_link AS url
        FROM lit_references lr
        JOIN task_references tr ON lr.lit_reference_id = tr.lit_reference_id
        WHERE tr.task_id = ?;
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

        SELECT 'task' AS type, t.task_id AS id, t.task_name AS label, t.url
        FROM tasks t
        JOIN task_authors ta ON t.task_id = ta.task_id
        WHERE ta.author_id = ?

        UNION

        SELECT 'lit_reference' AS type, lr.lit_reference_id AS id, lr.lit_reference_title AS label, lr.lit_reference_link AS url
        FROM lit_references lr
        JOIN auth_references ar ON lr.lit_reference_id = ar.lit_reference_id
        WHERE ar.auth_id = ?

        UNION

        SELECT 'publisher' AS type, p.publisher_id AS id, p.publisher_name AS label, 
               NULL AS url
        FROM publishers p
        JOIN task_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN task_authors ta ON tp.task_id = ta.task_id
        WHERE ta.author_id = ?;
      `;
  }
  return null;
};

export const getLinksForEntity = (entityType) => {
  if (entityType === "task") {
    return `
        SELECT 'authored' AS type, ta.task_id AS source, ta.author_id AS target
        FROM task_authors ta
        WHERE ta.task_id = ?
  
        UNION
  
        SELECT 'published_by' AS type, tp.task_id AS source, tp.publisher_id AS target
        FROM task_publishers tp
        WHERE tp.task_id = ?
  
        UNION
  
        SELECT 'references' AS type, tr.task_id AS source, tr.lit_reference_id AS target
        FROM task_references tr
        WHERE tr.task_id = ?;
      `;
  }
  if (entityType === "author") {
    return `
        SELECT 'authored' AS type, ta.author_id AS source, ta.task_id AS target
        FROM task_authors ta
        WHERE ta.author_id = ?
         
        UNION
  
        SELECT 'published_by' AS type, ta.author_id AS source, p.publisher_id AS target
        FROM publishers p
        JOIN task_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN task_authors ta ON tp.task_id = ta.task_id
        WHERE ta.author_id = ?
  
        UNION
  
        SELECT 'auth_referenced' AS type, ar.auth_id AS source, ar.lit_reference_id AS target
        FROM auth_references ar
        WHERE ar.auth_id = ?;
      `;
  }
  return null;
};
