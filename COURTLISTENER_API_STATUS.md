# CourtListener API - Current Status & Access

## Latest Documentation

The most current CourtListener API documentation is at:
- **Main API Docs:** https://www.courtlistener.com/help/api/rest/
- **RECAP/PACER APIs:** https://www.courtlistener.com/help/api/rest/v4/recap/
- **V4 Migration Guide:** https://www.courtlistener.com/help/api/rest/v4/migration-guide/

## Current API Version

As of 2025, CourtListener uses **API v4.3** (latest version).

### Version Timeline:
- **v4.3** (Current) - Enforces authentication, anonymous requests now get 401
- **v4.0-v4.2** - Launched Fall 2024, migrated to ElasticSearch, cursor pagination
- **v3** (Legacy) - Still supported but deprecated, will be removed eventually

**Our Implementation:** We're currently using **v3** endpoints ❗

## What We're Using (v3 Endpoints)

```javascript
// Current implementation in legalCaseParser.js
https://www.courtlistener.com/api/rest/v3/opinions/${opinionId}/
https://www.courtlistener.com/api/rest/v3/dockets/${docketId}/
https://www.courtlistener.com/api/rest/v3/docket-entries/?docket=${docketId}
https://www.courtlistener.com/api/rest/v3/parties/?docket=${docketId}
```

## Access Tiers

CourtListener uses **means-based pricing**, not fixed free/paid tiers:

### For Individuals & Non-Profits:
- ✅ **Free API access** with authentication
- ✅ **5,000 queries per hour** rate limit
- ✅ **Bulk data downloads** (free, no copyright restrictions)
- ✅ All database APIs available

### For Organizations & Commercial Use:
- 💰 **Negotiated pricing** based on usage and means
- 💰 **Advanced features** (webhooks, higher limits) require fees
- Contact Free Law Project to discuss agreements

### Authentication Required:
- **As of v4.3:** All authenticated endpoints now return 401 for anonymous requests
- **Need API token** from: https://www.courtlistener.com/register/
- **Token format:** `Authorization: Token YOUR_TOKEN_HERE`

## What Data We Can Access

### ✅ Available (What We're Using):

1. **Dockets** (`/dockets/${docketId}/`)
   - Case name, court, filing date
   - Docket number, nature of suit, cause
   - Jurisdiction type
   - **NOT paywalled**

2. **Docket Entries** (`/docket-entries/?docket=${docketId}`)
   - Entry number, date
   - Description (e.g., "Complaint", "Verdict Form", "Judgment")
   - **NOT paywalled**

3. **Parties** (`/parties/?docket=${docketId}`)
   - Party names (plaintiffs, defendants)
   - Party types
   - Attorneys
   - **NOT paywalled**

4. **Opinions** (`/opinions/${opinionId}/`)
   - Opinion text, syllabus, procedural history
   - Judge names, citations
   - **NOT paywalled**

### ❓ Potentially Restricted:

1. **PDF Documents** (`/recap-documents/`)
   - May require PACER purchase
   - Some documents sealed or unavailable
   - **Warning:** Don't accidentally request sealed documents (you'll be charged)

2. **RECAP Fetch API**
   - Uses YOUR PACER credentials to purchase documents
   - Charges apply per document

3. **Attachment Pages**
   - May be behind PACER paywall

### ✅ What We're Successfully Getting:

Based on our implementation, we ARE getting:
- ✅ Complaint descriptions (from docket entries)
- ✅ Verdict descriptions (from docket entries)
- ✅ Judgment descriptions (from docket entries)
- ✅ Party information (plaintiffs, defendants, attorneys)
- ✅ Case metadata (nature of suit, cause, court)

**What we're NOT getting:**
- ❌ Full PDF text of complaints/verdicts/judgments (would require PACER purchase)
- ❌ Document content beyond entry descriptions

## Rate Limits

- **5,000 queries/hour** for authenticated users
- **Deep pagination:** Limited to 100 pages when not ordering by `id`, `date_modified`, or `date_created`
- **Cursor-based pagination** in v4 allows unlimited deep crawling

## Why Our Implementation Works

We're getting **docket entry descriptions**, not full documents:

```javascript
// What we get from /docket-entries/ API:
{
  "entry_number": 1,
  "date_filed": "2023-01-15",
  "description": "Complaint for Damages",  // ← This is free!
  // PDF would be at recap_documents (may require PACER purchase)
}
```

The **description field** gives us:
- "Complaint for Damages"
- "Jury Verdict Form"
- "Final Judgment - Defendant liable for $500,000"

This is **metadata**, not the full document text, so it's free and accessible via the API.

## Migration Needed: v3 → v4

### Why Migrate:
1. v3 will eventually be deprecated
2. v4 has better performance (ElasticSearch)
3. v4 has cursor pagination (no 100-page limit)
4. v4 is actively maintained

### What to Change:

```javascript
// Old (v3):
https://www.courtlistener.com/api/rest/v3/dockets/${docketId}/

// New (v4):
https://www.courtlistener.com/api/rest/v4/dockets/${docketId}/
```

### Risk:
- Field names may have changed
- Response structure may be different
- Need to test all endpoints

### Testing Plan:
1. Update URL paths from `/v3/` to `/v4/`
2. Test each endpoint:
   - `GET /v4/dockets/{id}/`
   - `GET /v4/docket-entries/?docket={id}`
   - `GET /v4/parties/?docket={id}`
   - `GET /v4/opinions/{id}/`
3. Check for breaking changes in response structure
4. Update field mappings if needed

## Current Implementation Status

### ✅ Working:
- Fetching docket metadata
- Getting docket entry descriptions (complaint, verdict, judgment)
- Retrieving party information
- Consolidating multiple docket entries into one case
- Filtering out cases without summary data

### ❌ Limitations:
- Using deprecated v3 API (need to migrate)
- Can't access full PDF text without PACER purchase
- Rate limited to 5,000 queries/hour
- Some cases may be sealed or unavailable

### 💡 Not Hitting Paywalls Because:
- We're only using docket entry **descriptions** (metadata)
- We're NOT fetching PDF documents
- We're NOT using the RECAP Fetch API
- All data we need is in the free tier

## Recommendations

1. **Migrate to v4 soon** (v3 will be deprecated)
2. **Test v4 endpoints** to ensure field compatibility
3. **Monitor rate limits** (5,000/hour is plenty for now)
4. **Don't fetch PDFs** unless user explicitly requests (PACER costs apply)
5. **Consider upgrading to v4.3** for better authentication handling

## Sources

- [REST API, v4.3 Documentation](https://www.courtlistener.com/help/api/rest/)
- [RECAP APIs for PACER Data](https://www.courtlistener.com/help/api/rest/v4/recap/)
- [V4 API Migration Guide](https://www.courtlistener.com/help/api/rest/v4/migration-guide/)
- [CourtListener API Access Info](https://www.courtlistener.com/help/api/)
- [API Surpasses 100 Million Requests (2025)](https://free.law/2025/09/29/one-hundred-million-requests/)

## Summary

**You're not hitting a paywall!**

What you're asking for (complaint/verdict/judgment summaries) is available as **free metadata** in docket entry descriptions. You don't need to purchase PDFs from PACER.

The data we're getting is:
- ✅ Free (no PACER charges)
- ✅ Accessible via API (5,000/hour limit)
- ✅ Sufficient for credibility checks

The only issue is we're using **v3 (deprecated)** instead of **v4 (current)**, which we should migrate to soon.
