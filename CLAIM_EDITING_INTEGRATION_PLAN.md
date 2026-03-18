# Claim Editing Integration Plan

## Current State (What Exists)

### ✅ Frontend UI (Already Built)
**File**: `dashboard/src/components/TaskClaims.tsx`

Each task claim has 3 buttons:
- ✏️ **Edit button** (line 579-588) - Opens ClaimModal in edit mode
- 🔍 **Verify button** (line 589-598) - Runs verification
- 🗑️ **Delete button** (line 599-608) - Deletes claim

**ClaimModal** (`dashboard/src/components/modals/ClaimModal.tsx`):
- Shows textarea for editing claim text
- Shows veracity score input
- Shows confidence level input
- Calls `onSave(claim)` when user clicks Save

### ✅ Backend Endpoint (Just Built)
**File**: `backend/src/routes/content/content.incremental.routes.js`

`POST /api/content/:id/update-claims` - Detects changed claims and runs evidence only for new ones

---

## What Needs Integration

### Current Flow (What Happens Now)
```
User clicks ✏️ edit icon
  ↓
ClaimModal opens with textarea
  ↓
User edits: "Valerian helps sleep" → "Valerian helps with sleep"
  ↓
User clicks Save
  ↓
onEditClaim(updatedClaim) is called
  ↓
Frontend makes API call (we need to check what this does)
  ↓
??? (Unclear what happens - probably just updates DB row)
```

### Desired Flow (What We Want)
```
User clicks ✏️ edit icon
  ↓
ClaimModal opens with textarea
  ↓
User edits: "Valerian helps sleep" → "Valerian helps with sleep"
  ↓
User clicks Save
  ↓
onEditClaim(updatedClaim) is called
  ↓
Frontend calls: POST /api/content/13626/update-claims
  {
    claims: [
      "Valerian helps with sleep",  // CHANGED
      "Valerian is called nature's Valium",  // unchanged
      "Valerian reduces anxiety"  // unchanged
    ]
  }
  ↓
Backend detects: 1 claim changed
  ↓
Backend removes old version → Runs evidence for new version
  ↓
Response shows: 1 removed, 1 added, 2 unchanged
  ↓
Frontend refreshes task claims and references
```

---

## User-Specific Edits (Per Your Request)

### Problem
> "if reedko deletes or edits a claim, critic can still see it in original form"

### Solution: User-Specific Claim Versions

We need to track WHO edited each claim, so different users see different versions.

### Database Schema Addition

```sql
-- New table: user_claim_edits
CREATE TABLE user_claim_edits (
  edit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  original_claim_id INT NOT NULL,  -- Points to original claim
  edited_claim_text TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id),
  FOREIGN KEY (original_claim_id) REFERENCES claims(claim_id),

  -- One edit per user per claim
  UNIQUE KEY unique_user_claim (user_id, original_claim_id)
);
```

### Query Logic

**When user views claims:**
```sql
-- Get claims with user-specific edits
SELECT
  c.claim_id,
  COALESCE(uce.edited_claim_text, c.claim_text) AS claim_text,
  COALESCE(uce.is_deleted, FALSE) AS is_deleted,
  uce.edit_id IS NOT NULL AS is_edited
FROM claims c
JOIN content_claims cc ON c.claim_id = cc.claim_id
LEFT JOIN user_claim_edits uce
  ON uce.original_claim_id = c.claim_id
  AND uce.user_id = ?  -- Current user
WHERE cc.content_id = ?
  AND (uce.is_deleted IS NULL OR uce.is_deleted = FALSE);
```

**Result:**
- **reedko** sees: edited version (if he edited it), deleted claims hidden
- **critic** sees: original version, all claims visible
- **system evidence**: runs on reedko's version only

---

## Integration Steps

### Step 1: Check Current onEditClaim Behavior

Need to find where `onEditClaim` is implemented in the parent component (Workspace or TaskProjectsPanel).

```bash
# Find the implementation
grep -r "onEditClaim.*=>" dashboard/src
```

### Step 2: Create User Edit Tracking

**A. Migration**:
```sql
-- backend/migrations/add-user-claim-edits.sql
CREATE TABLE user_claim_edits (
  edit_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  original_claim_id INT NOT NULL,
  edited_claim_text TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (original_claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE,

  UNIQUE KEY unique_user_claim (user_id, original_claim_id)
);
```

**B. New Endpoint**:
```javascript
// POST /api/content/:id/edit-claim-for-user
{
  userId: 123,
  claimId: 456,
  newText: "Valerian helps with sleep",
  runEvidence: true  // Whether to re-run evidence
}
```

### Step 3: Update Frontend to Use New Endpoint

**Current** (in Workspace.tsx or TaskProjectsPanel.tsx):
```typescript
const handleEditClaim = async (updatedClaim: Claim) => {
  // Current: Probably just updates DB directly
  await fetch(`/api/claims/${updatedClaim.claim_id}`, {
    method: 'PUT',
    body: JSON.stringify({ claim_text: updatedClaim.claim_text })
  });

  // Refresh claims
  await loadClaims();
};
```

