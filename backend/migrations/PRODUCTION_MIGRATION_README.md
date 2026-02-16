# Production Migration Guide

## Overview
This comprehensive migration script (`production_full_migration.sql`) combines all schema changes into a single, idempotent file that's safe to run on your production database.

## What It Does

### 1. Creates New Tables
- `password_reset_tokens` - Stores password reset tokens with expiration
- `user_claim_ratings` - Tracks user assessment of claim quality for honesty scoring
- `molecule_views` - Stores tabbed views for molecule map interface
- `molecule_view_pins` - Stores which reference cards are pinned/hidden per view

### 2. Adds Columns to Existing Tables
- `claim_links.veracity_score` - AI-generated veracity score (0-1)
- `claim_links.confidence` - AI confidence in match (0.15-0.98)
- `claim_links.created_by_ai` - Flag for auto-generated vs user-created links
- `claim_links.points_earned` - GameSpace scoring
- `content.is_active` - Soft deletion flag

### 3. Modifies Existing Columns
- `claim_links.user_id` - Made nullable to support AI-generated links
- **`login_events.event_type`** - Changed from ENUM to VARCHAR(50) to support password reset events

### 4. Creates Indexes
- Performance indexes for claim_links queries
- Index on content.is_active for filtering

### 5. Creates Triggers
- Auto-invalidates cached scores when claim_links are modified
- Triggers fire on INSERT, UPDATE, DELETE of claim_links

## How to Run on Production

### Option 1: Using MySQL Command Line
```bash
mysql -u your_username -p your_database < production_full_migration.sql
```

### Option 2: Using MySQL Workbench
1. Open MySQL Workbench
2. Connect to your production database
3. File → Open SQL Script → Select `production_full_migration.sql`
4. Execute the script (⚡ lightning icon or Ctrl+Shift+Enter)

### Option 3: Using phpMyAdmin
1. Log into phpMyAdmin
2. Select your database
3. Go to SQL tab
4. Paste the contents of `production_full_migration.sql`
5. Click "Go"

### Option 4: Using Hostinger Control Panel
1. Log into your Hostinger account
2. Go to Databases → phpMyAdmin
3. Select the truthtrollers database
4. SQL tab → paste script → Execute

## Safety Features

✅ **Idempotent** - Safe to run multiple times
- Uses `CREATE TABLE IF NOT EXISTS`
- Checks column existence before adding
- Uses `CREATE INDEX IF NOT EXISTS`
- Drops triggers before recreating

✅ **Non-Destructive**
- No data deletion
- Only adds tables/columns or modifies types
- Updates existing data safely

✅ **Verification Queries**
- Shows tables created
- Shows columns added
- Shows triggers created
- Confirms event_type column type change

## Expected Output

When successful, you'll see:
```
Migration completed successfully!
```

Plus verification query results showing:
- 4 tables created (password_reset_tokens, user_claim_ratings, molecule_views, molecule_view_pins)
- Columns added to claim_links and content
- login_events.event_type changed to VARCHAR(50)
- 3 triggers created on claim_links table

## Critical Fix Included

The **login_events.event_type** column change is critical for password reset functionality:
- **Old**: ENUM('login', 'logout') ❌ Crashes on password reset
- **New**: VARCHAR(50) ✅ Supports 'password_reset_request' and 'password_changed'

## Rollback Plan

If you need to rollback:
1. The script doesn't delete anything, so most changes are additive
2. Critical rollback would be the column modifications
3. Backup your database BEFORE running

## Before Running

1. **BACKUP YOUR DATABASE**
2. Test on a staging/development database first if possible
3. Check you have sufficient permissions (ALTER, CREATE, DROP TRIGGER)
4. Ensure no active transactions are holding locks

## After Running

1. Verify the output shows "Migration completed successfully!"
2. Check verification queries confirm all changes
3. Test password reset functionality
4. Test GameSpace claim linking
5. Monitor logs for any errors

## Support

If you encounter errors:
1. Note the exact error message
2. Check which section failed (look for "SECTION X" in error)
3. That section can be run independently if needed
