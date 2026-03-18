# Claim Edit Integration - Implementation Complete

## Overview

The pencil icon (✏️) next to each task claim is now fully integrated with the incremental evidence update system. Users can edit claims and choose whether to re-run evidence for changes.

---

## What Was Built

### 1. Backend: Single-Claim Edit Endpoint

**File**: `backend/src/routes/claims/claims.edit.routes.js` (NEW)

**Endpoint**: `PUT /api/claims/:claimId/edit`

**Request Body**:
```json
{
  "newText": "Updated claim text",
  "runEvidence": true,
  "userId": 123
}
```

**Response**:
```json
{
  "success": true,
  "claim": {
    "claim_id": 456,
    "claim_text": "Updated claim text"
  },
  "evidenceRun": true,
  "summary": {
    "added": 1,
    "removed": 1,
    "unchanged": 3,
    "total": 4
  },
  "evidence": {
    "referencesFound": 4,
    "referencesProcessed": 3
  }
}
```

**How It Works**:
1. Gets all claims for the content that contains the edited claim
2. Replaces the edited claim in the array
3. Calls `performIncrementalUpdate()` to detect changes
4. Runs evidence only for the new/changed claim
5. Returns results to frontend

**Files Modified**:
- `backend/src/routes/claims/claims.edit.routes.js` - New route handler
- `backend/src/routes/claims/index.js` - Register new route
- `backend/src/routes/content/content.incremental.routes.js` - Exported `performIncrementalUpdate()` for reuse

---

### 2. Frontend: API Function

**File**: `dashboard/src/services/useDashboardAPI.ts`

**Function**: `updateClaimWithEvidence(claim, runEvidence, userId)`

```typescript
export const updateClaimWithEvidence = async (
  claim: Claim,
  runEvidence: boolean = true,
  userId?: number
): Promise<{
  success: boolean;
  claim: Claim;
  evidenceRun: boolean;
  summary?: { added: number; removed: number; unchanged: number; total: number };
  evidence?: { referencesFound: number; referencesProcessed: number; ... };
}> => {
  const response = await api.put(
    `${API_BASE_URL}/api/claims/${claim.claim_id}/edit`,
    {
      newText: claim.claim_text,
      runEvidence,
      userId,
    }
  );
  return response.data;
};
```

**Usage**:
```typescript
const result = await updateClaimWithEvidence(updatedClaim, true, userId);
console.log(`Found ${result.evidence.referencesFound} new references`);
```

---

### 3. Frontend: Evidence Confirmation Dialog

**File**: `dashboard/src/components/TaskClaims.tsx`

**Changes Made**:

1. **Added Imports**:
   - `useState` for dialog state
   - Modal components from Chakra UI

2. **Added State**:
```typescript
const [showEvidencePrompt, setShowEvidencePrompt] = useState(false);
const [pendingEdit, setPendingEdit] = useState<{
  claim: Claim;
  originalText: string;
} | null>(null);
```

3. **Modified ClaimModal onSave Handler**:
```typescript
onSave={(claim: Claim) => {
  if (claim.claim_id) {
    // Check if claim text changed
    const original = claims.find(c => c.claim_id === claim.claim_id);
    if (original && original.claim_text !== claim.claim_text) {
      // Text changed - show evidence prompt
      setPendingEdit({ claim, originalText: original.claim_text });
      setShowEvidencePrompt(true);
      setIsClaimModalOpen(false);
    } else {
      // Just metadata changed - update directly
      onEditClaim(claim);
      setIsClaimModalOpen(false);
    }
  }
}}
```

4. **Added Evidence Confirmation Modal**:
Shows:
- Original claim text (red background)
- Updated claim text (green background)
- Two buttons:
  - "Yes, Run Evidence" → Calls `onEditClaim({ ...claim, runEvidence: true })`
  - "No, Skip Evidence" → Calls `onEditClaim({ ...claim, runEvidence: false })`

---

### 4. Frontend: Workspace Integration

**File**: `dashboard/src/components/Workspace.tsx`

**Changes Made**:

1. **Added Import**:
```typescript
import { updateClaimWithEvidence } from "../services/useDashboardAPI";
```

