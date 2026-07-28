-- CF6 Milestone 2B disposable MySQL bootstrap.
--
-- Run this file as a MySQL administrator.
-- This creates an isolated database and a user scoped only to that database.
-- Replace REPLACE_WITH_A_STRONG_TEST_PASSWORD before execution.
--
-- Do not rename the database to a production or shared schema name.

-- Required on MySQL servers with binary logging enabled so the scoped test
-- user can create the immutability triggers used by the CF6 migration.
-- This is a global server setting and therefore requires administrator rights.
SET GLOBAL log_bin_trust_function_creators = 1;

CREATE DATABASE IF NOT EXISTS `veristrata_cf6_test`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'veristrata_cf6_test_user'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_STRONG_TEST_PASSWORD';

-- If the user already exists and its password must be changed, run this
-- separately with the exact password also stored in .env.cf6-mysql-test:
--
-- ALTER USER 'veristrata_cf6_test_user'@'localhost'
--   IDENTIFIED BY 'REPLACE_WITH_THE_ENV_FILE_PASSWORD';

GRANT ALL PRIVILEGES
  ON `veristrata_cf6_test`.*
  TO 'veristrata_cf6_test_user'@'localhost';

FLUSH PRIVILEGES;

-- Verification
SELECT SCHEMA_NAME
FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME = 'veristrata_cf6_test';

SHOW GRANTS FOR 'veristrata_cf6_test_user'@'localhost';

-- Disposable teardown. Keep commented during setup.
-- Run only after Milestone 2B verification is complete:
--
-- DROP DATABASE IF EXISTS `veristrata_cf6_test`;
-- DROP USER IF EXISTS 'veristrata_cf6_test_user'@'localhost';
