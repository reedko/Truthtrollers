-- Add display_mode column to molecule_views table
ALTER TABLE molecule_views
ADD COLUMN display_mode VARCHAR(50) DEFAULT 'mr_cards'
AFTER is_default;