2. **Updated onEditClaim Handler**:
```typescript
onEditClaim={async (updatedClaim: Claim & { runEvidence?: boolean }) => {
  const runEvidence = updatedClaim.runEvidence ?? false;

  if (runEvidence) {
    // Use new API with evidence re-run
    try {
      const result = await updateClaimWithEvidence(
        updatedClaim,
        true,
        viewerId || undefined
      );

      // Update claim in state
      setClaims(
        claims.map((c) =>
          c.claim_id === updatedClaim.claim_id ? updatedClaim : c,
        ),
      );

      // Show success feedback
      console.log('Evidence run complete:', result.summary);
      if (result.evidence) {
        console.log(`Found ${result.evidence.referencesFound} new references`);
      }

      // Reload claims and references to show new evidence
      await loadClaimsAndEvidence();
    } catch (error) {
      console.error('Failed to update claim with evidence:', error);
      // Fall back to regular update
      await updateClaim(updatedClaim);
      setClaims(
        claims.map((c) =>
          c.claim_id === updatedClaim.claim_id ? updatedClaim : c,
        ),
      );
    }
  } else {
    // Just update claim without running evidence
    const saved = await updateClaim(updatedClaim);
    setClaims(
      claims.map((c) =>
        c.claim_id === updatedClaim.claim_id ? updatedClaim : c,
      ),
    );
  }
}}
```

**Key Features**:
- Checks `runEvidence` flag on the claim
- Calls new API if evidence should run
- Reloads claims and references after evidence completes
- Falls back to regular update if new API fails
- Logs results to console for debugging

---

## User Flow

### Editing a Claim

1. **User clicks pencil icon** (✏️) next to a claim
2. **ClaimModal opens** with current claim text
3. **User edits text**: "Valerian helps sleep" → "Valerian helps with sleep"
4. **User clicks Save**
5. **System checks if text changed**:
   - If unchanged: Updates claim directly (no dialog)
   - If changed: Shows evidence confirmation dialog
6. **Evidence confirmation dialog appears**:
   - Shows original text in red box
   - Shows new text in green box
   - Asks: "Run evidence for updated claim? (~30-60 seconds)"
7. **User chooses**:
   - **"Yes, Run Evidence"**:
     - Backend detects change (1 removed, 1 added)
     - Runs evidence for new claim only
     - Finds new references
     - Matches to all task claims
     - Returns results
     - Frontend reloads claims and references
     - User sees new evidence immediately
   - **"No, Skip Evidence"**:
     - Updates claim text only
     - Keeps old evidence
     - Fast update (<1 second)

---

## Testing Checklist

### ✅ Backend Tests

1. **Test single-claim edit without evidence**:
```bash
curl -X PUT http://localhost:5001/api/claims/456/edit \
  -H "Content-Type: application/json" \
  -d '{
    "newText": "Updated claim text",
    "runEvidence": false,
    "userId": 1
  }'
```

**Expected**:
- Claim text updated in database
- No evidence engine run
- Response: `evidenceRun: false`

2. **Test single-claim edit with evidence**:
```bash
curl -X PUT http://localhost:5001/api/claims/456/edit \
  -H "Content-Type: application/json" \
  -d '{
    "newText": "Valerian helps with insomnia",
    "runEvidence": true,
    "userId": 1
  }'
```

**Expected**:
- Claim text updated
- Evidence engine runs (~30-60 seconds)
- New references found and linked
- Response includes `summary` and `evidence` objects

### ✅ Frontend Tests

1. **Test pencil icon opens modal**:
   - Click ✏️ next to any claim
   - Modal should open with claim text

2. **Test editing without text change**:
   - Open claim editor
   - Change veracity score or confidence
   - Save
   - Should update without showing evidence dialog

3. **Test editing with text change**:
   - Open claim editor
   - Change claim text
   - Save
   - Evidence confirmation dialog should appear

4. **Test "Yes, Run Evidence"**:
   - Edit claim text
   - Click "Yes, Run Evidence"
   - Should show loading state (check console)
   - After completion, claims and references should reload
   - Check browser console for: `Found X new references`

