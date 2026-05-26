# Performance Fixes — Apply These in Order

Diagnosed in a prior Claude Code session (wrong working directory).
Tell Claude: "Read PERFORMANCE_FIXES.md and apply all fixes listed here."

---

## FIX 1 — CRITICAL: RelationshipMap feedback loop (mouse freeze / browser lockup)

**File:** `dashboard/src/components/RelationshipMap.tsx`

**Problem:** A `ResizeObserver` was watching `document.body`. Every time `measure()` ran it called
`setState`, which caused a React re-render, which changed the DOM, which fired the ResizeObserver
again — a 60fps infinite loop that locked the main thread. A scroll capture listener made it worse.

**Find this block and replace it entirely:**

```tsx
// REMOVE everything from the state declarations through the second useLayoutEffect.
// Specifically remove:
//   const [containerX, setContainerX] = useState(0);
//   const [hasMeasuredContainer, setHasMeasuredContainer] = useState(false);
//   the commented-out useEffect block
//   the first useLayoutEffect (which fed containerX via ResizeObserver on containerRef)
//   the second useLayoutEffect's body — specifically:
//     const ro = new ResizeObserver(measure);
//     ro.observe(document.body);               ← THE KILLER
//     window.addEventListener("scroll", measure, true);  ← also bad
```

**Replace with:**

```tsx
const [rightCenters, setRightCenters] = useState<Record<number, number>>({});
const containerRef = useRef<HTMLDivElement>(null);
const adjustedLeftX = leftX - 12;
const adjustedRightX = rightX + 15;

const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const [hoveredLinkId, setHoveredLinkId] = useState<string | null>(null);

useLayoutEffect(() => {
  return () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  };
}, []);

useLayoutEffect(() => {
  const measure = () => {
    if (!containerRef.current) return;
    const containerTop = containerRef.current.getBoundingClientRect().top;
    const nodes = document.querySelectorAll<HTMLElement>("[data-ref-id]");
    const map: Record<number, number> = {};
    nodes.forEach((el) => {
      const id = Number(el.dataset.refId);
      const r = el.getBoundingClientRect();
      map[id] = r.top - containerTop + r.height / 2;
    });
    setRightCenters(map);
  };

  measure();
  window.addEventListener("resize", measure);
  return () => window.removeEventListener("resize", measure);
}, [rightItems, height]);
```

**Also remove unused imports at the top of the file:**
- Remove `useEffect` from the React import (if no other useEffect exists in the file)
- Remove `import { fetchClaimsAndLinkedReferencesForTask } from ...` if unused

---

## FIX 2 — CRITICAL: Zustand devtools serializing huge state on every update

**Files:** `dashboard/src/store/useTaskStore.ts` and `dashboard/src/store/useAuthStore.ts`

**Problem:** The `devtools` middleware serializes the entire store (100+ tasks with nested data)
on every state update, sending it to Redux DevTools via postMessage — even when DevTools isn't open.

**In useTaskStore.ts** — find the closing of the devtools creator and add options:

Find:
```ts
    })),
    {
      name: "task-store",
```

Replace with:
```ts
    }), { enabled: import.meta.env.DEV, name: "task-store" }),
    {
      name: "task-store",
```

**In useAuthStore.ts** — same pattern:

Find:
```ts
      logout: () => {
        set({ user: null, token: null });
      },
    })),
    {
      name: "auth-storage",
```

Replace with:
```ts
      logout: () => {
        set({ user: null, token: null });
      },
    }), { enabled: import.meta.env.DEV, name: "auth-store" }),
    {
      name: "auth-storage",
```

---

## FIX 3 — Debug console.log calls firing in render path

**File:** `dashboard/src/components/UnifiedHeader.tsx`

**Problem:** A `useEffect` logged on every user change. Remove this entire block:

```tsx
// DELETE THIS:
useEffect(() => {
  console.log("[UnifiedHeader] Current user:", user);
  console.log("[UnifiedHeader] User role:", user?.role);
}, [user]);
```

