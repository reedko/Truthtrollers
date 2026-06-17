# Workflow Dashboard Plan

**Original request:** Make the dashboard guide users through the actual workflow. The tools exist but the dashboard doesn't connect them. Also: Workspace and CaseFocus must use identical routes/data. NavBar is overstuffed.

---

## Status

| Section | Title | Status |
|---------|-------|--------|
| 1 | Workspace / CaseFocus data parity | ✅ Done (`useClaimLinkSession` hook) |
| 2 | Dashboard Workflow Panel | ✅ Done |
| 3 | Molecule — author/publisher credibility in workflow | 🔲 Pending |
| 4 | EvaluationTaskPanel + evaluate-ratings wiring | ✅ Done |
| 5 | Summary document (reworded rationales) | 🔲 Pending |
| 6 | Evidence chain document (KnowGraph export) | 🔲 Pending |
| 7 | NavBar cleanup (de-overstuff) | 🔲 Pending |

---

## Section 1 — Workspace / CaseFocus Parity ✅

**What was done:**
- Created `dashboard/src/hooks/useClaimLinkSession.ts`
- Both Workspace and CaseFocus now call the same endpoints with the same params
- `loadCandidates` in CaseFocus now receives shared references instead of fetching independently
- Claim scores use the shared hook; `refreshHookScores()` called after a link is created

---

## Section 2 — Dashboard Workflow Panel 🔲

**Goal:** Replace the current "My Assigned Cases + sidebar" section with a 3-lane
workflow panel that makes it obvious what to do next and why.

**Three task types (from original prompt):**
1. **Build Claim Links** — take new scraped docs, link evidence to claims (Workspace or CaseFocus)
2. **Evaluate User Ratings** — peer-review another user's submitted evidence chain
3. **Check Source Credibility** — rate authors/publishers, use Molecule for bias/veracity

**Layout:** 3 stacked horizontal sections (full width, each collapsible), replacing the current 2/3+1/3 grid.

### Lane 1 — Build Evidence Links
- Data: `assignedTasks` from `useTaskStore` (already loaded)
- Each row: thumbnail · title · source badge · **"Workspace →"** and **"CaseFocus →"** buttons
- Remove the "Select" + mode-dropdown UX; two explicit destination buttons are clearer
- Keep the task card grid layout but add a section header explaining the action
- CTA copy: "Open in Workspace" / "Open in CaseFocus"

### Lane 2 — Evaluate User Ratings
- Data: `fetchUsersWithPendingRatings()` (already wired in `EvaluationTaskPanel`)
- Move `EvaluationTaskPanel` from the sidebar into this lane (same component, larger context)
- Show top 5 instead of top 3; "View all →" to `/evaluate-ratings`
- Remove `EvaluationTaskPanel` from the sidebar after moving it here

### Lane 3 — Check Source Credibility
- Static CTAs (no live data needed for v1):
  - "Rate Authors & Publishers" → `/credibility`
  - "Open Molecule View" → `/molecule` (for visual author/publisher graph)
- Phase 2: show a count of unrated authors/publishers from the current task

**Files to change:**
- `dashboard/src/components/UserDashboard.tsx` — restructure the bottom grid
- `dashboard/src/components/EvaluationTaskPanel.tsx` — minor: increase limit from 3 → 5
- No new files needed; the panel is inline in UserDashboard

---

## Section 3 — Molecule Integration for Source Credibility 🔲

**Goal:** After a user builds claim links, they can jump to Molecule to verify
the credibility of the authors/publishers referenced — and update bias/veracity
ratings from within that flow.

**What needs to happen:**
1. Molecule view (`/molecule`) already exists; it shows the claim/reference graph
2. Need to surface author/publisher credibility scores **on reference nodes** in Molecule
3. From a reference node, user can click → opens credibility modal → updates bias/veracity
4. Updates flow back to the claim link score (since publisher credibility affects verimeter)

**Files to investigate before implementing:**
- `dashboard/src/pages/MoleculeMapPage.tsx`
- `dashboard/src/components/PubCard.tsx` (existing publisher credibility card)
- `dashboard/src/components/modals/CredibilityInfoModal.tsx`

---

## Section 4 — EvaluationTaskPanel ✅

**What was done:**
- `dashboard/src/components/EvaluationTaskPanel.tsx` — new component
- `dashboard/src/services/useDashboardAPI.ts` — added `fetchUsersWithPendingRatings`
- `dashboard/src/components/UserDashboard.tsx` — panel added to sidebar
- `dashboard/src/pages/RatingEvaluationPage.tsx` — `?userId=X` prefilter
- `dashboard/src/components/NavBar.tsx` + `AccountMenu.tsx` — evaluate-ratings links

---

## Section 5 — Summary Document Generation 🔲

**Goal:** After building claim links, generate a readable summary document that
rewords the rationale for each link into coherent prose. Serves as a shareable
analysis of the content.

**What it is:**
- One paragraph per claim link: "Source X supports/refutes claim Y because [rationale]"
- Aggregated into a single document covering all links for a content item
- Available as download (PDF or text) and/or as a page in the app

**Implementation approach:**
1. Backend: `POST /api/content/:id/generate-summary` — calls AI (Claude/GPT) with all
   claim links for the content item; returns structured prose
2. Frontend: "Generate Summary" button in Workspace toolbar or CaseFocus header
3. Result shown in a modal with a download button and a "Save to TextPad" option

**Files to touch:**
- New backend route (likely in `content.routes.js` or a new `summary.routes.js`)
- `dashboard/src/components/Workspace.tsx` — add "Generate Summary" button
- `dashboard/src/pages/CaseFocusPage.tsx` — same button
- New modal: `dashboard/src/components/modals/SummaryDocumentModal.tsx`

---

## Section 6 — Evidence Chain Document Export 🔲

**Goal:** Export the evidence chain (as visualised in KnowGraph) as a structured
document — essentially a snapshot of the graph showing how claims are linked.

**What it is:**
- A document showing: Content title → Case claims → Evidence links → Sources
- Visual: mirrors KnowGraph layout (nodes and relationships)
- Available as PDF export or shareable URL

**Implementation approach:**
1. KnowGraph already renders the graph; add an "Export" button
2. Backend: `GET /api/content/:id/evidence-chain` — returns structured JSON of all
   claims + links + sources for the content item
3. Frontend: render as printable HTML or use a PDF library (e.g. `html2canvas` + `jspdf`)

**Files to touch:**
- `dashboard/src/pages/KnowGraphPage.tsx` (or `NewKnowGraphPage.tsx`) — add Export button
- New backend endpoint for structured chain data
- Possibly a new `EvidenceChainDocument.tsx` print-view component

---

## Section 7 — NavBar Cleanup 🔲

**Goal:** NavBar is overstuffed. Reduce to the tools that fit the workflow.

**Current problem:** Too many menu items at the top level; most users don't need
GameSpace, QuadrantGrid, Claim Duel, etc. on every page.

**Proposed structure:**
```
[Logo]  Work ▾  Evaluate ▾  Explore ▾  [User menu]
```
- **Work:** Workspace · CaseFocus · TextPad · Molecule
- **Evaluate:** Evaluate Ratings · Credibility · KnowGraph
- **Explore:** TTLive · Social · Games (Duel, TrueFalse, GameSpace) · QuadrantGrid

**Files to touch:**
- `dashboard/src/components/NavBar.tsx`

---

## Resuming Work

To pick up where we left off, tell Claude:
> "Read WORKFLOW_DASHBOARD_PLAN.md and continue with the next pending section."
