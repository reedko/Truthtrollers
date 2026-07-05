# Frame Detection Route Integration Guide

This guide shows how to update route handlers to pass article metadata to `processTaskClaims()` for frame detection.

## Example: Text Submission Route

**File**: `/backend/src/routes/content/content.tasks.routes.js`

### Before (no metadata)
```javascript
const taskClaims = await processTaskClaims({ query, taskContentId, text });
```

### After (with metadata)
```javascript
const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text,
  title: title || "Text Submission",  // From req.body
  byline: username,                   // Derived from user/publisher
  // date: can be added if captured during text submission
  // headings: can be extracted from text if desired
});
```

## Example: Web Scrape Route

**File**: `/backend/src/routes/content/content.scrape.routes.js`

For scraped content, metadata is typically available from the page extraction:

```javascript
// After content is scraped and cleaned
const { title, byline, date, headings } = pageMetadata;

const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text: cleanedContent,
  title,    // From <title> or og:title
  byline,   // From author meta tag or publisher info
  date,     // From published_time meta tag
  headings, // Extracted from <h1>-<h6> tags
});
```

## Example: Reference Claims Route

**File**: `/backend/src/routes/content/content.tasks.routes.js` (reference processing)

```javascript
const extractedClaims = await processTaskClaims({
  query,
  taskContentId: ref.referenceContentId,
  text: ref.cleanText,
  claimType: "reference",
  taskClaimsContext: taskClaims.map((c) => c.text),
  title: ref.title,      // Reference article title
  byline: ref.byline,    // Reference author
  date: ref.pubDate,     // Reference publication date
});
```

## Example: Incremental Content Route

**File**: `/backend/src/routes/content/content.incremental.routes.js`

```javascript
if (ref.cleanText) {
  const extractedClaims = await processTaskClaims({
    query,
    taskContentId: ref.referenceContentId,
    text: ref.cleanText,
    claimType: "reference",
    taskClaimsContext: allTaskClaims.map((c) => c.text),
    title: ref.title,
    byline: ref.author,
    date: ref.date,
    headings: ref.headings,
  });
}
```

## Metadata Extraction Tips

### Title
- Source: `<title>`, `og:title`, `article:title` meta tags
- Fallback: First `<h1>` tag
- Max length: ~200 chars

### Byline / Author
- Source: `article:author`, `author` meta tags, `.byline` class elements
- Alternative: Publisher name or source organization
- Format: "By Author Name" or just "Author Name"

### Publication Date
- Source: `article:published_time`, `datePublished` meta tag
- Format: ISO 8601 (YYYY-MM-DD) preferred
- Fallback: Current date if unavailable

### Headings
- Extract from `<h1>`, `<h2>`, `<h3>` tags
- Limit to first 10 headings for performance
- Skip empty or single-word headings if desired

## Optional Parameters

All metadata parameters are **optional**. If not provided:
- Frame detection will use only article text
- It will still extract thesis, stance, pillars, etc.
- Confidence scores may be lower with less context

```javascript
// Minimal (still works)
const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text,
});

// Optimal (with metadata)
const taskClaims = await processTaskClaims({
  query,
  taskContentId,
  text,
  title: "Article Title",
  byline: "By Author Name",
  date: "2025-07-05",
  headings: ["Section 1", "Section 2"],
});
```

## Performance Considerations

- Frame detection adds ~2-4 seconds per article (one LLM call)
- It runs in parallel with other setup steps if possible
- The cost is negligible compared to full evidence engine runs
- Frame detection has no database overhead

## Debugging Frame Detection

Enable verbose logging:
```bash
# Frame detection logs always include:
# - [articleFrameDetector] prefix
# - ARTICLE_FRAME_SEEDED JSON output
# Look for these in server logs during processing
```

Check logs for:
```
✅ [articleFrameDetector] Frame detected (confidence: X.XX)
   Thesis: "..."
   Stance: endorses/rejects/mixed/unclear
   Pillars: N
   Opposing claims: N
   Named anchors: N
   Open questions: N
```

If frame detection fails:
```
⚠️ [articleFrameDetector] Failed to detect frame: [reason]
```

Pipeline will continue normally — frame detection failure is non-blocking.
