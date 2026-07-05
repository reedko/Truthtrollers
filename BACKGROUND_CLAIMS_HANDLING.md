# Background Claims: Current Treatment & Integration Guide

## Definition
Background claims are statements that:
- Don't address the central theme/thesis of the article
- Don't affect the central truth value being evaluated
- Would be useful if the content was later used as a SOURCE to evaluate other content
- Are contextual facts, historical information, or general knowledge assertions

## Current Handling - Five-Stage Process

### STAGE 1: EXTRACTION (localClaimExtraction.js + claimsEngine.js)

**What happens:**
- Background claims are extracted from content with role = `"background"`
- Extracted alongside thesis, pillar, evidence, and opposing_claim roles
- LLM marks them during local chunk extraction phase

**Extraction prompt guidance:**
```
localRoleSuggestion: 
  - thesis | pillar | evidence | background | opposing_claim | unclear
```

**Location:** `claimsEngine.js:628`
```javascript
const backgroundClaims = flattenClaimEntries(reasoningStack.backgroundClaims, 'background');
```

---

### STAGE 2: RANKING IN EXTRACTION PIPELINE (claimsEngine.js)

**What happens:**
- Background claims ranked LAST by `roleRank` in synthesis
- Ordered as: thesis (0) → pillar (1) → evidence (2) → background (3)
- Lower rank = appears later in final claim list

**Location:** `claimsEngine.js:793`
```javascript
const roleRank = { 
  thesis: 0, 
  pillar: 1, 
  evidence: 2, 
  opposing_claim: 2, 
  unclear: 2, 
  background: 3    // ← LAST
};

const orderedClaims = synthesis.claims
  .slice()
  .sort((a, b) =>
    (roleRank[a.finalRole] ?? 2) - (roleRank[b.finalRole] ?? 2) ||
    ...
  );
```

---

### STAGE 3: FILTERING OUT OF BEARING/EVIDENCE PIPELINE (evidenceCandidateSelector.js)

**What happens:**
- Background claims are explicitly FILTERED OUT before bearing gating
- They never enter evidence retrieval or bearing scoring
- Marked with skip reason: `"background_claim"`
- Only non-background claims proceed to evidence search

**Location:** `evidenceCandidateSelector.js:105-145`
```javascript
export function selectClaimsForBearingGating(claims = [], config) {
  const candidates = [];
  const skipped = [];
  
  for (const claim of claims) {
    const role = String(claim?.role || "").toLowerCase();
    const argumentFunction = String(claim?.argumentFunction || "").toLowerCase();
    
    // FILTER OUT BACKGROUND CLAIMS
    if (role === "background" || argumentFunction === "background") {
      skipped.push({ claim, reason: "background_claim" });  // ← SKIPPED
      continue;
    }
    
    // ... other filtering logic ...
    candidates.push(claim);  // Only non-background claims proceed
  }
  
  return { eligible, skipped };
}
```

---

### STAGE 4: SCORING ELIGIBILITY (argumentMappingEngine.js)

**What happens:**
- Background claims marked as NOT searchable and NOT verdict-eligible
- `searchEligible: false` — won't trigger evidence retrieval
- `verdictEligible: false` — won't affect article's final rating/score

**Location:** `argumentMappingEngine.js:350-370`
```javascript
const isBackground = argumentFunction === "background" || flags.background;

// ... creating substantive target ...
targets.push(normalizeEvaluationTarget({
  targetType: "substantive",
  targetText: substantiveText,
  // ... other fields ...
  scoreTransform,
  searchEligible: !isBackground,      // ← FALSE for background
  verdictEligible: !isBackground,     // ← FALSE for background
  resolutionStatus: "mapped",
}, { ...context, targetOrder: targets.length }));
```

---

### STAGE 5: DISPLAY IN WORKSPACE (Dashboard/UI)

**What happens:**
- Background claims appear at BOTTOM of claim stack
- Labeled with role badge "BACKGROUND" (gray color)
- Sorted by `roleOrder` array

**Location:** `dashboard/src/components/admin/ClaimHierarchyEditor.tsx:62`
```javascript
const roleOrder: ClaimRole[] = [
  "thesis",              // Position 0 (top)
  "pillar",              // Position 1
  "pillar_support",      // Position 2
  "evidence",            // Position 3
  "fallibility_critical",// Position 4
  "background"           // Position 5 (bottom)
];

// When sorting claims:
claims.forEach((claim) => {
  const parentId = claim.parent_claim_id ?? null;
  // ...
  const sortClaims = (a: Claim, b: Claim) =>
    roleOrder.indexOf(String(a.claim_role || ... ) -
    roleOrder.indexOf(String(b.claim_role || ... ) ||
    // ... secondary sorts ...
});
```

**Location:** `dashboard/src/components/admin/ClaimHierarchyEditor.tsx:74-81`
```javascript
const roleLabel = (claim: Claim) => {
  const value = String(claim.claim_role || claim.claim_type || "background").toLowerCase();
  if (value === "task" || value === "thesis") return "THESIS";
  if (value === "pillar") return "PILLAR";
  if (value === "pillar_support") return "PILLAR SUPPORT";
  if (value === "fallibility_critical") return "CRITICAL";
  if (value === "evidence" || value === "reference" || value === "snippet") return "EVIDENCE";
  return "BACKGROUND";  // ← Label for background role
};
```

---