5. **Test "No, Skip Evidence"**:
   - Edit claim text
   - Click "No, Skip Evidence"
   - Should update immediately (<1 second)
   - Old evidence should remain unchanged

### ✅ Integration Tests

1. **Test with small text change**:
   - "Valerian helps sleep" → "Valerian helps with sleep"
   - Should detect as changed
   - Run evidence
   - Should find similar references

2. **Test with major text change**:
   - "Valerian helps sleep" → "Valerian contains valerenic acid"
   - Should detect as changed
   - Run evidence
   - May find different references

3. **Test error handling**:
   - Edit claim with invalid text (empty string)
   - Should show validation error

4. **Test concurrent edits**:
   - Edit claim A with evidence
   - While evidence running, edit claim B (skip evidence)
   - Both should work independently

---

## Performance

### Expected Times

| Operation | Time |
|-----------|------|
| Edit claim (skip evidence) | < 1 second |
| Edit claim (run evidence) | 30-60 seconds |
| Evidence engine phase | ~30 seconds |
| Reference processing | ~30 seconds |

### Optimizations Applied

- Only runs evidence for changed claim (not all claims)
- Batched reference processing (3 at a time)
- Connection pooling for OpenAI API
- Skips references with insufficient text (<500 chars)

---

## Known Limitations

### 1. Global Changes (No User-Specific Edits Yet)

**Current Behavior**:
- When user edits a claim, ALL users see the edit
- No per-user claim versions

**Future Enhancement** (Phase 2):
- Add `user_claim_edits` table
- Track edits per user
- Show user-specific versions in queries

### 2. No Undo Feature

**Current Behavior**:
- Once evidence runs, old evidence is removed
- Cannot revert to previous version

**Workaround**:
- Before editing, note down original text
- Manually re-edit if needed

**Future Enhancement**:
- Add claim version history
- "Revert to original" button

### 3. No Batch Edit Mode

**Current Behavior**:
- Each claim edit triggers separate evidence run
- Editing 5 claims = 5 evidence runs = 2.5-5 minutes

**Future Enhancement**:
- "Edit multiple claims" mode
- Run evidence once for all changes
- More efficient for bulk edits

---

## Debugging

### Backend Logs

Look for these log messages:

```
================================================================================
✏️  [/api/claims/456/edit] EDIT CLAIM
   New text: "Valerian helps with insomnia"
   Run evidence: true
   User: 1
================================================================================

📋 [Edit] Found 4 claims for content_id=13626

🔄 [Edit] Replacing claim_id=456 with new text

🔍 [Edit] Running incremental update with evidence...

================================================================================
🔄 [Incremental Update] content_id=13626
   New claims: 4
================================================================================

📋 [Incremental] Found 4 existing claims

📊 [Incremental] Diff summary:
   ✅ Added: 1 claims
   ❌ Removed: 1 claims
   ⏺️  Unchanged: 3 claims

🗑️  [Incremental] Removing 1 claims...
✅ [Incremental] Removed 1 claims and their evidence

➕ [Incremental] Adding 1 new claims...
✅ [Incremental] Added 1 new claims

🔍 [Incremental] Running evidence engine for 1 NEW claims only...
✅ [Incremental] Evidence engine found 4 references for new claims

🔄 [Incremental] Processing 3 references in batches of 3
✅ [Incremental] Processed 3 references

================================================================================
✅ [Incremental] Update complete
================================================================================
```

### Frontend Logs

Check browser console for:

```
✅ Claim updated with evidence: {
  success: true,
  evidenceRun: true,
  summary: { added: 1, removed: 1, unchanged: 3 },
  evidence: { referencesFound: 4, referencesProcessed: 3 }
}

Evidence run complete: { added: 1, removed: 1, unchanged: 3, total: 4 }
Found 4 new references
```

### Common Issues

**Issue**: Evidence dialog doesn't appear
- **Cause**: Text didn't actually change (check whitespace, capitalization)
- **Fix**: Make a substantive edit

