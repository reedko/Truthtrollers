# Credibility API Services Setup

The TruthTrollers credibility module integrates with five external APIs to assess the credibility and background of authors and publishers.

## Services Overview

### 1. Global Disinformation Index (GDI)
**Status:** Waiting for API key
**Purpose:** Media bias and disinformation ratings
**Applies to:** Publishers, URLs
**Configuration:**
```bash
GDI_API_KEY=your_api_key_here
```
**Sign up:** Contact GDI for API access
**Docs:** https://disinformationindex.org/

### 2. OpenSanctions
**Status:** Configured
**Purpose:** Sanctions, PEPs (Politically Exposed Persons), and watchlist screening
**Applies to:** Authors, Publishers
**Configuration:**
```bash
OPENSANCTIONS_API_KEY=your_api_key_here
```
**Sign up:** https://www.opensanctions.org/api/
**Docs:** https://www.opensanctions.org/docs/api/

### 3. CourtListener (Free Law Project)
**Status:** Ready to configure
**Purpose:** Search federal and state court cases
**Applies to:** Authors, Publishers
**Configuration:**
```bash
COURTLISTENER_API_TOKEN=your_token_here
```
**Sign up:** https://www.courtlistener.com/sign-up/
**Get API Token:** https://www.courtlistener.com/api/
**Docs:** https://www.courtlistener.com/api/rest-info/
**Cost:** Free tier available, premium features require subscription

**Features:**
- Search court opinions and dockets
- Federal and state court coverage
- Searchable by party name, case name, or text
- Useful for finding legal history of individuals/organizations

### 4. Consumer Financial Protection Bureau (CFPB)
**Status:** Configured (public API, no key needed)
**Purpose:** Consumer complaint database for financial institutions
**Applies to:** Publishers (organizations)
**Configuration:** None required (public API)
**Docs:** https://cfpb.github.io/api/ccdb/
**Cost:** Free

**Features:**
- Search consumer complaints by company name
- Filter by product, issue, state, date range
- Company response tracking
- Dispute rates and timeliness metrics
- Particularly useful for checking financial publishers

## Setup Instructions

### Step 1: Get API Keys

1. **CourtListener:**
   - Go to https://www.courtlistener.com/sign-up/
   - Create free account
   - Navigate to https://www.courtlistener.com/api/
   - Copy your API token

2. **GDI (when available):**
   - Contact Global Disinformation Index for API access
   - Receive API key via email

### Step 2: Add to Environment Variables

Add the following to your `backend/.env` file:

```bash
# Credibility Services
OPENSANCTIONS_API_KEY=your_opensanctions_key
GDI_API_KEY=your_gdi_key
COURTLISTENER_API_TOKEN=your_courtlistener_token
# CFPB requires no key
```

### Step 3: Test the Services

Check service status:
```bash
curl http://localhost:5001/api/credibility/status
```

Test author check:
```bash
curl http://localhost:5001/api/credibility/check-author/123
```

Test publisher check:
```bash
curl http://localhost:5001/api/credibility/check-publisher/456
```

## API Usage

### Check Author Credibility
```javascript
GET /api/credibility/check-author/:authorId

Response:
{
  "author_id": 123,
  "checked_at": "2026-03-12T...",
  "services": {
    "opensanctions": { ... },
    "courtlistener": { ... },
    "caselaw": { ... },
    "cfpb": { ... }
  },
  "overall_risk": {
    "level": "low",
    "score": 1,
    "flags": [],
    "reasons": ["5 court cases found"]
  }
}
```

### Check Publisher Credibility
```javascript
GET /api/credibility/check-publisher/:publisherId

Response:
{
  "publisher_id": 456,
  "checked_at": "2026-03-12T...",
  "services": {
    "gdi": { ... },
    "opensanctions": { ... },
    "courtlistener": { ... },
    "caselaw": { ... },
    "cfpb": { ... }
  },
  "overall_risk": {
    "level": "medium",
    "score": 2,
    "flags": ["gdi_low_rating"],
    "reasons": ["GDI score: 45", "120 consumer complaints"]
  }
}
```

## Risk Levels

Each service returns a risk level:
- **none**: No issues found
- **low**: Minor concerns
- **medium**: Moderate concerns
- **high**: Significant concerns
- **critical**: Severe concerns

The overall risk is calculated as the highest risk level across all services.

## Rate Limiting

- **OpenSanctions:** 100 requests/minute
- **GDI:** TBD (when API key received)
- **CourtListener:** Free tier has rate limits, check docs
- **CFPB:** No documented rate limits (public API)

Built-in 500ms delay between batch checks to avoid rate limiting.

## Troubleshooting

### Service returns "not_configured"
- Check that environment variable is set in `.env`
- Restart the backend server after adding new env vars
- Verify API key is valid by testing in browser/Postman

### Service returns "check_failed"
- Check API key is correct
- Verify internet connection
- Check if API service is down (status pages)
- Review error message in server logs

### No results found
- Some services may not have data for all entities
- Try variations of names (full name vs abbreviated)
- Check spelling of entity name in database

## Cost Considerations

- **Free:** OpenSanctions (limited), CourtListener (basic), CFPB (public)
- **Paid:** GDI (pricing TBD), CourtListener premium features
- **Budget:** Estimate ~$50-100/month for full access to all paid tiers

## Privacy & Legal

- All API calls are logged for debugging
- Data is cached to minimize API calls
- Comply with each service's Terms of Service
- Do not use for employment screening (use FCRA-compliant services)
- Legal case data is public record
- Consumer complaints are anonymized by CFPB
