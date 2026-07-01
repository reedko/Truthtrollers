import React, { useEffect, useState } from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import useTaskStore from "../store/useTaskStore";
import ClaimPairsDetail from "./ClaimPairsDetail";
import browser from "webextension-polyfill";
import { Task } from "../entities/Task";
import { isFacebookPost } from "../services/scrapeFacebookPost";

const BAR_HEIGHT = 44; // px — keep in sync with body padding-top below

const REACT_APP_EXTENSION_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_EXTENSION_URL) ||
  process.env.REACT_APP_EXTENSION_URL ||
  "https://localhost:3000";

interface ClaimPair {
  caseClaim: { claim_id: number; claim_text: string; publisher: string; url: string };
  sourceClaim: { claim_id: number; claim_text: string; publisher: string; url: string; relationship: string };
  verimeter_score: number;
}
interface ClaimPairsData {
  overall_verimeter: number;
  claim_pairs: ClaimPair[];
}

// ── Tiny glowing score bubble ─────────────────────────────────────────────
function ScoreBubble({ score }: { score: number }) {
  const color =
    score >= 0.25 ? "#00e676" : score <= -0.25 ? "#ff4d4d" : "#ffd700";
  const text = `${score >= 0 ? "+" : ""}${(score * 100).toFixed(0)}%`;
  return (
    <Box
      w="38px"
      h="38px"
      borderRadius="50%"
      border={`2px solid ${color}`}
      boxShadow={`0 0 10px ${color}66, inset 0 0 6px ${color}22`}
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
    >
      <Text
        fontSize="9px"
        fontWeight="800"
        color={color}
        fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
        letterSpacing="-0.5px"
        lineHeight="1"
      >
        {text}
      </Text>
    </Box>
  );
}

// ── Compact stat: tiny label + bold value side-by-side ────────────────────
function Stat({
  label,
  value,
  color,
  labelColor = "rgba(160,185,210,0.55)",
  hoverBg = "rgba(0,162,255,0.08)",
  onClick,
  chevron,
}: {
  label: string;
  value: string | number;
  color: string;
  labelColor?: string;
  hoverBg?: string;
  onClick?: () => void;
  chevron?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <Box
      as={onClick ? "button" : "div"}
      onClick={onClick}
      onMouseEnter={() => onClick && setHov(true)}
      onMouseLeave={() => onClick && setHov(false)}
      display="flex"
      alignItems="center"
      gap="5px"
      px="10px"
      h="100%"
      flexShrink={0}
      cursor={onClick ? "pointer" : "default"}
      background={hov ? hoverBg : "transparent"}
      transition="background 0.15s"
    >
      <Text
        fontSize="8px"
        color={labelColor}
        letterSpacing="1.5px"
        textTransform="uppercase"
        fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
      >
        {label}
      </Text>
      <Text
        fontSize="15px"
        fontWeight="700"
        color={color}
        fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
        lineHeight="1"
      >
        {value}
      </Text>
      {chevron && (
        <Text fontSize="10px" color={color} lineHeight="1" mt="1px">
          {chevron}
        </Text>
      )}
    </Box>
  );
}

// ── Thin vertical divider ─────────────────────────────────────────────────
function Sep({ color = "rgba(0,162,255,0.18)" }: { color?: string }) {
  return <Box w="1px" h="22px" background={color} flexShrink={0} />;
}

