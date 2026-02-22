import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Button,
  Text,
  HStack,
  VStack,
  Heading,
  IconButton,
  Badge,
  Progress,
  Spinner,
} from "@chakra-ui/react";
import { CloseIcon, QuestionOutlineIcon } from "@chakra-ui/icons";
import { useNavigate, useLocation } from "react-router-dom";

// ─── Demo content ──────────────────────────────────────────────────────────────
const DEMO_TITLE = "Minnesota Protest Claims";
const DEMO_TEXT =
  "All minnesota protestors are paid.  Everyone knows this.  They are too organized.  That is why it is obvious that these citizens are being paid to protest.";

// ─── Storage keys ──────────────────────────────────────────────────────────────
const TOUR_STEP_KEY = "tt_tour_step";
const TOUR_ACTIVE_KEY = "tt_tour_active";

// ─── Tour step definitions ─────────────────────────────────────────────────────
interface TourStep {
  page: string;
  target?: string;       // CSS selector to highlight + point to
  title: string;
  content: string;
  primaryLabel: string;
  secondaryLabel?: string;
  specialAction?: "navigate-textpad" | "paste-title" | "paste-text" | "wait-for-submit" | "wait-for-ref-modal" | "wait-for-link-overlay" | "end";
}

const STEPS: TourStep[] = [
  // ── Dashboard ────────────────────────────────────────────────────────────────
  {
    page: "dashboard",
    title: "Welcome to TruthTrollers! 👋",
    content:
      "This is your mission control. Your job is to evaluate claims, rate evidence, and help keep the internet a bit more honest. Let's take a quick tour so you know where everything is.",
    primaryLabel: "Let's go →",
    secondaryLabel: "Skip tour",
  },
  {
    page: "dashboard",
    target: ".claim-activity-chart",
    title: "Your Claim Activity",
    content:
      "This chart tracks your rating activity over time and shows how other users on the platform are engaging with content. As you evaluate more claims, this fills up and shows your contribution.",
    primaryLabel: "Next →",
  },
  {
    page: "dashboard",
    target: ".assigned-tasks-section",
    title: "Your Assigned Content",
    content:
      "These are the articles, statements, and posts you've been assigned to evaluate. It's empty right now — we'll fix that! Each card has a dropdown to choose Workspace, GameSpace, or Molecule, then hit Evaluate.",
    primaryLabel: "Next →",
  },
  {
    page: "dashboard",
    target: ".other-tasks-section",
    title: "Other Tasks",
    content:
      "Beyond rating content you can also: rate authors and publishers for credibility, evaluate other users' rating quality, verify specific claims, and browse all available tasks on the platform.",
    primaryLabel: "Next →",
  },
  {
    page: "dashboard",
    title: "Let's Try It Out! 🚀",
    content:
      "The best way to learn is by doing. Let's submit some text to the evidence engine using a real example — a claim about Minnesota protesters. Click below to head to TextPad.",
    primaryLabel: "Go to TextPad →",
    secondaryLabel: "Skip tour",
    specialAction: "navigate-textpad",
  },

  // ── TextPad ──────────────────────────────────────────────────────────────────
  {
    page: "textpad",
    target: ".textpad-title-input",
    title: "Step 1 — Give It a Title",
    content:
      "Enter a short title describing this text. It'll appear in your task list so you can find it later.",
    primaryLabel: "Use demo title",
    secondaryLabel: "I'll type my own →",
    specialAction: "paste-title",
  },
  {
    page: "textpad",
    target: ".textpad-textarea",
    title: "Step 2 — Enter Text to Analyze",
    content:
      "Paste or type any claim, article excerpt, or statement here. The AI will extract individual factual claims and search for supporting or contradicting evidence.",
    primaryLabel: "Paste demo text",
    secondaryLabel: "I'll enter my own →",
    specialAction: "paste-text",
  },
  {
    page: "textpad",
    target: ".textpad-submit",
    title: "Step 3 — Submit for Analysis",
    content:
      "Go ahead and click the Submit button when you're ready!\n\nThe evidence engine will extract claims and search for supporting or contradicting evidence. This takes 1–3 minutes. ☕",
    primaryLabel: "Got it!",
    specialAction: "wait-for-submit",
  },
  {
    page: "textpad",
    target: ".textpad-evaluate-button",
    title: "Analysis Complete! 🎉",
    content:
      "Your text has been analyzed! Now click the \"Evaluate in Workspace\" button to start reviewing the claims and evidence.",
    primaryLabel: "Got it →",
  },

  // ── Workspace ────────────────────────────────────────────────────────────────
  {
    page: "workspace",
    target: ".workspace-header",
    title: "You're in the Workspace! 💪",
    content:
      "This is where evidence meets claims. Three columns work together:\n\n• Left — Task Claims extracted from your text\n• Center — Relationship Map (AI-detected connections)\n• Right — References (evidence sources)\n\nLet's walk through each one.",
    primaryLabel: "Show me →",
  },
  {
    page: "workspace",
    target: ".workspace-claims",
    title: "Task Claims — Left Column",
    content:
      "These are the factual claims the AI extracted from your text.\n\n• ✏️ Edit the claim text\n• 🔍 (purple) Verify a claim externally\n• 🔍 (teal) Scan references for relevant evidence\n• 🗑️ Delete the claim\n\nClick any claim to read it in full.",
    primaryLabel: "Next →",
  },
  {
    page: "workspace",
    target: ".workspace-references",
    title: "References — Right Column",
    content:
      "These are web pages and articles found by the evidence engine that may support or contradict your claims.\n\nRight-click any reference card to open it in a new tab. Use '+ Add Reference' to add your own sources manually.",
    primaryLabel: "Next →",
  },
  {
    page: "workspace",
    target: ".workspace-references",
    title: "Open a Reference's Claims",
    content:
      "Click any reference card to open a floating panel showing the individual claims extracted from that source.\n\nThese reference claims are what you'll link to your task claims. Go ahead — click one now!",
    primaryLabel: "I clicked one →",
    specialAction: "wait-for-ref-modal",
  },
  {
    page: "workspace",
    target: ".mr-modal-header",
    title: "Reference Claims Panel",
    content:
      "This floating panel shows claims from the selected reference. Drag it by its header to reposition it.\n\nBlue text = factual claims.  Italic gray = direct quotes.\n\nColored borders mean a claim is already linked:\n🟢 Supports · 🔴 Refutes · 🔵 Nuanced",
    primaryLabel: "Next →",
  },
  {
    page: "workspace",
    title: "Link a Claim — Drag & Drop 🖱️",
    content:
      "Now the key move! Click and hold any reference claim in the panel, then drag it over a task claim on the left.\n\nThe task claim highlights as you hover — release the mouse to open the Claim Relationship panel.\n\nGive it a try!",
    primaryLabel: "I'll try it! →",
    specialAction: "wait-for-link-overlay",
  },
  {
    page: "workspace",
    target: ".mr-button",
    title: "Claim Relationship Panel 🔗",
    content:
      "Define how the reference claim relates to the task claim:\n\n• Slider RIGHT (green ✅) = Supports the claim\n• Slider LEFT (red ⛔) = Refutes the claim\n• Center (yellow ⚖️) = Nuanced / Related\n\nAdd optional notes, then click 'Create Link'. A colored line will connect them in the map!",
    primaryLabel: "Got it — create the link!",
    specialAction: "end",
  },
];

