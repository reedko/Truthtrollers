-- Investor portal: invite-only access via admin-issued invitation links.
-- Additive only. Does not touch users, roles, allowed_users, or any
-- existing table. Safe to run multiple times (guarded with IF NOT EXISTS
-- where MySQL supports it for these object types via existence checks).

CREATE TABLE IF NOT EXISTS investor_invitations (
  invitation_id INT NOT NULL AUTO_INCREMENT,
  recipient_email VARCHAR(255) NOT NULL,
  recipient_name VARCHAR(255) NULL,
  organization VARCHAR(255) NULL,
  notes TEXT NULL,
  token_hash CHAR(64) NOT NULL,
  token_prefix CHAR(8) NOT NULL,
  created_by_admin_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (invitation_id),
  UNIQUE KEY uk_token_hash (token_hash),
  KEY idx_recipient_email (recipient_email),
  KEY idx_expires_at (expires_at),
  CONSTRAINT fk_investor_invitations_admin
    FOREIGN KEY (created_by_admin_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS investor_access_sessions (
  session_id INT NOT NULL AUTO_INCREMENT,
  invitation_id INT NOT NULL,
  session_token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (session_id),
  UNIQUE KEY uk_session_token_hash (session_token_hash),
  KEY idx_invitation_id (invitation_id),
  CONSTRAINT fk_investor_sessions_invitation
    FOREIGN KEY (invitation_id) REFERENCES investor_invitations (invitation_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS investor_access_events (
  event_id INT NOT NULL AUTO_INCREMENT,
  invitation_id INT NOT NULL,
  session_id INT NULL DEFAULT NULL,
  event_type VARCHAR(64) NOT NULL,
  document_id VARCHAR(64) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_invitation_id (invitation_id),
  KEY idx_session_id (session_id),
  KEY idx_event_type (event_type),
  KEY idx_document_id (document_id),
  CONSTRAINT fk_investor_events_invitation
    FOREIGN KEY (invitation_id) REFERENCES investor_invitations (invitation_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_investor_events_session
    FOREIGN KEY (session_id) REFERENCES investor_access_sessions (session_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS investor_admin_audit (
  audit_id INT NOT NULL AUTO_INCREMENT,
  invitation_id INT NULL DEFAULT NULL,
  admin_user_id INT NOT NULL,
  action VARCHAR(64) NOT NULL,
  detail TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_invitation_id (invitation_id),
  KEY idx_admin_user_id (admin_user_id),
  CONSTRAINT fk_investor_audit_invitation
    FOREIGN KEY (invitation_id) REFERENCES investor_invitations (invitation_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_investor_audit_admin
    FOREIGN KEY (admin_user_id) REFERENCES users (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
