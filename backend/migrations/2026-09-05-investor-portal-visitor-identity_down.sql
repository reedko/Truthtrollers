-- Rollback for 2026-09-05-investor-portal-visitor-identity_up.sql
ALTER TABLE investor_access_sessions
  DROP COLUMN visitor_email,
  DROP COLUMN geo_area,
  DROP COLUMN ip_address;
