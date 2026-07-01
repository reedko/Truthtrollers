-- Add node_settings column to store per-node display preferences
ALTER TABLE molecule_views
ADD COLUMN node_settings JSON DEFAULT NULL
AFTER positions;

-- node_settings will store: { "node-id": { "displayMode": "circles" | "compact" | "mr_cards" } }
