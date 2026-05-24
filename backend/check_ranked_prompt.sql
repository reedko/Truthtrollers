-- Check what the ranked extraction prompt currently says
SELECT
    prompt_name,
    prompt_type,
    LEFT(prompt_text, 500) as prompt_preview,
    version,
    is_active
FROM llm_prompts
WHERE prompt_name LIKE '%ranked%'
ORDER BY prompt_name, version DESC;
