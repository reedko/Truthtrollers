# Current Claim Editing: How It Works Now

## ✅ What EXISTS (Already Working)

### Frontend: Pencil Icon (✏️) Button
**Location**: `dashboard/src/components/TaskClaims.tsx:579-588`

```tsx
<IconButton
  icon={<span>✏️</span>}
  onClick={() => {
    setEditingClaim(claim);
    setIsClaimModalOpen(true);
  }}
/>
```

### ClaimModal (Edit Dialog)
**Location**: `dashboard/src/components/modals/ClaimModal.tsx`

- Shows textarea with current claim text
- User can edit the text
- Shows veracity score and confidence inputs
- Calls `onSave(updatedClaim)` when saved

### API Call (Current Implementation)
**Location**: `dashboard/src/components/Workspace.tsx:489-496`

```tsx
onEditClaim={async (updatedClaim: Claim) => {
  const saved = await updateClaim(updatedClaim);  // ← API call
  setClaims(
    claims.map((c) =>
      c.claim_id === updatedClaim.claim_id ? updatedClaim : c,
    ),
  );
}}
```

### Backend Endpoint (Current)
**Location**: `dashboard/src/services/useDashboardAPI.ts`

```typescript
export const updateClaim = async (claim: Claim): Promise<Claim> => {
  const response = await api.put(
    `/api/claims/${claim.claim_id}`,
    claim
  );
  return { ...claim };
};
```

**Backend Route**: `PUT /api/claims/:claimId`
- Updates the `claims` table row directly
- Changes `claim_text` for EVERYONE (global edit)
- **DOES NOT** run evidence engine
- **DOES NOT** track who made the edit

---

## ❌ What's MISSING

### 1. No Evidence Re-Run
When you edit "Valerian helps sleep" → "Valerian helps with sleep":
- ✅ Claim text updates in database
- ❌ Evidence is NOT re-run
- ❌ References are NOT updated
- ❌ User sees old evidence for new claim text

### 2. No User-Specific Edits
When reedko edits a claim:
- ❌ ALL users see reedko's edit (global change)
- ❌ critic cannot see original version
- ❌ No way to revert to original
- ❌ No "edited by" tracking

### 3. No Delete Tracking
When you click 🗑️ delete:
- ✅ Claim is removed from UI
- ❌ Deleted for EVERYONE (not user-specific)
- ❌ No soft delete / hide option

---

## What I Built vs What You Need

### What I Built (Backend Endpoint)

**`POST /api/content/:id/update-claims`**
- Takes full array of claims
- Detects which changed (using SHA-256 hashes)
- Runs evidence ONLY for changed claims
- Returns diff summary

**Use Case**: Batch updates (edit multiple claims at once)

### What You Need (Pencil Icon Integration)

**`PUT /api/claims/:claimId/edit-and-rerun`**
- Takes single claim edit
- Optionally runs evidence for that claim
- Tracks which user made the edit
- Returns evidence results

**Use Case**: Single claim edit via ✏️ pencil icon

---

## Integration Plan: Connect Pencil Icon to Evidence Engine

### Step 1: Create Single-Claim Edit Endpoint

**New File**: `backend/src/routes/claims/claims.edit.routes.js`

```javascript
router.put("/api/claims/:claimId/edit-and-rerun", async (req, res) => {
  const { claimId } = req.params;
  const { newText, runEvidence, userId } = req.body;

  // 1. Get content_id for this claim
  const [row] = await query(
    `SELECT content_id FROM content_claims WHERE claim_id = ?`,
    [claimId]
  );
  const contentId = row.content_id;

  // 2. Get all current claims for this content
  const allClaims = await query(
    `SELECT c.claim_text FROM claims c
     JOIN content_claims cc ON c.claim_id = cc.claim_id
     WHERE cc.content_id = ?`,
    [contentId]
  );

  // 3. Replace edited claim in array
  const updatedClaims = allClaims.map(c =>
    c.claim_id === claimId ? newText : c.claim_text
  );

  // 4. Call incremental update endpoint
  const result = await incrementalUpdate(contentId, updatedClaims);

  res.json(result);
});
```

### Step 2: Update Frontend API Call

**File**: `dashboard/src/services/useDashboardAPI.ts`

```typescript
// OLD (current)
export const updateClaim = async (claim: Claim): Promise<Claim> => {
  const response = await api.put(
    `/api/claims/${claim.claim_id}`,
    claim
  );
  return { ...claim };
};

// NEW (with evidence re-run)
export const updateClaimWithEvidence = async (
  claim: Claim,
  runEvidence: boolean = true
): Promise<{
  claim: Claim;
  evidenceRun: boolean;
  summary?: { added: number; removed: number; };
}> => {
  const response = await api.put(
    `/api/claims/${claim.claim_id}/edit-and-rerun`,
    {
      newText: claim.claim_text,
      runEvidence,
      userId: getCurrentUserId()  // From auth context
    }
  );
  return response.data;
};
```

### Step 3: Add Confirmation Dialog

