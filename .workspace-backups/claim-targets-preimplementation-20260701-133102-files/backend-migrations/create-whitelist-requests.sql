-- Migration: Create whitelist_requests table for early access signups
-- This table stores user emails requesting to be whitelisted for the platform

CREATE TABLE IF NOT EXISTS whitelist_requests (
  whitelist_request_id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  reason TEXT,
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  approved_at TIMESTAMP NULL,
  approved_by INT,
  notes TEXT,
  INDEX idx_email (email),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at),
  FOREIGN KEY (approved_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