**Issue**: Evidence runs but no new references found
- **Cause**: Evidence engine couldn't find relevant sources
- **Check**: Look at `failedCandidates` in response

**Issue**: Error: "Invalid claim ID"
- **Cause**: Claim was deleted or doesn't exist
- **Fix**: Refresh page to reload claims

**Issue**: Frontend shows old evidence after update
- **Cause**: `loadClaimsAndEvidence()` didn't run
- **Fix**: Check for errors in console, manually refresh

---

## API Summary

### New Endpoints

**PUT /api/claims/:claimId/edit**
- Purpose: Edit single claim with optional evidence re-run
- Body: `{ newText, runEvidence, userId }`
- Response: `{ success, claim, evidenceRun, summary, evidence }`

### Existing Endpoints (Unchanged)

**POST /api/content/:id/update-claims**
- Purpose: Batch claim updates (still works)
- Body: `{ claims: [...], fullText? }`
- Response: `{ success, summary, addedClaims, removedClaims, ... }`

**PUT /api/claims/:claimId**
- Purpose: Update claim metadata without evidence
- Body: `{ claim_text, veracity_score, confidence_level, ... }`
- Response: Updated claim object

---

## Files Changed Summary

### Backend (3 files)

1. `backend/src/routes/claims/claims.edit.routes.js` - **NEW** (136 lines)
   - Single-claim edit endpoint
   - Wraps incremental update

2. `backend/src/routes/claims/index.js` - **MODIFIED** (1 line added)
   - Registered new edit routes

3. `backend/src/routes/content/content.incremental.routes.js` - **MODIFIED** (300+ lines refactored)
   - Extracted `performIncrementalUpdate()` function
   - Made reusable for both endpoints

### Frontend (3 files)

1. `dashboard/src/services/useDashboardAPI.ts` - **MODIFIED** (40 lines added)
   - New `updateClaimWithEvidence()` function
   - TypeScript types for response

2. `dashboard/src/components/TaskClaims.tsx` - **MODIFIED** (80 lines added)
   - Evidence confirmation modal
   - State for pending edit
   - Updated ClaimModal onSave logic

3. `dashboard/src/components/Workspace.tsx` - **MODIFIED** (40 lines added)
   - Import new API function
   - Updated onEditClaim handler
   - Evidence result handling
   - Reload claims after evidence

### Total Changes

- **New Files**: 1
- **Modified Files**: 5
- **Lines Added**: ~600
- **Lines Modified**: ~100

---

## Next Steps (Optional Enhancements)

### Phase 2: User-Specific Edits

Add database table and queries for per-user claim versions:

**Database**:
```sql
CREATE TABLE user_claim_edits (
  edit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  original_claim_id INT NOT NULL,
  edited_claim_text TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY (user_id, original_claim_id)
);
```

**Query Changes**:
```sql
SELECT
  COALESCE(uce.edited_claim_text, c.claim_text) AS claim_text
FROM claims c
LEFT JOIN user_claim_edits uce
  ON uce.original_claim_id = c.claim_id
  AND uce.user_id = ?
WHERE c.claim_id = ?
```

**Endpoints Needed**:
- `POST /api/content/:id/edit-claim-for-user` - Create user-specific edit
- `POST /api/content/:id/hide-claim-for-user` - Soft delete for user
- `POST /api/content/:id/revert-claim-edit` - Revert to original

### Phase 3: Reference Modal Integration

Update `ReferenceDetailsModal.tsx` to:
- Add ✏️ edit icon next to each reference claim
- Add 🗑️ delete icon
- Make all claims same width for icon alignment
- Connect to same edit flow

### Phase 4: Undo Feature

Add claim version tracking:
- Store previous versions before edit
- "Undo" button to revert
- Show edit history

---

## Conclusion

The claim editing integration is now complete and ready for testing. Users can:

1. Click ✏️ to edit any claim
2. Choose whether to run evidence for changes
3. See results immediately after evidence completes

The system efficiently runs evidence only for changed claims, saving time and cost compared to full re-scraping.

**Ready for Production**: Yes (pending testing)
**Breaking Changes**: None (backward compatible)
**Migration Required**: No