const TOTAL_STEPS = STEPS.length;

// ─── Card geometry ─────────────────────────────────────────────────────────────
const CARD_W = 360;
const CARD_H_EST = 260;
const ARROW = 14;
const GAP = 12;

type ArrowDir = "top" | "bottom" | "left" | "right" | "none";

interface CardPos {
  top: number;
  left: number;
  arrowDir: ArrowDir;
  arrowAlong: number; // px offset along the card edge where the arrow sits
}

function positionCard(selector: string): CardPos | null {
  const el = document.querySelector(selector);
  if (!el) return null;

  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  // Clamp card so it stays in viewport horizontally
  const clampLeft = (l: number) => Math.max(8, Math.min(l, vw - CARD_W - 8));
  // Clamp card so it stays in viewport vertically
  const clampTop = (t: number) => Math.max(8, Math.min(t, vh - CARD_H_EST - 8));

  // ── try below ──
  if (r.bottom + GAP + ARROW + CARD_H_EST < vh) {
    const left = clampLeft(cx - CARD_W / 2);
    return {
      top: r.bottom + GAP + ARROW,
      left,
      arrowDir: "top",
      arrowAlong: Math.max(ARROW + 2, Math.min(cx - left - ARROW, CARD_W - ARROW * 2 - 2)),
    };
  }
  // ── try above ──
  if (r.top - GAP - ARROW - CARD_H_EST > 0) {
    const left = clampLeft(cx - CARD_W / 2);
    return {
      top: r.top - GAP - ARROW - CARD_H_EST,
      left,
      arrowDir: "bottom",
      arrowAlong: Math.max(ARROW + 2, Math.min(cx - left - ARROW, CARD_W - ARROW * 2 - 2)),
    };
  }
  // ── try right ──
  if (r.right + GAP + ARROW + CARD_W < vw) {
    const top = clampTop(cy - CARD_H_EST / 2);
    return {
      top,
      left: r.right + GAP + ARROW,
      arrowDir: "left",
      arrowAlong: Math.max(ARROW + 2, Math.min(cy - top - ARROW, CARD_H_EST - ARROW * 2 - 2)),
    };
  }
  // ── fallback left ──
  const top = clampTop(cy - CARD_H_EST / 2);
  return {
    top,
    left: Math.max(8, r.left - GAP - ARROW - CARD_W),
    arrowDir: "right",
    arrowAlong: Math.max(ARROW + 2, Math.min(cy - top - ARROW, CARD_H_EST - ARROW * 2 - 2)),
  };
}

