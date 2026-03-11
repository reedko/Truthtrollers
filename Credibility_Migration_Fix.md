# Credibility Migration Column Name Fixes

## Problem

The credibility checks migration was failing with SQL errors:
```
Error Code: 1054. Unknown column 'a.display_name' in 'field list'
Error Code: 1054. Unknown column 'c.title' in 'field list'
```

## Root Cause

The migration used incorrect column names that don't exist in the database:
- **authors** table: Used `display_name` (doesn't exist)
- **content** table: Used `title` (doesn't exist)
- **publishers** table: Used `p.name` (doesn't exist)

## Actual Column Names

After checking the existing routes and queries:

### Authors Table
- ✅ `author_id`
- ✅ `author_first_name`
- ✅ `author_last_name`
- ❌ `display_name` (doesn't exist)

### Content Table
- ✅ `content_id`
- ✅ `content_name`
- ✅ `url`
- ❌ `title` (doesn't exist)

### Publishers Table
- ✅ `publisher_id`
- ✅ `publisher_name`
- ✅ `domain`
- ❌ `name` (doesn't exist)

## Changes Made

### File: `backend/migrations/add-credibility-checks.js`

#### 1. Fixed author_credibility_summary view (lines ~107-123)

**Before:**
```sql
SELECT
  a.author_id,
  a.display_name,  -- ❌ Column doesn't exist
  ...
FROM authors a
GROUP BY a.author_id, a.display_name;  -- ❌ Column doesn't exist
```

**After:**
```sql
SELECT
  a.author_id,
  CONCAT(IFNULL(a.author_first_name, ''), ' ', IFNULL(a.author_last_name, '')) as author_name,  -- ✅ Construct name
  ...
FROM authors a
GROUP BY a.author_id, a.author_first_name, a.author_last_name;  -- ✅ Group by actual columns
```

#### 2. Fixed publisher_credibility_summary view (lines ~125-146)

**Before:**
```sql
SELECT
  p.publisher_id,
  p.name as publisher_name,  -- ❌ Column 'name' doesn't exist
  ...
FROM publishers p
GROUP BY p.publisher_id, p.name, p.domain;  -- ❌ Column doesn't exist
```

**After:**
```sql
SELECT
  p.publisher_id,
  p.publisher_name,  -- ✅ Actual column name
  ...
FROM publishers p
GROUP BY p.publisher_id, p.publisher_name, p.domain;  -- ✅ Actual column name
```

#### 3. Fixed content_credibility_summary view (lines ~148-165)

**Before:**
```sql
SELECT
  c.content_id,
  c.title,  -- ❌ Column doesn't exist
  c.url,
  ...
FROM content c
GROUP BY c.content_id, c.title, c.url;  -- ❌ Column doesn't exist
```

**After:**
```sql
SELECT
  c.content_id,
  c.content_name,  -- ✅ Actual column name
  c.url,
  ...
FROM content c
GROUP BY c.content_id, c.content_name, c.url;  -- ✅ Actual column name
```

## Services Already Correct

The service modules already handle column name variations:

### opensanctions.service.js (line 129)
```javascript
async checkPublisher(publisher) {
  const name = publisher.name || publisher.publisher_name;  // ✅ Handles both
  ...
}
```

### credibility.service.js
Already uses correct publisher object properties from the database.

## Publisher Domain Column

The migration now adds a `domain` column to the `publishers` table:

```sql
ALTER TABLE publishers
ADD COLUMN IF NOT EXISTS domain VARCHAR(255) DEFAULT NULL,
ADD INDEX IF NOT EXISTS idx_domain (domain);
```

**Why it's needed**: GDI API checks publisher domains (e.g., "nytimes.com"), not names.

### Populating Domains

After running the main migration, you can optionally populate domains:

```bash
node backend/migrations/populate-publisher-domains.js
```

This helper script:
- Extracts domains from publisher names (e.g., "nytimes.com" from "The New York Times (nytimes.com)")
- Updates publishers that have identifiable domains
- Skips publishers without obvious domains (they can still be checked via OpenSanctions by name)

## Testing

To run the migration:
```bash
node backend/migrations/add-credibility-checks.js
```

Expected output:
```
Starting credibility checks migration...
Adding domain column to publishers table...
Creating author_credibility_checks table...
Creating publisher_credibility_checks table...
Creating content_credibility_checks table...
Creating credibility check summary views...
Migration completed successfully!
All done!
```

## Verify Views Created

Run these queries to verify:
```sql
-- Check views exist
SHOW FULL TABLES WHERE Table_type = 'VIEW';

-- Test author view
SELECT * FROM author_credibility_summary LIMIT 5;

-- Test publisher view
SELECT * FROM publisher_credibility_summary LIMIT 5;

-- Test content view
SELECT * FROM content_credibility_summary LIMIT 5;
```

## OpenSanctions API Integration

The OpenSanctions API key has been added to `.env` and `.env.prod`:
```bash
OPENSANCTIONS_API_KEY=31b6361b173757db133aa74cb9c355a9
```

**GDI API**: Pending approval - key field left empty for now.

## Usage

Once migration is complete, you can use the credibility check endpoints:

```bash
# Check an author
POST /api/credibility/author/:authorId/check

# Check a publisher
POST /api/credibility/publisher/:publisherId/check

# Get summary of high-risk authors
GET /api/credibility/summary/authors

# Get summary of high-risk publishers
GET /api/credibility/summary/publishers
```

## Notes

- Views use `CREATE OR REPLACE` so they can be re-run safely
- The migration creates indexes on foreign keys for performance
- Risk levels are standardized: none, low, medium, high, critical
- Overall risk score is calculated as highest risk level (0-4)
