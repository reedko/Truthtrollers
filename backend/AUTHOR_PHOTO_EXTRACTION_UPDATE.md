# Author Photo Extraction Enhancement

## Summary
Updated the author extraction utility to properly handle author photos from various news sites, including Fox News style author bylines.

## What Was Done

### 1. Enhanced extractAuthors.js
**File:** `src/utils/extractAuthors.js`

Added specific handling for **Fox News author bylines**:
```html
<div class="author-byline">
  <span class="author-headshot">
    <img src="..." alt="Author Name">
  </span>
  By <a href="/person/s/author-name">Author Name</a>
</div>
```

The new extraction logic:
- Finds `.author-byline` containers
- Extracts author photo from `.author-headshot img`
- Extracts author name from person links or img alt text
- Cleans up "By" prefix from names
- Deduplicates authors

### 2. All Scrape Paths Verified
**All scrape entry points already use `extractAuthors()` - no changes needed:**

#### Main Scrape Paths:
1. **Extension Scrape (new task)** → `scrapeTask()` → uses `extractAuthors()` ✅
2. **Dashboard New Scrape** → `scrapeTask()` → uses `extractAuthors()` ✅
3. **Dashboard Retry Scrape (reference)** → `scrapeReference()` → uses `extractAuthors()` ✅
4. **Evidence Engine References** → `scrapeReference()` → uses `extractAuthors()` ✅

#### Route Locations:
- `src/routes/content/content.scrape.routes.js` (line 493, 893)
- `src/core/scrapeTask.js` (line 158)
- `src/core/scrapeReference.js` (line 68)

### 3. Testing
**Test File:** `test-fox-news-author.js`

Verified Fox News author extraction with real HTML sample:
- ✅ Correctly extracts author name: "Angelica Stabile"
- ✅ Correctly extracts author photo URL
- ✅ Test passes with 100% accuracy

## How It Works

The extractAuthors utility now checks multiple patterns in priority order:

1. **Fox News bylines** (NEW) - `.author-byline` with `.author-headshot`
2. **Standard bylines** - `a[rel="author"]` with avatar images
3. **Author name spans** - `span.author-name` with avatar siblings
4. **JSON-LD metadata** - `script[type="application/ld+json"]`
5. **Meta tags** - `<meta name="author">`, `<meta property="article:author">`
6. **Citation meta** - `<meta name="citation_author">`
7. **CHD-specific** - Children's Health Defense custom markup

## Author Object Structure

Each author object contains:
```javascript
{
  name: "Author Name",           // Required
  description: "Bio...",          // Optional (from JSON-LD)
  image: "https://..."           // Optional (author photo URL)
}
```

## Database Storage

Authors are persisted via:
- `persistAuthors()` called from `persistTaskContent()` and `createContentInternal()`
- Stores in `authors` table with `author_photo` field
- Links to content via `content_authors` junction table

## What Works Now

✅ **Fox News** - Full author name and photo extraction
✅ **Brownstone Institute** - Already working
✅ **Children's Health Defense** - Already working
✅ **Sites with JSON-LD** - Already working
✅ **Standard WordPress/news sites** - Already working

## Files Modified

1. `src/utils/extractAuthors.js` - Added Fox News byline extraction
2. `test-fox-news-author.js` - New test file

## Files Verified (No Changes Needed)

1. `src/core/scrapeTask.js` - Already uses extractAuthors ✅
2. `src/core/scrapeReference.js` - Already uses extractAuthors ✅
3. `src/routes/content/content.scrape.routes.js` - Calls scrapeTask/scrapeReference ✅

## Next Steps (Future Enhancements)

If you encounter sites where author photos aren't being extracted:

1. Find the HTML structure for author bylines on that site
2. Add a new extraction pattern to `extractAuthors.js`
3. Add test case to verify extraction
4. All scrape paths will automatically benefit (no route changes needed!)

## Example Usage

When you scrape a Fox News article now:
```javascript
// Extension or dashboard scrapes this URL
const url = "https://www.foxnews.com/health/ancient-herb-known-natures-valium-touted-improving-sleep-anxiety";

// scrapeTask() or scrapeReference() is called
// → extractAuthors($) is called internally
// → Returns: [{
//     name: "Angelica Stabile",
//     image: "https://a57.foxnews.com/static.foxnews.com/foxnews.com/content/uploads/2024/12/340/340/angelica-stabile_12-scaled.jpg",
//     description: null
//   }]
// → Authors persisted to database with photo URLs
```

All scrape paths (extension, dashboard new, dashboard retry, evidence engine) will now extract author photos from Fox News and similar sites automatically!
