// Generates encoded SVG data URIs for SourceCrest images, for use as
// Cytoscape `background-image` values (Cytoscape can't render the React
// <SourceCrest> component directly). Shares its shield geometry, palette,
// and sash math with SourceCrest.tsx via sourceCrestVisual.ts — do not
// hand-copy paths/colors here; import them.

import {
  buildSourceCrestSashStops,
  clampAlignmentRiskScore,
  sourceCrestMarkerFontSize,
  parseAdmiraltyCode,
  ADMIRALTY_COLORS,
  SOURCE_CREST_SHIELD as SHIELD,
  SOURCE_CREST_BEVEL as BEVEL,
  SOURCE_CREST_SHINE as SHINE,
  SOURCE_CREST_SASH as SASH,
  type SourceAlignment,
} from "./sourceCrestVisual";

let uidCounter = 0;

function buildSvg(admiraltyCode: string | undefined, sizePx: number, alignment: SourceAlignment | null): string {
  const { letter, number } = parseAdmiraltyCode(admiraltyCode);
  const c = ADMIRALTY_COLORS[letter] ?? ADMIRALTY_COLORS["Ø"];
  const h = Math.round(sizePx * 1.25);
  const uid = `scu-${uidCounter++}`;

  const hasSash = !!alignment;
  const riskScore = clampAlignmentRiskScore(alignment?.riskScore);
  const sashStops = hasSash ? buildSourceCrestSashStops(riskScore) : [];
  const showSocialSash = alignment?.marker === "SOC";
  const ribbonText = alignment?.marker ?? "";
  const ribbonFontSize = sourceCrestMarkerFontSize(ribbonText);

  const sashMarkup = hasSash
    ? `
  <defs>
    <linearGradient id="${uid}-risk" x1="0%" y1="0%" x2="100%" y2="0%">
      ${sashStops.map((stop) => `<stop offset="${stop.offset}%" stop-color="${stop.color}"/>`).join("")}
    </linearGradient>
    <linearGradient id="${uid}-soc" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4C1D95"/>
      <stop offset="100%" stop-color="#7C3AED"/>
    </linearGradient>
    <clipPath id="${uid}-shield-clip"><path d="${SHIELD}"/></clipPath>
  </defs>
  <g clip-path="url(#${uid}-shield-clip)">
    <path d="${SASH}" fill="${showSocialSash ? `url(#${uid}-soc)` : `url(#${uid}-risk)`}" opacity="0.94"/>
    <path d="M2,22 L62,42" fill="none" stroke="rgba(255,255,255,0.68)" stroke-width="0.9"/>
    <path d="M2,47 L62,67" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="1.1"/>
    <path d="M3,24 L61,43" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.6"/>
    <text x="32" y="44.5" text-anchor="middle" dominant-baseline="middle"
      font-size="${ribbonFontSize}" font-weight="900" font-family="system-ui,-apple-system,sans-serif"
      fill="#FFFFFF" stroke="rgba(2,6,23,0.82)" stroke-width="1.8"
      paint-order="stroke" stroke-linejoin="round" letter-spacing="0.35"
      transform="rotate(18 32 44.5)">${ribbonText}</text>
  </g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" width="${sizePx}" height="${h}">
  <defs>
    <radialGradient id="${uid}-f" cx="50%" cy="38%" r="62%">
      <stop offset="0%" stop-color="${c.mid}"/>
      <stop offset="100%" stop-color="${c.base}"/>
    </radialGradient>
    <radialGradient id="${uid}-g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${c.glow}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${c.glow}" stop-opacity="0"/>
    </radialGradient>
    <filter id="${uid}-d" x="-30%" y="-20%" width="160%" height="160%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="${c.glow}" flood-opacity="0.6"/>
    </filter>
  </defs>
  <ellipse cx="32" cy="42" rx="32" ry="38" fill="url(#${uid}-g)"/>
  <path d="${SHIELD}" fill="url(#${uid}-f)" stroke="${c.glow}" stroke-width="1.5" filter="url(#${uid}-d)"/>
  <path d="${BEVEL}"  fill="none"    stroke="rgba(255,255,255,0.17)" stroke-width="1"/>
  <path d="${SHINE}"  fill="rgba(255,255,255,0.09)"/>
  <path d="${SHIELD}" fill="none" stroke="${c.rim}" stroke-width="0.6" opacity="0.45"/>
  <text x="32" y="${hasSash ? "20.5" : "34"}" text-anchor="middle" dominant-baseline="middle"
        font-size="${hasSash ? "20" : "22"}" font-weight="900" font-family="system-ui,-apple-system,sans-serif"
        fill="rgba(255,255,255,0.95)" letter-spacing="-0.5">${letter}</text>
  ${sashMarkup}
  <text x="32" y="${hasSash ? "67" : "60"}" text-anchor="middle" dominant-baseline="middle"
        font-size="15" font-weight="700" font-family="system-ui,-apple-system,sans-serif"
        fill="rgba(255,255,255,0.85)">${number}</text>
  <path d="${SHIELD}" fill="none" stroke="${c.rim}" stroke-width="0.6" opacity="0.55"/>
</svg>`;
}

/**
 * Returns a data URI usable as a Cytoscape `background-image` or <img src>.
 * Pass admiraltyCode (e.g. "D4", "AØ", "ØØ") — defaults to ØØ if omitted.
 * Pass alignment (from the same backend attachSourceAlignments() output
 * every other SourceCrest consumer uses) to draw the IND/GOV/ADV/etc sash.
 */
export function getSourceCrestDataUri(
  admiraltyCode?: string,
  sizePx = 64,
  alignment: SourceAlignment | null = null,
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
