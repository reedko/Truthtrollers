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
  target?: string; // CSS selector to highlight + point to
  title: string;
  content: string;
  primaryLabel: string;
  secondaryLabel?: string;
  tertiaryLabel?: string;
  specialAction?:
    | "navigate-textpad"
    | "paste-title"
    | "paste-text"
    | "wait-for-submit"
    | "wait-for-ref-modal"
    | "wait-for-link-overlay"
    | "wait-for-task-assignment"
    | "branch-full-tutorial"
    | "branch-extension"
    | "branch-video-gallery"
    | "navigate-extension-page"
    | "end";
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
  // ── Branch: Choose Tutorial Path ─────────────────────────────────────────────
  {
    page: "dashboard",
    title: "Choose Your Path 🛤️",
    content:
      "You have three options:\n\n1. Full Platform Tutorial — Walk through submitting text, extracting claims, and linking evidence (takes ~5-10 minutes)\n\n2. Tutorial Video Gallery — Watch video tutorials at your own pace\n\n3. Extension Installation — Quick guide to install the browser extension for capturing web content",
    primaryLabel: "1. Full Tutorial →",
    secondaryLabel: "2. Video Gallery →",
    tertiaryLabel: "3. Install Extension →",
    specialAction: "branch-full-tutorial",
  },

  // ── Extension Installation Branch ────────────────────────────────────────────
  {
    page: "extension",
    title: "Extension Installation Guide 🧩",
    content:
      "The TruthTrollers browser extension lets you capture web content directly from any page.\n\nWe'll walk through:\n1. Downloading the ZIP\n2. Unzipping to a permanent folder\n3. Loading it in your browser\n\nLet's get started!",
    primaryLabel: "Let's do it! →",
    secondaryLabel: "Skip to dashboard",
  },
  {
    page: "extension",
    target: "button[href*='extension.zip']",
    title: "Step 1 — Download the ZIP 📦",
    content:
      "👇 Click the highlighted button below to download the extension.\n\n⚠️ Important: The ZIP will download to your Downloads folder. You'll need to UNZIP it in the next step!\n\nClick the button and the tutorial will automatically advance.",
    primaryLabel: "I downloaded it →",
  },
  {
    page: "extension",
    title: "Step 2 — Unzip the File 📂",
    content:
      "1. Go to your Downloads folder\n2. Find 'truthtrollers_extension.zip'\n3. Double-click to unzip it (creates 'truthtrollers_extension' folder)\n4. Move that folder somewhere permanent like:\n   • ~/Documents/TruthTrollers/extension\n   • Desktop/TruthTrollers/extension\n\n⚠️ Don't delete this folder — the browser loads from it!",
    primaryLabel: "Done unzipping →",
  },
  {
    page: "extension",
    title: "Step 3 — Open Browser Extensions 🌐",
    content:
      "Now let's load it in your browser!\n\nClick the button below for your browser, OR manually open:\n\nChrome/Edge: chrome://extensions\nFirefox: about:debugging#/runtime/this-firefox\n\nOnce that page opens, come back here and click Next!",
    primaryLabel: "Extensions page is open →",
    secondaryLabel: "Copy chrome://extensions",
  },
  {
    page: "extension",
    target: "ol",
    title: "Step 4 — Enable Developer Mode ⚙️",
    content:
      "On the extensions page you just opened:\n\nChrome/Edge:\n• Look for 'Developer mode' toggle in the TOP RIGHT\n• Turn it ON (it should turn blue)\n• You'll see new buttons appear: 'Load unpacked', 'Pack extension', etc.\n\nFirefox:\n• Click the 'Load Temporary Add-on...' button\n• (No developer mode needed)",
    primaryLabel: "Developer mode is ON →",
  },
  {
    page: "extension",
    title: "Step 5 — Load Unpacked Extension 📥",
    content:
      "Almost there!\n\nChrome/Edge:\n• Click 'Load unpacked' button\n• Navigate to where you unzipped the folder\n• Select the 'truthtrollers_extension' folder (not the .zip!)\n• Click 'Select Folder'\n\nFirefox:\n• Click 'Load Temporary Add-on'\n• Navigate to the unzipped folder\n• Select 'manifest.json' inside it\n• Click 'Open'",
    primaryLabel: "Extension loaded! →",
  },
  {
    page: "extension",
    title: "Step 6 — Pin the Extension 📌",
    content:
      "You should now see 'TruthTrollers Extension' in your extensions list!\n\nTo make it easy to access:\n\n• Click the puzzle piece icon 🧩 in your browser toolbar\n• Find 'TruthTrollers Extension'\n• Click the pin icon 📌 next to it\n\nNow the TruthTrollers icon will always be visible in your toolbar!",
    primaryLabel: "I pinned it! →",
  },
  {
    page: "extension",
    title: "Extension Installed! 🎉",
    content:
      "Congratulations! The TruthTrollers extension is now installed and ready to use.\n\n✅ Extension loaded\n✅ Icon pinned to toolbar\n\nClick the TruthTrollers icon on any web page to:\n• Capture content\n• Send it to your dashboard\n• Analyze claims and find evidence\n\nReady to start fact-checking the web!",
    primaryLabel: "Finish tour",
    specialAction: "end",
  },

  // ── Full Tutorial Branch (Original Dashboard Tour) ──────────────────────────
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
      "These are the articles, statements, and posts you've been assigned to evaluate. It's empty right now — but let's fix that! We'll grab your first case from the platform.",
    primaryLabel: "Let's get a case! →",
  },
  {
    page: "tasks",
    title: "The Cases Page 📋",
    content:
      "This is where all available content lives. You can browse articles, statements, and posts that need fact-checking. Let's assign one to yourself so you have something to work with!",
    primaryLabel: "Got it →",
  },
  {
    page: "tasks",
    target: ".mr-card",
    title: "Case Cards",
    content:
      "Each card shows a piece of content that needs evaluation. You can see:\n• The title and source\n• When it was submitted\n• Current veracity score (if available)\n\nClick SELECT on any case card to assign it to yourself!",
    primaryLabel: "I'll pick one →",
    specialAction: "wait-for-task-assignment",
  },
  {
    page: "dashboard",
    target: ".assigned-tasks-section",
    title: "Case Assigned! 🎉",
    content:
      "Great! Now you have a case in your Assigned Content section. This is where you'll find all the content you're actively working on. You can access Workspace and Molecule from the Workbench menu to evaluate it.",
    primaryLabel: "Next →",
  },
  {
    page: "dashboard",
    target: ".other-tasks-section",
    title: "Other Activities",
    content:
      "Beyond rating content you can also: rate authors and publishers for credibility, evaluate other users' rating quality, verify specific claims, and browse all available cases on the platform.",
    primaryLabel: "Next →",
  },
  {
    page: "dashboard",
    title: "Let's Try It Out! 🚀",
    content:
      "The best way to learn is by doing. Let's submit some text to the evidence engine using a real example — a claim about Minnesota protesters. Click below to head to TextPad (found in the Workbench menu).",
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
      "👇 Click the highlighted Submit button to start the analysis!\n\nThe evidence engine will extract claims and search for supporting or contradicting evidence. This takes 1–3 minutes. ☕\n\n(Or click the button below to auto-submit!)",
    primaryLabel: "Submit for Me!",
    specialAction: "wait-for-submit",
  },
  {
    page: "textpad",
    target: ".textpad-evaluate-button",
    title: "Analysis Complete! 🎉",
    content:
      'Your text has been analyzed! Now click the "Evaluate in Workspace" button to start reviewing the claims and evidence.',
    primaryLabel: "Got it →",
  },

  // ── Workspace ────────────────────────────────────────────────────────────────
  {
    page: "workspace",
    target: ".workspace-header",
    title: "You're in the Workspace! 💪",
    content:
      "This is where evidence meets claims. Three columns work together:\n\n• Left — Case Claims extracted from your text\n• Center — Relationship Map (connections between claims)\n• Right — Sources (evidence sources)\n\nLet's walk through the new workflow.",
    primaryLabel: "Show me →",
  },
  {
    page: "workspace",
    target: ".workspace-claims",
    title: "Case Claims — Left Column",
    content:
      "These are the factual claims the AI extracted from your text.\n\nEach claim card has quick actions:\n• ✏️ Edit the claim text\n• 🔍 Verify claim externally\n• 🗑️ Delete the claim\n\n👉 Click the BIG BUTTON with the claim text to open the claim panel!",
    primaryLabel: "Next →",
  },
  {
    page: "workspace",
    title: "Case Claim Panel — The Hub 🎯",
    content:
      "When you click a case claim button, a panel opens showing:\n\n• The claim text at the top\n• Verified links (solid lines) — human-verified connections\n• AI suggested links (dotted lines) — need human verification\n• Quick Scan — search existing AI sources for relevant claims\n• Deep Scan — search ALL sources for relevant claims\n\nLet's understand the difference between dotted and solid lines...",
    primaryLabel: "Tell me more →",
  },
  {
    page: "workspace",
    title: "Dotted vs Solid Lines ⚡",
    content:
      "This is KEY to understanding the Verimeter score:\n\n━━━ Solid Lines = Human Verified ✅\n• These count toward the Verimeter score\n• A human has confirmed the relevance and stance\n• Trustworthy evidence\n\n┄┄┄ Dotted Lines = AI Suggestions 🤖\n• These DON'T count for the score (yet!)\n• Need human verification to become solid\n• Click 'Create Link' button to verify and promote to solid",
    primaryLabel: "Got it! →",
  },
  {
    page: "workspace",
    target: ".workspace-references",
    title: "Sources — Right Column",
    content:
      "These are web pages and articles found by the evidence engine that may support or contradict your claims.\n\n• Click a source card to see its extracted claims\n• Right-click to open in new tab\n• Use '+ Add Source' to add your own sources\n\nThe AI has already scanned these for relevant claims!",
    primaryLabel: "Next →",
  },
  {
    page: "workspace",
    title: "Quick Scan vs Deep Scan 🔍",
    content:
      "Two ways to find more evidence:\n\n⚡ Quick Scan\n• Searches only AI-linked sources\n• Fast (~10 seconds)\n• Good for checking existing evidence\n\n🌊 Deep Scan\n• Searches ALL sources in the list\n• Slower (~30-60 seconds)\n• Finds connections AI might have missed\n\nBoth show results as dotted-line suggestions you can verify!",
    primaryLabel: "Makes sense! →",
  },
  {
    page: "workspace",
    title: "Verifying AI Suggestions 🎓",
    content:
      "When you see dotted-line AI suggestions:\n\n1. Read the suggested source claim\n2. Read your case claim\n3. Decide if they're actually related\n4. Click 'Create Link' button\n5. Set the relationship:\n   • Supports (green) ✅\n   • Refutes (red) ⛔\n   • Nuanced (yellow) ⚖️\n6. Add optional notes\n7. Submit!\n\nThe dotted line becomes solid and counts toward the Verimeter! 🎉",
    primaryLabel: "Ready to try! →",
  },
  {
    page: "workspace",
    title: "You're All Set! 🚀",
    content:
      "You now know how to:\n\n✅ Click case claim buttons to open the claim panel\n✅ Distinguish between dotted (AI) and solid (verified) links\n✅ Use Quick Scan for fast results\n✅ Use Deep Scan for thorough analysis\n✅ Verify AI suggestions to build the Verimeter score\n\nStart clicking claims and verifying evidence!\n\nThe more you verify, the more accurate the truth score becomes. 💪",
    primaryLabel: "Finish tour",
    specialAction: "end",
  },
];