## Constraints / Rules Currently Enforced

| Aspect | Rule | Code Location |
|--------|------|---------------| 
| **Extraction** | Extracted with `role: "background"` | `localClaimExtraction.js` |
| **Deduplication** | Included in dedup (not filtered early) | `claimsEngine.js:123-147` |
| **Synthesis** | Kept during synthesis consolidation | `claimsEngine.js:792-810` |
| **Ranking** | Sorted to BOTTOM of claim list | `claimsEngine.js:793-800` |
| **Bearing Search** | EXCLUDED from bearing pipeline | `evidenceCandidateSelector.js:111-113` |
| **Evidence Retrieval** | NOT retrieved (searchEligible=false) | `argumentMappingEngine.js:366` |
| **Scoring** | NOT included in verdict (verdictEligible=false) | `argumentMappingEngine.js:367` |
| **UI Display** | Shown at bottom with "BACKGROUND" label | `ClaimHierarchyEditor.tsx:62,81` |
| **Linkability** | Cannot be linked to evidence sources | (via searchEligible=false) |

---

## How to Integrate Into Theme-Aware Chunked Extraction

### Approach 1: PRESERVE CURRENT BEHAVIOR (Recommended)

Keep background claims in the same pipeline but mark them clearly during theme-aware extraction:

```javascript
// In new theme-aware extraction:

async function extractClaimsWithThemeAwareness(chunk, articleTheme) {
  const claims = await extractClaimsForChunk({
    chunk,
    articleTheme,
    systemPrompt: `Extract claims. For each, mark:
      - themeRelevant: boolean (supports/refutes main article argument)
      - role: "thesis" | "pillar" | "evidence" | "background" | "opposing_claim"`
  });
  
  // Separate into two buckets
  const themeAlignedClaims = claims.filter(c => c.themeRelevant || c.role !== "background");
  const backgroundClaims = claims.filter(c => c.role === "background");
  
  // Process theme-aligned claims for evidence (existing flow)
  // Store background claims separately (preserved for context)
  
  return {
    themeAlignedClaims,     // → Full evidence pipeline (12 final)
    backgroundClaims        // → Kept in DB, shown in workspace, no evidence
  };
}
```

### Approach 2: USE THEM IN FINAL SYNTHESIS

Include background claims in the final 12+ displayed claims but clearly marked:

```javascript
async function synthesizeAndFilter(allChunkResults, articleTheme) {
  const allClaims = [];
  const backgroundClaims = [];
  
  // Separate by theme relevance
  for (const chunk of allChunkResults) {
    for (const claim of chunk.claims) {
      if (claim.role === "background") {
        backgroundClaims.push(claim);
      } else {
        allClaims.push(claim);
      }
    }
  }
  
  // Process main claims: full evidence + ranking (12 claims)
  const mainClaims = filterAndRankBySemantic(allClaims, 12);
  
  // Append background claims AT THE END (not ranked, no evidence)
  const finalResult = [
    ...mainClaims.map(c => ({ ...c, role: c.role })),
    ...backgroundClaims.map(c => ({ ...c, role: "background", evidence: [] }))
  ];
  
  return finalResult;
}
```

### Approach 3: DEFER BACKGROUND EXTRACTION

Skip background claims entirely during theme-aware extraction, only extract "main" claims:

```javascript
async function extractClaimsForChunk(chunk, articleTheme) {
  const claims = await extractor.extract({
    chunk,
    systemPrompt: `Extract ONLY claims that:
      1. Support or refute the article's main argument: "${articleTheme.thesis}"
      2. Are specific and verifiable
      
    DO NOT extract:
      - Generic background facts
      - Historical context unrelated to the main claim
      - Tangential information
      
    Do not include role: "background"`
  });
  
  // All extracted claims are theme-relevant
  // Background claims can be added LATER as a second pass if needed
  
  return claims;  // All processable for evidence
}
```

---

## Recommended Path Forward

**For your new theme-aware chunked approach, I recommend Approach 1 + 2:**

1. ✅ **Extract claims WITH theme awareness** — mark during extraction which claims are background vs. theme-relevant
2. ✅ **Process theme-relevant claims fully** — 12×N chunks → evidence retrieval → rank by semantic relevance + evidence quality → select top 12
3. ✅ **Preserve background claims separately** — store them, display them at bottom of workspace, do NOT score them
4. ✅ **Keep existing constraints** — `searchEligible=false`, `verdictEligible=false`, no evidence retrieval

**Benefits:**
- Background claims still extracted (useful for future source evaluation)
- Clear separation between "evaluate this" and "context only"
- No changes to existing filtering logic
- Workspace UI already handles background display correctly
- Theme-aware extraction naturally identifies background vs. relevant claims

---

## Files to Modify for New Approach

When implementing theme-aware chunked extraction, preserve these background claim behaviors:

| File | What to Preserve |
|------|------------------|
| `processTaskClaims.js` | Keep background role in extraction output |
| `claimsEngine.js` | Keep background in `roleRank` (sorted to end) |
| `evidenceCandidateSelector.js` | Keep `if (role === "background") { skip }` |
| `argumentMappingEngine.js` | Keep `searchEligible: !isBackground` |
| `Dashboard UI` | Keep bottom-of-stack display, "BACKGROUND" label |

No changes needed—your new extraction will automatically respect these constraints because you'll mark claims with `role: "background"` and the existing filtering will handle them correctly.

