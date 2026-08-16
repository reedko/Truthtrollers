/**
 * SourceCrest
 *
 * Shield-shaped source mark. Communicates source type + reliability at a glance.
 * Embeds anywhere inline; graph nodes use getSourceCrestDataUri() from sourceCrestUri.ts.
 *
 * Do NOT rename to "Badge" — this is a SourceCrest throughout.
 */

import React, { useId } from "react";
import { Tooltip } from "@chakra-ui/react";
import { SourceType, Reliability } from "../utils/normalizeSourceProfile";
import {
  buildSourceCrestSashStops,
  clampAlignmentRiskScore,
  sourceCrestMarkerFontSize,
  parseAdmiraltyCode,
  ADMIRALTY_COLORS,
  ADMIRALTY_LETTER_LABEL,
  ADMIRALTY_NUMBER_LABEL,
  SOURCE_CREST_SHIELD as SHIELD,
  SOURCE_CREST_BEVEL as BEVEL,
  SOURCE_CREST_SHINE as SHINE,
  SOURCE_CREST_SASH as SASH,
  type SourceAlignment,
} from "../utils/sourceCrestVisual";

export type { SourceAlignment };

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
  alignment?: SourceAlignment | null;
  cacheStatus?: "fresh" | "cached";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showLabel?: boolean;
  active?: boolean;
  onClick?: (e?: React.MouseEvent) => void;
}

const SourceCrest: React.FC<SourceCrestProps> = ({
  publisherName,
  sourceType = "unknown",
  reliability = "unchecked",
  score,
  admiraltyCode,
  alignment,
  cacheStatus = "fresh",
  size = "sm",
  showLabel = false,
  active = false,
  onClick,
}) => {
  const w = SIZE_PX[size];
  const h = Math.round(w * 1.25);
  const reactId = useId().replace(/:/g, "");

  // Always Admiralty mode. F and 6 are legacy DB values that display as Ø.
  // No code → ØØ (not yet assessed).
  const { letter: admLetter, number: admNumber } = parseAdmiraltyCode(admiraltyCode);

  const c = ADMIRALTY_COLORS[admLetter] ?? ADMIRALTY_COLORS["Ø"];

  // A sash is a verified alignment/provenance assertion. Never infer one from
  // sourceType alone — source type is heuristic and can be inherited incorrectly.
  // SOC sash is shown only when explicitly passed via alignment.marker === "SOC".
  const effectiveAlignment: SourceAlignment | null = alignment ?? null;
  const showSocialSash = effectiveAlignment?.marker === "SOC";
  const hasSash = !!effectiveAlignment;

  const shieldTopText = admLetter;
  const shieldBotText = admNumber;
  const uid = `sc-${reactId}-${admLetter}${admNumber}-${size}`;
  const riskScore = clampAlignmentRiskScore(effectiveAlignment?.riskScore);
  const sashStops = buildSourceCrestSashStops(riskScore);
  const alignmentMarker = effectiveAlignment?.marker ?? "";
  const ribbonText = alignmentMarker;
  const ribbonFontSize = sourceCrestMarkerFontSize(ribbonText);

  const tooltipParts = [
    publisherName,
    `${admLetter}${admNumber} · ${ADMIRALTY_LETTER_LABEL[admLetter] ?? ""} · ${ADMIRALTY_NUMBER_LABEL[admNumber] ?? ""}`,
    showSocialSash ? "SOC · Social / community source — admiralty rating reflects entity, not platform" : null,
    effectiveAlignment ? `${effectiveAlignment.marker} · ${effectiveAlignment.label}${effectiveAlignment.degree ? ` · ${effectiveAlignment.degree} alignment risk` : ""}${riskScore == null ? "" : ` (${Math.round(riskScore)}/100)`}` : null,
    effectiveAlignment?.explanation,
    cacheStatus === "cached" ? "Cached publisher-level SourceCrest" : null,
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
          ? `drop-shadow(0 0 ${Math.round(w * 0.35)}px ${c.glow})`
          : "none",
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
        <linearGradient id={`${uid}-risk`} x1="0%" y1="0%" x2="100%" y2="0%">
          {sashStops.map((stop, index) => (
            <stop key={`${stop.offset}-${index}`} offset={`${stop.offset}%`} stopColor={stop.color}/>
          ))}
        </linearGradient>
        <linearGradient id={`${uid}-soc`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4C1D95"/>
          <stop offset="100%" stopColor="#7C3AED"/>
        </linearGradient>
        <clipPath id={`${uid}-shield-clip`}><path d={SHIELD}/></clipPath>
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

        {/* Top shine band. Cached publisher-level crests omit the gleam as a subtle stale/cache marker. */}
        {cacheStatus !== "cached" && <path d={SHINE} fill="rgba(255,255,255,0.09)"/>}

        {/* Outer rim accent */}
        <path d={SHIELD} fill="none" stroke={c.rim} strokeWidth="0.6" opacity="0.45"/>

        {/* Admiralty letter */}
        <text
          x="32"
          y={hasSash ? "20.5" : "34"}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={hasSash ? "20" : "22"}
          fontWeight="900"
          fontFamily="system-ui, -apple-system, sans-serif"
          fill="rgba(255,255,255,0.95)"
          letterSpacing="-0.5"
        >
          {shieldTopText}
        </text>

        {/* Alignment sash — risk-colored for IND/GOV/CORP etc, purple for SOC */}
        {effectiveAlignment && (
          <g aria-label={`${effectiveAlignment.marker} ${effectiveAlignment.label}${riskScore == null ? "" : ` ${Math.round(riskScore)} out of 100 material-interest risk`}`}
            clipPath={`url(#${uid}-shield-clip)`}>
            <path d={SASH} fill={showSocialSash ? `url(#${uid}-soc)` : `url(#${uid}-risk)`} opacity="0.94"/>
            <path d="M2,22 L62,42" fill="none" stroke="rgba(255,255,255,0.68)" strokeWidth="0.9"/>
            <path d="M2,47 L62,67" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="1.1"/>
            <path d="M3,24 L61,43" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.6"/>
            <text x="32" y="44.5" textAnchor="middle" dominantBaseline="middle"
              fontSize={ribbonFontSize}
              fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif"
              fill="#FFFFFF" stroke="rgba(2,6,23,0.82)" strokeWidth="1.8"
              paintOrder="stroke" strokeLinejoin="round" letterSpacing="0.35"
              transform="rotate(18 32 44.5)">
              {ribbonText}
            </text>
          </g>
        )}

        {/* Admiralty number */}
        <text
          x="32"
          y={hasSash ? "67" : "60"}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="15"
          fontWeight="700"
          fontFamily="system-ui, -apple-system, sans-serif"
          fill="rgba(255,255,255,0.85)"
        >
          {shieldBotText}
        </text>

        {/* Reassert the rim over the clipped sash so the shield stays crisp. */}
        <path d={SHIELD} fill="none" stroke={c.rim} strokeWidth="0.6" opacity="0.55"/>
      </g>
    </svg>
  );

  return (
    <Tooltip label={tooltipParts.join(" · ") || undefined} hasArrow placement="top" openDelay={500} closeDelay={0}>
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