**Also fix the Zustand selector** (creates new object reference on every render):

Find:
```ts
const verimeterScoreMap = useTaskStore((s) => s.verimeterScores || {});
```
Replace with:
```ts
const verimeterScoreMap = useTaskStore((s) => s.verimeterScores);
```

And update the usage site to use optional chaining:
```ts
// find:
const storeScore = contentId != null ? (verimeterScoreMap[contentId] ?? null) : null;
// replace with:
const storeScore = contentId != null ? (verimeterScoreMap?.[contentId] ?? null) : null;
```

---

## FIX 4 — Debug console.log in TaskCard (renders N times on dashboard)

**File:** `dashboard/src/components/TaskCard.tsx`

**Problem:** Logs on every user change, multiplied by number of visible cards. Remove:

```tsx
// DELETE THIS:
useEffect(() => {
  console.log("[TaskCard] Current user:", user);
  console.log("[TaskCard] User role:", user?.role);
}, [user]);
```

Also clean up the handleUpload function — remove all console.log and console.error calls
from inside it (keep the toast notifications, just remove the logs).

---

## FIX 5 — Infinite CSS animation with box-shadow causes continuous repaints

**File:** `dashboard/src/components/ModernArcGauge.tsx`

**Problem:** `box-shadow` in a keyframe animation is NOT GPU-composited — it causes a main-thread
repaint on every frame. With multiple gauges visible, this is a continuous repaint storm.

Find:
```ts
const pulse = keyframes`
  0% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
  50% { transform: translateX(-50%) scale(1.3); box-shadow: 0 0 15px; }
  100% { transform: translateX(-50%) scale(1); box-shadow: 0 0 8px; }
`;
```

Replace with (remove box-shadow, keep transform which IS GPU-composited):
```ts
const pulse = keyframes`
  0% { transform: translateX(-50%) scale(1); }
  50% { transform: translateX(-50%) scale(1.3); }
  100% { transform: translateX(-50%) scale(1); }
`;
```

---

## FIX 6 — cardWrapSx object recreated on every render

**File:** `dashboard/src/components/UnifiedHeader.tsx`

**Problem:** A large const with 5 responsive breakpoint objects is defined inside the component
function body, so it's recreated from scratch on every render.

Find the block inside the component that looks like:
```tsx
const isLoading = !pivotTask;

// Card wrapper—forces identical widths, kills stagger
const cardWrapSx = {
  "--card-max": `${CARD_W}px`,
  flex: { base: "0 0 280px", ... },
  width: { ... },
  maxWidth: { ... },
  minWidth: { ... },
  "> *": { ... },
} as const;
```

Move the entire `cardWrapSx` const to **module level** (outside the component, near the top of
the file where `CARD_W` is defined). It doesn't use any props or state so it's safe.

---

## FIX 7 — Micro-card flash on load (UnifiedHeader shows wrong size first)

**File:** `dashboard/src/components/UnifiedHeader.tsx`

**Problem:** Chakra UI's `useBreakpointValue` returns the `base` value ("micro") on the first
render before its media-query effects fire. The old code passed that directly into `useState`,
so cards rendered as micro even on a 1920px desktop. Then a `useEffect` "corrected" it a frame
later — causing a visible flash.

Find the entire variant initialization block:
```tsx
const bpVariant = useBreakpointValue<Variant>({ base: "micro", sm: "micro", md: "compact", lg: "compact", xl: "full" });

const [localVariant, setLocalVariant] = useState<Variant>(
  variant ?? bpVariant ?? "full",
);
useEffect(() => {
  if (variant) setLocalVariant(variant);
  else if (bpVariant) setLocalVariant(bpVariant);
}, [variant, bpVariant]);
```

