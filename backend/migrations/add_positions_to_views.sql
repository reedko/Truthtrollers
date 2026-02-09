-- Add positions column to store node positions as JSON
ALTER TABLE molecule_views
ADD COLUMN positions JSON DEFAULT NULL
AFTER display_mode;
