# Database Changes Since IP Address Widening

This document summarizes all database schema changes that occurred after the `widen_ip_address_columns.sql` migration.

## Timeline of Migrations

### 1. Make claim_links.user_id Nullable
**File:** `make_claim_links_user_id_nullable.sql`
**Date:** 2026-02-10

**Changes:**
- Modified `claim_links.user_id` from `NOT NULL` to `NULL`
- Allows AI-generated claim links without a user_id

### 2. Update login_events.event_type
**File:** `update_login_events_event_type.sql`

**Changes:**
- Modified `login_events.event_type` from ENUM to `VARCHAR(50)`
- Supports password reset events: 'password_reset_request', 'password_changed'

### 3. Rename notes to rationale
**File:** `rename-notes-to-rationale.sql`

**Changes:**
- Renamed `claim_links.notes` column to `claim_links.rationale`
- Consistency with `reference_claim_task_links` table

### 4. Production Full Migration
**File:** `production_full_migration01.sql`

**New Tables:**
- `password_reset_tokens` - Password reset functionality
  - id, user_id, token, expires_at, used, created_at
- `user_claim_ratings` - User quality ratings for honesty scoring
  - user_claim_rating_id, user_id, reference_claim_id, task_claim_id, user_quality_rating, ai_quality_rating, ai_stance, honesty_score, created_at
- `molecule_views` - Tabbed views in molecule map
  - id, user_id, content_id, name, is_default, display_mode, positions, node_settings, last_viewed_at, created_at, updated_at
- `molecule_view_pins` - Pinned references per view
  - id, view_id, reference_content_id, is_pinned, created_at, updated_at

**New Columns:**
- `claim_links.veracity_score` DECIMAL(5,2) - AI veracity score 0-1
- `claim_links.confidence` DECIMAL(5,2) - AI confidence 0.15-0.98
- `claim_links.created_by_ai` TINYINT(1) - Auto-generated flag
- `claim_links.points_earned` DECIMAL(5,1) - GameSpace points
- `content.is_active` TINYINT - Soft deletion flag

**New Indexes:**
- `idx_claim_links_target` on (target_claim_id, disabled)
- `idx_claim_links_source` on (source_claim_id)
- `idx_claim_links_auto` on (created_by_ai, disabled)
- `idx_content_is_active` on (is_active)

**New Triggers:**
- `claim_links_after_insert` - Invalidates verimeter scores
- `claim_links_after_update` - Invalidates verimeter scores
- `claim_links_after_delete` - Invalidates verimeter scores

### 5. Task Completion Migration
**File:** `PRODUCTION_task_completion_migration.sql`
**Date:** 2026-02-16

**Changes:**
- Added `content_users.completed_at` TIMESTAMP NULL
- Added index `idx_completed` on completed_at
- Migrated existing completed tasks from global progress to per-user tracking

### 6. Permissions & Viewer Filtering
**File:** `setup_permissions_and_viewer_filtering.sql`

**New Tables:**
- `permissions` - Available permissions
  - permission_id, name, description, created_at
- `user_roles` - User-to-role mapping
  - user_id, role_id, assigned_at
- `user_reference_visibility` - Per-user reference hiding
  - user_id, task_content_id, reference_content_id, is_hidden, hidden_at, created_at

**New Columns:**
- `content_relations.added_by_user_id` INT NULL - Who added the reference
- `content_relations.is_system` BOOLEAN - Evidence engine flag
- `content_relations.created_at` TIMESTAMP
- `author_ratings.user_id` INT - Per-user ratings
- `publisher_ratings.user_id` INT - Per-user ratings

**Default Roles Inserted:**
1. super_admin (role_id: 1)
2. admin (role_id: 2)
3. moderator (role_id: 3)
4. user (role_id: 4)

**Default Permissions Inserted:**
- delete_system_references
- delete_any_user_reference
- manage_users
- manage_permissions
- view_all_data
- moderate_content

## Summary by Table

### claim_links
- user_id: NOW NULLABLE (was NOT NULL)
- notes: RENAMED TO rationale
- NEW: veracity_score DECIMAL(5,2)
- NEW: confidence DECIMAL(5,2)
- NEW: created_by_ai TINYINT(1)
- NEW: points_earned DECIMAL(5,1)
- NEW INDEXES: idx_claim_links_target, idx_claim_links_source, idx_claim_links_auto
- NEW TRIGGERS: after_insert, after_update, after_delete

### login_events
- event_type: CHANGED FROM ENUM TO VARCHAR(50)

### content
- NEW: is_active TINYINT
- NEW INDEX: idx_content_is_active

### content_users
- NEW: completed_at TIMESTAMP NULL
- NEW INDEX: idx_completed

### content_relations
- NEW: added_by_user_id INT NULL
- NEW: is_system BOOLEAN
- NEW: created_at TIMESTAMP
- NEW INDEX: idx_added_by_user
- NEW FK: added_by_user_id → users(user_id)

### author_ratings
- NEW: user_id INT (if didn't exist)
- NEW INDEX: idx_user

### publisher_ratings
- NEW: user_id INT (if didn't exist)
- NEW INDEX: idx_user

### New Tables Created
1. password_reset_tokens
2. user_claim_ratings
3. molecule_views
4. molecule_view_pins
5. permissions
6. user_roles
7. user_reference_visibility

## Total Changes

- **7 new tables** created
- **13 new columns** added across existing tables
- **1 column renamed** (notes → rationale)
- **2 columns modified** (user_id nullable, event_type type change)
- **7 new indexes** for performance
- **3 new triggers** for score invalidation
- **4 default roles** inserted
- **6 default permissions** inserted

## Backward Compatibility

All migrations are backward compatible:
- No columns dropped
- No data deleted
- Nullable columns for optional features
- Triggers handle score recalculation automatically
- Existing queries continue to work (except if checking event_type ENUM values)

## Breaking Changes

Only one potential breaking change:
- `login_events.event_type` changed from ENUM to VARCHAR(50)
  - If code was doing ENUM-specific checks, it may need updating
  - But VARCHAR is more flexible and backward compatible with existing values
