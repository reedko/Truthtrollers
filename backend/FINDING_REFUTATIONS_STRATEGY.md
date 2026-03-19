# Finding Refutations for Source Credibility Mapping

## Your Insight

**Goal:** Find sources that publish REFUTED claims (even low-quality ones) to:
- Map which sources publish debunked content
- Build credibility/bias profiles for sources
- Connect claim types to source quality patterns
- Show users "what the fringe is saying"

Example:
```
Claim: "Antisemitism rose after Oct 7, 2023"
Evidence: ADL, SPLC, universities (high credibility)

Refutations: White supremacist blogs, conspiracy sites (low credibility)
→ Map these sources as "antisemitism denial" + "low credibility"
```

## Where Refuted/Fringe Claims Live

### 1. **Conspiracy Theory Sites** (Most Common)
- InfoWars, NaturalNews, GlobalResearch.ca
- Bitchute, Rumble, Gab
- Various "alternative news" networks

**Search strategies:**
```
"antisemitism hoax October 2023"
"fake antisemitism claims Jewish students"
"antisemitism false flag operation"
site:bitchute.com antisemitism exaggerated
site:gab.com antisemitism narrative
```

### 2. **Ideological Echo Chambers**
- Far-right: Stormfront, 4chan/pol/, 8kun
- Far-left: Certain fringe socialist/anti-Zionist blogs
- Anti-vax: NaturalNews, Children's Health Defense (for medical claims)

**Search strategies:**
```
site:reddit.com/r/conspiracy antisemitism overblown
site:4chan.org antisemitism media narrative
inurl:blog "antisemitism myth"
```

### 3. **Foreign Propaganda Outlets**
- RT (Russia Today), Sputnik
- PressTV (Iran)
- CGTN (China)
- Various state-backed "news" sites

**Search strategies:**
```
site:rt.com antisemitism western propaganda
site:presstv.ir antisemitism claims fabricated
```

### 4. **Predatory/Low-Quality Journals**
- Not in DOAJ (Directory of Open Access Journals)
- Paper mills, pay-to-publish
- Retracted papers still hosted

**Search strategies:**
```
"antisemitism exaggerated" filetype:pdf -site:edu -site:gov
intitle:"journal" "antisemitism claims" -site:springer -site:nature
```

### 5. **Personal Blogs & Substack**
- Unmoderated, self-published content
- Often where fringe theories start

**Search strategies:**
```
site:substack.com antisemitism narrative false
site:wordpress.com antisemitism hoax
site:medium.com antisemitism overblown
```

### 6. **Social Media (Especially Unmoderated)**
- Gab, Parler, Truth Social
- Telegram channels
- BitChute comments

**Search strategies:**
```
site:gab.com antisemitism
site:truthsocial.com antisemitism claims
site:t.me antisemitism false (Telegram)
```

### 7. **Archive Sites (Removed Content)**
- archive.org, archive.is, archive.ph
- Captures of deleted tweets, removed posts
- Shows what WAS claimed before debunking

**Search strategies:**
```
site:archive.org antisemitism hoax
site:archive.is antisemitism false flag
```

### 8. **Academic Contrarians**
- Fringe researchers
- Papers from predatory journals
- Retracted studies

**Search strategies:**
```
author:"known contrarian" antisemitism
"antisemitism exaggerated" -site:nih.gov -site:pubmed
```

## Search Engine Strategies

### Current Problem: Tavily & Bing Filter Out Junk
These engines prioritize HIGH-QUALITY sources, which is why you don't find refutations!

### Alternative Search Approaches:

#### 1. **DuckDuckGo** (Less Filtering)
- Doesn't personalize results
- Includes more fringe content
- Better for finding "alternative" views

#### 2. **Yandex** (Russian Search Engine)
- Different editorial standards
- Includes RT, Sputnik, other propaganda
- Good for finding foreign disinfo

#### 3. **Brave Search** (Privacy-Focused)
- Less aggressive filtering
- Includes more independent sites

#### 4. **Google with Negative Filters**
```
"antisemitism" -site:nytimes.com -site:washingtonpost.com -site:cnn.com -site:bbc.com -site:reuters.com
```
Excludes mainstream media to surface fringe sources.

#### 5. **Specialized Search Engines**

**For Conspiracy Content:**
```
site:bitchute.com OR site:rumble.com OR site:gab.com "antisemitism"
```

**For Academic Fringe:**
```
site:researchgate.net OR site:academia.edu "antisemitism overblown"
```

**For Foreign Propaganda:**
```
site:rt.com OR site:sputniknews.com OR site:presstv.ir "antisemitism"
```

## Implementing This in Your Evidence Engine

### Option 1: Add "Fringe Search" Mode

```javascript
const fringeSearchOptions = {
  searchEngine: "duckduckgo", // or custom implementation
  queries: [
    // Standard queries
    "antisemitism rise October 2023 data",

    // Fringe-seeking queries (NEW)
    "antisemitism hoax October 2023",
    "antisemitism false flag Jewish students",
    "antisemitism media narrative fabricated",

    // Site-specific fringe searches
    "site:bitchute.com antisemitism exaggerated",
    "site:gab.com antisemitism fake news",
    "site:substack.com antisemitism hoax",
  ],
  includeBlacklist: true, // Include normally-blacklisted sources
  qualityThreshold: 0.0,  // Don't filter out low-quality
};
```

### Option 2: Two-Pass Search Strategy

**Pass 1: High-Quality Sources (Current)**
- Use Tavily/Bing
- Find credible evidence
- Build primary verdict

**Pass 2: Fringe Sources (NEW)**
- Use DuckDuckGo or manual site searches
- Find low-quality refutations
- Tag sources as "publishes debunked claims"
- Build credibility map

