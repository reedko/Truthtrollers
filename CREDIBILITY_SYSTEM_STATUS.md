# Credibility System - Current Status & Issues

## Current Flow

### 1. Author Card → Credibility Check
**Button Location:** Author card in workspace/dashboard

**Endpoint:** `POST /api/credibility/author/{authorId}/check`

**What It Does:**
- Calls `credibilityService.checkAuthor()`
- Runs ALL APIs: OpenSanctions, CourtListener, CFPB
- Stores results in `author_credibility_checks` table
- Returns full result object

**Display:** Opens `CredibilityInfoModal` with results

### 2. Credibility Page → Custom Check
**Location:** Dedicated credibility page

**Endpoint:** `POST /api/credibility/check-custom-author`

**What It Does:**
- Calls `credibilityService.checkAuthor()`
- Runs same APIs: OpenSanctions, CourtListener, CFPB
- Does NOT store in database
- Returns full result object

**Display:** Shows inline results on page

## What Works

✅ **Backend is unified:**
- Single `credibilityService.checkAuthor()` method
- Runs all APIs together (OpenSanctions, CourtListener, CFPB)
- Both endpoints use the same service

✅ **CourtListener is being called:**
- It's in the service
- It's being executed
- Results are returned

## What's Broken

### ❌ **Display is Basic**

**Current CourtListener Display (CredibilityInfoModal):**
```
CourtListener
⚖️ 15 court case(s) found

Smith v. Jones
ca9 - 2023-01-15
...some snippet text...
```

**What's Missing:**
- No complaint summary ("Dude A suing Dude B because...")
- No verdict ("Jury says...")
- No judgment ("Judge ordered...")
- No readable explanation of what actually happened
- No page type (opinion vs docket)
- No case type (criminal vs civil)

### ❌ **Legal Case Parser Not Used**

The new `LegalCaseParser` exists but:
- Modal doesn't call `GET /api/credibility/legal-case/details`
- No readable summaries shown
- User sees URL but no human explanation

### ❌ **Inconsistent Response Format**

Different endpoints return slightly different structures:
- `/author/:id/check` stores in DB, returns services
- `/check-custom-author` doesn't store, returns services
- Both work but confusing architecture

## What You Want

### Unified Flow:
1. **Same code path** whether from card or page
2. **Same API calls** (OpenSanctions, CourtListener, CFPB, GDI)
3. **Same response format** everywhere
4. **Role-based filtering** (privileged users get more APIs)

### Better Display:
5. **Readable case summaries** not just case names
6. **Complaint + Verdict + Judgment** extracted and shown
7. **Page type indicators** (opinion vs docket vs filing)
8. **Case type classification** (criminal, civil, habeas, etc.)

## Proposed Solution

### 1. Enhance CredibilityService

```javascript
async checkAuthor(author, authorId, options = {}) {
  const userRole = options.userRole || 'user';

  const results = {
    author_id: authorId,
    checked_at: new Date().toISOString(),
    services: {}
  };

  // Always run these
  results.services.opensanctions = await opensanctionsService.checkAuthor(author);
  results.services.courtlistener = await courtlistenerService.checkAuthor(author);

  // Only for privileged users
  if (userRole === 'super_admin' || userRole === 'admin') {
    results.services.cfpb = await cfpbService.checkAuthor(author);
  }

  // Enhance CourtListener results with readable summaries
  if (results.services.courtlistener.cases) {
    results.services.courtlistener.cases = await Promise.all(
      results.services.courtlistener.cases.map(async (c) => {
        if (c.url) {
          try {
            const details = await courtlistenerService.getCaseDetails(c.url);
            return { ...c, details };
          } catch {
            return c;
          }
        }
        return c;
      })
    );
  }

  return results;
}
```

### 2. Update Modal Display

Show readable summaries:
```tsx
{caseData.details?.readable_summary ? (
  <Box fontSize="sm" whiteSpace="pre-wrap">
    {caseData.details.readable_summary}
  </Box>
) : (
  <Text>{caseData.description}</Text>
)}
```

### 3. Single Endpoint

Replace:
- `/api/credibility/author/:id/check`
- `/api/credibility/check-custom-author`

With:
```
POST /api/credibility/check
{
  "entity_type": "author",
  "entity_id": 123, // or null for custom
  "entity_data": { name: "...", ... }
}
```

## Questions for You

1. **Where exactly are you seeing "it looks the same"?**
   - In the CredibilityInfoModal popup?
   - On the CredibilityPage?
   - Both?

2. **Is CourtListener actually returning data?**
   - Can you show me a screenshot or console output?
   - Do you see case names at all?

3. **What do you want displayed?**
   - Full case text?
   - Just complaint + verdict + judgment?
   - Readable one-line summaries?

4. **Role-based filtering - which APIs for which roles?**
   - Everyone: OpenSanctions, CourtListener?
   - Admins only: CFPB, GDI?
   - Custom per API?

## Next Steps

Once you clarify what's broken, I'll:
1. Fix the display to show readable summaries
2. Unify the endpoints into one clean API
3. Add role-based filtering
4. Make card + page use identical code paths