**New** (with user-specific edits):
```typescript
const handleEditClaim = async (updatedClaim: Claim) => {
  // NEW: Create user-specific edit
  const response = await fetch(`/api/content/${taskId}/edit-claim-for-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: currentUser.user_id,
      claimId: updatedClaim.claim_id,
      newText: updatedClaim.claim_text,
      runEvidence: true  // Run evidence for this user's version
    })
  });

  const result = await response.json();

  // Show feedback
  if (result.evidenceRun) {
    toast.success(`Claim updated! Found ${result.referencesFound} new references`);
  }

  // Refresh claims (will show user-specific version)
  await loadClaims();
};
```

### Step 4: Update TaskClaims Query

**File**: Backend queries (wherever TaskClaims data is fetched)

**Before**:
```sql
SELECT c.claim_id, c.claim_text, c.veracity_score
FROM claims c
JOIN content_claims cc ON c.claim_id = cc.claim_id
WHERE cc.content_id = ?
```

**After**:
```sql
SELECT
  c.claim_id,
  COALESCE(uce.edited_claim_text, c.claim_text) AS claim_text,
  c.veracity_score,
  uce.edit_id IS NOT NULL AS is_user_edited
FROM claims c
JOIN content_claims cc ON c.claim_id = cc.claim_id
LEFT JOIN user_claim_edits uce
  ON uce.original_claim_id = c.claim_id
  AND uce.user_id = ?  -- Current viewer
WHERE cc.content_id = ?
  AND (uce.is_deleted IS NULL OR uce.is_deleted = FALSE)
```

### Step 5: Handle Delete with User-Specific Hide

**Current delete**:
```typescript
const handleDeleteClaim = async (claimId: number) => {
  // Deletes for everyone
  await fetch(`/api/claims/${claimId}`, { method: 'DELETE' });
};
```

**New delete**:
```typescript
const handleDeleteClaim = async (claimId: number) => {
  // Soft delete for this user only
  await fetch(`/api/content/${taskId}/hide-claim-for-user`, {
    method: 'POST',
    body: JSON.stringify({
      userId: currentUser.user_id,
      claimId: claimId
    })
  });

  // Claim is hidden for reedko, but critic still sees it
};
```

---

## Reference Details Modal Updates

### Current State
Need to check ReferenceDetailsModal to see if it has edit icons.

### Required Changes

1. **Make claims same width** (for alignment)
2. **Add edit icon** (✏️) next to each reference claim
3. **Add delete/hide icon** (🗑️)
4. **Ensure edit works with user-specific versions**

**UI Layout**:
```
[Claim text.................................] ✏️ 🔍 🗑️
[Another claim..............................] ✏️ 🔍 🗑️
[Short claim] ✏️ 🔍 🗑️
```

All icons should be right-aligned in same column.

---

## Evidence Re-Run Behavior

### When Should Evidence Re-Run?

**Option A: Always Re-Run (Conservative)**
- User edits claim → Evidence re-runs immediately
- Pro: Always up-to-date
- Con: Costs API calls, takes 30 seconds

**Option B: Ask User (Flexible)**
```
[Modal after saving edit]
"Run evidence for updated claim?"
[Yes, run evidence] [No, skip for now]
```

**Option C: Batch Mode (Efficient)**
```
User edits 3 claims → Evidence doesn't run yet
User clicks "Update Evidence" button → Runs for all edited claims at once
```

**Recommendation**: Option B (Ask user)

---

## API Summary

### New Endpoints Needed

1. **POST /api/content/:id/edit-claim-for-user**
   - Creates user-specific claim edit
   - Optionally runs evidence for new version
   - Returns evidence results

2. **POST /api/content/:id/hide-claim-for-user**
   - Soft-deletes claim for specific user
   - Other users still see it

3. **GET /api/content/:id/claims-for-user/:userId**
   - Returns claims with user-specific edits applied
   - Filters out user-hidden claims

4. **POST /api/content/:id/revert-claim-edit**
   - User reverts to original claim text
   - Deletes their edit from user_claim_edits

---

## Migration Path

### Phase 1: Simple Integration (No User-Specific)
1. Connect existing ✏️ icon to `/api/content/:id/update-claims`
2. Run evidence when claim changes
3. All users see same edits

### Phase 2: User-Specific Edits
1. Add `user_claim_edits` table
2. Create new endpoints
3. Update queries to show user-specific versions
4. Update frontend to call new endpoints

### Phase 3: Reference Modal Integration
1. Add edit icons to ReferenceDetailsModal
2. Align all icons in same column
3. Make claims same width

---

## Next Steps

1. **Find onEditClaim implementation** - Where does it currently save edits?
2. **Test current behavior** - What happens when you edit a claim now?
3. **Decide on user-specific edits** - Do we need Phase 2 immediately or later?
4. **Choose evidence re-run strategy** - Always, Ask, or Batch?

Once we know these answers, I can implement the integration.
