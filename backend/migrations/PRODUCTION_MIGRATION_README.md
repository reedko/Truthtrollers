# Production Database Migration Guide

## Overview

This guide covers running all database migrations that occurred after the IP address column widening on the production MariaDB server.

## Migration Script

**File:** `run_production_migrations.js`

**What it does:**
- Runs all migrations since IP address widening in the correct order
- All migrations are idempotent (safe to run multiple times)
- Provides detailed logging and verification
- Handles errors gracefully

## Migrations Included

The script runs the following migrations in order:

1. **make_claim_links_user_id_nullable** - Allows AI-generated claim links
2. **update_login_events_event_type** - Supports password reset events
3. **rename_notes_to_rationale** - Renames column for consistency
4. **production_full_migration** - Comprehensive schema update including:
   - Password reset tokens table
   - User claim ratings table
   - Molecule views tables
   - Various new columns (veracity_score, confidence, created_by_ai, points_earned, is_active)
   - Indexes and triggers
5. **task_completion_migration** - Per-user task completion tracking
6. **permissions_and_viewer_filtering** - Roles, permissions, and viewer-specific features

## Prerequisites

1. **Node.js** installed on the production server
2. **mysql2 package** - Will need to install if not present:
   ```bash
   cd /root/backend
   npm install mysql2
   ```
3. **Valid .env file** at `/root/backend/.env` with database credentials

## Running on Production

### Option 1: Using default .env location

```bash
cd /root/backend/migrations
node run_production_migrations.js
```

### Option 2: Specify custom .env path

```bash
cd /root/backend/migrations
node run_production_migrations.js /path/to/custom/.env
```

## Expected Output

The script will:
1. Load database credentials from .env
2. Connect to MariaDB
3. Run each migration with progress logging:
   ```
   ══════════════════════════════════════════════════════════════════
   🔄 Running: 1. make_claim_links_user_id_nullable
   ══════════════════════════════════════════════════════════════════
   ✅ Completed: 1. make_claim_links_user_id_nullable
   ```
4. Perform final verification checks
5. Display summary of created tables and modified columns

## Safety Features

- **Idempotent:** All migrations check if changes already exist before applying
- **No data loss:** Uses `ALTER TABLE ADD IF NOT EXISTS` and similar safe operations
- **Error handling:** Continues when encountering "already exists" errors
- **Transaction safety:** Each migration is logged separately
- **Verification:** Final checks confirm all tables and columns exist

## Rollback

These migrations are designed to be additive (new tables, new columns). If you need to rollback:

1. **DO NOT drop tables** - they may contain data
2. **To reverse column additions:** You would need to write custom rollback scripts
3. **Recommended approach:** Take a database backup BEFORE running migrations:
   ```bash
   mysqldump -u root -p truthtrollers > backup_before_migration_$(date +%Y%m%d_%H%M%S).sql
   ```

## Verification Queries

After running migrations, you can verify manually:

```sql
-- Check new tables exist
SHOW TABLES LIKE '%molecule_view%';
SHOW TABLES LIKE '%permission%';
SHOW TABLES LIKE 'password_reset_tokens';

-- Check claim_links columns
DESCRIBE claim_links;

-- Check login_events.event_type is VARCHAR(50)
SHOW COLUMNS FROM login_events LIKE 'event_type';

-- Check content_users has completed_at
SHOW COLUMNS FROM content_users LIKE 'completed_at';

-- Check roles and permissions setup
SELECT * FROM roles;
SELECT * FROM permissions;
SELECT r.name AS role, p.name AS permission
FROM roles r
JOIN role_permissions rp ON r.role_id = rp.role_id
JOIN permissions p ON rp.permission_id = p.permission_id;
```

## Troubleshooting

### Connection Issues

**Error:** `Can't connect to MySQL server`
- Check DB_HOST, DB_PORT in .env
- Verify MariaDB is running: `systemctl status mariadb`
- Check firewall rules

### Permission Denied

**Error:** `Access denied for user`
- Verify DB_USER and DB_PASSWORD in .env
- Check user has necessary privileges:
  ```sql
  SHOW GRANTS FOR 'your_user'@'localhost';
  ```

### "Already Exists" Messages

- **Not an error!** This means the migration was already applied
- Script will continue to next migration
- Shows as `⚠️ Skipped (already exists)`

### Syntax Errors

- Check that all migration files exist in the migrations directory
- Verify file permissions allow reading

## Manual Migration (Alternative)

If you prefer to run migrations manually:

```bash
mysql -u root -p truthtrollers < make_claim_links_user_id_nullable.sql
mysql -u root -p truthtrollers < update_login_events_event_type.sql
mysql -u root -p truthtrollers < rename-notes-to-rationale.sql
mysql -u root -p truthtrollers < production_full_migration01.sql
mysql -u root -p truthtrollers < PRODUCTION_task_completion_migration.sql
mysql -u root -p truthtrollers < setup_permissions_and_viewer_filtering.sql
```

## Post-Migration Tasks

After successful migration:

1. **Restart backend server** to pick up schema changes
   ```bash
   pm2 restart truthtrollers-backend
   # or
   systemctl restart truthtrollers
   ```

2. **Verify application works** - test key features:
   - User login/logout
   - Creating claim links
   - Task completion marking
   - Reference visibility

3. **Monitor logs** for any database errors:
   ```bash
   tail -f /var/log/mariadb/error.log
   pm2 logs truthtrollers-backend
   ```

## Support

If you encounter issues:
1. Check the error message carefully
2. Verify all prerequisites are met
3. Review the verification queries
4. Check application logs for additional context

## Database Backup Recommendation

**ALWAYS backup before migrations:**

```bash
# Full backup
mysqldump -u root -p --all-databases > full_backup_$(date +%Y%m%d_%H%M%S).sql

# Or just truthtrollers database
mysqldump -u root -p truthtrollers > truthtrollers_backup_$(date +%Y%m%d_%H%M%S).sql
```

Restore if needed:
```bash
mysql -u root -p truthtrollers < truthtrollers_backup_YYYYMMDD_HHMMSS.sql
```
