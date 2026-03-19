# Two-Pass Search Implementation Status

## What Was Implemented

### ✅ Phase 1: DuckDuckGo Integration
**File:** `src/core/duckDuckGoSearch.js`
- Created DuckDuckGo search wrapper (less filtered than Tavily/Bing)
- HTML scraping approach (free, no API key needed)
- Fringe query generators by claim type
- Claim type detection

### ✅ Phase 2: Evidence Engine Enhancements
**File:** `src/core/evidenceEngine.js`
- Added `generateFringeQueries()` method
- Added `detectClaimType()` method
- Modified `run()` method to support two-pass search
- Added fringe evidence tagging

### ✅ Phase 3: Integration
**File:** `src/core/runEvidenceEngine.js`
- Imported DuckDuckGo search
- Added fringe search to engine deps
- Added runOptions for fringe search configuration

## How It Works

### Pass 1: High-Quality Sources (Existing)
```
Search with: Tavily + Bing (hybrid mode)
Queries: "antisemitism rise October 2023"
         "rise in antisemitism schools statistics"
Results: ADL, SPLC, University studies (high credibility)
Verdict: SUPPORT (confidence: 0.95)
```

### Pass 2: Fringe Sources (NEW)
```
Triggered when: Primary verdict is strong support (confidence > 0.7)
Search with: DuckDuckGo (less filtered)
Queries: "antisemitism hoax October 2023"
         "site:gab.com antisemitism exaggerated"
         "antisemitism false flag"
Results: Gab, Stormfront, conspiracy blogs (low credibility)
Tagged as: Fringe evidence for credibility mapping
```

## Configuration

**In runEvidenceEngine.js:**
```javascript
const runOptions = {
  // Main search (Pass 1)
  enableWeb: true,
  topKQueries: 6,
  searchEngine: "hybrid",
  maxEvidenceCandidates: 4,

  // Fringe search (Pass 2) - NEW
  enableFringeSearch: true,  // Enable second pass
  topKFringeQueries: 3,      // 3 fringe queries per claim
  topKFringeCandidates: 3,   // Fetch 3 fringe candidates
  maxFringeEvidenceCandidates: 2, // Extract from 2 sources
};
```

## Fringe Query Templates

By claim type:
- **Antisemitism:** site:gab.com, site:bitchute.com, "antisemitism myth"
- **Vaccines:** site:naturalnews.com, site:childrenshealthdefense.org
- **Climate:** site:wattsupwiththat.com, "climate hoax"
- **COVID:** site:naturalnews.com, "covid hoax", "plandemic"
- **Pesticides:** site:naturalnews.com, "pesticide safety"

## What's Next (To Complete)

### Phase 4: Process Fringe Results
Need to add fringe evidence processing in runEvidenceEngine.js:
```javascript
// After main evidence loop
for (const fringeEv of fringeItems) {
  // Tag source as low-credibility if refuting well-supported claim
  if (adj.finalVerdict === 'support' && fringeEv.stance === 'refute') {
    fringeSourcesFound.push({
      url: fringeEv.url,
      domain: extractDomain(fringeEv.url),
      claimType: claimType,
      pattern: 'refutes-documented-facts',
      credibilityScore: 0.10,
    });
  }
}
```

### Phase 5: Source Credibility Database
Create tables for source profiles:
```sql
CREATE TABLE source_profiles (
  domain VARCHAR(255) PRIMARY KEY,
  credibility_score DECIMAL(3,2),
  bias_rating VARCHAR(50),
  tags JSON,
  claim_patterns JSON,
  created_at TIMESTAMP
);

CREATE TABLE source_claim_patterns (
  domain VARCHAR(255),
  claim_type VARCHAR(50),
  stance VARCHAR(20),
  frequency INT,
  last_seen TIMESTAMP,
  FOREIGN KEY (domain) REFERENCES source_profiles(domain)
);
```

### Phase 6: UI Display
Show fringe sources to users:
```
PRIMARY EVIDENCE: ✅ Well-supported (ADL, SPLC)
FRINGE REFUTATIONS: ⚠️ Low-credibility sources dispute this
  [Show fringe sources] →
    - Gab (credibility: 0.10) - Antisemitism denial pattern
    - Stormfront (credibility: 0.05) - Hate speech platform
```

## Benefits

1. **Source Credibility Mapping** - Identify bad actors
2. **Pattern Recognition** - "Sites that deny X also deny Y"
3. **User Education** - "Only fringe sources dispute this"
4. **Complete Evidence** - Show what the fringe is saying
5. **Bias Detection** - Connect claim types to source quality

## Testing

To test fringe search:
```javascript
// Set enableFringeSearch: true in runOptions
// Scrape a well-documented claim (antisemitism, vaccines, etc.)
// Check logs for:
//   🔍 [EV][fringe] Starting fringe source discovery
//   🔍 [EV][fringe] Detected claim type: antisemitism
//   🔍 [EV][fringe] Found 2 fringe evidence items
```

## Current Status

✅ Infrastructure complete
✅ DuckDuckGo integration ready
✅ Fringe query generation working
✅ Two-pass logic implemented
⏳ Fringe result processing (needs completion)
⏳ Source credibility database (needs schema)
⏳ UI display (needs design)

**Ready to test basic fringe search discovery!**
