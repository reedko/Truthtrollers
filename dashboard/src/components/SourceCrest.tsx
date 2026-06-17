/**
 * SourceCrest
 *
 * Shield-shaped source mark. Communicates source type + reliability at a glance.
 * Embeds anywhere inline; graph nodes use getSourceCrestDataUri() from sourceCrestUri.ts.
 *
 * Do NOT rename to "Badge" — this is a SourceCrest throughout.
 */

import React from "react";
import { Tooltip } from "@chakra-ui/react";
import { SourceType, Reliability } from "../utils/normalizeSourceProfile";

// Admiralty letter A-E → color  green → teal → blue → amber → red  (Ø = gray)
const ADMIRALTY_COLORS: Record<string, { base: string; mid: string; glow: string; rim: string }> = {
  A:   { base: "#052E12", mid: "#16A34A", glow: "#22C55E", rim: "#86EFAC" }, // green
  B:   { base: "#0D2E2E", mid: "#0F766E", glow: "#14B8A6", rim: "#99F6E4" }, // teal
  C:   { base: "#061428", mid: "#1D6FA8", glow: "#00A2FF", rim: "#BAE6FD" }, // MR-blue (neutral center)
  D:   { base: "#4A2C07", mid: "#B7791F", glow: "#F6AD55", rim: "#FBD38D" }, // amber
  E:   { base: "#450A0A", mid: "#B91C1C", glow: "#EF4444", rim: "#FCA5A5" }, // red
  "Ø": { base: "#1A202C", mid: "#4A5568", glow: "#718096", rim: "#A0AEC0" }, // gray
};

const ADMIRALTY_LETTER_LABEL: Record<string, string> = {
  A:   "Highly reliable source",
  B:   "Usually reliable source",
  C:   "Mixed / context-dependent",
  D:   "Questionable source",
  E:   "Unreliable source",
  "Ø": "Source not yet assessed",
};

const ADMIRALTY_NUMBER_LABEL: Record<string, string> = {
  "1": "Confirmed by authoritative evidence",
  "2": "Probably true",
  "3": "Possibly true, needs corroboration",
  "4": "Doubtful / contested",
  "5": "Probably false",
  "Ø": "Claim not yet assessed",
};

// Width in px — height is always width × 1.25 (64:80 shield ratio)
const SIZE_PX: Record<"xs" | "sm" | "md" | "lg" | "xl", number> = {
  xs: 32,
  sm: 40,
  md: 56,
  lg: 80,
  xl: 112,
};

interface SourceCrestProps {
  publisherId?: number | string;
  publisherName?: string;
  sourceType?: SourceType;   // kept for callers; not used for display (always Admiralty)
  reliability?: Reliability; // kept for callers; not used for display
  score?: number;            // kept for callers; not used for display
  admiraltyCode?: string;    // A-E or Ø letter + 1-5 or Ø number, e.g. "D4", "AØ", "ØØ"
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showLabel?: boolean;
  active?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
}

const SHIELD = "M32,76 C13,67 5,55 5,43 L5,12 Q5,5 12,5 L52,5 Q59,5 59,12 L59,43 C59,55 51,67 32,76 Z";
const BEVEL  = "M32,74 C15,65 7,54 7,43 L7,13 Q7,7 13,7 L51,7 Q57,7 57,13 L57,43 C57,54 49,65 32,74 Z";
const SHINE  = "M14,8 Q14,7 20,7 L44,7 Q50,7 50,8 L50,22 Q32,28 14,22 Z";

