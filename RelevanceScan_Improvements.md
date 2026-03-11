# Relevance Scan Modal Improvements

## Problem Summary

When clicking a case claim in workspace, the "Case Claim Details" modal would show irrelevant source claims with confusing labels:
- Showed claims with stance "? UNKNOWN" (actually "insufficient")
- Score of 0 with no clear explanation
- Labels like "conf." weren't clear
- No publisher or author information
- Irrelevant claims cluttered the UI

## Example of Problem:
```
#1
? UNKNOWN
Score: 0
50% conf.
...
From: How Political Changes Affect Oil And It's Prices? | TNFX

The reference claim does not provide any information or context that relates
to the price of oil, making it irrelevant for evaluating the task claim.
```

This claim should never have been shown to the user.

## Changes Made

### 1. **Backend: Don't Store Irrelevant Assessments**

**File**: `backend/src/routes/claims/referenceClaimTask.routes.js:196-241`

Added filtering logic to skip storing assessments that are irrelevant:

```javascript
// 🎯 FILTER: Don't store irrelevant assessments (insufficient stance with low quality/confidence)
const isIrrelevant = assessment.stance === 'insufficient' &&
                    (assessment.quality < 0.4 || assessment.confidence < 0.4);

if (isIrrelevant) {
  console.log(`[Assess Claim] Skipping irrelevant assessment`);
  return res.json({
    assessed: true,
    link: null, // No link created - claim is irrelevant
    assessment,
    skipped: true,
    reason: 'insufficient_relevance'
  });
}
```

**Impact**: No database pollution with useless assessments. Saves storage and reduces confusion.

### 2. **Frontend: Better Labels and Tooltips**

**File**: `dashboard/src/components/modals/RelevanceScanModal.tsx:387-393, 536-556`

**Before**:
- "? UNKNOWN" - confusing label
- "Score: X" - unclear what it means
- "X% conf." - abbreviated and unclear

**After**:
- "⊘ INSUFFICIENT" - clear label for insufficient stance
- "Relevance: X" with tooltip: "Relevance score: -100 (strongly refutes) to +100 (strongly supports)"
- "Confidence: X%" with tooltip: "AI confidence in this assessment"

**Changed Labels**:
```typescript
const getStanceLabel = (stance?: string) => {
  if (stance === "support") return "✓ SUPPORTS";
  if (stance === "refute") return "✗ REFUTES";
  if (stance === "nuance") return "~ NUANCED";
  if (stance === "insufficient") return "⊘ INSUFFICIENT"; // NEW
  return "? UNKNOWN";
};
```

### 3. **Frontend: Added Publisher and Author Info**

**File**: `dashboard/src/components/modals/RelevanceScanModal.tsx:555-575`

**Before**:
```
From: How Political Changes Affect Oil And It's Prices? | TNFX
```

**After**:
```
Source: How Political Changes Affect Oil And It's Prices? | TNFX
Publisher: Thomson Reuters
Author: John Smith
```

Added code to display:
- Source name (renamed from "From:")
- Publisher name (if available)
- Author name (if available)

### 4. **Frontend: Filter Out Low-Relevance Claims**

**File**: `dashboard/src/components/modals/RelevanceScanModal.tsx:152-167, 294-313`

Added filtering in two places:

**When loading existing links**:
```typescript
const assessed = sorted.filter((c) => {
  if (!c.stance) return false; // No assessment at all
  if (c.hasLink) return true; // Always show manual links

  // For AI assessments, filter out irrelevant ones
  const isIrrelevant = c.stance === 'insufficient' &&
                      Math.abs(c.relevanceScore) < 10 &&
                      (c.confidence ?? 0) < 0.5;

  return !isIrrelevant;
});
```

**When scanning for new links**:
Same filtering logic applied to new scan results.

**Filtering Criteria**:
- ✅ **Always show**: Manual links (created by users)
- ✅ **Show**: AI assessments with stance support/refute/nuance
- ✅ **Show**: AI assessments marked "insufficient" BUT with high relevance or confidence
- ❌ **Hide**: AI assessments marked "insufficient" with low relevance (<10) and low confidence (<50%)

### 5. **Improved Debug Info**

**File**: `dashboard/src/components/modals/RelevanceScanModal.tsx:531-533`

**Before**:
```
Src Content: 13247 | Src Claim: 39678
```

**After**:
```
Source Content: 13247 | Source Claim: 39678
```

More professional labels (full words instead of abbreviations).

## Understanding the Scores

### Stance
- **✓ SUPPORTS**: Reference claim provides evidence FOR the case claim
- **✗ REFUTES**: Reference claim provides evidence AGAINST the case claim
- **~ NUANCED**: Reference claim adds context or partial support/refutation
- **⊘ INSUFFICIENT**: Reference claim is not relevant or doesn't provide meaningful evidence

### Relevance Score
- **Range**: -100 to +100
- **Calculation**: `stance_multiplier * confidence * quality * 100`
- **Negative**: Refutes the case claim
- **Positive**: Supports the case claim
- **Near zero**: Low relevance or insufficient

### Confidence
- **Range**: 0% to 100%
- **Meaning**: How confident the AI is in its assessment
- **Low confidence**: AI is uncertain about the relationship

## Benefits

1. **Cleaner UI**: Users only see relevant source claims
2. **Less confusion**: Clear labels with helpful tooltips
3. **Better context**: Publisher and author info helps evaluate credibility
4. **Database efficiency**: No storage of useless assessments
5. **Better UX**: Users can focus on meaningful evidence

## Testing Checklist

- [x] Backend skips storing irrelevant assessments
- [x] Frontend filters out low-relevance claims on load
- [x] Frontend filters out low-relevance claims after scanning
- [x] Manual links are never filtered out
- [x] Labels are clear and descriptive
- [x] Tooltips explain what scores mean
- [x] Publisher name displays when available
- [x] Author name displays when available
- [ ] Test with various claim combinations to ensure good filtering

## Example: Before vs After

### Before:
```
#1
? UNKNOWN
Score: 0
50% conf.
...
From: How Political Changes Affect Oil And It's Prices? | TNFX

The reference claim does not provide any information or context...
[Create Link button]
```

### After:
This claim would **not appear at all** because:
- Backend won't store it (insufficient stance + low quality)
- Even if it existed, frontend would filter it out (relevance < 10, confidence < 50%)

### Good Claims Still Show:
```
#1
✓ SUPPORTS
Relevance: 85 [with tooltip]
Confidence: 92% [with tooltip]
...
Source: Climate Scientists Confirm Global Warming Trend
Publisher: Nature Publishing Group
Author: Dr. Jane Smith

This claim provides strong supporting evidence from peer-reviewed research...
[Edit Link button]
```

## Future Improvements

Consider:
1. **Adjustable threshold**: Let users configure what "low relevance" means
2. **Show filtered count**: "15 low-relevance claims hidden (show all)"
3. **Color coding**: Visual indicators for relevance strength
4. **Credibility scores**: Integrate publisher/author credibility ratings
5. **Export**: Allow exporting assessment results for analysis
