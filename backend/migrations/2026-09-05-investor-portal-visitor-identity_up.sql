-- Adds coarse visitor identification to investor-portal sessions: IP + a
-- resolved city/region/country string, and an optional self-reported email
-- (not verified against anything — just what the visitor typed in).
ALTER TABLE investor_access_sessions
  ADD COLUMN ip_address VARCHAR(64) NULL DEFAULT NULL AFTER expires_at,
  ADD COLUMN geo_area VARCHAR(255) NULL DEFAULT NULL AFTER ip_address,
  ADD COLUMN visitor_email VARCHAR(255) NULL DEFAULT NULL AFTER geo_area;
