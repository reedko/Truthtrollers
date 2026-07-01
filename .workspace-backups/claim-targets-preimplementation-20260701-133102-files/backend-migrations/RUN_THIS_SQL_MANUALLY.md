# Run This SQL Manually

Since the migration script has MySQL authentication issues, just run this SQL directly in your MySQL client.

## Option 1: MySQL Command Line

```bash
mysql -u YOUR_USERNAME -p YOUR_DATABASE_NAME < add-canonical-url-hash.sql
```

## Option 2: Copy/Paste into MySQL

Connect to MySQL:
```bash
mysql -u YOUR_USERNAME -p
```

Then paste this:

```sql
USE YOUR_DATABASE_NAME;

-- Add canonical_url_hash column
ALTER TABLE content
ADD COLUMN canonical_url_hash VARCHAR(64) NULL
COMMENT 'SHA-256 hash of canonical URL for privacy-preserving lookups';

-- Add index on hash for fast lookups
CREATE INDEX idx_content_canonical_url_hash
ON content(canonical_url_hash);

-- Add canonical_url column
ALTER TABLE content
ADD COLUMN canonical_url VARCHAR(2048) NULL
COMMENT 'Canonicalized version of URL (normalized, tracking params removed)';

-- Add index on canonical_url
CREATE INDEX idx_content_canonical_url
ON content(canonical_url(255));
```

## Option 3: Use the API Endpoint (Easiest!)

If your backend is running, just hit this endpoint as super_admin:

```bash
POST /api/admin/migrate-canonical-hash
```

It will:
- Add the columns
- Add the indexes
- Backfill 1000 rows at a time

Just keep calling it until it says "remaining: 0"

## Check if it worked

```sql
SHOW COLUMNS FROM content WHERE Field LIKE '%canonical%';
SHOW INDEX FROM content WHERE Key_name LIKE '%canonical%';
```

You should see:
- `canonical_url` column
- `canonical_url_hash` column
- `idx_content_canonical_url_hash` index
- `idx_content_canonical_url` index
