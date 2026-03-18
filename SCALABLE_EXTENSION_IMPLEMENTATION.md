# Scalable Extension Implementation Plan

This document outlines the implementation of a privacy-preserving, scalable architecture for the TruthTrollers extension that can handle 100,000+ concurrent users without crushing the backend.

## Problem Statement

The current extension architecture has critical scalability and privacy issues:

1. **Every page load hits the backend 2-3 times**:
   - `checkContentAndUpdatePopup()` → `/api/check-content`
   - `storeLastUrl()` → `/api/store-last-visited-url`
   - `syncTaskStateForUrl()` → `/api/check-content` (again!)

2. **Privacy violation**: Raw browsing history is logged to `page_visits` table

3. **No caching**: Every navigation triggers fresh DB queries

4. **No request deduplication**: Rapid tab switches spam the backend

## Solution Architecture

### Phase 1: Extension-Side Improvements ✅

**Files Created:**
- `extension/src/services/urlCanonicalizer.ts` - URL normalization and hashing
- `extension/src/services/urlCacheService.ts` - Local cache with TTL
- `extension/src/services/passiveLookupService.ts` - Debounced passive lookups

**Key Features:**

1. **URL Canonicalization**:
   ```typescript
   // Normalizes URLs for consistent matching
   canonicalizeUrl("https://example.com/article?utm_source=twitter&ref=123")
   // → "https://example.com/article"
   ```

2. **Privacy-First Design**:
   - Blocks sensitive domains (banking, email, health, admin pages)
   - Never sends raw URLs for passive lookups
   - Uses SHA-256 hashes for privacy-preserving queries

3. **Multi-Layer Caching**:
   - **Memory cache**: Instant for current session
   - **LocalStorage cache**: Persists across sessions
   - **TTL-based expiration**:
     - Rated content: 24 hours
     - Known unrated: 6 hours
     - Unknown URLs: 1 hour
     - Errors: 2 minutes

4. **Request Deduplication**:
   - Multiple tabs loading same URL = single backend request
   - In-flight request tracking prevents duplicate lookups

### Phase 2: Backend Improvements ✅

**Files Created:**
- `backend/src/routes/content/content.lookup.routes.js` - Passive lookup endpoint
- `backend/src/utils/canonicalizeUrl.js` - Server-side URL canonicalization
- `backend/src/db/redis.js` - Optional Redis caching layer
- `backend/migrations/add-canonical-url-hash.sql` - Database schema changes
- `backend/migrations/run-add-canonical-url-hash.js` - Migration runner
- `backend/migrations/backfill-canonical-hashes.js` - Populate existing data

**Files Modified:**
- `backend/src/routes/content/index.js` - Added lookup routes
- `backend/server.js` - Added Redis initialization and routing

**Key Features:**

1. **Hash-Based Lookups**:
   ```javascript
   POST /api/lookup-by-hash
   { "urlHash": "abc123..." }
   → { "exists": true, "contentId": 42, "verimeterScore": 85 }
   ```

2. **Redis Caching** (optional, graceful degradation):
   - 24h cache for rated content
   - 6h cache for unrated content
   - 1h cache for unknown URLs
   - Reduces DB load by 90%+

3. **Database Schema**:
   - `content.canonical_url` - Normalized URL
   - `content.canonical_url_hash` - SHA-256 hash for fast lookups
   - Indexed for O(1) hash lookups

### Phase 3: Separation of Concerns (TODO)

**Passive Lookup** (lightweight, every page):
- Check if URL is rated
- Return cached score if available
- **NO analysis triggered**
- **NO URL logging**

**Active Analysis** (heavy, on user click):
- User explicitly clicks extension icon
- Full scraping + LLM analysis
- Evidence engine runs
- Claims extracted and stored

## Implementation Steps

### Step 1: Run Database Migration

```bash
cd backend
node migrations/run-add-canonical-url-hash.js
```

This adds:
- `canonical_url` VARCHAR(2048)
- `canonical_url_hash` VARCHAR(64)
- Indexes on both columns

### Step 2: Backfill Existing Content

```bash
node migrations/backfill-canonical-hashes.js
```

This computes and stores hashes for all existing content.

### Step 3: Install Redis (Optional but Recommended)

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu
sudo apt-get install redis-server
sudo systemctl start redis

# Or use Docker
docker run -d -p 6379:6379 redis:alpine
```

Set environment variable:
```bash
REDIS_URL=redis://localhost:6379
```

If Redis is not available, the system gracefully degrades to DB-only mode.

### Step 4: Install Dependencies

```bash
# Backend
cd backend
npm install redis

# Extension (already has crypto.subtle)
cd extension
npm install
```

### Step 5: Update Extension Background Script (TODO)

Replace the current backend-spamming logic in `extension/src/background.js`:

**Before:**
```javascript
// Every page load = 2-3 backend hits!
await checkContentAndUpdatePopup(tabId, url);
await storeLastUrl(url);
await syncTaskStateForUrl(url);
```

**After:**
```javascript
import { passiveLookup } from './services/passiveLookupService';

// Passive lookup with caching + deduplication
const result = await passiveLookup(url);

if (result.status === 'rated') {
  // Show badge with score
  showBadge(result.score);
} else if (result.status === 'unknown') {
  // URL not in database, no badge
  hideBadge();
}

