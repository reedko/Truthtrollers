-- Create extension_settings table to store global extension configuration

CREATE TABLE IF NOT EXISTS extension_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description VARCHAR(255),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT,
  FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Insert default verimeter mode settings
INSERT INTO extension_settings (setting_key, setting_value, description)
VALUES
  ('verimeter_mode', 'user', 'Extension verimeter mode: ai, user, or combined'),
  ('verimeter_ai_weight', '0.5', 'AI weight for combined mode (0-1)')
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value);