Replace with:
```tsx
const bpVariant = useBreakpointValue<Variant>({
  base: "micro",
  sm: "micro",
  md: "compact",
  lg: "compact",
  xl: "full",
});

// Read window.innerWidth synchronously so the very first paint is correct.
// Chakra's bpVariant starts as "micro" (base) and corrects later — bypassing it
// for initial state prevents the flash of wrong-size cards.
const [localVariant, setLocalVariant] = useState<Variant>(() => {
  if (variant) return variant;
  if (typeof window === "undefined") return "full";
  const w = window.innerWidth;
  return w >= 1280 ? "full" : w >= 768 ? "compact" : "micro";
});
// Ref prevents the first useEffect run from overwriting the correct initial state
// with Chakra's still-stale "micro" value.
const hasMountedVariant = useRef(false);
useEffect(() => {
  if (!hasMountedVariant.current) {
    hasMountedVariant.current = true;
    return;
  }
  if (variant) setLocalVariant(variant);
}, [variant]);
// Handle genuine window resize without going through Chakra's deferred evaluation
useEffect(() => {
  if (variant) return;
  const update = () => {
    const w = window.innerWidth;
    setLocalVariant(w >= 1280 ? "full" : w >= 768 ? "compact" : "micro");
  };
  window.addEventListener("resize", update);
  return () => window.removeEventListener("resize", update);
}, [variant]);
```

Make sure `useRef` is in the React import at the top of the file.

---

## FIX 8 — White screen on reload (10-30 seconds)

**File:** `dashboard/src/routes.tsx`

**Problem:** All 30+ page components were statically imported at the top of routes.tsx.
In Vite dev mode each static import triggers a separate HTTP request + TypeScript compilation
before React can render anything — creating a deep module waterfall.

**Solution:** Convert every page import to `React.lazy()`. Replace the entire file with:

