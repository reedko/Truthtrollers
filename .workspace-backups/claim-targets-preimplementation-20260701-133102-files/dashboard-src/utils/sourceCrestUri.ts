// Generates encoded SVG data URIs for SourceCrest images.
// Use getSourceCrestDataUri() for Cytoscape background-image values.
// Always Admiralty mode: letter A-E or Ø on top, number 1-5 or Ø on bottom.

import { buildSourceCrestSashStops, clampAlignmentRiskScore, sourceCrestMarkerFontSize } from "./sourceCrestVisual";

// green → teal → blue → amber → red  (Ø = gray)
const ADMIRALTY_COLORS: Record<string, { base: string; mid: string; glow: string; rim: string }> = {
  A:   { base: "#052E12", mid: "#16A34A", glow: "#22C55E", rim: "#86EFAC" }, // green
  B:   { base: "#0D2E2E", mid: "#0F766E", glow: "#14B8A6", rim: "#99F6E4" }, // teal
  C:   { base: "#061428", mid: "#1D6FA8", glow: "#00A2FF", rim: "#BAE6FD" }, // MR-blue (neutral center)
  D:   { base: "#4A2C07", mid: "#B7791F", glow: "#F6AD55", rim: "#FBD38D" }, // amber
  E:   { base: "#4A0D0D", mid: "#C53030", glow: "#FC4444", rim: "#FCA5A5" }, // red
  "Ø": { base: "#1A202C", mid: "#4A5568", glow: "#718096", rim: "#A0AEC0" }, // gray
};

const SHIELD = "M32,76 C13,67 5,55 5,43 L5,12 Q5,5 12,5 L52,5 Q59,5 59,12 L59,43 C59,55 51,67 32,76 Z";
const BEVEL  = "M32,74 C15,65 7,54 7,43 L7,13 Q7,7 13,7 L51,7 Q57,7 57,13 L57,43 C57,54 49,65 32,74 Z";
const SHINE  = "M14,8 Q14,7 20,7 L44,7 Q50,7 50,8 L50,22 Q32,28 14,22 Z";
const SASH   = "M2,22 L62,42 L62,67 L2,47 Z";

export interface SourceCrestUriAlignment {
  marker: string;
  riskScore?: number | null;
}

function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;",
  })[char] || char);
}

function buildSvg(admiraltyCode: string | undefined, sizePx: number, alignment?: SourceCrestUriAlignment | null): string {
  const rawLetter = admiraltyCode?.match(/^([A-EFØ])/u)?.[1] ?? "Ø";
  const rawNumber = admiraltyCode?.match(/([1-6Ø])$/u)?.[1] ?? "Ø";
  const letter = rawLetter === "F" ? "Ø" : rawLetter;
  const number = rawNumber === "6" ? "Ø" : rawNumber;
  const c = ADMIRALTY_COLORS[letter] ?? ADMIRALTY_COLORS["Ø"];
  const h = Math.round(sizePx * 1.25);
  const riskScore = clampAlignmentRiskScore(alignment?.riskScore);
  const sashStops = buildSourceCrestSashStops(riskScore)
    .map((stop) => `<stop offset="${stop.offset}%" stop-color="${stop.color}"/>`)
    .join("");
  const rawMarker = alignment?.marker || "";
  const marker = escapeSvgText(rawMarker);
  const markerFontSize = sourceCrestMarkerFontSize(rawMarker);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" width="${sizePx}" height="${h}">
  <defs>
    <radialGradient id="f" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${c.mid}"/>
      <stop offset="100%" stop-color="${c.base}"/>
    </radialGradient>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c.glow}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${c.glow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="d" x="-30%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="${c.glow}" flood-opacity="0.6"/>
    </filter>
    <linearGradient id="r" x1="0%" y1="0%" x2="100%" y2="0%">${sashStops}</linearGradient>
    <clipPath id="s"><path d="${SHIELD}"/></clipPath>
  </defs>
  <ellipse cx="32" cy="42" rx="32" ry="38" fill="url(#g)"/>
  <path d="${SHIELD}" fill="url(#f)" stroke="${c.glow}" stroke-width="1.5" filter="url(#d)"/>
  <path d="${BEVEL}"  fill="none"    stroke="rgba(255,255,255,0.17)" stroke-width="1"/>
  <path d="${SHINE}"  fill="rgba(255,255,255,0.09)"/>
  <path d="${SHIELD}" fill="none" stroke="${c.rim}" stroke-width="0.6" opacity="0.45"/>
  <text x="32" y="${alignment ? 20.5 : 34}" text-anchor="middle" dominant-baseline="middle"
        font-size="${alignment ? 20 : 22}" font-weight="900" font-family="system-ui,-apple-system,sans-serif"
        fill="rgba(255,255,255,0.95)" letter-spacing="-0.5">${letter}</text>
  ${alignment ? `<g clip-path="url(#s)">
    <path d="${SASH}" fill="url(#r)" opacity="0.94"/>
    <path d="M2,22 L62,42" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.9"/>
    <path d="M2,47 L62,67" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="1.1"/>
    <text x="32" y="44.5" text-anchor="middle" dominant-baseline="middle"
          font-size="${markerFontSize}" font-weight="900" font-family="system-ui,-apple-system,sans-serif"
          fill="#fff" stroke="rgba(2,6,23,0.82)" stroke-width="1.8" paint-order="stroke"
          stroke-linejoin="round" letter-spacing="0.35" transform="rotate(18 32 44.5)">${marker}</text>
  </g>` : ""}
  <text x="32" y="${alignment ? 67 : 60}" text-anchor="middle" dominant-baseline="middle"
        font-size="15" font-weight="700" font-family="system-ui,-apple-system,sans-serif"
        fill="rgba(255,255,255,0.85)">${number}</text>
  <path d="${SHIELD}" fill="none" stroke="${c.rim}" stroke-width="0.6" opacity="0.55"/>
</svg>`;
}

/**
 * Returns a data URI usable as a Cytoscape `background-image` or <img src>.
 * Pass admiraltyCode (e.g. "D4", "AØ", "ØØ") — defaults to ØØ if omitted.
 */
export function getSourceCrestDataUri(
  admiraltyCode?: string,
  sizePx = 64,
  alignment?: SourceCrestUriAlignment | null,
): string {
  const svg = buildSvg(admiraltyCode, sizePx, alignment);
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const BACKEND = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

export const CREST_SVG_URL: Record<string, string> = {
  high:      `${BACKEND}/assets/images/crests/crest-high.svg`,
  medium:    `${BACKEND}/assets/images/crests/crest-medium.svg`,
  mixed:     `${BACKEND}/assets/images/crests/crest-mixed.svg`,
  low:       `${BACKEND}/assets/images/crests/crest-low.svg`,
  flagged:   `${BACKEND}/assets/images/crests/crest-flagged.svg`,
  unchecked: `${BACKEND}/assets/images/crests/crest-unchecked.svg`,
};
