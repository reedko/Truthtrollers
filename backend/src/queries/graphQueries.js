export const getNodesForEntity = (entityType, viewerId = null) => {
  if (entityType === "task") {
    // Build visibility filter for references
    // If viewerId is provided, exclude sources hidden by this user
    // We interpolate viewerId directly since it's an integer (safe from SQL injection)
    const visibilityFilter = viewerId
      ? `AND NOT EXISTS (
          SELECT 1 FROM user_reference_visibility urv
          WHERE urv.user_id = ${parseInt(viewerId, 10)}
            AND urv.task_content_id = tr.content_id
            AND urv.reference_content_id = lr.content_id
            AND urv.is_hidden = TRUE
        )`
      : '';

    const visibilityFilterForAuthors = viewerId
      ? `AND NOT EXISTS (
          SELECT 1 FROM user_reference_visibility urv
          WHERE urv.user_id = ${parseInt(viewerId, 10)}
            AND urv.task_content_id = tr.content_id
            AND urv.reference_content_id = tr.reference_content_id
            AND urv.is_hidden = TRUE
        )`
      : '';

    return `
        SELECT
          'task' AS type,
          CONCAT("conte-",t.content_id) AS id,
          t.content_id AS content_id,
          NULL AS author_id,
          NULL AS publisher_id,
          t.content_name AS label,
          t.url,
          (SELECT COUNT(*) FROM content_claims WHERE content_id = t.content_id) AS claimCount,
          (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = t.content_id) AS rating,
          NULL AS added_by_user_id,
          NULL AS is_system
        FROM content t
        WHERE t.content_id = ?

        UNION

        SELECT
          'author' AS type,
          CONCAT("autho-",a.author_id) AS id,
          NULL AS content_id,
          a.author_id AS author_id,
          NULL AS publisher_id,
          CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
          NULL AS url,
          NULL AS claimCount,
          (SELECT AVG(veracity_score) FROM author_ratings WHERE author_id = a.author_id) AS rating,
          NULL AS added_by_user_id,
          NULL AS is_system
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        WHERE ca.content_id = ?

        UNION

        SELECT
          'author' AS type,
          CONCAT("autho-",a.author_id) AS id,
          NULL AS content_id,
          a.author_id AS author_id,
          NULL AS publisher_id,
          CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
          NULL AS url,
          NULL AS claimCount,
          (SELECT AVG(veracity_score) FROM author_ratings WHERE author_id = a.author_id) AS rating,
          NULL AS added_by_user_id,
          NULL AS is_system
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_relations tr ON ca.content_id = tr.reference_content_id
        WHERE tr.content_id = ?
        ${visibilityFilterForAuthors}

        UNION

        SELECT
          'publisher' AS type,
          CONCAT("publi-",p.publisher_id) AS id,
          NULL AS content_id,
          NULL AS author_id,
          p.publisher_id AS publisher_id,
          p.publisher_name AS label,
          NULL AS url,
          NULL AS claimCount,
          (SELECT AVG(veracity_score) FROM publisher_ratings WHERE publisher_id = p.publisher_id) AS rating,
          NULL AS added_by_user_id,
          NULL AS is_system
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        WHERE tp.content_id = ?


        UNION

        SELECT
          'reference' AS type,
          CONCAT("conte-",lr.content_id) AS id,
          lr.content_id AS content_id,
          NULL AS author_id,
          NULL AS publisher_id,
          lr.content_name AS label,
          lr.url AS url,
          (SELECT COUNT(*) FROM content_claims WHERE content_id = lr.content_id) AS claimCount,
          (SELECT AVG(CASE
            WHEN rcl.stance = 'support' THEN rcl.support_level
            WHEN rcl.stance = 'refute' THEN -rcl.support_level
            ELSE 0
          END)
          FROM reference_claim_links rcl
          JOIN content_claims cc ON rcl.claim_id = cc.claim_id
          WHERE rcl.reference_content_id = lr.content_id AND cc.content_id = ?
          ) AS rating,
          tr.added_by_user_id,
          tr.is_system
        FROM content lr
        JOIN content_relations tr ON lr.content_id = tr.reference_content_id
        WHERE tr.content_id = ?
        ${visibilityFilter}
        ;
      `;
  }

  if (entityType === "author") {
    return `
        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id,
               NULL AS content_id, a.author_id AS author_id, NULL AS publisher_id,
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
               NULL AS url,
               NULL AS claimCount,
               (SELECT AVG(veracity_score) FROM author_ratings WHERE author_id = a.author_id) AS rating
        FROM authors a
        WHERE a.author_id = ?

        UNION

        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id,
               t.content_id AS content_id, NULL AS author_id, NULL AS publisher_id,
               t.content_name AS label, t.url,
               (SELECT COUNT(*) FROM content_claims WHERE content_id = t.content_id) AS claimCount,
               (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = t.content_id) AS rating
        FROM content t
        JOIN content_authors ca ON t.content_id = ca.content_id
        WHERE t.content_type='task' AND ca.author_id = ?


        UNION

        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id,
               lr.content_id AS content_id, NULL AS author_id, NULL AS publisher_id,
               lr.content_name AS label, lr.url AS url,
               (SELECT COUNT(*) FROM content_claims WHERE content_id = lr.content_id) AS claimCount,
               (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = lr.content_id) AS rating
        FROM content lr
        JOIN content_authors ca ON lr.content_id = ca.content_id
        WHERE lr.content_type='reference' AND ca.author_id = ?


        UNION

        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id,
               NULL AS content_id, NULL AS author_id, p.publisher_id AS publisher_id,
               p.publisher_name AS label,
               NULL AS url,
               NULL AS claimCount,
               (SELECT AVG(veracity_score) FROM publisher_ratings WHERE publisher_id = p.publisher_id) AS rating
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN content_authors ca ON tp.content_id = ca.content_id
        WHERE ca.author_id = ?
        ;
      `;
  }

  if (entityType === "publisher") {
    return `
        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id,
               NULL AS content_id, NULL AS author_id, p.publisher_id AS publisher_id,
               p.publisher_name AS label,
               NULL AS url,
               NULL AS claimCount,
               (SELECT AVG(veracity_score) FROM publisher_ratings WHERE publisher_id = p.publisher_id) AS rating
        FROM publishers p
        WHERE p.publisher_id = ?

        UNION

        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id,
               t.content_id AS content_id, NULL AS author_id, NULL AS publisher_id,
               t.content_name AS label, t.url,
               (SELECT COUNT(*) FROM content_claims WHERE content_id = t.content_id) AS claimCount,
               (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = t.content_id) AS rating
        FROM content t
        JOIN content_publishers tp ON t.content_id = tp.content_id
        WHERE t.content_type = 'task' AND tp.publisher_id = ?


        UNION

        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id,
               NULL AS content_id, a.author_id AS author_id, NULL AS publisher_id,
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
               NULL AS url,
               NULL AS claimCount,
               (SELECT AVG(veracity_score) FROM author_ratings WHERE author_id = a.author_id) AS rating
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_publishers tp ON ca.content_id = tp.content_id
        WHERE tp.publisher_id = ?


        UNION

        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id,
               lr.content_id AS content_id, NULL AS author_id, NULL AS publisher_id,
               lr.content_name AS label, lr.url AS url,
               (SELECT COUNT(*) FROM content_claims WHERE content_id = lr.content_id) AS claimCount,
               (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = lr.content_id) AS rating
        FROM content lr
        JOIN content_publishers tp ON lr.content_id = tp.content_id
        WHERE lr.content_type = 'reference' AND tp.publisher_id = ?
        ;
      `;
  }

  if (entityType === "reference") {
    return `
        SELECT 'reference' AS type, CONCAT("conte-",lr.content_id) AS id,
               lr.content_id AS content_id, NULL AS author_id, NULL AS publisher_id,
               lr.content_name AS label, lr.url AS url,
               (SELECT COUNT(*) FROM content_claims WHERE content_id = lr.content_id) AS claimCount,
               (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = lr.content_id) AS rating
        FROM content lr
        WHERE lr.content_id = ?

        UNION

        SELECT 'task' AS type, CONCAT("conte-",t.content_id) AS id,
               t.content_id AS content_id, NULL AS author_id, NULL AS publisher_id,
               t.content_name AS label, t.url,
               (SELECT COUNT(*) FROM content_claims WHERE content_id = t.content_id) AS claimCount,
               (SELECT AVG(veracity_score) FROM claims c JOIN content_claims cc ON c.claim_id = cc.claim_id WHERE cc.content_id = t.content_id) AS rating
        FROM content t
        JOIN content_relations tr ON t.content_id = tr.content_id
        WHERE tr.reference_content_id = ?


        UNION

        SELECT 'author' AS type, CONCAT("autho-",a.author_id) AS id,
               NULL AS content_id, a.author_id AS author_id, NULL AS publisher_id,
               CONCAT(a.author_first_name, ' ', a.author_last_name) AS label,
               NULL AS url,
               NULL AS claimCount,
               (SELECT AVG(veracity_score) FROM author_ratings WHERE author_id = a.author_id) AS rating
        FROM authors a
        JOIN content_authors ca ON a.author_id = ca.author_id
        JOIN content_relations tr ON ca.content_id = tr.reference_content_id
        WHERE tr.reference_content_id = ?


        UNION

        SELECT 'publisher' AS type, CONCAT("publi-",p.publisher_id) AS id,
               NULL AS content_id, NULL AS author_id, p.publisher_id AS publisher_id,
               p.publisher_name AS label,
               NULL AS url,
               NULL AS claimCount,
               (SELECT AVG(veracity_score) FROM publisher_ratings WHERE publisher_id = p.publisher_id) AS rating
        FROM publishers p
        JOIN content_publishers tp ON p.publisher_id = tp.publisher_id
        JOIN content_relations tr ON tp.content_id = tr.reference_content_id
        WHERE tr.reference_content_id = ?
        ;
      `;
  }

  return null;
};

