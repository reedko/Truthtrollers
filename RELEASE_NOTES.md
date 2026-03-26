# Release Notes - User Claim Hiding & UI Improvements

## Summary
This release adds per-user claim hiding functionality (mirroring reference hiding), fixes bugs in the reference details modal, and includes various UI/UX improvements across the platform.

## Major Features

### 1. Per-User Claim Hiding
- **New Table**: `user_claim_visibility` - Tracks which claims each user has hidden
- **Hide/Unhide Endpoints**:
  - `POST /api/claims/hide` - Hide a claim for the current user
  - `POST /api/claims/unhide` - Unhide a previously hidden claim
- **Query Updates**: All claim-fetching endpoints now filter out hidden claims for the current user
  - `/api/claims/:content_id`
  - `/api/claims-with-evidence/:contentId`
  - `/api/content/:task_content_id/references-with-claims`
- **Frontend**: Trashcan button in reference details modal now properly hides claims per-user with toast notifications

### 2. Reference Deletion Improvements
- Fixed trashcan icons not responding in reference source list
- Added proper error handling with user feedback via toasts
- Added `stopPropagation()` to prevent click bubbling on delete/edit buttons

### 3. AI Suggested Links Bug Fixes
- Fixed crash when backend returns null link for irrelevant claims
- Added handling for skipped/irrelevant assessments in `referenceClaimRelevance.ts`
- Enhanced error logging and user feedback in RelevanceScanModal

### 4. Case Focus Page Enhancements
- Added navigation controls with progress bar for case claims (matching source claims style)
- Moved verimeter from panel top into case claim card (replacing evidence summary box)
- Implemented smooth slide animations when navigating between claims (no screen blink)
- Layout optimizations: reduced whitespace, repositioned UI elements
- Moved MR1/MR2 style toggle to right side of panels

### 5. Backend Processing Improvements
- Enhanced claims engine with better quote extraction
- Improved evidence engine reliability
- Updated task processing workflows
- Better author extraction utilities

## Database Migrations Required

### CRITICAL - Must Run Before Deployment

```sql
-- Create user_claim_visibility table
CREATE TABLE IF NOT EXISTS user_claim_visibility (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  claim_id INT NOT NULL,
  is_hidden BOOLEAN DEFAULT FALSE,
  hidden_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_claim (user_id, claim_id),
  INDEX idx_user_id (user_id),
  INDEX idx_claim_id (claim_id),
  INDEX idx_is_hidden (is_hidden),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (claim_id) REFERENCES claims(claim_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### Optional Migrations (Already in migrations folder)
The following migrations are in the `backend/migrations/` folder but may not have been deployed to production yet:

- `add_claim_triage_system.sql` - Claim triage/quality scoring system
- `add_content_text_column.sql` - Additional content text storage
- `add_evidence_search_config.sql` - Evidence search configuration
- `add_source_quality_prompt.sql` - Source quality assessment prompts
- `fix-delete-content-reference-links.sql` - Fix cascade delete issues

**Review these migrations and deploy if needed for your production environment.**

## API Changes

### New Endpoints
- `POST /api/claims/hide` - Hide claim for user (requires `claimId` and `userId` in body)
- `POST /api/claims/unhide` - Unhide claim for user (requires `claimId` and `userId` in body)

### Modified Endpoints
- All claim-fetching endpoints now respect `user_claim_visibility` table
- Reference-with-claims endpoint filters out hidden claims in JSON aggregation

## Frontend Changes

### New Services
- `hideClaim(claimId, userId)` - Hide a claim for a user
- `unhideClaim(claimId, userId)` - Unhide a claim for a user
- `deleteClaim(claimId, userId)` - Deprecated wrapper for hideClaim

### Component Updates
- **Workspace.tsx**: Enhanced claim deletion with user feedback and proper refresh
- **ReferenceList.tsx**: Fixed click event bubbling on action buttons
- **RelevanceScanModal.tsx**: Better error handling for skipped assessments
- **CaseFocusPage.tsx**: Major UI overhaul with navigation and animations
- **NavBar.tsx, UnifiedHeader.tsx, TaskCard.tsx**: Various UI improvements

## Bug Fixes
- Fixed "Cannot read properties of null (reading 'claim_type')" crash when hiding claims
- Fixed AI suggested links showing nothing despite dotted lines being present
- Fixed screen blinking during claim navigation (now smooth slide transitions)
- Fixed trashcan delete buttons not working in reference source list

## Technical Notes

### Authentication Pattern
This release uses the existing pattern of passing `userId` in request body/query params rather than relying solely on JWT middleware, maintaining consistency with other endpoints like `viewerId` in claim fetches.

### Data Filtering
Hidden claims are filtered using LEFT JOIN with `user_claim_visibility` table:
```sql
LEFT JOIN user_claim_visibility ucv ON cl.claim_id = ucv.claim_id AND ucv.user_id = ?
WHERE (ucv.is_hidden IS NULL OR ucv.is_hidden = FALSE)
```

JSON aggregation uses conditional IF to exclude hidden claims, with post-processing to remove nulls from arrays.

## Files Changed
- Backend: 17 files modified (core engines, routes, utilities)
- Frontend: 13 files modified (components, pages, services)
- Migrations: 1 new migration required (`add_user_claim_visibility.sql`)
- Deleted: `FoxCasePage.tsx` (legacy component removed)

## Deployment Checklist

1. ✅ Backup production database
2. ✅ Run `add_user_claim_visibility.sql` migration
3. ✅ Review optional migrations and deploy if needed
4. ✅ Deploy backend changes
5. ✅ Deploy frontend changes
6. ✅ Test claim hiding functionality
7. ✅ Verify reference deletion works
8. ✅ Test Case Focus page navigation and animations

## Breaking Changes
None - all changes are backward compatible. The `user_claim_visibility` table will be empty initially, so all claims will be visible until users start hiding them.

---
**Build Date**: 2026-03-26
**Last Commit**: foxcase getting closer (94917b1)