// ─── CSS arrow fragment ────────────────────────────────────────────────────────
function ArrowTip({ dir, along }: { dir: ArrowDir; along: number }) {
  if (dir === "none") return null;

  const borderColor = "#3182ce"; // blue.500
  const size = ARROW;

  const base: React.CSSProperties = {
    position: "absolute",
    width: 0,
    height: 0,
    pointerEvents: "none",
  };

  let style: React.CSSProperties;

  if (dir === "top") {
    style = {
      ...base,
      top: -size,
      left: along,
      borderLeft: `${size}px solid transparent`,
      borderRight: `${size}px solid transparent`,
      borderBottom: `${size}px solid ${borderColor}`,
    };
  } else if (dir === "bottom") {
    style = {
      ...base,
      bottom: -size,
      left: along,
      borderLeft: `${size}px solid transparent`,
      borderRight: `${size}px solid transparent`,
      borderTop: `${size}px solid ${borderColor}`,
    };
  } else if (dir === "left") {
    style = {
      ...base,
      left: -size,
      top: along,
      borderTop: `${size}px solid transparent`,
      borderBottom: `${size}px solid transparent`,
      borderRight: `${size}px solid ${borderColor}`,
    };
  } else {
    // right
    style = {
      ...base,
      right: -size,
      top: along,
      borderTop: `${size}px solid transparent`,
      borderBottom: `${size}px solid transparent`,
      borderLeft: `${size}px solid ${borderColor}`,
    };
  }

  return <div style={style} />;
}

// ─── Highlight helper ──────────────────────────────────────────────────────────
function applyHighlight(selector?: string) {
  document.querySelectorAll(".tt-tour-highlight").forEach((el) =>
    el.classList.remove("tt-tour-highlight")
  );
  if (selector) {
    const el = document.querySelector(selector);
    if (el) el.classList.add("tt-tour-highlight");
  }
}

// ─── Waiting message helper ────────────────────────────────────────────────────
function waitingMessage(waitingFor: string): string {
  switch (waitingFor) {
    case "submit":       return "Waiting for submission…";
    case "ref-modal":   return "Click a reference on the right to continue… 👉";
    case "link-overlay": return "Drag a reference claim onto a task claim… 🖱️";
    default:            return "Waiting…";
  }
}

