# AI Verimeter System

## Overview
This system enables switching between AI-only, User-only, and Combined (AI+User) verimeter scores throughout the application. AI ratings are already generated during the scrape process and stored in `claim_links` with `created_by_ai = 1`.

## Architecture

### Backend Components

#### 1. AI Ratings Module (`src/modules/aiRatings.js`)
Centralized module for all AI rating operations:

**Claim-level Functions:**
- `calculateAIClaimScore(query, claimId)` - AI-only score for a claim
- `calculateUserClaimScore(query, claimId, userId)` - User-only score for a claim
- `calculateCombinedClaimScore(query, claimId, userId, aiWeight)` - Weighted combination

**Content-level Functions:**
- `calculateAIContentScore(query, contentId)` - AI-only scores for content (includes verimeter, pro, con)
- `calculateUserContentScore(query, contentId, userId)` - User-only scores for content
- `calculateCombinedContentScore(query, contentId, userId, aiWeight)` - Weighted combination

**Utility Functions:**
- `getAIEvidenceForClaim(query, claimId)` - Get AI-generated evidence links
- `getAIUserRatingCounts(query, contentId)` - Get counts of AI vs user ratings

#### 2. API Endpoints (`src/routes/scores/scores.routes.js`)

**New Endpoints:**
- `GET /api/content/:contentId/scores/ai` - Get AI-only scores
- `GET /api/content/:contentId/scores/user?viewerId={userId}` - Get user-only scores
- `GET /api/content/:contentId/scores/combined?viewerId={userId}&aiWeight={0-1}` - Get combined scores

**Response Format:**
```json
{
  "verimeter_score": 0.75,
  "pro_score": 0.8,
  "con_score": 0.2,
  "mode": "ai|user|combined",
  "rating_counts": {
    "ai_count": 12,
    "user_count": 5,
    "total_count": 17
  }
}
```

### Frontend Components

#### 1. Context Provider (`dashboard/src/contexts/VerimeterModeContext.tsx`)
Global state management for verimeter mode:
- Persists mode selection to localStorage
- Provides `mode`, `setMode`, `aiWeight`, `setAIWeight`
- Available modes: `'ai'`, `'user'`, `'combined'`

**Usage:**
```typescript
import { useVerimeterMode } from '../contexts/VerimeterModeContext';

function MyComponent() {
  const { mode, setMode, aiWeight, setAIWeight } = useVerimeterMode();
  // ...
}
```

#### 2. Toggle Component (`dashboard/src/components/VerimeterModeToggle.tsx`)
UI control for switching modes:
- Compact mode: Small button with popover
- Full mode: Expanded card with slider for AI weight
- Color-coded: AI (purple), User (blue), Combined (teal)

**Usage:**
```tsx
import { VerimeterModeToggle } from '../components/VerimeterModeToggle';

// Compact mode (for toolbars)
<VerimeterModeToggle compact />

// Full mode (for settings panels)
<VerimeterModeToggle />
```

#### 3. Updated API Service (`dashboard/src/services/useDashboardAPI.ts`)
Enhanced `fetchContentScores` function:

```typescript
export const fetchContentScores = async (
  contentId: number,
  userId: number | null,
  mode: VerimeterMode = 'user',
  aiWeight: number = 0.5
) => {
  // Automatically routes to correct endpoint based on mode
  // ...
}
```

## Integration Guide

### Step 1: Add Toggle to UI
Add the `VerimeterModeToggle` component to your control bar or settings panel:

```tsx
import { VerimeterModeToggle } from '../components/VerimeterModeToggle';

<VerimeterModeToggle compact /> // In toolbar/header
```

### Step 2: Update Score Fetching
Modify components that fetch scores to use the mode:

```typescript
import { useVerimeterMode } from '../contexts/VerimeterModeContext';
import { fetchContentScores } from '../services/useDashboardAPI';

function MyComponent() {
  const { mode, aiWeight } = useVerimeterMode();
  const userId = /* get current user ID */;

  const loadScores = async () => {
    const scores = await fetchContentScores(contentId, userId, mode, aiWeight);
    // Use scores.verimeterScore, scores.pro, scores.con
  };

  // Re-fetch when mode changes
  useEffect(() => {
    loadScores();
  }, [mode, aiWeight]);
}
```

### Step 3: Update Verimeter Displays
Components that display scores should react to mode changes:

**Example for VerimeterBar:**
```tsx
import { useVerimeterMode } from '../contexts/VerimeterModeContext';

function VerimeterBar({ contentId }) {
  const { mode, aiWeight } = useVerimeterMode();
  const [scores, setScores] = useState(null);

  useEffect(() => {
    fetchContentScores(contentId, userId, mode, aiWeight)
      .then(setScores);
  }, [contentId, mode, aiWeight]);

  return <div>Score: {scores?.verimeterScore}</div>;
}
```

## Components to Update

The following components display verimeter scores and should be updated:

### Dashboard
1. `dashboard/src/components/VerimeterBar.tsx`
2. `dashboard/src/components/VerimeterMeter.tsx`
3. `dashboard/src/components/ModernArcGauge.tsx`
4. `dashboard/src/components/TopStatsPanel.tsx`
5. `dashboard/src/components/BoolCard.tsx`
6. `dashboard/src/components/RatingEvaluation.tsx`
7. `dashboard/src/components/tiles/ScoreTile.tsx`
8. `dashboard/src/pages/CaseFocusPage.tsx`
9. `dashboard/src/pages/ClaimDuelPage.tsx`

### Extension (if needed)
1. `extension/src/components/ModernArcGauge.tsx`
2. `extension/src/components/VerimeterMeter.tsx`
3. `extension/src/components/UserConsensusBar.tsx`

## Database Schema

The system uses the existing `claim_links` table structure:

```sql
claim_links:
  - claim_id
  - reference_content_id
  - stance (support, refute, nuance, insufficient)
  - score
  - confidence
  - support_level (DECIMAL -1 to 1) -- Key field for AI ratings
  - rationale
  - evidence_text
  - evidence_offsets
  - created_by_ai (BOOLEAN) -- 1 = AI, 0 = User
  - verified_by_user_id
  - disabled
```

**Filtering Logic:**
- AI scores: `WHERE created_by_ai = 1 AND disabled = 0`
- User scores: `WHERE created_by_ai = 0 AND disabled = 0`
- Combined: Weighted average of both

## Testing

### Backend Tests
```bash
# Test AI scores endpoint
curl "https://localhost:5001/api/content/123/scores/ai"

# Test user scores endpoint
curl "https://localhost:5001/api/content/123/scores/user?viewerId=456"

# Test combined scores endpoint
curl "https://localhost:5001/api/content/123/scores/combined?viewerId=456&aiWeight=0.7"
```

### Frontend Tests
1. Toggle between modes and verify scores update
2. Adjust AI weight slider in combined mode
3. Verify mode persists after page refresh (localStorage)
4. Check that all verimeter displays update correctly

## Future Enhancements

1. **Per-User AI Weight Preferences**: Store user's preferred AI weight in user settings
2. **Mode-Specific Visualizations**: Different gauge styles for AI vs User modes
3. **Comparison View**: Show AI and User scores side-by-side
4. **AI Confidence Indicators**: Display AI's confidence levels alongside scores
5. **Explainability**: Show AI evidence when hovering over AI scores

## Notes

- AI ratings are generated during scrape using `evidenceEngine.js`
- AI support_level is calculated as: `stance_multiplier * confidence * quality`
- Stance multipliers: support=1.0, refute=-1.0, nuance=0.5, insufficient=0.0
- All scores are clamped to range [-1, 1] for verimeter, [0, 1] for pro/con
