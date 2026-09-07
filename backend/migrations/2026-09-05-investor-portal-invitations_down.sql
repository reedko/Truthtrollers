-- Rollback for 2026-09-05-investor-portal-invitations_up.sql
-- Drops in child-to-parent order to satisfy foreign keys.
DROP TABLE IF EXISTS investor_admin_audit;
DROP TABLE IF EXISTS investor_access_events;
DROP TABLE IF EXISTS investor_access_sessions;
DROP TABLE IF EXISTS investor_invitations;