const TOTAL_STEPS = STEPS.length;

// ─── Card geometry ─────────────────────────────────────────────────────────────
const CARD_W = 360;
const CARD_H_EST = 260;
const ARROW = 14;
const GAP = 20; // Increased from 12 to prevent covering buttons

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

  // For submit buttons and important CTAs, prefer positioning above to avoid covering
  const preferAbove = selector.includes("submit") || selector.includes("button");

  if (preferAbove) {
    // ── try above first ──
    if (r.top - GAP - ARROW - CARD_H_EST > 0) {
      const left = clampLeft(cx - CARD_W / 2);
      return {
        top: r.top - GAP - ARROW - CARD_H_EST,
        left,
        arrowDir: "bottom",
        arrowAlong: Math.max(
          ARROW + 2,
          Math.min(cx - left - ARROW, CARD_W - ARROW * 2 - 2),
        ),
      };
    }
    // ── try below if above doesn't fit ──
    if (r.bottom + GAP + ARROW + CARD_H_EST < vh) {
      const left = clampLeft(cx - CARD_W / 2);
      return {
        top: r.bottom + GAP + ARROW,
        left,
        arrowDir: "top",
        arrowAlong: Math.max(
          ARROW + 2,
          Math.min(cx - left - ARROW, CARD_W - ARROW * 2 - 2),
        ),
      };
    }
  } else {
    // ── try below ──
    if (r.bottom + GAP + ARROW + CARD_H_EST < vh) {
      const left = clampLeft(cx - CARD_W / 2);
      return {
        top: r.bottom + GAP + ARROW,
        left,
        arrowDir: "top",
        arrowAlong: Math.max(
          ARROW + 2,
          Math.min(cx - left - ARROW, CARD_W - ARROW * 2 - 2),
        ),
      };
    }
    // ── try above ──
    if (r.top - GAP - ARROW - CARD_H_EST > 0) {
      const left = clampLeft(cx - CARD_W / 2);
      return {
        top: r.top - GAP - ARROW - CARD_H_EST,
        left,
        arrowDir: "bottom",
        arrowAlong: Math.max(
          ARROW + 2,
          Math.min(cx - left - ARROW, CARD_W - ARROW * 2 - 2),
        ),
      };
    }
  }
  // ── try right ──
  if (r.right + GAP + ARROW + CARD_W < vw) {
    const top = clampTop(cy - CARD_H_EST / 2);
    return {
      top,
      left: r.right + GAP + ARROW,
      arrowDir: "left",
      arrowAlong: Math.max(
        ARROW + 2,
        Math.min(cy - top - ARROW, CARD_H_EST - ARROW * 2 - 2),
      ),
    };
  }
  // ── fallback left ──
  const top = clampTop(cy - CARD_H_EST / 2);
  return {
    top,
    left: Math.max(8, r.left - GAP - ARROW - CARD_W),
    arrowDir: "right",
    arrowAlong: Math.max(
      ARROW + 2,
      Math.min(cy - top - ARROW, CARD_H_EST - ARROW * 2 - 2),
    ),
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
  document
    .querySelectorAll(".tt-tour-highlight")
    .forEach((el) => el.classList.remove("tt-tour-highlight"));
  if (selector) {
    const el = document.querySelector(selector);
    if (el) el.classList.add("tt-tour-highlight");
  }
}