// ─── PlatformTour ─────────────────────────────────────────────────────────────
export const PlatformTour: React.FC = () => {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  // null = not waiting; "submit" | "ref-modal" | "link-overlay" = waiting for user action
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<CardPos | null>(null);
  const posTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const currentPage = (() => {
    if (location.pathname.includes("/dashboard")) return "dashboard";
    if (location.pathname.includes("/textpad")) return "textpad";
    if (location.pathname.includes("/workspace")) return "workspace";
    if (location.pathname.includes("/tasks")) return "tasks";
    return "dashboard";
  })();

  // ── Recompute card position ────────────────────────────────────────────────
  const refreshPos = useCallback(() => {
    if (!active) return;
    const step = STEPS[stepIndex];
    if (!step || step.page !== currentPage) { setCardPos(null); return; }

    if (step.target) {
      const pos = positionCard(step.target);
      setCardPos(pos); // null means element not found yet — retry
    } else {
      setCardPos(null); // no target → use fixed corner
    }
  }, [active, stepIndex, currentPage]);

  // Re-position when step changes or on scroll/resize
  useEffect(() => {
    if (!active) return;

    // Small delay so DOM is ready after navigation
    posTimerRef.current = setTimeout(refreshPos, 350);

    window.addEventListener("scroll", refreshPos, true);
    window.addEventListener("resize", refreshPos);
    return () => {
      if (posTimerRef.current) clearTimeout(posTimerRef.current);
      window.removeEventListener("scroll", refreshPos, true);
      window.removeEventListener("resize", refreshPos);
    };
  }, [active, refreshPos]);

  // ── Restore state from localStorage on mount ──────────────────────────────
  useEffect(() => {
    const savedActive = localStorage.getItem(TOUR_ACTIVE_KEY) === "true";
    const savedStep = parseInt(localStorage.getItem(TOUR_STEP_KEY) || "0", 10);
    if (savedActive) {
      setActive(true);
      setStepIndex(isNaN(savedStep) ? 0 : savedStep);
    }
  }, []);

  // ── Auto-start on first dashboard visit (especially for new users) ───────
  useEffect(() => {
    const hasSeenTour = localStorage.getItem("tourCompleted");
    const isAlreadyActive = localStorage.getItem(TOUR_ACTIVE_KEY) === "true";
    if (!hasSeenTour && !isAlreadyActive && location.pathname.includes("/dashboard")) {
      // Shorter delay (800ms) so new users see the tour faster after login
      const t = setTimeout(() => startTour(), 800);
      return () => clearTimeout(t);
    }
  }, [location.pathname]); // eslint-disable-line

  // ── Detect TextPad submission complete (URL gains ?contentId) ─────────────
  useEffect(() => {
    if ((active || waitingFor === "submit") && location.search.includes("contentId")) {
      if (stepIndex === 7 || waitingFor === "submit") {
        setWaitingFor(null);
        goToStep(8);
      }
    }
  }, [location.search]); // eslint-disable-line

  // ── Poll for Reference Claims Modal opening ────────────────────────────────
  useEffect(() => {
    if (waitingFor !== "ref-modal") return;
    const interval = setInterval(() => {
      // .mr-modal is the className on DraggableReferenceClaimsModal's Box
      if (document.querySelector(".mr-modal")) {
        setWaitingFor(null);
        goToStep(stepIndex + 1);
      }
    }, 400);
    return () => clearInterval(interval);
  }, [waitingFor, stepIndex]); // eslint-disable-line

  // ── Poll for Claim Link Overlay opening ───────────────────────────────────
  useEffect(() => {
    if (waitingFor !== "link-overlay") return;
    const interval = setInterval(() => {
      // .mr-button is on the "Create Link" button inside ClaimLinkOverlay
      if (document.querySelector(".mr-button")) {
        setWaitingFor(null);
        goToStep(stepIndex + 1);
      }
    }, 400);
    return () => clearInterval(interval);
  }, [waitingFor, stepIndex]); // eslint-disable-line

  // ── Highlight target element when step changes ────────────────────────────
  useEffect(() => {
    if (!active || waitingFor) { applyHighlight(undefined); return; }
    const step = STEPS[stepIndex];
    const t = setTimeout(() => applyHighlight(step?.page === currentPage ? step?.target : undefined), 350);
    return () => clearTimeout(t);
  }, [active, stepIndex, currentPage, waitingFor]);

  // ── Stop tour on page change ───────────────────────────────────────────────
  useEffect(() => {
    if (!waitingFor) setCardPos(null);
  }, [currentPage]); // eslint-disable-line

  // ── Listen for restart event ──────────────────────────────────────────────
  useEffect(() => {
    const handle = () => startTour();
    window.addEventListener("restartTour", handle);
    return () => window.removeEventListener("restartTour", handle);
  }); // eslint-disable-line

  // ─── Core helpers ──────────────────────────────────────────────────────────
  const startTour = useCallback(() => {
    localStorage.setItem(TOUR_ACTIVE_KEY, "true");
    localStorage.setItem(TOUR_STEP_KEY, "0");
    setWaitingFor(null);
    setStepIndex(0);
    setActive(true);
  }, []);

  const goToStep = useCallback((idx: number) => {
    localStorage.setItem(TOUR_STEP_KEY, String(idx));
    setStepIndex(idx);
  }, []);

  const endTour = useCallback(() => {
    applyHighlight(undefined);
    localStorage.removeItem(TOUR_ACTIVE_KEY);
    localStorage.removeItem(TOUR_STEP_KEY);
    localStorage.setItem("tourCompleted", "true");
    setWaitingFor(null);
    setActive(false);
    setCardPos(null);
  }, []);

  const handlePrimary = useCallback(() => {
    const step = STEPS[stepIndex];
    if (!step) return;

    switch (step.specialAction) {
      case "navigate-textpad":
        goToStep(stepIndex + 1);
        navigate("/textpad");
        break;
      case "paste-title":
        window.dispatchEvent(new CustomEvent("tourFillTitle", { detail: { title: DEMO_TITLE } }));
        goToStep(stepIndex + 1);
        break;
      case "paste-text":
        window.dispatchEvent(new CustomEvent("tourFillText", { detail: { text: DEMO_TEXT } }));
        goToStep(stepIndex + 1);
        break;
      case "wait-for-submit":
        // Collapse to waiting indicator — user clicks Submit themselves
        setWaitingFor("submit");
        applyHighlight(undefined);
        break;
      case "wait-for-ref-modal":
        // Collapse to waiting indicator — auto-advances when .mr-modal appears
        setWaitingFor("ref-modal");
        applyHighlight(undefined);
        break;
      case "wait-for-link-overlay":
        // Collapse to waiting indicator — auto-advances when .mr-button appears
        setWaitingFor("link-overlay");
        applyHighlight(undefined);
        break;
      case "end":
        endTour();
        break;
      default:
        if (stepIndex < TOTAL_STEPS - 1) goToStep(stepIndex + 1);
        else endTour();
    }
  }, [stepIndex, navigate, goToStep, endTour]);

  const handleSecondary = useCallback(() => {
    const step = STEPS[stepIndex];
    if (step?.secondaryLabel === "Skip tour") endTour();
    else goToStep(stepIndex + 1);
  }, [stepIndex, goToStep, endTour]);

  // ─── Render ────────────────────────────────────────────────────────────────
  if (!active) return null;

  const step = STEPS[stepIndex];
  const isOnCorrectPage = step?.page === currentPage;

  // ── Waiting indicator (user needs to perform an action) ───────────────────
  if (waitingFor) {
    return (
      <>
        <style>{highlightCSS}</style>
        <Box
          position="fixed"
          bottom="24px"
          right="24px"
          zIndex={9999}
          bg="blue.500"
          color="white"
          borderRadius="full"
          px={4}
          py={3}
          boxShadow="0 4px 20px rgba(0,0,0,0.3)"
          display="flex"
          alignItems="center"
          gap={3}
        >
          <Spinner size="sm" color="white" />
          <Text fontSize="sm" fontWeight="medium">{waitingMessage(waitingFor)}</Text>
          <IconButton
            icon={<CloseIcon boxSize={2.5} />}
            aria-label="Cancel tour"
            size="xs"
            variant="ghost"
            color="white"
            _hover={{ bg: "blue.600" }}
            onClick={endTour}
          />
        </Box>
      </>
    );
  }

  if (!step || !isOnCorrectPage) return null;

  const progress = ((stepIndex + 1) / TOTAL_STEPS) * 100;
  const hasTarget = !!step.target;
  const useFixedCorner = !hasTarget || !cardPos;

  // Build positioning style
  const posStyle: React.CSSProperties = useFixedCorner
    ? { position: "fixed", bottom: 24, right: 24 }
    : { position: "fixed", top: cardPos!.top, left: cardPos!.left };

  return (
    <>
      <style>{highlightCSS}</style>

      {/* Semi-transparent backdrop only for center/no-target steps */}
      {!hasTarget && (
        <Box
          position="fixed"
          inset={0}
          zIndex={9990}
          bg="blackAlpha.400"
          pointerEvents="none"
        />
      )}

      {/* Tour card */}
      <Box
        style={posStyle}
        zIndex={9999}
        w={`${CARD_W}px`}
        bg="white"
        borderRadius="xl"
        boxShadow="0 8px 48px rgba(0,0,0,0.28)"
        overflow="visible"
        border="2px solid"
        borderColor="blue.500"
        transition="top 0.35s cubic-bezier(.4,0,.2,1), left 0.35s cubic-bezier(.4,0,.2,1)"
      >
        {/* Arrow pointing to target */}
        {cardPos && cardPos.arrowDir !== "none" && (
          <ArrowTip dir={cardPos.arrowDir} along={cardPos.arrowAlong} />
        )}

        {/* Header */}
        <Box bg="blue.500" px={4} py={2} borderRadius="10px 10px 0 0">
          <HStack justify="space-between" align="center">
            <Badge bg="blue.300" color="white" fontSize="xs">
              Step {stepIndex + 1} of {TOTAL_STEPS}
            </Badge>
            <IconButton
              icon={<CloseIcon boxSize={3} />}
              aria-label="Close tour"
              size="xs"
              variant="ghost"
              color="white"
              _hover={{ bg: "blue.600" }}
              onClick={endTour}
            />
          </HStack>
          <Progress
            value={progress}
            size="xs"
            bg="blue.400"
            sx={{ "& > div": { background: "white" } }}
            borderRadius="full"
            mt={1}
          />
        </Box>

        {/* Body */}
        <Box px={5} py={4}>
          <Heading size="sm" color="gray.800" mb={2}>
            {step.title}
          </Heading>
          <Text fontSize="sm" color="gray.600" whiteSpace="pre-line" lineHeight="1.7">
            {step.content}
          </Text>
        </Box>

        {/* Buttons */}
        <Box px={5} pb={4}>
          <VStack spacing={2} align="stretch">
            <Button colorScheme="blue" size="sm" onClick={handlePrimary} w="100%">
              {step.primaryLabel}
            </Button>
            {step.secondaryLabel && (
              <Button variant="ghost" size="sm" color="gray.500" onClick={handleSecondary} w="100%">
                {step.secondaryLabel}
              </Button>
            )}
          </VStack>
        </Box>
      </Box>
    </>
  );
};