```tsx
import React, { lazy, Suspense } from "react";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import VisionLayout from "./layout/VisionLayout";
import ErrorPage from "./pages/ErrorPage";
import ProtectedRoute from "./components/ProtectedRoute";
import { useTokenRefresh } from "./hooks/useTokenRefresh";

const LandingPage        = lazy(() => import("./pages/LandingPage"));
const Login              = lazy(() => import("./components/Login"));
const Register           = lazy(() => import("./components/Register"));
const ForgotPassword     = lazy(() => import("./components/ForgotPassword"));
const ResetPassword      = lazy(() => import("./components/ResetPassword"));
const AboutPage          = lazy(() => import("./pages/AboutPage"));
const VerifyRecordPage   = lazy(() => import("./pages/VerifyRecordPage"));
const UserDashboard      = lazy(() => import("./components/UserDashboard"));
const VisionDashboard    = lazy(() => import("./components/Dashboard"));
const RatingEvaluation   = lazy(() => import("./components/RatingEvaluation"));
const TaskPage           = lazy(() => import("./pages/TaskPage").then(m => ({ default: m.TaskPage })));
const SearchResultsPage  = lazy(() => import("./pages/SearchResultsPage"));
const CredibilityPage    = lazy(() => import("./pages/CredibilityPage"));
const WorkspacePage      = lazy(() => import("./pages/WorkspacePage"));
const GameSpacePage      = lazy(() => import("./pages/GameSpacePage"));
const LevelPage          = lazy(() => import("./pages/LevelPage"));
const MoleculeMapPage    = lazy(() => import("./pages/MoleculeMapPage"));
const KnowGraphPage      = lazy(() => import("./pages/KnowGraphPage"));
const NewKnowGraphPage   = lazy(() => import("./pages/NewKnowGraphPage"));
const QuadrantGridPage   = lazy(() => import("./pages/QuadrantGridPage"));
const DiscussionPage     = lazy(() => import("./pages/DiscussionPage"));
const ClaimDuelPage      = lazy(() => import("./pages/ClaimDuelPage"));
const CaseFocusPage      = lazy(() => import("./pages/CaseFocusPage").then(m => ({ default: m.CaseFocusPage })));
const ChatPage           = lazy(() => import("./pages/ChatPage"));
const TextPadPage        = lazy(() => import("./pages/TextPadPage"));
const AccountSettingsPage = lazy(() => import("./pages/AccountSettingsPage"));
const UserSelectionPage  = lazy(() => import("./pages/UserSelectionPage"));
const GamePreview        = lazy(() => import("./pages/GamePage"));
const TrueFalseGame      = lazy(() => import("./components/TrueFalseGame"));
const TrueFalseGamePage  = lazy(() => import("./pages/TrueFalseGamePage"));
const ExtensionDownloadPage = lazy(() => import("./pages/ExtensionDownloadPage"));
const SocialMediaPage    = lazy(() => import("./pages/SocialMediaPage"));
const SocialAdminPanel   = lazy(() => import("./pages/SocialAdminPanel"));
const TTLiveFeedPage     = lazy(() => import("./pages/TTLiveFeedPage"));
const TTLiveThreadPage   = lazy(() => import("./pages/TTLiveThreadPage"));
const EmailTesterPage    = lazy(() => import("./pages/EmailTesterPage"));
const TutorialGalleryPage = lazy(() => import("./pages/TutorialGalleryPage"));
const AdminPanelPage     = lazy(() => import("./pages/AdminPanelPage"));
const SourceQualityPage  = lazy(() => import("./pages/SourceQualityPage"));
const RatingEvaluationPage = lazy(() => import("./pages/RatingEvaluationPage"));
const LogoutPage         = lazy(() => import("./pages/LogoutPage"));

const PageLoader = () => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "80vh" }}>
    <div style={{ color: "#4fd1c5", fontSize: "1.2rem" }}>Loading…</div>
  </div>
);

const router = createBrowserRouter([
  { path: "/",               element: <LandingPage />,     errorElement: <ErrorPage /> },
  { path: "/login",          element: <Login /> },
  { path: "/forgot-password", element: <ForgotPassword /> },
  { path: "/reset-password", element: <ResetPassword /> },
  { path: "/register",       element: <Register /> },
  { path: "/about",          element: <AboutPage /> },
  { path: "/verify",         element: <VerifyRecordPage /> },
  {
    path: "/",
    element: <VisionLayout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "dashboard",        element: <ProtectedRoute><UserDashboard /></ProtectedRoute> },
      { path: "user-dashboard",   element: <ProtectedRoute><UserDashboard /></ProtectedRoute> },
      { path: "vision-dashboard", element: <ProtectedRoute><VisionDashboard /></ProtectedRoute> },
      { path: "rating-history",   element: <ProtectedRoute><RatingEvaluation /></ProtectedRoute> },
      { path: "tasks",            element: <ProtectedRoute><TaskPage /></ProtectedRoute> },
      { path: "search",           element: <ProtectedRoute><SearchResultsPage /></ProtectedRoute> },
      { path: "credibility",      element: <ProtectedRoute><CredibilityPage /></ProtectedRoute> },
      { path: "claim-duel",       element: <ProtectedRoute><ClaimDuelPage /></ProtectedRoute> },
      { path: "claim-duel/:taskId", element: <ProtectedRoute><ClaimDuelPage /></ProtectedRoute> },
      { path: "casefocus",        element: <ProtectedRoute><CaseFocusPage /></ProtectedRoute> },
      { path: "casefocus/:taskId", element: <ProtectedRoute><CaseFocusPage /></ProtectedRoute> },
      { path: "workspace",        element: <ProtectedRoute><WorkspacePage /></ProtectedRoute> },
      { path: "workspace/:contentId", element: <ProtectedRoute><WorkspacePage /></ProtectedRoute> },
      { path: "gamespace",        element: <ProtectedRoute><GameSpacePage /></ProtectedRoute> },
      { path: "level",            element: <ProtectedRoute><LevelPage /></ProtectedRoute> },
      { path: "molecule",         element: <ProtectedRoute><MoleculeMapPage /></ProtectedRoute> },
      { path: "knowgraph",        element: <ProtectedRoute><KnowGraphPage /></ProtectedRoute> },
      { path: "newknowgraph",     element: <ProtectedRoute><NewKnowGraphPage /></ProtectedRoute> },
      { path: "social-media",     element: <ProtectedRoute><SocialMediaPage /></ProtectedRoute> },
      { path: "admin/social",     element: <ProtectedRoute><SocialAdminPanel /></ProtectedRoute> },
      { path: "ttlive",           element: <ProtectedRoute><TTLiveFeedPage /></ProtectedRoute> },
      { path: "ttlive/thread/:threadId", element: <ProtectedRoute><TTLiveThreadPage /></ProtectedRoute> },
      { path: "quadrantgrid",     element: <ProtectedRoute><QuadrantGridPage /></ProtectedRoute> },
      { path: "discussion/:contentId", element: <ProtectedRoute><DiscussionPage /></ProtectedRoute> },
      { path: "account",          element: <ProtectedRoute><AccountSettingsPage /></ProtectedRoute> },
      { path: "select-user",      element: <ProtectedRoute><UserSelectionPage /></ProtectedRoute> },
      { path: "game",             element: <ProtectedRoute><GamePreview /></ProtectedRoute> },
      { path: "game/truefalse",   element: <ProtectedRoute><TrueFalseGame /></ProtectedRoute> },
      { path: "truefalse",        element: <ProtectedRoute><TrueFalseGamePage /></ProtectedRoute> },
      { path: "extension",        element: <ProtectedRoute><ExtensionDownloadPage /></ProtectedRoute> },
      { path: "textpad",          element: <ProtectedRoute><TextPadPage /></ProtectedRoute> },
      { path: "chat",             element: <ProtectedRoute><ChatPage /></ProtectedRoute> },
      { path: "emailtest",        element: <ProtectedRoute><EmailTesterPage /></ProtectedRoute> },
      { path: "tutorials",        element: <ProtectedRoute><TutorialGalleryPage /></ProtectedRoute> },
      { path: "admin",            element: <ProtectedRoute><AdminPanelPage /></ProtectedRoute> },
      { path: "source-quality/:contentId", element: <ProtectedRoute><SourceQualityPage /></ProtectedRoute> },
      { path: "evaluate-ratings", element: <ProtectedRoute><RatingEvaluationPage /></ProtectedRoute> },
      { path: "logout",           element: <LogoutPage /> },
    ],
  },
]);

export default function AppRouter() {
  useTokenRefresh();
  return (
    <Suspense fallback={<PageLoader />}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
```