// ─── Waiting message helper ────────────────────────────────────────────────────
function waitingMessage(waitingFor: string): string {
  switch (waitingFor) {
    case "submit":
      return "⏳ Analyzing your text… (1-3 minutes)";
    case "ref-modal":
      return "👉 Click any source card on the right to continue";
    case "link-overlay":
      return "🖱️ Drag a source claim onto a case claim to continue";
    case "task-assignment":
      return "👆 Click any case card to assign it to yourself";
    default:
      return "⏳ Waiting…";
  }
}

// ─── PlatformTour ─────────────────────────────────────────────────────────────
export const PlatformTour: React.FC = () => {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  // null = not waiting; "submit" | "ref-modal" | "link-overlay" = waiting for user action
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [cardPos, setCardPos] = useState<CardPos | null>(null);
  const [offerAutoSubmit, setOfferAutoSubmit] = useState(false);
  const posTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const currentPage = (() => {
    if (location.pathname.includes("/dashboard")) return "dashboard";
    if (location.pathname.includes("/textpad")) return "textpad";
    if (location.pathname.includes("/workspace")) return "workspace";
    if (location.pathname.includes("/extension")) return "extension";
    if (location.pathname.includes("/tasks")) return "tasks";
    if (location.pathname.includes("/tutorials")) return "tutorials";
    return "dashboard";
  })();

  // ─── Core helpers (defined early so useEffects can reference them) ─────────
  const goToStep = useCallback((idx: number) => {
    localStorage.setItem(TOUR_STEP_KEY, String(idx));
    setStepIndex(idx);
    setOfferAutoSubmit(false);
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
  }, []);

  const startTour = useCallback(() => {
    localStorage.setItem(TOUR_ACTIVE_KEY, "true");
    localStorage.setItem(TOUR_STEP_KEY, "0");
    setWaitingFor(null);
    setStepIndex(0);
    setActive(true);
    // Navigation will be handled by the auto-navigate useEffect
  }, []);

  // ── Recompute card position ────────────────────────────────────────────────
  const refreshPos = useCallback(() => {
    if (!active) return;
    const step = STEPS[stepIndex];
    if (!step || step.page !== currentPage) {
      setCardPos(null);
      return;
    }

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
    if (
      !hasSeenTour &&
      !isAlreadyActive &&
      location.pathname.includes("/dashboard")
    ) {
      // Longer delay (1500ms) to ensure dashboard fully renders before tour starts
      console.log(
        "🎯 PlatformTour: New user detected, starting tour in 1.5s...",
      );
      const t = setTimeout(() => {
        console.log("🚀 PlatformTour: Starting tour now!");
        startTour();
      }, 1500);
      return () => clearTimeout(t);
    }
    // Tour not needed - user has already seen it
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Detect TextPad submission complete (URL gains ?contentId) ─────────────
  useEffect(() => {
    if (
      (active || waitingFor === "submit") &&
      location.search.includes("contentId")
    ) {
      // After submission, advance to next step (works regardless of current step index)
      if (waitingFor === "submit") {
        setWaitingFor(null);
        goToStep(stepIndex + 1);
      }
    }
  }, [location.search]); // eslint-disable-line

  // ── Poll for Reference Claims Modal opening ────────────────────────────────
  useEffect(() => {
    if (waitingFor !== "ref-modal") return;
    const interval = setInterval(() => {
      // .mr-modal is the className on DraggableReferenceClaimsModal's Box
      if (document.querySelector(".mr-modal")) {
        console.log("✅ [Tour] Reference modal detected - advancing!");
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
        console.log("✅ [Tour] Claim link overlay detected - advancing!");
        setWaitingFor(null);
        goToStep(stepIndex + 1);
      }
    }, 400);
    return () => clearInterval(interval);
  }, [waitingFor, stepIndex]); // eslint-disable-line

  // ── Detect task card click (task assignment) ──────────────────────────────
  useEffect(() => {
    if (waitingFor !== "task-assignment") return;

    const handleTaskClick = (e: Event) => {
      console.log("✅ [Tour] Task card clicked - user is selecting a task!");
      // Don't prevent default - let the task selection happen
      // After a short delay, navigate back to dashboard
      setTimeout(() => {
        console.log(
          "✅ [Tour] Navigating back to dashboard to show assigned task",
        );
        setWaitingFor(null);
        navigate("/dashboard");
        goToStep(stepIndex + 1);
      }, 1000);
    };

    // Listen for clicks on any task card
    const taskCards = document.querySelectorAll(".mr-card");
    taskCards.forEach((card) => {
      card.addEventListener("click", handleTaskClick, { once: true });
    });

    return () => {
      taskCards.forEach((card) => {
        card.removeEventListener("click", handleTaskClick);
      });
    };
  }, [waitingFor, stepIndex, navigate, goToStep]); // eslint-disable-line

  // ── Highlight target element when step changes ────────────────────────────
  useEffect(() => {
    if (!active || waitingFor) {
      applyHighlight(undefined);
      return;
    }
    const step = STEPS[stepIndex];
    const t = setTimeout(
      () =>
        applyHighlight(step?.page === currentPage ? step?.target : undefined),
      350,
    );
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

  // ── Auto-navigate to the correct page for the current step ────────────────
  useEffect(() => {
    if (!active) return;
    const step = STEPS[stepIndex];
    if (step && step.page !== currentPage) {
      console.log(
        `🧭 [Tour] Auto-navigating from ${currentPage} to ${step.page}`,
      );
      const pageMap: Record<string, string> = {
        dashboard: "/dashboard",
        textpad: "/textpad",
        workspace: "/workspace",
        extension: "/extension",
        tasks: "/tasks",
        tutorials: "/tutorials",
      };
      const targetPath = pageMap[step.page];
      if (targetPath) {
        navigate(targetPath);
      }
    }
  }, [active, stepIndex, currentPage, navigate]);

  // ── Detect clicks on highlighted elements ──────────────────────────────────
  useEffect(() => {
    if (!active || waitingFor) return;
    const step = STEPS[stepIndex];
    if (!step?.target) return;

    const targetSelector = step.target; // Store in variable for closure
    const element = document.querySelector(targetSelector);
    if (!element) return;

    const handleClick = (e: Event) => {
      console.log(`✅ [Tour] User clicked target element: ${targetSelector}`);

      // For submit button, move to waiting state
      if (targetSelector === ".textpad-submit") {
        console.log("✅ [Tour] User clicked submit - entering wait state");
        setOfferAutoSubmit(false);
        setWaitingFor("submit");
        applyHighlight(undefined);
        if (autoSubmitTimerRef.current) {
          clearTimeout(autoSubmitTimerRef.current);
          autoSubmitTimerRef.current = null;
        }
      }
      // For download button, let the click happen and advance
      else if (targetSelector.includes("extension.zip")) {
        setTimeout(() => {
          console.log("✅ [Tour] Download initiated - advancing!");
          goToStep(stepIndex + 1);
        }, 500);
      }
      // For other interactive elements, advance immediately
      else {
        goToStep(stepIndex + 1);
      }
    };

    element.addEventListener("click", handleClick);
    return () => element.removeEventListener("click", handleClick);
  }, [active, stepIndex, waitingFor, goToStep]);

  // ── Monitor submit button and offer auto-click after delay ─────────────────
  useEffect(() => {
    // Clear any existing timer
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
    setOfferAutoSubmit(false);

    if (!active || waitingFor) return;
    const step = STEPS[stepIndex];

    // Check if this is the submit step
    if (
      step?.specialAction === "wait-for-submit" &&
      step?.target === ".textpad-submit"
    ) {
      console.log("👀 [Tour] Monitoring submit button...");

      // After 8 seconds, offer to auto-click
      autoSubmitTimerRef.current = setTimeout(() => {
        console.log("⏰ [Tour] 8 seconds passed, offering auto-submit");
        setOfferAutoSubmit(true);
      }, 8000);
    }

    return () => {
      if (autoSubmitTimerRef.current) {
        clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
    };
  }, [active, stepIndex, waitingFor]);

  const endTour = useCallback(() => {
    applyHighlight(undefined);
    localStorage.removeItem(TOUR_ACTIVE_KEY);
    localStorage.removeItem(TOUR_STEP_KEY);
    localStorage.setItem("tourCompleted", "true");
    setWaitingFor(null);
    setActive(false);
    setCardPos(null);
    setOfferAutoSubmit(false);
    if (autoSubmitTimerRef.current) {
      clearTimeout(autoSubmitTimerRef.current);
      autoSubmitTimerRef.current = null;
    }
  }, []);

  const handlePrimary = useCallback(() => {
    const step = STEPS[stepIndex];
    if (!step) return;

    switch (step.specialAction) {
      case "branch-full-tutorial":
        // Jump to step 10 (full tutorial starts after extension branch)
        // Steps 0-1: intro+branch, 2-9: extension branch, 10+: full tutorial
        goToStep(10);
        break;
      case "branch-extension":
        // Jump to step 2 (extension installation starts)
        navigate("/extension");
        goToStep(2);
        break;
      case "navigate-extension-page":
        goToStep(stepIndex + 1);
        navigate("/extension");
        break;
      case "navigate-textpad":
        goToStep(stepIndex + 1);
        navigate("/textpad");
        break;
      case "paste-title":
        window.dispatchEvent(
          new CustomEvent("tourFillTitle", { detail: { title: DEMO_TITLE } }),
        );
        goToStep(stepIndex + 1);
        break;
      case "paste-text":
        window.dispatchEvent(
          new CustomEvent("tourFillText", { detail: { text: DEMO_TEXT } }),
        );
        goToStep(stepIndex + 1);
        break;
      case "wait-for-submit":
        // Always click the submit button when "Got it!" is clicked
        const submitBtn = document.querySelector(
          ".textpad-submit",
        ) as HTMLButtonElement;
        if (submitBtn) {
          console.log("🤖 [Tour] Auto-clicking submit button for user");
          submitBtn.click();
          setOfferAutoSubmit(false);
          setWaitingFor("submit");
          applyHighlight(undefined);
        } else {
          // If button not found, just enter waiting state
          setWaitingFor("submit");
          applyHighlight(undefined);
        }
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
      case "wait-for-task-assignment":
        // Collapse to waiting indicator — auto-advances when task is assigned
        setWaitingFor("task-assignment");
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
    if (step?.secondaryLabel === "Skip tour") {
      endTour();
    } else if (step?.secondaryLabel === "2. Video Gallery →") {
      // Navigate to tutorial gallery and end tour
      navigate("/tutorials");
      endTour();
    } else if (step?.secondaryLabel === "B. Install Extension →") {
      // Branch to extension installation and navigate to page
      navigate("/extension");
      goToStep(2); // Jump to step 2 (extension intro)
    } else if (step?.secondaryLabel === "Skip to dashboard") {
      // Return to dashboard and end tour
      navigate("/dashboard");
      endTour();
    } else if (step?.secondaryLabel === "Copy chrome://extensions") {
      // Copy chrome://extensions to clipboard
      navigator.clipboard
        .writeText("chrome://extensions")
        .then(() => {
          console.log("✅ Copied chrome://extensions to clipboard");
          // Could show a toast notification here
        })
        .catch((err) => {
          console.error("Failed to copy:", err);
        });
      // Don't advance - let them stay on this step
    } else if (
      step?.secondaryLabel === "I'll type my own →" ||
      step?.secondaryLabel === "I'll enter my own →"
    ) {
      // Skip auto-fill, just advance
      goToStep(stepIndex + 1);
    } else {
      goToStep(stepIndex + 1);
    }
  }, [stepIndex, goToStep, endTour, navigate]);

  const handleTertiary = useCallback(() => {
    const step = STEPS[stepIndex];
    if (step?.tertiaryLabel === "3. Install Extension →") {
      // Branch to extension installation and navigate to page
      navigate("/extension");
      goToStep(2); // Jump to step 2 (extension intro)
    } else {
      goToStep(stepIndex + 1);
    }
  }, [stepIndex, goToStep, navigate]);

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
          <Text fontSize="sm" fontWeight="medium">
            {waitingMessage(waitingFor)}
          </Text>
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
          <Text
            fontSize="sm"
            color="gray.600"
            whiteSpace="pre-line"
            lineHeight="1.7"
          >
            {step.content}
          </Text>
          {offerAutoSubmit && step.specialAction === "wait-for-submit" && (
            <Box
              mt={3}
              p={2}
              bg="green.50"
              borderRadius="md"
              border="1px solid"
              borderColor="green.200"
            >
              <Text fontSize="xs" color="green.700" fontWeight="medium">
                💡 Time's up! Click the button below and I'll submit it for you!
              </Text>
            </Box>
          )}
        </Box>

        {/* Buttons */}
        <Box px={5} pb={4}>
          <VStack spacing={2} align="stretch">
            <Button
              colorScheme={
                offerAutoSubmit && step.specialAction === "wait-for-submit"
                  ? "green"
                  : "blue"
              }
              size="sm"
              onClick={handlePrimary}
              w="100%"
            >
              {offerAutoSubmit && step.specialAction === "wait-for-submit"
                ? "Submit Now!"
                : step.primaryLabel}
            </Button>
            {step.secondaryLabel && (
              <Button
                variant="ghost"
                size="sm"
                color="gray.500"
                onClick={handleSecondary}
                w="100%"
              >
                {step.secondaryLabel}
              </Button>
            )}
            {step.tertiaryLabel && (
              <Button
                variant="ghost"
                size="sm"
                color="gray.500"
                onClick={handleTertiary}
                w="100%"
              >
                {step.tertiaryLabel}
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