const SourceCrest: React.FC<SourceCrestProps> = ({
  publisherName,
  sourceType = "unknown",
  reliability = "unchecked",
  score,
  admiraltyCode,
  size = "sm",
  showLabel = false,
  active = false,
  onClick,
}) => {
  const w = SIZE_PX[size];
  const h = Math.round(w * 1.25);

  // Always Admiralty mode. F and 6 are legacy DB values that display as Ø.
  // No code → ØØ (not yet assessed).
  const rawLetter = (admiraltyCode?.match(/^([A-EFØ])/u)?.[1] ?? "Ø");
  const rawNumber = (admiraltyCode?.match(/([1-6Ø])$/u)?.[1] ?? "Ø");
  const admLetter = rawLetter === "F" ? "Ø" : rawLetter;
  const admNumber = rawNumber === "6" ? "Ø" : rawNumber;

  const c = ADMIRALTY_COLORS[admLetter] ?? ADMIRALTY_COLORS["Ø"];

  const shieldTopText = admLetter;
  const shieldBotText = admNumber;
  const uid = `sc-${admLetter}${admNumber}-${size}`;

  const tooltipParts = [
    publisherName,
    `${admLetter}${admNumber} · ${ADMIRALTY_LETTER_LABEL[admLetter] ?? ""} · ${ADMIRALTY_NUMBER_LABEL[admNumber] ?? ""}`,
  ].filter(Boolean);

  const animId = `sc-pulse-${uid}`;

  const crest = (
    <svg
      width={w}
      height={h}
      viewBox="0 0 64 80"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        cursor: onClick ? "pointer" : "default",
        flexShrink: 0,
        lineHeight: 0,
        filter: active
          ? `drop-shadow(0 0 ${Math.round(w * 0.5)}px ${c.glow}) drop-shadow(0 0 ${Math.round(w * 0.25)}px ${c.rim})`
          : `drop-shadow(0 0 ${Math.round(w * 0.18)}px ${c.glow}88)`,
        transition: active ? "filter 0.1s" : "filter 0.6s",
      }}
      onClick={onClick}
      role={onClick ? "button" : "img"}
      aria-label={tooltipParts.join(" · ") || "Source crest"}
    >
      {active && (
        <style>{`
          @keyframes ${animId} {
            0%,100% { opacity: 1; }
            50%      { opacity: 0.55; }
          }
          #${animId}-group { animation: ${animId} 0.9s ease-in-out infinite; }
        `}</style>
      )}
      <defs>
        <radialGradient id={`${uid}-fill`} cx="50%" cy="38%" r="62%">
          <stop offset="0%"   stopColor={c.mid}/>
          <stop offset="100%" stopColor={c.base}/>
        </radialGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={c.glow} stopOpacity="0.45"/>
          <stop offset="100%" stopColor={c.glow} stopOpacity="0"/>
        </radialGradient>
      </defs>

      <g id={active ? `${animId}-group` : undefined}>
        {/* Outer glow halo */}
        <ellipse cx="32" cy="42" rx="32" ry="38" fill={`url(#${uid}-glow)`}/>

        {/* Shield body */}
        <path d={SHIELD}
          fill={`url(#${uid}-fill)`}
          stroke={c.glow}
          strokeWidth="1.5"
        />

        {/* Glass bevel */}
        <path d={BEVEL} fill="none" stroke="rgba(255,255,255,0.17)" strokeWidth="1"/>

        {/* Top shine band */}
        <path d={SHINE} fill="rgba(255,255,255,0.09)"/>

        {/* Outer rim accent */}
        <path d={SHIELD} fill="none" stroke={c.rim} strokeWidth="0.6" opacity="0.45"/>

        {/* Admiralty letter */}
        <text
          x="32"
          y="34"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="22"
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
          fill="rgba(255,255,255,0.95)"
          letterSpacing="-0.5"
        >
          {shieldTopText}
        </text>

        {/* Admiralty number */}
        <text
          x="32"
          y="60"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="15"
          fontWeight="700"
          fontFamily="system-ui, -apple-system, sans-serif"
          fill="rgba(255,255,255,0.85)"
        >
          {shieldBotText}
        </text>
      </g>
    </svg>
  );

  return (
    <Tooltip label={tooltipParts.join(" · ") || undefined} hasArrow placement="top" openDelay={150}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", lineHeight: 0 }}>
        {crest}
        {showLabel && (
          <span style={{ fontSize: "11px", color: c.glow, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap" }}>
            {admLetter}{admNumber}
          </span>
        )}
      </span>
    </Tooltip>
  );
};

export default SourceCrest;