// ── Main component ────────────────────────────────────────────────────────
const TaskBar: React.FC = () => {
  const { task, setTask } = useTaskStore();
  const [visible, setVisible] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(false);

  // Load task from storage on mount
  useEffect(() => {
    browser.storage.local
      .get("task")
      .then((data: { [key: string]: unknown }) => {
        const stored = data.task as Task | undefined;
        if (stored) { setTask(stored); setVisible(true); }
      })
      .catch((err: unknown) => console.error("[TaskBar] storage get failed:", err));
  }, [setTask]);

  // Live-sync when background updates storage
  useEffect(() => {
    const handleChange = (
      changes: { [key: string]: browser.Storage.StorageChange },
      area: string
    ) => {
      if (area !== "local" || !changes.task) return;
      const newTask = changes.task.newValue as Task | undefined;
      if (newTask) { setTask(newTask); setVisible(true); }
      else setVisible(false);
    };
    browser.storage.onChanged.addListener(handleChange);
    return () => browser.storage.onChanged.removeListener(handleChange);
  }, [setTask]);

  useEffect(() => {
    if (!task?.content_id) return;
    let cancelled = false;

    (async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          action: "fetchClaimScores",
          contentId: task.content_id,
        })) as {
          success?: boolean;
          verimeterScore?: number;
          mode?: string;
          ratingCounts?: unknown;
        };

        if (!response?.success || cancelled) return;

        const nextTask = {
          ...(useTaskStore.getState().task || task),
          verimeter_score: Number(response.verimeterScore) || 0,
          verimeter_score_mode: response.mode,
          rating_counts: response.ratingCounts,
        };
        setTask(nextTask as Task);
        await browser.storage.local.set({ task: nextTask });
      } catch (err) {
        console.warn("[TaskBar] Failed to refresh verimeter score:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [task?.content_id, setTask]);


  if (!visible || !task) return null;

  // Fixed MR palette — backdrop-filter naturally picks up page colors underneath
  const borderClr = "rgba(0, 162, 255, 0.5)";
  const glowClr   = "rgba(0, 162, 255, 0.18)";
  const textColor = "#00a2ff";
  const subText   = "rgba(160, 185, 210, 0.6)";

  const claimPairsData = (task as any).claim_pairs as ClaimPairsData | null;
  const pairs = claimPairsData?.claim_pairs ?? [];

  const refuted  = pairs.filter(p => p.sourceClaim.relationship?.toLowerCase().includes("refut")).length;
  const supported = pairs.filter(p => p.sourceClaim.relationship?.toLowerCase().includes("support")).length;
  const nuanced  = pairs.filter(p => p.sourceClaim.relationship?.toLowerCase().includes("nuanc")).length;

  const publishers = new Set(
    [...pairs.map(p => p.caseClaim.publisher), ...pairs.map(p => p.sourceClaim.publisher)].filter(Boolean)
  );
  const sourceDisplay = publishers.size === 0 ? "—" : publishers.size > 99 ? "99+" : String(publishers.size);

  const score = task.verimeter_score ?? 0;
  const scoreColor = score >= 0.25 ? "#00e676" : score <= -0.25 ? "#ff4d4d" : "#ffd700";

  const rawName = isFacebookPost(task.url ?? "") ? "Facebook Post" : task.content_name ?? "Unknown";
  const displayName = rawName.length > 28 ? rawName.slice(0, 28) + "…" : rawName;

  const handleDiscuss = () => {
    browser.runtime.sendMessage({
      fn: "openDiscussionTab",
      url: `${REACT_APP_EXTENSION_URL}/discussion/${task.content_id}`,
    });
  };

  const handleClose = () => {
    setVisible(false);
    const root = document.getElementById("tt-popup-host");
    if (root) root.style.display = "none";
  };

  return (
    <>
      {/* ── Bar ── */}
      <Box
        position="fixed"
        top="0"
        left="0"
        width="100vw"
        height={`${BAR_HEIGHT}px`}
        zIndex={2147483647}
        backgroundColor="transparent"
        sx={{
          // background-color must be transparent (see above) so Chakra's grey
          // dark-mode default doesn't show through the semi-transparent gradients.
          // Layers: scan lines on top (listed first), blue tint below (listed second).
          // backdrop-filter blurs the page underneath and tints it with the page's own hues.
          backgroundImage: `
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(0, 140, 255, 0.18) 2px,
              rgba(0, 140, 255, 0.18) 4px
            ),
            linear-gradient(
              135deg,
              rgba(0, 20, 70, 0.72),
              rgba(5, 35, 90, 0.65)
            )
          `,
        }}
        backdropFilter="blur(18px) saturate(2)"
        borderBottom={`1px solid ${borderClr}`}
        boxShadow={`0 0 30px ${glowClr}, 0 4px 20px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.15)`}
      >
        {/* Left cyan accent strip — same as TaskCard */}
        <Box
          position="absolute"
          left={0}
          top={0}
          width="60px"
          height="100%"
          background="linear-gradient(90deg, rgba(0, 217, 255, 0.45) 0%, rgba(0, 217, 255, 0.18) 40%, transparent 100%)"
          pointerEvents="none"
        />
        <HStack spacing={0} height="100%" align="center" px={2} position="relative" zIndex={1}>
          {/* Score bubble */}
          <Box px={2} flexShrink={0}>
            <ScoreBubble score={score} />
          </Box>

          {/* Content name */}
          <Text
            fontSize="10px"
            fontWeight="600"
            color={textColor}
            letterSpacing="1px"
            textTransform="uppercase"
            fontFamily="Futura, 'Century Gothic', 'Avenir Next', sans-serif"
            noOfLines={1}
            maxW="180px"
            flexShrink={0}
            px={1}
          >
            {displayName}
          </Text>

          <Sep color={borderClr} />
          <Stat label="Verimeter" value={`${score >= 0 ? "+" : ""}${(score * 100).toFixed(0)}%`} color={scoreColor} labelColor={subText} hoverBg={glowClr} />
          <Sep color={borderClr} />
          <Stat label="Refuted"   value={refuted}   color="#ff4d4d" labelColor={subText} hoverBg={glowClr} />
          <Sep color={borderClr} />
          <Stat label="Supported" value={supported} color="#00e676" labelColor={subText} hoverBg={glowClr} />
          <Sep color={borderClr} />
          <Stat label="Nuanced"   value={nuanced}   color="#ffd700" labelColor={subText} hoverBg={glowClr} />
          <Sep color={borderClr} />
          <Stat
            label="Claims"
            value={pairs.length}
            color={textColor}
            labelColor={subText}
            hoverBg={glowClr}
            chevron={pairs.length > 0 ? (claimsOpen ? "∧" : "∨") : undefined}
            onClick={pairs.length > 0 ? () => setClaimsOpen(o => !o) : undefined}
          />
          <Sep color={borderClr} />
          <Stat label="Sources" value={sourceDisplay} color="#94a3b8" labelColor={subText} hoverBg={glowClr} />

          {/* Spacer */}
          <Box flex={1} />

          {/* Action buttons */}
          <HStack spacing={1} px={2} flexShrink={0}>
            <Box
              as="button"
              onClick={handleDiscuss}
              title="Discuss"
              px={2}
              py={1}
              borderRadius="4px"
              border="1px solid rgba(0,162,255,0.3)"
              background="rgba(0,162,255,0.08)"
              cursor="pointer"
              display="flex"
              alignItems="center"
              sx={{ "&:hover": { background: "rgba(0,162,255,0.2)" } }}
              transition="background 0.15s"
            >
              <Text fontSize="14px" lineHeight="1">💬</Text>
            </Box>
            <Box
              as="button"
              onClick={handleClose}
              title="Close"
              px={2}
              py={1}
              borderRadius="4px"
              border="1px solid rgba(200,200,220,0.2)"
              background="rgba(255,255,255,0.04)"
              cursor="pointer"
              display="flex"
              alignItems="center"
              sx={{ "&:hover": { background: "rgba(255,255,255,0.1)" } }}
              transition="background 0.15s"
            >
              <Text color="rgba(200,200,220,0.7)" fontSize="11px" fontWeight="600" lineHeight="1">✕</Text>
            </Box>
          </HStack>
        </HStack>
      </Box>

      {/* ── Expandable claims panel drops below bar ── */}
      {claimsOpen && claimPairsData && (
        <Box
          position="fixed"
          top={`${BAR_HEIGHT}px`}
          left="0"
          width="100vw"
          zIndex={2147483646}
          backgroundColor="transparent"
          sx={{
            backgroundImage: `
              repeating-linear-gradient(
                0deg,
                transparent,
                transparent 2px,
                rgba(0, 140, 255, 0.10) 2px,
                rgba(0, 140, 255, 0.10) 4px
              ),
              linear-gradient(135deg, rgba(0, 20, 70, 0.95), rgba(5, 35, 90, 0.92))
            `,
          }}
          backdropFilter="blur(20px)"
          borderBottom="1px solid rgba(0, 162, 255, 0.4)"
          boxShadow="0 0 40px rgba(0, 162, 255, 0.2), 0 12px 40px rgba(0, 0, 0, 0.7)"
          maxH="60vh"
          overflowY="auto"
        >
          <ClaimPairsDetail claimPairsData={claimPairsData} />
        </Box>
      )}
    </>
  );
};

export default TaskBar;
