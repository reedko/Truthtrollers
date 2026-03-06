-- Grant super_admin role to a user
-- Usage: Run this on your production database
-- Replace 'reedko' with your username or email

-- First, let's see all users
SELECT user_id, username, email FROM users ORDER BY user_id LIMIT 20;

-- Check if super_admin role exists
SELECT * FROM roles WHERE name = 'super_admin';

-- If it doesn't exist, create it
INSERT IGNORE INTO roles (name, description)
VALUES ('super_admin', 'Super Administrator with full access');

-- Get the role_id for super_admin
SET @super_admin_role_id = (SELECT role_id FROM roles WHERE name = 'super_admin');

-- Get the user_id for your user (CHANGE 'reedko' to your username/email)
SET @user_id = (SELECT user_id FROM users WHERE username = 'reedko' OR email = 'reedko' LIMIT 1);

-- Show what we found
SELECT @user_id AS user_id, @super_admin_role_id AS super_admin_role_id;

-- Check current roles for this user
SELECT u.username, r.name as role_name
FROM users u
LEFT JOIN user_roles ur ON u.user_id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.role_id
WHERE u.user_id = @user_id;

-- Grant super_admin role (won't duplicate if already exists)
INSERT IGNORE INTO user_roles (user_id, role_id)
VALUES (@user_id, @super_admin_role_id);

-- Verify it worked
SELECT u.user_id, u.username, u.email, r.name as role
FROM users u
JOIN user_roles ur ON u.user_id = ur.user_id
JOIN roles r ON ur.role_id = r.role_id
WHERE u.user_id = @user_id;

-- Done! The user needs to log out and log back in for the role to take effect.