**File**: `dashboard/src/components/TaskClaims.tsx`

```tsx
// Add modal for asking about evidence re-run
const [showEvidencePrompt, setShowEvidencePrompt] = useState(false);
const [pendingEdit, setPendingEdit] = useState<Claim | null>(null);

// When user saves claim edit
onSave={(claim: Claim) => {
  if (claim.claim_id) {
    // Check if text actually changed
    const original = claims.find(c => c.claim_id === claim.claim_id);
    if (original && original.claim_text !== claim.claim_text) {
      // Text changed - ask about evidence
      setPendingEdit(claim);
      setShowEvidencePrompt(true);
    } else {
      // Just metadata changed - update directly
      onEditClaim(claim);
    }
  }
}}

// Evidence prompt modal
<Modal isOpen={showEvidencePrompt} onClose={() => setShowEvidencePrompt(false)}>
  <ModalHeader>Run Evidence for Updated Claim?</ModalHeader>
  <ModalBody>
    <Text>You changed:</Text>
    <Text fontWeight="bold" color="red.500">
      {claims.find(c => c.claim_id === pendingEdit?.claim_id)?.claim_text}
    </Text>
    <Text mt={2}>To:</Text>
    <Text fontWeight="bold" color="green.500">
      {pendingEdit?.claim_text}
    </Text>
    <Text mt={4}>
      Run evidence engine to find sources for the updated claim? (~30 seconds)
    </Text>
  </ModalBody>
  <ModalFooter>
    <Button
      onClick={async () => {
        await updateClaimWithEvidence(pendingEdit!, true);
        setShowEvidencePrompt(false);
        loadClaims(); // Refresh
      }}
    >
      Yes, Run Evidence
    </Button>
    <Button
      variant="ghost"
      onClick={async () => {
        await updateClaimWithEvidence(pendingEdit!, false);
        setShowEvidencePrompt(false);
        loadClaims();
      }}
    >
      No, Skip Evidence
    </Button>
  </ModalFooter>
</Modal>
```

---

## User-Specific Edits (Phase 2)

### Database Schema

```sql
CREATE TABLE user_claim_edits (
  edit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  original_claim_id INT NOT NULL,
  edited_claim_text TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (original_claim_id) REFERENCES claims(claim_id),

  UNIQUE KEY unique_user_claim (user_id, original_claim_id)
);
```

### Query Changes

```sql
-- When fetching claims, join with user_claim_edits
SELECT
  c.claim_id,
  COALESCE(uce.edited_claim_text, c.claim_text) AS claim_text,
  uce.edit_id IS NOT NULL AS is_user_edited
FROM claims c
JOIN content_claims cc ON c.claim_id = cc.claim_id
LEFT JOIN user_claim_edits uce
  ON uce.original_claim_id = c.claim_id
  AND uce.user_id = ?  -- Current viewer
WHERE cc.content_id = ?
  AND (uce.is_deleted IS NULL OR uce.is_deleted = FALSE);
```

### Result

- **reedko** sees: "Valerian helps **with** sleep" (edited version)
- **critic** sees: "Valerian helps sleep" (original version)
- Evidence runs on reedko's version only
- Both versions tracked independently

---

## Reference Details Modal

### Current State
Need to check if ReferenceDetailsModal has edit icons.

### Required Updates

1. Add ✏️ edit icon next to each reference claim
2. Add 🗑️ delete icon
3. Align all icons in same column (fixed width for claim text)
4. Connect to same edit flow

**Before**:
```
[Long claim text that varies in length] 🔍
[Short] 🔍
[Medium length claim] 🔍
```

**After**:
```
[Long claim text that varies in length...] ✏️ 🔍 🗑️
[Short......................................] ✏️ 🔍 🗑️
[Medium length claim...................] ✏️ 🔍 🗑️
```

---

## Summary: What You Said vs What I Built

### What You Said:
> "make it so we can edit a text pad document and just run evidence on new claims, or changes, not redo the whole document"

### What I Built:
✅ **Backend system** to detect claim changes and run evidence only for new/changed claims
✅ **Incremental update endpoint** that processes diffs efficiently

### What You Actually Want:
✅ **Connect the pencil icon** (✏️) that already exists to the new backend
✅ **Ask user if they want to run evidence** after editing
✅ **User-specific edits** so reedko and critic see different versions

### Status:
- ✅ Backend infrastructure is ready
- ⏳ Frontend integration needed (connect ✏️ to new endpoint)
- ⏳ User-specific edits need database migration
- ⏳ Reference modal needs edit icons

---

## Next Steps (In Order)

1. **Test current editing** - Click ✏️ and edit a claim to see current behavior
2. **Create single-claim edit endpoint** - Wrapper around incremental update
3. **Add evidence confirmation dialog** - Ask "Run evidence? Yes/No"
4. **Test end-to-end** - Edit claim → Choose yes → See new evidence
5. **(Optional) Add user-specific edits** - Phase 2 feature

Want me to implement Step 2 (create the single-claim endpoint)?
