# Credibility Checking Setup - Quick Start

## Prerequisites

✅ OpenSanctions API key is configured in `.env` and `.env.prod`
⏳ GDI API key pending approval (leave empty for now)

## Step-by-Step Setup

### Step 1: Run the Migration

```bash
cd backend
node migrations/add-credibility-checks.js
```

**What this does:**
- Adds `domain` column to `publishers` table
- Creates 3 new tables for storing credibility check results
- Creates 3 views for easy querying of results

**Expected output:**
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

### Step 2 (Optional): Populate Publisher Domains

```bash
node migrations/populate-publisher-domains.js
```

**What this does:**
- Extracts domains from publisher names where possible
- Example: "The New York Times (nytimes.com)" → domain = "nytimes.com"

**Why it matters:**
- GDI API requires domains (can't check by name)
- OpenSanctions can check by name (no domain needed)

**Expected output:**
```
Starting publisher domain population...
Found 50 publishers without domains
✓ nytimes.com -> nytimes.com
✓ BBC News (bbc.com) -> bbc.com
⊘ Local News Network -> (no domain found)
...
Population complete!
  Updated: 35
  Skipped: 15
```

### Step 3: Verify Installation

Run these queries in your MySQL client:

```sql
-- Check that domain column was added
DESCRIBE publishers;

-- Check tables exist
SHOW TABLES LIKE '%credibility%';

-- Check views exist
SHOW FULL TABLES WHERE Table_type = 'VIEW' AND Tables_in_truthtrollers LIKE '%credibility%';

-- Test a view
SELECT * FROM author_credibility_summary LIMIT 5;
```

## Usage Examples

### Check an Author

```bash
# API endpoint
POST /api/credibility/author/:authorId/check

# Example with curl
curl -X POST http://localhost:5001/api/credibility/author/123/check \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "author_id": 123,
  "checked_at": "2026-03-10T...",
  "services": {
    "opensanctions": {
      "source": "opensanctions",
      "has_matches": true,
      "match_count": 1,
      "risk_level": "high",
      "risk_reasons": ["pep_match"],
      "matches": [...]
    }
  },
  "overall_risk": {
    "level": "high",
    "score": 3,
    "reasons": ["1 OpenSanctions match(es)"]
  }
}
```

### Check a Publisher

```bash
POST /api/credibility/publisher/:publisherId/check
```

**Response includes both GDI and OpenSanctions results:**
```json
{
  "publisher_id": 456,
  "services": {
    "gdi": {
      "domain": "example.com",
      "score": 45.5,
      "risk_level": "high"
    },
    "opensanctions": {
      "has_matches": false,
      "risk_level": "none"
    }
  },
  "overall_risk": {
    "level": "high",
    "score": 3
  }
}
```

### Get High-Risk Summary

```bash
# Get all authors with medium+ risk
GET /api/credibility/summary/authors

# Get all publishers with medium+ risk
GET /api/credibility/summary/publishers
```

## Database Schema Reference

### Tables Created

**author_credibility_checks**
- Stores OpenSanctions screening results for authors
- Links to `authors.author_id`

**publisher_credibility_checks**
- Stores GDI and OpenSanctions results for publishers
- Links to `publishers.publisher_id`

**content_credibility_checks**
- Stores GDI results for content URLs
- Links to `content.content_id`

### Views Created

**author_credibility_summary**
- Quick summary of latest OpenSanctions results per author
- Includes overall risk score (0-4)

**publisher_credibility_summary**
- Quick summary of latest GDI and OpenSanctions results per publisher
- Includes overall risk score (0-4)

**content_credibility_summary**
- Quick summary of latest GDI results per content item
- Includes overall risk score (0-4)

## Risk Levels Explained

| Level    | Score | GDI Score Range | OpenSanctions              |
|----------|-------|-----------------|----------------------------|
| none     | 0     | N/A             | No matches                 |
| low      | 1     | 80-100          | Low-priority match         |
| medium   | 2     | 60-79           | Potential match            |
| high     | 3     | 40-59           | PEP match                  |
| critical | 4     | 0-39            | Sanctions/crime match      |
| unknown  | 0     | No data         | Error or not assessed      |

## What Works Now

✅ **OpenSanctions Integration**
- Author screening (by name)
- Publisher screening (by name)
- Full match data with reasons
- API key configured

⏳ **GDI Integration (Pending API Approval)**
- Publisher domain checking (when API key available)
- Content URL checking (when API key available)
- Code is ready, just needs API key

## Troubleshooting

### Publishers Don't Have Domains
**Solution**: Run the domain population script or manually add domains:
```sql
UPDATE publishers SET domain = 'example.com' WHERE publisher_id = 123;
```

### GDI Checks Return "not_configured"
**Expected**: GDI API key is still pending approval. OpenSanctions checks will work fine.

### Migration Fails on ALTER TABLE
**Possible cause**: Domain column already exists
**Solution**: Migration handles this gracefully - check the console output

## Next Steps

1. ✅ Run migration
2. ✅ Test OpenSanctions checks on authors/publishers
3. ⏳ Wait for GDI API approval
4. ⏳ Add GDI_API_KEY to `.env` files
5. ⏳ Test GDI checks on publishers/content

## Documentation

- Full API documentation: `backend/CREDIBILITY_MODULES.md`
- Migration fix details: `Credibility_Migration_Fix.md`
- Code files: `backend/src/services/external/`