export const getLinksForEntity = (entityType, viewerId = null) => {
  if (entityType === "task") {
    // Build visibility filter for reference-related links
    // We interpolate viewerId directly since it's an integer (safe from SQL injection)
    const visibilityFilter = viewerId
      ? `AND NOT EXISTS (
          SELECT 1 FROM user_reference_visibility urv
          WHERE urv.user_id = ${parseInt(viewerId, 10)}
            AND urv.task_content_id = tr.content_id
            AND urv.reference_content_id = tr.reference_content_id
            AND urv.is_hidden = TRUE
        )`
      : '';

    const visibilityFilterForRefAuthored = viewerId
      ? `AND NOT EXISTS (
          SELECT 1 FROM user_reference_visibility urv
          WHERE urv.user_id = ${parseInt(viewerId, 10)}
            AND urv.task_content_id = tr.content_id
            AND urv.reference_content_id = ca.content_id
            AND urv.is_hidden = TRUE
        )`
      : '';

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
      ${visibilityFilter}

      UNION

      SELECT
        'ref_authored' AS type,
        CONCAT("conte-", ca.content_id) AS source,
        CONCAT("autho-", ca.author_id) AS target,
        CONCAT("conte-", ca.content_id, "_autho-", ca.author_id) AS id
      FROM content_authors ca
      JOIN content_relations tr ON ca.content_id = tr.reference_content_id
      WHERE tr.content_id = ?
      ${visibilityFilterForRefAuthored}
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

export const getLinkedClaimsAndLinksForTask = (taskId, viewerId, viewScope) => {
  console.log("👁️ viewerId in fetchNewGraphDataFromLegacyRoute:", viewerId, "viewScope:", viewScope);

  // When viewScope is 'all', show all users' links
  // When viewScope is 'user' (or undefined for backward compatibility), filter by user
  const shouldFilterByUser = viewScope !== 'all' && Number.isInteger(viewerId);

  const claimNodeSql = `
    -- Task Claims
    SELECT DISTINCT
      CONCAT('claim-', c.claim_id) AS id,
      c.claim_id,
      cc.content_id,
      c.claim_text AS label,
      'taskClaim' AS type,
      c.veracity_score,
      c.confidence_level,
      (SELECT COUNT(*) FROM content_claims WHERE content_id = cc.content_id) AS claimCount
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
      'refClaim' AS type,
      c2.veracity_score,
      c2.confidence_level,
      (SELECT COUNT(*) FROM content_claims WHERE content_id = cc2.content_id) AS claimCount
    FROM claim_links cl
    JOIN claims c2 ON c2.claim_id = cl.source_claim_id
    JOIN content_claims cc2 ON c2.claim_id = cc2.claim_id
    WHERE cl.target_claim_id IN (
      SELECT claim_id FROM content_claims WHERE content_id = ?
    )
   ${shouldFilterByUser ? "AND (cl.user_id = ? OR cl.user_id IS NULL)" : ""}
  `;

  const claimLinkSql = `
    -- Only include links where the target is a taskClaim for this task
    SELECT
      cl.relationship AS relation,
      cl.relationship AS stance,
      cl.support_level AS value,
      CONCAT('claim-', cl.source_claim_id) AS source,
      CONCAT('claim-', cl.target_claim_id) AS target,
      cl.claim_link_id,
      cl.notes AS rationale,
      cl.confidence,
      cl.created_at
    FROM claim_links cl
    WHERE cl.target_claim_id IN (
      SELECT claim_id FROM content_claims WHERE content_id = ?
    )
    ${shouldFilterByUser ? "AND (cl.user_id = ? OR cl.user_id IS NULL)" : ""}
  `;
  console.log("ViewerId", viewerId, "shouldFilterByUser:", shouldFilterByUser, "<---");
  const claimNodeParams = shouldFilterByUser
    ? [taskId, taskId, viewerId]
    : [taskId, taskId];

  const claimLinkParams = shouldFilterByUser
    ? [taskId, viewerId] // ← NOTE: viewerId *second*
    : [taskId];

  return {
    claimNodeSql,
    claimNodeParams,
    claimLinkSql,
    claimLinkParams,
  };
};

/**
 * Get case claims for a task for the claim expansion view
 * Returns claims that belong to the task (case)
 */
export const getCaseClaimsForTask = (taskId) => {
  return `
    SELECT
      CONCAT('caseClaim-', c.claim_id) AS id,
      c.claim_id,
      c.claim_text AS label,
      'caseClaim' AS type,
      cc.content_id,
      c.veracity_score,
      c.confidence_level,
      (SELECT COUNT(DISTINCT rcl.reference_content_id)
       FROM reference_claim_links rcl
       WHERE rcl.claim_id = c.claim_id) AS linkedSourceCount
    FROM claims c
    JOIN content_claims cc ON c.claim_id = cc.claim_id
    WHERE cc.content_id = ?
    ORDER BY c.claim_id
  `;
};

/**
 * Get source-to-case-claim links (both user-approved and AI-suggested)
 * This connects reference nodes to case claim nodes
 */
export const getSourceToClaimLinks = (taskId, viewerId, viewScope) => {
  const shouldFilterByUser = viewScope !== 'all' && Number.isInteger(viewerId);

  return `
    SELECT DISTINCT
      CONCAT('conte-', rcl.reference_content_id) AS source,
      CONCAT('caseClaim-', rcl.claim_id) AS target,
      CONCAT('conte-', rcl.reference_content_id, '-caseClaim-', rcl.claim_id) AS id,
      rcl.stance AS relation,
      rcl.support_level AS value,
      rcl.rationale AS notes,
      rcl.rationale,
      CASE
        WHEN rcl.verified_by_user_id IS NULL THEN 'ai-suggested'
        ELSE 'user-approved'
      END AS linkType,
      rcl.confidence,
      rcl.verified_by_user_id AS user_id,
      rcl.reference_content_id,
      rcl.claim_id
    FROM reference_claim_links rcl
    JOIN content_claims cc ON rcl.claim_id = cc.claim_id
    WHERE cc.content_id = ?
    ${shouldFilterByUser ? "AND (rcl.verified_by_user_id = ? OR rcl.verified_by_user_id IS NULL)" : ""}
    ORDER BY rcl.reference_content_id, rcl.claim_id
  `;
};

/**
 * Get sources that don't have any claim links
 * These will be connected to the case with dotted lines
 */
export const getUnlinkedSourcesForTask = (taskId, viewerId, viewScope) => {
  const shouldFilterByUser = viewScope !== 'all' && Number.isInteger(viewerId);

  return `
    SELECT DISTINCT
      tr.reference_content_id,
      CONCAT('conte-', tr.reference_content_id) AS sourceId
    FROM content_relations tr
    WHERE tr.content_id = ?
    AND tr.reference_content_id NOT IN (
      SELECT DISTINCT rcl.reference_content_id
      FROM reference_claim_links rcl
      JOIN content_claims cc ON rcl.claim_id = cc.claim_id
      WHERE cc.content_id = ?
      ${shouldFilterByUser ? "AND (rcl.verified_by_user_id = ? OR rcl.verified_by_user_id IS NULL)" : ""}
    )
  `;
};

/**
 * Get AI-suggested links for sources that don't have user-approved links yet
 * This is used to position sources around suggested claims when no user link exists
 */
export const getAISuggestedLinksForUnlinkedSources = (taskId) => {
  return `
    SELECT DISTINCT
      CONCAT('conte-', rcl.reference_content_id) AS source,
      CONCAT('caseClaim-', rcl.claim_id) AS target,
      CONCAT('conte-', rcl.reference_content_id, '-caseClaim-', rcl.claim_id, '-ai') AS id,
      rcl.stance AS relation,
      rcl.support_level AS value,
      rcl.confidence,
      'ai-suggested' AS linkType
    FROM reference_claim_links rcl
    JOIN content_claims cc ON rcl.claim_id = cc.claim_id
    WHERE cc.content_id = ?
    AND rcl.verified_by_user_id IS NULL
    AND rcl.reference_content_id NOT IN (
      SELECT DISTINCT reference_content_id
      FROM reference_claim_links
      WHERE claim_id IN (
        SELECT claim_id FROM content_claims WHERE content_id = ?
      )
      AND verified_by_user_id IS NOT NULL
    )
    ORDER BY rcl.confidence DESC
  `;
};
