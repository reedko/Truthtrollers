-- ============================================================
-- Make llm_prompts.prompt_id AUTO_INCREMENT
-- Safe to run on dev and prod — MySQL automatically sets the
-- AUTO_INCREMENT counter to MAX(prompt_id) + 1 on the ALTER.
-- ============================================================

-- See current state first
DESCRIBE llm_prompts;
SELECT MAX(prompt_id) AS current_max FROM llm_prompts;

-- Add AUTO_INCREMENT (also ensures PRIMARY KEY is set)
ALTER TABLE llm_prompts
  MODIFY COLUMN prompt_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- Confirm
DESCRIBE llm_prompts;
