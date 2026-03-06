-- Update molecule_views table to change "References" to "Sources" in view names
-- This updates any view name containing "Reference" or "References" to use "Source/Sources" instead

UPDATE molecule_views
SET name = REPLACE(REPLACE(name, 'References', 'Sources'), 'Reference', 'Source')
WHERE name LIKE '%Reference%';

-- Show updated rows
SELECT view_id, name, content_id, is_default
FROM molecule_views
WHERE name LIKE '%Source%'
ORDER BY view_id;