// ─── Highlight CSS ─────────────────────────────────────────────────────────────
// NOTE: Only outline + animation — NO position or z-index changes.
// Adding position/z-index to highlighted elements can create stacking contexts
// that block the DraggableReferenceClaimsModal (z-index 2500) or its SVG overlay.
const highlightCSS = `
  .tt-tour-highlight {
    outline: 3px solid #3182ce !important;
    outline-offset: 5px !important;
    border-radius: 8px !important;
    animation: tt-pulse 1.8s ease-in-out infinite;
  }
  @keyframes tt-pulse {
    0%, 100% { outline-color: #3182ce; outline-offset: 5px; }
    50%       { outline-color: #63b3ed; outline-offset: 8px; }
  }
`;

// ─── NavBar trigger button ────────────────────────────────────────────────────
export const TourTriggerButton: React.FC = () => {
  const handleStart = () => {
    localStorage.removeItem("tourCompleted");
    window.dispatchEvent(new CustomEvent("restartTour"));
  };
  return (
    <Button
      onClick={handleStart}
      size="sm"
      variant="ghost"
      color="white"
      _hover={{ bg: "whiteAlpha.200" }}
      _active={{ bg: "whiteAlpha.300" }}
      leftIcon={<QuestionOutlineIcon />}
      aria-label="Start platform tour"
    >
      Tutorial
    </Button>
  );
};