### Option 3: Targeted Fringe Queries

For each claim type, define fringe search targets:

```javascript
const fringeSourcesByClaimType = {
  antisemitism: [
    "site:stormfront.org",
    "site:4chan.org/pol/",
    "site:gab.com",
    "antisemitism hoax",
    "antisemitism false flag",
  ],

  vaccines: [
    "site:naturalnews.com",
    "site:childrenshealthdefense.org",
    "site:vaccinetruth.org",
    "vaccine dangers cover-up",
  ],

  climate: [
    "site:wattsupwiththat.com",
    "site:climatedepot.com",
    "climate change hoax",
  ],

  // etc.
};
```

## Source Credibility Tagging

When you find these refutations, tag the sources:

```javascript
const sourceProfile = {
  url: "bitchute.com/watch/...",
  domain: "bitchute.com",

  credibilityFlags: [
    "antisemitism-denial",
    "conspiracy-content",
    "unmoderated-platform",
  ],

  claimTypes: [
    { type: "antisemitism", stance: "refute", frequency: 45 },
    { type: "covid", stance: "refute", frequency: 120 },
  ],

  credibilityScore: 0.15, // Very low
  biasScore: {
    political: "far-right",
    reliability: "very-low",
  },
};
```

## Building the Credibility Map

```
HIGH CREDIBILITY (0.8-1.0)
├── NYTimes, WaPo, Reuters, AP
├── Peer-reviewed journals (Nature, Science)
└── Government reports (ADL, FBI, CDC)

MEDIUM CREDIBILITY (0.4-0.7)
├── Opinion pieces from reputable sources
├── Think tanks (partisan but fact-based)
└── Regional newspapers

LOW CREDIBILITY (0.2-0.4)
├── Partisan blogs
├── Self-published content
└── Unverified social media

VERY LOW CREDIBILITY (0.0-0.2)
├── Conspiracy sites (InfoWars, NaturalNews)
├── Propaganda outlets (RT, PressTV)
├── Hate speech platforms (Stormfront, Gab)
└── Content farms, clickbait

SHOWS AS "REFUTES WELL-DOCUMENTED FACTS"
└── These sources publish antisemitism denial, vaccine denial, climate denial, etc.
```

## Example Flow

```
1. Claim: "Antisemitism rose after Oct 7, 2023"

2. High-Quality Search (Tavily):
   → ADL: Confirms 200% rise ✅ (credibility: 0.95)
   → SPLC: Confirms rise ✅ (credibility: 0.90)
   → University studies: Confirm rise ✅ (credibility: 0.85)
   Verdict: SUPPORT (high confidence)

3. Fringe Search (DuckDuckGo + Site-Specific):
   → Gab post: "Antisemitism hoax" ❌ (credibility: 0.10)
   → Stormfront: "Jewish victimhood narrative" ❌ (credibility: 0.05)
   → Random blog: "Media exaggerating antisemitism" ❌ (credibility: 0.15)

4. Source Tagging:
   → Gab: +1 to "antisemitism-denial" count
   → Stormfront: +1 to "hate-speech" count
   → Blog: +1 to "conspiracy-content" count

5. User Display:
   PRIMARY EVIDENCE: ✅ Well-supported by high-credibility sources
   FRINGE CLAIMS: ❌ Some low-credibility sources dispute this (view details)

   [Click to see fringe sources]
   ⚠️ Warning: These sources have low credibility scores
   - Gab (credibility: 0.10) - Known for antisemitism denial
   - Stormfront (credibility: 0.05) - Hate speech platform
```

## Recommended Implementation

### Phase 1: Add Fringe Search Capability
```javascript
// In evidenceEngine.js
async generateQueriesWithFringe(claim, ctx, n = 6) {
  const standardQueries = await this.generateQueries(claim, ctx, n);

  const fringeQueries = [
    {
      query: `${claim.text} hoax`,
      intent: "refute-fringe",
    },
    {
      query: `${claim.text} false flag`,
      intent: "refute-fringe",
    },
    {
      query: `site:bitchute.com OR site:gab.com "${claim.text}"`,
      intent: "refute-fringe",
    },
  ];

  return [...standardQueries, ...fringeQueries];
}
```

### Phase 2: Use DuckDuckGo or Custom Scraper
```javascript
// Add to search options
search: {
  highQuality: tavilySearch.web,  // For credible sources
  fringe: duckDuckGoSearch.web,   // For low-quality sources
}
```

### Phase 3: Tag and Score Sources
```javascript
// When processing results
for (const evidence of evidenceItems) {
  const sourceProfile = await getOrCreateSourceProfile(evidence.domain);

  // Tag if source is refuting well-documented facts
  if (primaryVerdict === "support" && evidence.stance === "refute") {
    sourceProfile.tags.push("refutes-documented-facts");
    sourceProfile.credibilityScore -= 0.1;
  }

  // Track claim types this source covers
  sourceProfile.claimTypes.push({
    type: detectClaimType(claim.text), // "antisemitism", "vaccines", etc.
    stance: evidence.stance,
    timestamp: Date.now(),
  });
}
```

## Bottom Line

**You want to find low-quality refutations to BUILD CREDIBILITY MAPS!**

This is actually brilliant:
- High-quality sources supporting claim → Claim is credible ✅
- Low-quality sources refuting claim → Claim is VERY credible ✅✅
- Sources that refute well-documented facts → Flag as low-credibility

**Recommended approach:**
1. Keep current search for HIGH-QUALITY evidence (verdict)
2. Add FRINGE search to find low-quality refutations (source mapping)
3. Tag sources that deny well-documented facts
4. Show users: "Only conspiracy sites dispute this"

This turns "no refutations found" into a FEATURE: "So well-documented that only fringe sources dispute it!"