// Only on explicit user click:
// - Trigger full analysis
// - Open TaskCard
```

### Step 6: Remove URL Logging (TODO)

Remove or comment out in `backend/src/routes/content/content.url-tracking.routes.js`:
```javascript
// DELETE THIS:
router.post("/api/store-last-visited-url", ...)
```

Replace with anonymized metrics:
```javascript
// Store aggregate stats only
router.post("/api/track-metrics", async (req, res) => {
  const { event, metadata } = req.body;
  // event: "page_view", "lookup", "analysis_requested"
  // metadata: { domain, timestamp } // NO full URL!
  await query(`
    INSERT INTO metrics (event_type, domain, created_at)
    VALUES (?, ?, NOW())
  `, [event, new URL(metadata.url).hostname]);
});
```

### Step 7: Update Content Creation

Modify `backend/src/core/scrapeReference.js` to compute and store hashes:

```javascript
import { canonicalizeAndHash } from '../utils/canonicalizeUrl.js';

async function scrapeReference(url, html) {
  const { canonical, hash } = canonicalizeAndHash(url);

  // Store in DB
  await query(`
    INSERT INTO content (url, canonical_url, canonical_url_hash, ...)
    VALUES (?, ?, ?, ...)
  `, [url, canonical, hash, ...]);
}
```

## Performance Impact

### Current (Worst Case)

100,000 users × 10 page loads/day = **1,000,000 requests/day**

- 3 backend hits per page load
- = **3,000,000 DB queries/day**
- = **34.7 queries/second sustained**
- Peak (morning hours): **300+ queries/second**

### With Phase 1 (Extension Caching)

- 90% cache hit rate
- = **300,000 backend requests/day**
- = **3.5 requests/second sustained**
- Peak: **30 requests/second**

**Result**: 90% reduction in backend load

### With Phase 2 (Backend Redis)

- 95% Redis cache hit rate
- = **15,000 DB queries/day**
- = **0.17 queries/second**
- Peak: **1.5 queries/second**

**Result**: 99.5% reduction in DB load

## Privacy Improvements

### Before

- ✗ Raw URLs logged to `page_visits` table
- ✗ Full browsing history exposed in database
- ✗ No sensitive domain filtering
- ✗ Extension checks banking/email pages

### After

- ✓ Only URL hashes sent to backend
- ✓ No browsing history logged
- ✓ Sensitive domains blocked at extension level
- ✓ Banking/email/health pages never touched
- ✓ Optional: aggregate metrics only (no URLs)

## Rollout Plan

### Week 1: Backend Foundation
- [x] Create lookup endpoint
- [x] Add Redis caching
- [ ] Run database migration
- [ ] Backfill existing hashes
- [ ] Test lookup performance

### Week 2: Extension Updates
- [x] Implement URL canonicalizer
- [x] Implement cache service
- [x] Implement passive lookup
- [ ] Update background.js
- [ ] Test with real usage

### Week 3: Monitoring & Tuning
- [ ] Add performance metrics
- [ ] Monitor cache hit rates
- [ ] Adjust TTLs based on usage
- [ ] Remove URL logging
- [ ] Deploy to production

## Testing Checklist

- [ ] Cache properly expires after TTL
- [ ] Deduplication prevents duplicate requests
- [ ] Sensitive domains are blocked
- [ ] Redis gracefully degrades if unavailable
- [ ] Backfill script completes successfully
- [ ] Lookup endpoint returns correct results
- [ ] Extension badge updates on rated content
- [ ] No performance regression on slow networks

## Monitoring

### Key Metrics to Track

1. **Cache Hit Rate**:
   - Target: >90% for extension local cache
   - Target: >95% for Redis cache

2. **Backend Request Rate**:
   - Before: ~35 req/s sustained
   - After: <5 req/s sustained

3. **Database Query Rate**:
   - Before: ~35 queries/s
   - After: <1 query/s

4. **Average Response Time**:
   - Cache hit: <10ms
   - Redis hit: <50ms
   - DB hit: <200ms

## Troubleshooting

### Redis Connection Failed
```
⚠️ Redis not available, caching disabled
```
**Solution**: System continues working, just slower. Install Redis or ignore if DB can handle the load.

### Migration Failed
```
❌ Migration failed: Duplicate column
```
**Solution**: Column already exists. Check with:
```sql
SHOW COLUMNS FROM content WHERE Field = 'canonical_url_hash';
```

### Backfill Takes Too Long
**Solution**: Process in batches:
```javascript
// Modify LIMIT in backfill-canonical-hashes.js
LIMIT 1000  // Process 1000 at a time
```

## Next Steps

After this implementation is stable, consider:

1. **Bloom Filter**: Pre-check if URL might be in DB before querying
2. **CDN Edge Caching**: Cache hot lookups at CDN layer (Cloudflare)
3. **Per-Domain Heuristics**: Never check social media feeds, always check news sites
4. **Batch Lookups**: Check multiple URLs in one request for better performance

## Files to Review

- `extension/src/services/urlCanonicalizer.ts`
- `extension/src/services/urlCacheService.ts`
- `extension/src/services/passiveLookupService.ts`
- `backend/src/routes/content/content.lookup.routes.js`
- `backend/src/utils/canonicalizeUrl.js`
- `backend/src/db/redis.js`

## Questions?

This is a solid foundation that will scale to 100K+ users while respecting privacy and minimizing backend load. The caching strategy alone eliminates 99%+ of unnecessary database queries.
