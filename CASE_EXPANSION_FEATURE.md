# Case Claim Expansion Feature - ReGraph Style Mindmap

## Overview
Added a new ReGraph-style mindmap interaction where clicking the Case node expands it to show Case Claims as an intermediate hierarchical layer between the Case and Sources.

## What Was Added

### 1. Backend SQL Queries (`backend/src/queries/graphQueries.js`)

**New Query Functions:**
- `getCaseClaimsForTask(taskId)` - Fetches all claims belonging to the case/task
- `getSourceToClaimLinks(taskId, viewerId, viewScope)` - Gets connections between sources and case claims (both user-approved and AI-suggested)
- `getUnlinkedSourcesForTask(taskId, viewerId, viewScope)` - Finds sources that don't link to any claims
- `getAISuggestedLinksForUnlinkedSources(taskId)` - Gets AI suggestions for positioning unlinked sources

### 2. Backend API Route (`backend/src/routes/graph/graph.routes.js`)

**New Endpoint:**
```
GET /api/case-claim-expansion/:taskId?viewerId=X&viewScope=user|all
```

**Returns:**
- `caseClaims`: Array of claim nodes for the case
- `sourceToClaimLinks`: User-approved and AI-suggested source→claim connections
- `unlinkedSources`: Sources without any claim links
- `aiSuggestedLinks`: AI suggestions for positioning

### 3. Frontend Animation Module (`dashboard/src/components/cytoscape/animation/caseExpansion.ts`)

**New Functions:**
- `expandCaseWithClaims()` - Main expansion function that:
  - Fetches case claim data from API
  - Arranges case claims in circle around case node
  - Creates case→claim edges
  - Creates source→claim edges (solid for user-approved, dashed for AI-suggested)
  - Hides direct case→source edges
  - Positions sources around their linked claims
  - Shows dotted lines for unlinked sources to case

- `collapseCaseClaims()` - Collapses back to original view

- `repositionSourcesAroundClaims()` - Intelligently positions sources:
  - Single-linked sources: Arc around their claim
  - Multi-linked sources: Positioned at centroid of linked claims
  - AI-suggested positioning for unlinked sources

## Visual Structure

### Before Expansion (Original View):
```
      Source1 ─────────┐
                       │
      Source2 ─────────┤
                       ├──── CASE
      Source3 ─────────┤
                       │
      Source4 ─────────┘
```

### After Expansion (ReGraph Style):
```
                    CaseClaim1
                   ╱           ╲
              Source1       Source2
                 │             │
                 │             │
               CASE ────────────────
                 │             │
                 │             │
              Source3       Source4
                   ╲           ╱
                    CaseClaim2
```

## Edge Types

1. **Case → Claim**: Solid lines showing containment
2. **Source → Claim (User-Approved)**: Solid colored lines (green for supports, red for refutes)
3. **Source → Claim (AI-Suggested)**: Dashed lines, 50% opacity
4. **Source → Case (Unlinked)**: Dotted lines, 40% opacity

## Usage (To Be Implemented)

### Context Menu Approach:
```typescript
// Right-click on case node → Show "Expand Claims" option
cy.on('cxttap', 'node[type="task"]', (event) => {
  const caseNode = event.target;
  const contentId = caseNode.data('content_id');

  // Show context menu with "Expand Claims" option
  showContextMenu({
    x: event.renderedPosition.x,
    y: event.renderedPosition.y,
    options: [
      {
        label: 'Show Claims',
        action: () => expandCaseWithClaims({
          cy,
          caseNode,
          contentId,
          viewerId,
          viewScope
        })
      },
      {
        label: 'Collapse Claims',
        action: () => collapseCaseClaims(cy, caseNode)
      }
    ]
  });
});
```

## Next Steps (For Implementation)

1. **Add Context Menu Component** to cytoscape/ui/
2. **Add event handler** in CytoscapeMolecule.tsx for right-click on case node
3. **Add button** in UI for "Show Claims" / "Hide Claims"
4. **Add caseClaim styling** to cytoscapeStyles.ts
5. **Test with real data** and adjust positioning algorithm
6. **Add animation** for smooth expansion/collapse
7. **Handle edge cases** (no pun intended):
   - Case with no claims
   - Case with many claims (adjust circle radius)
   - Sources with many claim links

## Benefits

✅ **Hierarchical Understanding**: Shows intermediate claim layer between case and sources
✅ **AI Guidance**: Visualizes AI-suggested links vs user-approved links
✅ **Better Organization**: Groups sources by the claims they support/refute
✅ **ReGraph Style**: Modern mindmap interaction pattern
✅ **Flexibility**: Works with filtered views (user-only vs all users)
✅ **Intelligent Positioning**: Sources positioned near relevant claims

## Database Tables Used

- `claims` - Claim text and metadata
- `content_claims` - Links claims to case
- `reference_claim_links` - Links sources to claims (with user_id for approval tracking)
- `content_relations` - Links sources to case

## Configuration

The expansion behavior can be adjusted via:
- `claimRadius` (default: 400px) - How far claims are from case
- `sourceDistance` (default: 250px) - How far sources are from claims
- `viewScope` - 'user' (default) or 'all' - Show only user's links or everyone's
