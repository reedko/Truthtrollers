// Centralized VeriStrata brand tokens.
// Single source of truth for brand typography, color, and spacing —
// consumed by VisionTheme.ts (Chakra theme) and BrandLockup.tsx directly.
import browser from "webextension-polyfill";

export const brandFonts = {
  // Brand wordmark ("VeriStrata") — Space Grotesk, weight 600 only is bundled.
  heading:
    "'Space Grotesk', Futura, 'Century Gothic', 'Avenir Next', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  // Tagline + general UI text.
  body:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};

export const brandNameWeight = 600;
export const brandNameLetterSpacing = "-0.02em";
export const brandTaglineLetterSpacing = "0.01em";
export const brandLogoTextGap = "12px";

// Primary blue is sampled from the canonical logo8sm.png mark itself
// (alpha-weighted average ≈ #0088F5); cyan/navy reuse the accent colors
// already used throughout the popup UI so the lockup matches its surroundings.
export const brandColors = {
  primaryBlue: "#0088F5",
  secondaryCyan: "#00D9FF",
  darkNavy: "#0F172A",
  brandNameLight: "#F8FAFC",
  taglineMuted: "#94A3B8",
};

const FONT_FILES = {
  interVariable: "assets/fonts/Inter-Variable.woff2",
  spaceGroteskSemiBold: "assets/fonts/SpaceGrotesk-SemiBold.woff2",
} as const;

/**
 * Builds @font-face CSS text with browser.runtime.getURL()-resolved font
 * URLs, mirroring how bundled images (e.g. miniLogo.png) are already
 * referenced elsewhere. Meant to be injected into the popup's shadow-root
 * <style> alongside the other imported CSS (see Popup.tsx initPopup()).
 */
export function getBrandFontFaceCss(): string {
  const inter = browser.runtime.getURL(FONT_FILES.interVariable);
  const spaceGrotesk = browser.runtime.getURL(FONT_FILES.spaceGroteskSemiBold);

  return `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url('${inter}') format('woff2');
    }
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 500;
      font-display: swap;
      src: url('${inter}') format('woff2');
    }
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 600;
      font-display: swap;
      src: url('${inter}') format('woff2');
    }
    @font-face {
      font-family: 'Space Grotesk';
      font-style: normal;
      font-weight: 600;
      font-display: swap;
      src: url('${spaceGrotesk}') format('woff2');
    }
  `;
}
