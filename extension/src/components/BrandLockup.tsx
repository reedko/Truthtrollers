import React from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import browser from "webextension-polyfill";
import {
  brandColors,
  brandFonts,
  brandLogoTextGap,
  brandNameLetterSpacing,
  brandNameWeight,
  brandTaglineLetterSpacing,
} from "./themes/brandTokens";

export type BrandLockupSize = "compact" | "standard";
export type BrandLockupSurface = "light" | "dark";

interface SizeSpec {
  logoHeight: string;
  gap: string;
  nameFontSize: string;
  taglineFontSize: string;
}

const SIZE_SPECS: Record<BrandLockupSize, SizeSpec> = {
  // Target for the task-card popup header.
  compact: {
    logoHeight: "44px",
    gap: brandLogoTextGap,
    nameFontSize: "24px",
    taglineFontSize: "13px",
  },
  standard: {
    logoHeight: "64px",
    gap: "16px",
    nameFontSize: "32px",
    taglineFontSize: "15px",
  },
};

const SURFACE_TEXT_COLORS: Record<
  BrandLockupSurface,
  { name: string; tagline: string }
> = {
  dark: {
    name: brandColors.primaryBlue,
    tagline: brandColors.taglineMuted,
  },
  light: {
    name: brandColors.darkNavy,
    tagline: "#475569",
  },
};

export interface BrandLockupProps {
  /** Compact for tight popup headers; standard for larger surfaces. */
  size?: BrandLockupSize;
  /** Which background the lockup sits on — controls text color only (never the logo art). */
  surface?: BrandLockupSurface;
  /** Show "The Evidence Layer" beneath the wordmark. Defaults to true. */
  showTagline?: boolean;
  /**
   * Accessible label for the logo mark. Pass a meaningful string when the
   * lockup is the only brand indicator on the page/surface; omit (or leave
   * as default) to treat the mark as decorative when "VeriStrata" text is
   * rendered right next to it, per WAI-ARIA image-alt guidance.
   */
  alt?: string;
  /** Override the default logo-to-text gap for this placement (defaults to the size's token gap). */
  gap?: string;
  /** Nudge the logo mark horizontally without touching the source art (e.g. to optically center within a container). */
  logoOffsetLeft?: string;
  /**
   * Let the name/tagline block absorb remaining row width and center itself
   * within it (name and tagline stay center-to-center with each other).
   * Requires the parent HStack to have a width for the flex to resolve against.
   */
  centerText?: boolean;
}

/**
 * Canonical VeriStrata brand lockup: logo8sm.png + "VeriStrata" / "The Evidence Layer".
 * Do not redraw, recolor, or re-crop the source mark — only its rendered height changes.
 */
const BrandLockup: React.FC<BrandLockupProps> = ({
  size = "standard",
  surface = "dark",
  showTagline = true,
  alt,
  gap,
  logoOffsetLeft,
  centerText,
}) => {
  const spec = SIZE_SPECS[size];
  const textColors = SURFACE_TEXT_COLORS[surface];
  const isDecorative = !alt;

  const logoSrc = browser.runtime.getURL("assets/images/brand/logo8sm.png");

  return (
    <HStack spacing={0} gap={gap ?? spec.gap} align="center">
      <img
        src={logoSrc}
        alt={isDecorative ? "" : alt}
        role={isDecorative ? "presentation" : undefined}
        style={{
          height: spec.logoHeight,
          width: "auto",
          display: "block",
          flexShrink: 0,
          marginLeft: logoOffsetLeft,
        }}
      />
      <Box lineHeight="1" flex={centerText ? 1 : undefined} textAlign={centerText ? "center" : undefined}>
        <Text
          as="span"
          display="block"
          fontFamily={brandFonts.heading}
          fontWeight={brandNameWeight}
          fontSize={spec.nameFontSize}
          lineHeight="1"
          letterSpacing={brandNameLetterSpacing}
          color={textColors.name}
        >
          VeriStrata
        </Text>
        {showTagline && (
          <Text
            as="span"
            display="block"
            fontFamily={brandFonts.body}
            fontWeight={500}
            fontSize={spec.taglineFontSize}
            lineHeight="1.2"
            letterSpacing={brandTaglineLetterSpacing}
            color={textColors.tagline}
            mt="2px"
          >
            The Evidence Layer
          </Text>
        )}
      </Box>
    </HStack>
  );
};

export default BrandLockup;