---

## FIX 9 — Workspace.tsx console.log flood on every data load

**File:** `dashboard/src/components/Workspace.tsx`

Remove these console.log calls that fire every time data loads (not errors — keep console.error):

1. Remove: `console.log(\`✅ Loaded ${formattedLinks.length} claim links for content ${contentId}\`)`
2. In the AI evidence links fetch: remove `console.log("✅ AI evidence links fetched:", links);`
   and simplify `.then((links) => { setAIEvidenceLinks(links); })`
3. In the references fetch: remove `console.log("✅ references fetched:", data);`
   and simplify `.then(setReferences)`
4. Remove the `console.log("[Workspace] handleOpenLinkOverlayFromScan called with:", ...)` block
   (keep just `setSourceClaim(scanSourceClaim);` and the lines after it)

---

## FIX 10 — main.tsx ReactQueryDevtools always loaded

**File:** `dashboard/src/main.tsx`

Gate the devtools panel so it only renders in dev:

Find:
```tsx
<ReactQueryDevtools />
```

Replace with:
```tsx
{import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
```

---

## After applying all fixes

1. Stop the Vite dev server (Ctrl+C)
2. Run: `rm -rf node_modules/.vite`
3. Run: `npm run dev`
4. Hard reload browser: Cmd+Shift+R
