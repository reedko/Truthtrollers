-- Add popup_style setting: controls whether the extension shows
-- the vertical card (card) or the horizontal taskbar (bar)
INSERT INTO extension_settings (setting_key, setting_value, description)
VALUES ('popup_style', 'card', 'Extension popup display style: card (vertical) or bar (horizontal)')
ON DUPLICATE KEY UPDATE description = VALUES(description);
