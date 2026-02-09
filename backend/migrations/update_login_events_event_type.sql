-- Update login_events.event_type to support password reset events
-- This assumes event_type is currently either an ENUM or a short VARCHAR

-- Option 1: If it's an ENUM, alter it to include new values
-- ALTER TABLE login_events MODIFY COLUMN event_type ENUM('login', 'logout', 'password_reset_request', 'password_changed') NOT NULL;

-- Option 2: If it's a VARCHAR, make it longer (safer, more flexible)
ALTER TABLE login_events MODIFY COLUMN event_type VARCHAR(50) NOT NULL;

-- Add index if not exists
-- CREATE INDEX idx_event_type ON login_events(event_type);
