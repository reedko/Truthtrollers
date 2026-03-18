# Credibility Module Integration - Summary

## What Was Added

### 1. New API Services (Backend)

#### **CourtListener Service** (`backend/src/services/external/courtlistener.service.js`)
- Searches federal and state court cases
- Tracks litigation history for authors and publishers
- Provides case names, courts, dates, and descriptions
- Risk assessment based on case count

#### **CFPB Service** (`backend/src/services/external/cfpb.service.js`)
- Consumer Financial Protection Bureau complaint database
- Searches consumer complaints by company name
- Tracks complaint statistics (dispute rates, response times)
- **No API key required** - public API!
- Particularly useful for financial publishers

### 2. Updated Credibility Service (`backend/src/services/external/credibility.service.js`)
Now integrates **4 services**:
- ✅ **OpenSanctions** - Sanctions & watchlist screening
- ✅ **GDI** - Global Disinformation Index (waiting for API key)
- ✅ **CourtListener** - Court case search (requires API token)
- ✅ **CFPB** - Consumer complaints (works immediately, no key needed)

### 3. New Credibility Page (`dashboard/src/pages/CredibilityPage.tsx`)
**Route:** `/credibility`

**Features:**
- Dropdown selectors for existing authors and publishers
- Service status display showing which APIs are configured
- Tabbed interface (Authors / Publishers)
- Real-time credibility checks
- Detailed results display with:
  - Overall risk assessment
  - Expandable service-by-service breakdown
  - Court case details
  - Consumer complaint summaries
  - Risk reasons and explanations

### 4. Updated Credibility Modal (`dashboard/src/components/modals/CredibilityInfoModal.tsx`)
Enhanced the existing modal in **PubCard** and **AuthCard** to show:
- **CourtListener** results with court case listings
- **CFPB** results with complaint statistics and examples
- All results styled with appropriate badges and risk colors

## How to Use

### Setup API Keys

Add to `backend/.env`:
```bash
# Required
OPENSANCTIONS_API_KEY=your_key_here
COURTLISTENER_API_TOKEN=your_token_here

# Optional (waiting for key)
GDI_API_KEY=your_key_here

# No key needed
# CFPB is public
```

**Get API Keys:**
- **CourtListener**: https://www.courtlistener.com/api/
- **OpenSanctions**: https://www.opensanctions.org/api/
- **GDI**: Contact Global Disinformation Index

### Using the Credibility Page

1. Navigate to `/credibility` in the workbench
2. Select **Authors** or **Publishers** tab
3. Choose an entity from the dropdown
4. Click "Check Credibility"
5. View detailed results from all services

### Using From PubCard/AuthCard

1. Click the **Actions** menu on any publisher or author card
2. Select "🔍 Check Credibility"
3. Modal opens showing all credibility check results
4. Results include:
   - OpenSanctions matches (sanctions, PEPs)
   - GDI bias ratings (when available)
   - Court cases (from CourtListener)
   - Consumer complaints (from CFPB)

## Risk Assessment

Each service returns a risk level:
- **None** 🟢 - No issues found
- **Low** 🔵 - Minor concerns
- **Medium** 🟡 - Moderate concerns
- **High** 🟠 - Significant concerns
- **Critical** 🔴 - Severe concerns

The overall risk is calculated as the highest risk across all services.

## What Works Right Now

✅ **CFPB** - Works immediately (public API, no key needed)
✅ **OpenSanctions** - If API key is configured
✅ **CourtListener** - If API token is configured (you have: `ccba10cf...`)
⏳ **GDI** - Waiting for API key from Global Disinformation Index

## Testing

### Test the new page:
```
http://localhost:3000/credibility
```

### Test author credibility:
```
GET /api/credibility/check-author/:authorId
```

### Test publisher credibility:
```
GET /api/credibility/check-publisher/:publisherId
```

### Check service status:
```
GET /api/credibility/status
```

## Files Modified

**Backend:**
- ✅ `backend/src/services/external/courtlistener.service.js` (new)
- ✅ `backend/src/services/external/cfpb.service.js` (new)
- ✅ `backend/src/services/external/credibility.service.js` (updated)
- ✅ `backend/CREDIBILITY_API_SETUP.md` (documentation)

**Frontend:**
- ✅ `dashboard/src/pages/CredibilityPage.tsx` (new)
- ✅ `dashboard/src/routes.tsx` (added route)
- ✅ `dashboard/src/components/modals/CredibilityInfoModal.tsx` (updated)

## Next Steps

1. ✅ Test CFPB integration (works immediately)
2. ⏳ Wait for GDI API key
3. ⏳ Add link to Credibility page in main navigation
4. ⏳ Consider caching credibility results to avoid re-checking frequently
