-- Read-only conflict report for Phase 4. This file intentionally performs no writes.

SELECT context_type, extraction_confidence, COUNT(*) AS context_count
FROM content_publishing_context
GROUP BY context_type, extraction_confidence
ORDER BY context_type, extraction_confidence;

SELECT identifier_type, identifier_scope, COUNT(*) AS identifier_count,
       COUNT(DISTINCT normalized_value) AS distinct_values
FROM content_publishing_identifiers
GROUP BY identifier_type, identifier_scope
ORDER BY identifier_type, identifier_scope;

SELECT cp.content_id, COUNT(*) AS entity_links,
       SUM(cp.is_primary = 1) AS primary_links,
       GROUP_CONCAT(CONCAT(cp.publisher_role, ':', p.publisher_name)
                    ORDER BY cp.is_primary DESC, cp.publisher_role SEPARATOR ' | ') AS identities
FROM content_publishers cp
JOIN publishers p ON p.publisher_id = cp.publisher_id
GROUP BY cp.content_id
HAVING primary_links <> 1 OR entity_links > 2
ORDER BY entity_links DESC, cp.content_id;

SELECT LOWER(TRIM(publisher_name)) AS normalized_name,
       COUNT(*) AS entity_count,
       GROUP_CONCAT(CONCAT(publisher_id, ':', COALESCE(entity_type, 'untyped'))
                    ORDER BY publisher_id SEPARATOR ' | ') AS entities
FROM publishers
GROUP BY LOWER(TRIM(publisher_name))
HAVING COUNT(*) > 1
ORDER BY entity_count DESC, normalized_name;

SELECT pd.domain, COUNT(DISTINCT pd.publisher_id) AS entity_count,
       GROUP_CONCAT(CONCAT(pd.publisher_id, ':', p.publisher_name)
                    ORDER BY pd.publisher_id SEPARATOR ' | ') AS entities
FROM publisher_domains pd
JOIN publishers p ON p.publisher_id = pd.publisher_id
GROUP BY pd.domain
HAVING COUNT(DISTINCT pd.publisher_id) > 1
ORDER BY entity_count DESC, pd.domain;

SELECT cpi.identifier_type, cpi.normalized_value,
       COUNT(DISTINCT cpc.content_id) AS content_count,
       GROUP_CONCAT(DISTINCT cpc.content_id ORDER BY cpc.content_id) AS content_ids
FROM content_publishing_identifiers cpi
JOIN content_publishing_context cpc ON cpc.context_id = cpi.context_id
GROUP BY cpi.identifier_type, cpi.normalized_value
HAVING COUNT(DISTINCT cpc.content_id) > 1
ORDER BY content_count DESC, cpi.identifier_type, cpi.normalized_value;
