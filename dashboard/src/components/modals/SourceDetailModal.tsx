/**
 * SourceDetailModal
 *
 * Opens when a SourceCrest is clicked anywhere in the app.
 *
 * Two enrichment pipelines — both always shown, disabled without a publisher ID:
 *   1. POST /api/publishers/:id/enrich          → AllSides, Ad Fontes, Wikipedia
 *      Writes to publisher_ratings. Updates the crest colour.
 *   2. POST /api/credibility/publisher/:id/check → OpenSanctions, GDI, CourtListener
 *      Delegated to CredibilityInfoModal (writes to publisher_credibility_checks).
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Button,
  VStack,
  HStack,
  Text,
  Box,
  Badge,
  Spinner,
  Tooltip,
  Link,
  Input,
  Collapse,
  useToast,
} from "@chakra-ui/react";
import { ExternalLinkIcon, RepeatIcon, ChevronDownIcon, ChevronUpIcon } from "@chakra-ui/icons";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/useAuthStore";
import SourceCrest from "../SourceCrest";
import type { SourceAlignment } from "../SourceCrest";
import CredibilityInfoModal from "./CredibilityInfoModal";
import { normalizeSourceProfile } from "../../utils/normalizeSourceProfile";
import type { SourceType, Reliability } from "../../utils/normalizeSourceProfile";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";


interface PublisherRating {
  source: string;
  rating_label?: string;
  rating_type?: string;
  bias_score?: number;
  veracity_score?: number;
  score?: number;
  url?: string;
  last_checked?: string;
  notes?: string;
  evidence_quote?: string;
}

interface PublisherProfile {
  source: string;
  source_type?: string;
  country?: string;
  description?: string;
  ownership_notes?: string;
  funding_notes?: string;
  credibility_notes?: string;
  political_notes?: string;
  profile_url?: string;
}

interface ExternalSignal {
  provider: string;
  signal_type: string;
  admiralty_effect_type: "contextual" | "direct" | "provenance" | "cap" | "downgrade" | string;
  normalized_score?: number | null;
  reliability_bucket?: string | null;
  confidence_delta?: number | null;
  reliability_delta?: number | null;
  cap?: string | null;
  cap_reason?: string | null;
  flags?: string | string[] | null;
  matched_name?: string | null;
  matched_domain?: string | null;
  match_confidence?: number | null;
  evidence_url?: string | null;
  explanation?: string | null;
  retrieved_at?: string | null;
  error_status?: string | null;
}

interface EnrichmentRun {
  provider: string;
  status: string;
  candidate_url?: string | null;
  confidence?: string | null;
  error_message?: string | null;
  created_at?: string | null;
}

interface EnrichmentData {
  publisher: { publisher_id: number; publisher_name: string; domain?: string; description?: string };
  ratings: PublisherRating[];
  profiles: PublisherProfile[];
  externalSignals?: ExternalSignal[];
  enrichmentRuns?: EnrichmentRun[];
  publisherStatus?: {
    publisher_type?: string | null;
    stakeholder_alignment?: string | null;
    ultimate_publisher_or_interest_group?: string | null;
    use_note?: string | null;
    evidence?: Array<{ source_url?: string | null; snippet?: string | null; field?: string }>;
  } | null;
  sourceAlignment?: SourceAlignment | null;
  admiraltyCode?: string;
}

interface EnrichRunResult {
  tasks_run?: number;
  status?: string;
  reason?: string;
  results?: Record<string, { status: string }>;
  [providerName: string]: any;
}

const PROVIDER_KEY: Record<string, string> = {
  "Ad Fontes": "adfontes",
  AllSides: "allsides",
  Crossref: "crossref",
  GDELT: "gdelt",
  "IRS TEOS": "irs_teos",
  MBFC: "mbfc",
  NewsGuard: "newsguard",
  OpenAlex: "openalex",
  OpenCorporates: "opencorporates",
  RDAP: "rdap",
  "SEC EDGAR": "sec_edgar",
  SCImago: "scimago",
  Wayback: "wayback",
  Wikidata: "wikidata",
  Wikipedia: "wikipedia",
};

function isGenericSocialPublisherName(value?: string | null) {
  return /^(facebook|facebook\.com|twitter\/x|x|x\.com|instagram|instagram\.com|tiktok|tiktok\.com)$/i
    .test(String(value || "").trim());
}

function isNumericFacebookGroupPlaceholder(value?: string | null) {
  return /^facebook group \d+$/i.test(String(value || "").trim());
}

export interface SourceCandidate {
  source: "matched" | "metadata" | "platform_account" | "platform" | "repository" | "domain";
  name: string;
  confidence: "high" | "medium" | "low";
}

export interface SourceIdentity {
  sourceUrl: string | null;
  normalizedUrl: string | null;
  rootDomain: string | null;
  displayDomain: string | null;
  publisherId: number | null;
  publisherName: string | null;
  sourceIdentityKind: string;
  resolutionLevel: number;       // 0–6
  resolutionStatus: string;
  sourceType: string;
  reliability: string;
  needsHumanReview: boolean;
  pageBlocked: boolean;
  candidates: SourceCandidate[];
  metadata: {
    title: string | null;
    author: string | null;
    platformName: string | null;
    platformAccountName: string | null;
  };
}

export type LineageType = "original" | "excerpt" | "repost" | "syndicated" | "pointer" | "archive" | "unknown";

export interface LineageHop {
  url: string;
  lineageType: LineageType;
  confidence: "high" | "medium" | "low";
}

export interface SourceLineage {
  lineageType: LineageType;
  upstreamUrl: string | null;
  upstreamPublisher: string | null;
  chainDepth: number;
  lineageChain: LineageHop[];
  confidence: "high" | "medium" | "low";
  _fromCache?: boolean;
}

export interface SourceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  publisherId?: number;
  contentId?: number;   // reference_content_id — used to link publisher when missing
  sourceUrl?: string;   // source URL for identity resolution
  publisherName: string;
  sourceType?: SourceType;
  reliability?: Reliability;
  admiraltyCode?: string; // pre-computed Admiralty code from the ref list (e.g. "F6")
  onPublisherLinked?: (publisherId: number, publisherName: string, admiraltyCode?: string | null) => void;
}

// ── Veracity score bar (0–100) ────────────────────────────────────────────────
const ScoreBar: React.FC<{ value: number; label: string }> = ({ value, label }) => {
  const pct   = Math.min(100, Math.max(0, Math.round(value)));
  const color = pct >= 70 ? "#48bb78" : pct >= 40 ? "#f6ad55" : "#fc8181";
  const glow  = pct >= 70 ? "rgba(72,187,120,0.5)" : pct >= 40 ? "rgba(246,173,85,0.5)" : "rgba(252,129,129,0.5)";
  return (
    <Box w="100%" mt={2}>
      <HStack justify="space-between" mb="3px">
        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">{label}</Text>
        <Text fontSize="xs" fontWeight="800" style={{ color, textShadow: `0 0 8px ${color}` }}>{pct}%</Text>
      </HStack>
      <Box h="5px" borderRadius="full" overflow="hidden"
        style={{ background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5)" }}>
        <Box h="100%" w={`${pct}%`} borderRadius="full" transition="width 0.5s"
          style={{ background: `linear-gradient(90deg,${color}99,${color})`, boxShadow: `0 0 10px ${glow}` }} />
      </Box>
    </Box>
  );
};

// ── Bias bar (−10 … 0 … +10), center-anchored ────────────────────────────────
// value=4 → 40% of the right half; value=-4 → 40% of the left half
const BiasBar: React.FC<{ value: number }> = ({ value }) => {
  const clamped  = Math.max(-10, Math.min(10, value));
  const isLeft   = clamped < 0;
  const isCenter = clamped === 0;
  const fillPct  = `${(Math.abs(clamped) / 10) * 50}%`; // 0–50% of track
  const color    = isCenter ? "#68d391" : isLeft ? "#63b3ed" : "#fc8181";
  const glow     = isCenter ? "rgba(104,211,145,0.4)" : isLeft ? "rgba(99,179,237,0.4)" : "rgba(252,129,129,0.4)";
  const display  = isCenter ? "0" : clamped > 0 ? `+${clamped}` : `${clamped}`;
  return (
    <Box w="100%" mt={2}>
      <HStack justify="space-between" mb="3px">
        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.06em">Bias</Text>
        <Text fontSize="xs" fontWeight="800" style={{ color, textShadow: `0 0 8px ${color}` }}>{display}</Text>
      </HStack>
      <Box h="5px" borderRadius="full" overflow="hidden" position="relative"
        style={{ background: "rgba(255,255,255,0.06)", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.5)" }}>
        <Box position="absolute" left="50%" top={0} bottom={0} w="1px"
          style={{ background: "rgba(255,255,255,0.25)", transform: "translateX(-50%)" }} />
        {isLeft ? (
          <Box position="absolute" right="50%" top={0} bottom={0} w={fillPct} borderLeftRadius="full"
            transition="width 0.5s" style={{ background: `linear-gradient(270deg, ${color}cc, ${color})`, boxShadow: `0 0 8px ${glow}` }} />
        ) : !isCenter ? (
          <Box position="absolute" left="50%" top={0} bottom={0} w={fillPct} borderRightRadius="full"
            transition="width 0.5s" style={{ background: `linear-gradient(90deg, ${color}cc, ${color})`, boxShadow: `0 0 8px ${glow}` }} />
        ) : null}
      </Box>
    </Box>
  );
};

// ── 3D glass rating card ──────────────────────────────────────────────────────
const RatingCard: React.FC<{ accent: string; glow: string; children: React.ReactNode }> = ({ accent, glow, children }) => (
  <Box position="relative" borderRadius="xl" p={4} overflow="hidden"
    style={{
      background: "linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 50%, rgba(0,0,0,0.2) 100%)",
      border: `1px solid ${accent}`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${glow}, inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.2)`,
      backdropFilter: "blur(20px)",
    }}
  >
    {/* Glass highlight */}
    <Box position="absolute" top={0} left={0} right={0} h="40%" borderTopRadius="xl" pointerEvents="none"
      style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.07) 0%,transparent 100%)" }} />
    {/* Left accent bar */}
    <Box position="absolute" left={0} top="10%" bottom="10%" w="2px" borderRadius="full"
      style={{ background: `linear-gradient(180deg,transparent,${accent},transparent)`, boxShadow: `0 0 8px ${accent}` }} />
    <Box position="relative" zIndex={1} pl={2}>{children}</Box>
  </Box>
);

// ── Action panel (enrichment or credibility) ─────────────────────────────────
const ActionPanel: React.FC<{
  title: string;
  subtitle: string;
  accentVar: string;
  borderVar: string;
  glowVar: string;
  disabled?: boolean;
  disabledReason?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, accentVar, borderVar, glowVar, disabled, disabledReason, children }) => (
  <Box
    position="relative"
    borderRadius="xl"
    p={4}
    overflow="hidden"
    style={{
      background: "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.3) 100%)",
      border: `1px solid ${borderVar}`,
      boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 24px ${glowVar}, inset 0 1px 0 rgba(255,255,255,0.1)`,
      backdropFilter: "blur(20px)",
      opacity: disabled ? 0.55 : 1,
    }}
  >
    <Box position="absolute" top={0} left={0} right={0} h="35%" borderTopRadius="xl" pointerEvents="none"
      style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.06) 0%,transparent 100%)" }} />
    <Box position="absolute" left={0} top="8%" bottom="8%" w="3px" borderRadius="full"
      style={{ background: `linear-gradient(180deg,transparent,${accentVar},transparent)`, boxShadow: `0 0 10px ${accentVar}` }} />
    <Box position="relative" zIndex={1} pl={2}>
      <HStack justify="space-between" mb={1} flexWrap="wrap" gap={2}>
        <VStack align="start" spacing={0}>
          <Text fontSize="sm" fontWeight="800" textTransform="uppercase" letterSpacing="0.1em"
            style={{ color: accentVar, textShadow: `0 0 12px ${accentVar}` }}>
            {title}
          </Text>
          <Text fontSize="2xs" color="var(--mr-text-muted)" mt="1px">{subtitle}</Text>
        </VStack>
        {disabled && disabledReason && (
          <Badge fontSize="2xs" bg="rgba(255,255,255,0.06)" color="var(--mr-text-muted)" border="1px solid rgba(255,255,255,0.1)">
            {disabledReason}
          </Badge>
        )}
      </HStack>
      {children}
    </Box>
  </Box>
);

// ── Provider status dots ──────────────────────────────────────────────────────
const ENRICHMENT_PROVIDERS: Array<{
  key: string;
  label: string;
  desc: string;
  requiresConfig?: boolean;
  enabled?: boolean;
  disabledReason?: string;
}> = [
  { key: "AllSides",  label: "AllSides",    desc: "Historical ratings remain visible", enabled: false, disabledReason: "data access pending" },
  { key: "Ad Fontes", label: "Ad Fontes",   desc: "Historical ratings remain visible", enabled: false, disabledReason: "disabled" },
  { key: "Wikipedia", label: "Wikipedia",   desc: "Publisher profile" },
  { key: "Wikidata",  label: "Wikidata",    desc: "Entity identity and relationships" },
  { key: "SCImago",   label: "SCImago",     desc: "Journal impact ranking (academic)" },
  { key: "MBFC",      label: "MBFC",        desc: "Factuality / credibility where seeded", requiresConfig: false },
  { key: "NewsGuard", label: "NewsGuard",   desc: "Licensed reliability score if configured", requiresConfig: true },
  { key: "Crossref",  label: "Crossref",    desc: "DOI / ISSN / journal metadata", requiresConfig: false },
  { key: "OpenAlex",  label: "OpenAlex",    desc: "Scholarly source/work provenance", requiresConfig: true },
  { key: "Wayback",   label: "Wayback",     desc: "Domain archive footprint", requiresConfig: false },
  { key: "RDAP",      label: "RDAP",        desc: "Domain registration age", requiresConfig: false },
  { key: "OpenCorporates", label: "OpenCorporates", desc: "Legal entity identity if configured", requiresConfig: true },
  { key: "IRS TEOS",  label: "IRS TEOS",    desc: "Nonprofit verification if configured", requiresConfig: true },
  { key: "SEC EDGAR", label: "SEC EDGAR",   desc: "Public issuer / regulated entity checks", requiresConfig: true },
  { key: "GDELT",     label: "GDELT",       desc: "Independent footprint", requiresConfig: false },
];

// The top-level Force refresh intentionally runs only the lightweight first
// pass. External-signal providers and own-site re-scraping are separate jobs.
const QUICK_REFRESH_PROVIDER_KEYS = new Set(["Wikipedia", "Wikidata", "SCImago"]);

const CREDIBILITY_PROVIDERS = [
  { label: "OpenSanctions", desc: "Sanctions & PEP lists" },
  { label: "GDI",           desc: "Disinformation risk index" },
  { label: "CourtListener", desc: "Legal case history" },
];

// ── Lineage panel sub-component ───────────────────────────────────────────────

const LINEAGE_META: Record<string, { label: string; color: string; warn: boolean }> = {
  original:   { label: "Original Source",    color: "#48bb78", warn: false },
  excerpt:    { label: "Excerpt",            color: "#f6ad55", warn: true  },
  repost:     { label: "Repost",             color: "#f6ad55", warn: true  },
  syndicated: { label: "Syndicated",         color: "var(--mr-blue)", warn: false },
  pointer:    { label: "Link / Via",         color: "rgba(255,255,255,0.5)", warn: false },
  archive:    { label: "Archive Snapshot",   color: "rgba(255,255,255,0.5)", warn: false },
  unknown:    { label: "Lineage Unknown",    color: "rgba(255,255,255,0.3)", warn: false },
};

const LineagePanel: React.FC<{
  lineage: SourceLineage | null;
  loading: boolean;
  onRefresh: () => void;
}> = ({ lineage, loading, onRefresh }) => {
  const meta = lineage ? (LINEAGE_META[lineage.lineageType] ?? LINEAGE_META.unknown) : null;

  return (
    <Box px={3} py={2} borderRadius="lg"
      style={{
        background: meta?.warn ? "rgba(246,173,85,0.05)" : "rgba(255,255,255,0.03)",
        border: meta?.warn ? "1px solid rgba(246,173,85,0.2)" : "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <HStack justify="space-between" mb={1}>
        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">
          Source Lineage
        </Text>
        {loading
          ? <Spinner size="xs" color="var(--mr-text-muted)" />
          : <Button size="xs" variant="ghost" color="var(--mr-text-muted)" height="16px" minW="auto" px={1}
              _hover={{ color: "var(--mr-blue)" }} onClick={onRefresh} title="Re-detect lineage">
              <RepeatIcon boxSize="10px" />
            </Button>
        }
      </HStack>

      {lineage && !loading && (
        <VStack spacing={2} align="stretch">
          <HStack spacing={2} flexWrap="wrap">
            {/* Lineage type badge */}
            <Badge fontSize="2xs" px={2} py="1px" borderRadius="sm"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${meta?.color ?? "rgba(255,255,255,0.15)"}`,
                color: meta?.color ?? "rgba(255,255,255,0.5)",
              }}>
              {meta?.label ?? lineage.lineageType}
            </Badge>

            {/* Confidence */}
            <Badge fontSize="2xs" bg="rgba(255,255,255,0.04)" color="var(--mr-text-muted)"
              border="1px solid rgba(255,255,255,0.08)">
              {lineage.confidence} confidence
            </Badge>

            {/* Chain depth */}
            {lineage.chainDepth > 0 && (
              <Badge fontSize="2xs" bg="rgba(255,255,255,0.04)" color="var(--mr-text-muted)"
                border="1px solid rgba(255,255,255,0.08)">
                {lineage.chainDepth} hop{lineage.chainDepth > 1 ? "s" : ""} from original
              </Badge>
            )}
          </HStack>

          {/* Warning for non-original sources */}
          {meta?.warn && lineage.upstreamUrl && (
            <Box py="6px" px={2} borderRadius="md"
              style={{ background: "rgba(246,173,85,0.08)", border: "1px solid rgba(246,173,85,0.2)" }}>
              <Text fontSize="2xs" color="rgba(246,173,85,0.85)" lineHeight="1.5">
                This may not be the original source.{" "}
                {lineage.upstreamPublisher ? `Upstream: ${lineage.upstreamPublisher}.` : ""}
              </Text>
              <HStack spacing={2} mt={1} flexWrap="wrap">
                <Link href={lineage.upstreamUrl} isExternal fontSize="2xs" color="var(--mr-blue)"
                  _hover={{ textDecoration: "underline" }} noOfLines={1} maxW="260px">
                  {lineage.upstreamUrl} <ExternalLinkIcon boxSize="9px" />
                </Link>
                <Button size="xs"
                  bg="rgba(246,173,85,0.1)" color="rgba(246,173,85,0.7)"
                  border="1px solid rgba(246,173,85,0.25)" borderRadius="md"
                  height="18px" px={2} fontSize="2xs"
                  _hover={{ bg: "rgba(246,173,85,0.2)", color: "#f6ad55" }}
                  onClick={() => window.open(lineage.upstreamUrl!, "_blank", "noopener")}>
                  View Original
                </Button>
              </HStack>
            </Box>
          )}

          {/* Archive upstream */}
          {lineage.lineageType === "archive" && lineage.upstreamUrl && (
            <HStack spacing={2} flexWrap="wrap">
              <Text fontSize="2xs" color="var(--mr-text-muted)">Archived from:</Text>
              <Link href={lineage.upstreamUrl} isExternal fontSize="2xs" color="var(--mr-blue)"
                _hover={{ textDecoration: "underline" }} noOfLines={1} maxW="220px">
                {lineage.upstreamUrl} <ExternalLinkIcon boxSize="9px" />
              </Link>
            </HStack>
          )}

          {/* Full chain (collapsible — only show when depth > 1) */}
          {lineage.lineageChain.length > 2 && (
            <Box>
              <Text fontSize="2xs" color="var(--mr-text-muted)" mb="3px">Chain:</Text>
              <VStack spacing="2px" align="stretch">
                {lineage.lineageChain.map((hop, i) => {
                  const hopMeta = LINEAGE_META[hop.lineageType] ?? LINEAGE_META.unknown;
                  return (
                    <HStack key={i} spacing={2}>
                      <Text fontSize="2xs" color="var(--mr-text-muted)" minW="14px">{i + 1}.</Text>
                      <Badge fontSize="8px" px={1} borderRadius="sm"
                        style={{ border: `1px solid ${hopMeta.color}`, color: hopMeta.color, background: "rgba(255,255,255,0.04)" }}>
                        {hopMeta.label}
                      </Badge>
                      <Text fontSize="2xs" color="var(--mr-text-muted)" noOfLines={1} flex={1}>
                        {new URL(hop.url).hostname.replace(/^www\./, "")}
                      </Text>
                    </HStack>
                  );
                })}
              </VStack>
            </Box>
          )}
        </VStack>
      )}
    </Box>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
// ── Resolution level badge ────────────────────────────────────────────────────
const LEVEL_LABEL: Record<number, { label: string; desc: string; color: string }> = {
  0: { label: "No URL",             desc: "No source URL was provided",                               color: "rgba(255,255,255,0.2)" },
  1: { label: "URL only",           desc: "Publisher name guessed from the domain name",              color: "rgba(246,173,85,0.7)" },
  2: { label: "Name extracted",     desc: "Publisher name found in the page's structured metadata",   color: "rgba(246,173,85,0.85)" },
  3: { label: "Matched to record",  desc: "Matched to a known publisher in our database",             color: "rgba(0,162,255,0.8)" },
  4: { label: "Type confirmed",     desc: "Source type verified (government, academic, etc.)",        color: "rgba(0,162,255,0.9)" },
  5: { label: "Ratings on file",    desc: "AllSides, Ad Fontes, or similar ratings exist",           color: "rgba(72,187,120,0.9)" },
  6: { label: "Human verified",     desc: "A researcher has reviewed and confirmed this source",      color: "rgba(72,187,120,1)" },
};

const SourceDetailModal: React.FC<SourceDetailModalProps> = ({
  isOpen, onClose, publisherId, contentId, sourceUrl, publisherName, sourceType, reliability, admiraltyCode, onPublisherLinked,
}) => {
  const navigate  = useNavigate();
  const token     = useAuthStore((s) => s.token);
  const toast     = useToast();

  // Tracks whether the modal is still mounted — used to abort the scrape polling loop.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // resolvedId starts as the prop; linkPublisher() upgrades it when creating a new record
  const [resolvedId,    setResolvedId]    = useState<number | undefined>(publisherId);
  // customName allows the user to correct the publisher name before linking
  const [customName,    setCustomName]    = useState(publisherName);
  const [enrichment,    setEnrichment]    = useState<EnrichmentData | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [enrichResult,  setEnrichResult]  = useState<EnrichRunResult | null>(null);
  const [enrichError,   setEnrichError]   = useState<string | null>(null);
  const [linking,       setLinking]       = useState(false);
  const [linkError,     setLinkError]     = useState<string | null>(null);
  const [credibilityOpen, setCredibilityOpen] = useState(false);
  const [sourceIdentity,  setSourceIdentity]  = useState<SourceIdentity | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [scrapePolling,   setScrapePolling]   = useState(false);
  const [scrapeStatus,    setScrapeStatus]    = useState<string | null>(null);
  const [rescrapeDetected, setRescrapeDetected] = useState(false);
  const [lineage,         setLineage]         = useState<SourceLineage | null>(null);
  const [lineageLoading,  setLineageLoading]  = useState(false);
  const [showIdentity,    setShowIdentity]    = useState(false);
  const [showLineage,     setShowLineage]     = useState(false);
  const [showRelink,      setShowRelink]      = useState(false);
  const [showDisabledProviders, setShowDisabledProviders] = useState(false);
  // Provenance fields fetched from the content row
  const [linkedPublisher,  setLinkedPublisher]  = useState<string | null>(null);
  const [contentPlatform,  setContentPlatform]  = useState<string | null>(null);
  const [contentChannel,   setContentChannel]   = useState<string | null>(null);
  const [socialProvenance, setSocialProvenance] = useState<Record<string, unknown> | null>(null);
  // Background domain check result (source-identity on the linked publisher domain)
  const [domainCheckResult, setDomainCheckResult] = useState<SourceIdentity | null>(null);
  const [domainCheckLoading, setDomainCheckLoading] = useState(false);
  // Updated inline after enrichment so the crest reflects new data without a page reload
  const [liveAdmiraltyCode, setLiveAdmiraltyCode] = useState<string | null>(null);
  const applyAdmiraltyCode = (code: string) => {
    setLiveAdmiraltyCode(code);
  };
  const onPublisherLinkedRef = useRef(onPublisherLinked);
  useEffect(() => {
    onPublisherLinkedRef.current = onPublisherLinked;
  }, [onPublisherLinked]);

  // Memoized so the object identity is stable across renders — prevents every useCallback
  // that lists authHeaders as a dep from being recreated on every render.
  const authHeaders = useMemo<Record<string, string>>(
    () => (token ? { Authorization: `Bearer ${token}` } : {} as Record<string, string>),
    [token]
  );

  // Reset all source-scoped state when a different source is opened. If the new
  // source has no publisher id, leaving the prior enrichment in place is worse
  // than showing an empty state.
  useEffect(() => {
    setResolvedId(publisherId);
    setCustomName(publisherName);
    setEnrichment(null);
    setEnrichResult(null);
    setEnrichError(null);
    setLinkError(null);
    setSourceIdentity(null);
    setLineage(null);
    setDomainCheckResult(null);
    setLinkedPublisher(null);
    setContentPlatform(null);
    setContentChannel(null);
    setLiveAdmiraltyCode(null);
    setScrapeStatus(null);
    setRescrapeDetected(false);
  }, [publisherId, publisherName, sourceUrl, contentId]);

  // Load source identity when we have a URL
  const loadSourceIdentity = useCallback((force = false) => {
    if (!sourceUrl) return;
    setIdentityLoading(true);
    const params = new URLSearchParams({ url: sourceUrl, ...(force ? { force: "1" } : {}) });
    fetch(`${API_BASE_URL}/api/source-identity?${params}`, { credentials: "include", headers: authHeaders })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: SourceIdentity) => {
        setSourceIdentity(d);
        const platformAccount = d.candidates?.find((candidate) =>
          candidate.source === "platform_account" &&
          candidate.confidence === "high" &&
          candidate.name
        );
        const preferredPlatformName =
          contentChannel && !isNumericFacebookGroupPlaceholder(contentChannel)
            ? contentChannel
            : platformAccount?.name;
        const currentName = enrichment?.publisher.publisher_name ?? publisherName;
        const shouldReplaceGenericPlatform =
          !!preferredPlatformName &&
          !isNumericFacebookGroupPlaceholder(preferredPlatformName) &&
          !!contentId &&
          /facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com/i.test(sourceUrl) &&
          isGenericSocialPublisherName(currentName);

        if (shouldReplaceGenericPlatform) {
          setCustomName(preferredPlatformName);
          setResolvedId(undefined);
          setEnrichment(null);
          setLiveAdmiraltyCode(null);
          setEnrichRunning(true);
          fetch(`${API_BASE_URL}/api/publishers/enrich-and-link`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({
              name: preferredPlatformName,
              contentId,
              sourceUrl,
              force: true,
              skipExternalSignals: true,
              maxProviderConcurrency: 1,
            }),
          })
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then((linkData) => {
              if (linkData?.publisherId) {
                setResolvedId(linkData.publisherId);
                const newCode = linkData.enrichResult?.admiraltyUpdates?.[contentId];
                onPublisherLinked?.(linkData.publisherId, preferredPlatformName, newCode ?? null);
                loadEnrichment(linkData.publisherId);
                if (newCode) applyAdmiraltyCode(newCode);
              }
            })
            .catch(() => {
              setShowRelink(true);
            })
            .finally(() => setEnrichRunning(false));
          return;
        }
        // Pre-fill from best candidate if the user hasn't manually edited.
        // Don't replace a proper DB name with a low-confidence domain guess.
        if (d.candidates?.length) {
          const best = d.candidates[0];
          setCustomName(prev => {
            if (prev !== publisherName) return prev;            // user has edited
            if (best.confidence === "low" && resolvedId) return prev; // don't downgrade to domain fallback
            return best.name ?? prev;
          });
        }
        // If resolver matched a publisher we didn't have, propagate it up
        if (d.publisherId && !resolvedId) {
          setResolvedId(d.publisherId);
          loadEnrichment(d.publisherId);
        }
      })
      .catch(() => {})
      .finally(() => setIdentityLoading(false));
  }, [sourceUrl, resolvedId, publisherName, enrichment, contentId, contentChannel, authHeaders, onPublisherLinked]);

  // Fire source-identity detection once when the modal opens (not on every resolvedId change —
  // that would create a loop because loadSourceIdentity itself updates resolvedId).
  const prevIsOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpen.current) {
      if (sourceUrl) loadSourceIdentity();
      // Fetch content provenance (linked_publisher) so we can offer it as enrichment target
      if (contentId) {
        fetch(`${API_BASE_URL}/api/content/${contentId}`, { credentials: "include", headers: authHeaders })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (!data) return;
            const lp: string | null = data.linked_publisher ?? null;
            const pl: string | null = data.platform ?? null;
            const ch: string | null = data.distribution_channel ?? null;
            const sp = data.social_provenance
              ? (typeof data.social_provenance === "string"
                  ? (() => { try { return JSON.parse(data.social_provenance); } catch { return null; } })()
                  : data.social_provenance)
              : null;
            setLinkedPublisher(lp);
            setContentPlatform(pl);
            setContentChannel(ch);
            setSocialProvenance(sp);
            if (lp) {
              // Pre-fill the input with the linked article domain (don't clobber user edits)
              setCustomName(prev => (prev === "Facebook" || prev === "Twitter/X" || !prev) ? lp : prev);
            }
          })
          .catch(() => {});
      }
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, sourceUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLineage = useCallback((force = false) => {
    if (!sourceUrl) return;
    setLineageLoading(true);
    const params = new URLSearchParams({ url: sourceUrl, ...(force ? { force: "1" } : {}) });
    fetch(`${API_BASE_URL}/api/source-lineage?${params}`, { credentials: "include", headers: authHeaders })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: SourceLineage) => setLineage(d))
      .catch(() => {})
      .finally(() => setLineageLoading(false));
  }, [sourceUrl]);

  // Lineage loads lazily — only when the section is first expanded.
  const lineageLoaded = useRef(false);
  useEffect(() => {
    if (showLineage && sourceUrl && !lineageLoaded.current) {
      lineageLoaded.current = true;
      loadLineage();
    }
  }, [showLineage, sourceUrl, loadLineage]);
  // Reset on modal close so the next open re-fetches fresh data.
  useEffect(() => { if (!isOpen) lineageLoaded.current = false; }, [isOpen]);

  // ── Background publisher check ────────────────────────────────────────────────
  // Calls source-identity on a publisher domain without opening a tab.
  // Works for any domain; fails gracefully if the page blocks bots (pageBlocked).
  const checkPublisherDomain = useCallback((domain: string) => {
    if (!domain.trim()) return;
    setDomainCheckLoading(true);
    setDomainCheckResult(null);
    // Normalise to a root URL so the resolver fetches the homepage meta
    const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
    const params = new URLSearchParams({ url });
    fetch(`${API_BASE_URL}/api/source-identity?${params}`, { credentials: "include", headers: authHeaders })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: SourceIdentity) => {
        setDomainCheckResult(d);
        // If the resolver returned a better publisher name, pre-fill it
        if (d.candidates?.length && d.candidates[0].confidence !== "low") {
          setCustomName(d.candidates[0].name);
        }
        // If the resolver found a DB publisher record, wire it up immediately
        if (d.publisherId && !resolvedId) {
          setResolvedId(d.publisherId);
          loadEnrichment(d.publisherId);
        }
      })
      .catch(() => {})
      .finally(() => setDomainCheckLoading(false));
  }, [authHeaders, resolvedId, contentId, sourceUrl]);

  // ── Create scrape job → extension picks it up (opens tab), polls for completion → re-resolve ─
  // targetUrl: if supplied, scrape THIS URL instead of sourceUrl (e.g. the linked article URL)
  const scrapeForPublisher = useCallback(async (targetUrl?: string, useExtension = false) => {
    const scrapeUrl = targetUrl || sourceUrl;
    if (!scrapeUrl || scrapePolling) return;
    if (useExtension && !contentId) {
      setScrapeStatus("Extension scrape requires a content id.");
      return;
    }
    setScrapePolling(true);
    setScrapeStatus(useExtension ? "Opening tab…" : "Refreshing from backend…");

    if (useExtension) {
      // Open the URL only for explicit extension scrapes so normal SourceCrest
      // refreshes do not steal focus from the dashboard.
      window.open(scrapeUrl, '_blank', 'noopener');
    }

    if (useExtension) setScrapeStatus("Submitting scrape job…");
    try {
      if (!useExtension) {
        const params = new URLSearchParams({ url: scrapeUrl, force: "1" });
        const identityRes = await fetch(`${API_BASE_URL}/api/source-identity?${params}`, {
          credentials: "include",
          headers: authHeaders,
        });
        const identityData: SourceIdentity | null = identityRes.ok ? await identityRes.json() : null;
        if (!identityRes.ok || !identityData) {
          throw new Error(`source identity failed: ${identityRes.status}`);
        }

        setSourceIdentity(identityData);
        const bestCandidate = identityData.candidates?.find((candidate) =>
          candidate.name && candidate.confidence !== "low"
        );
        const resolvedPublisherId = identityData.publisherId ?? null;
        const resolvedPublisherName = bestCandidate?.name ?? identityData.publisherName ?? null;
        const currentPublisherName = enrichment?.publisher.publisher_name ?? publisherName;

        if (resolvedId && resolvedPublisherId && resolvedPublisherId !== resolvedId) {
          setCustomName(resolvedPublisherName || currentPublisherName);
          setShowRelink(true);
          setScrapeStatus(`Different publisher detected: ${resolvedPublisherName || `record #${resolvedPublisherId}`}. Review it under Change publisher.`);
          return;
        }
        if (resolvedId && resolvedPublisherName && currentPublisherName &&
            resolvedPublisherName.trim().toLowerCase() !== currentPublisherName.trim().toLowerCase()) {
          setCustomName(resolvedPublisherName);
          setShowRelink(true);
          setScrapeStatus(`Different publisher detected: ${resolvedPublisherName}. Review it under Change publisher.`);
          return;
        }

        if (resolvedPublisherId) {
          setResolvedId(resolvedPublisherId);
          setScrapeStatus("Refreshing provider ratings…");
          const enrichRes = await fetch(`${API_BASE_URL}/api/publishers/${resolvedPublisherId}/enrich`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({
              force: true,
              contentId: contentId ?? null,
              sourceUrl: sourceUrl ?? scrapeUrl,
              skipExternalSignals: true,
              maxProviderConcurrency: 1,
            }),
          });
          const enrichData = enrichRes.ok ? await enrichRes.json().catch(() => null) : null;
          const result = enrichData?.result ?? enrichData;
          if (result) setEnrichResult(result);
          const newCode = contentId ? result?.admiraltyUpdates?.[contentId] ?? result?.admiraltyCode : result?.admiraltyCode;
          if (newCode) applyAdmiraltyCode(newCode);
          loadEnrichment(resolvedPublisherId);
        } else if (resolvedPublisherName) {
          setCustomName(resolvedPublisherName);
          setScrapeStatus(`Linking "${resolvedPublisherName}" and enriching…`);
          const linkRes = await fetch(`${API_BASE_URL}/api/publishers/enrich-and-link`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({
              name: resolvedPublisherName,
              contentId: contentId ?? null,
              sourceUrl: sourceUrl ?? scrapeUrl,
              force: true,
              skipExternalSignals: true,
              maxProviderConcurrency: 1,
            }),
          });
          const linkData = linkRes.ok ? await linkRes.json().catch(() => null) : null;
          const linkedId = linkData?.publisherId;
          if (linkedId) {
            setResolvedId(linkedId);
            setEnrichResult(linkData?.enrichResult ?? null);
            const newCode = contentId ? linkData?.enrichResult?.admiraltyUpdates?.[contentId] ?? linkData?.enrichResult?.admiraltyCode : linkData?.enrichResult?.admiraltyCode;
            onPublisherLinked?.(linkedId, resolvedPublisherName, newCode ?? null);
            loadEnrichment(linkedId);
            if (newCode) applyAdmiraltyCode(newCode);
          }
        } else {
          setScrapeStatus("No confident publisher identity found.");
          return;
        }
        loadLineage(true);
        setScrapeStatus(null);
        return;
      }

      const jobBody = { mode: "scrape_specific_url", url: scrapeUrl };
      console.log("[scrapeForPublisher] POST /api/scrape-request", jobBody);
      const jobRes = await fetch(`${API_BASE_URL}/api/scrape-request`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(jobBody),
      });
      const jobData = await jobRes.json();
      console.log("[scrapeForPublisher] scrape-request response", jobRes.status, jobData);
      if (!jobRes.ok) throw new Error(`scrape-request failed: ${jobRes.status} — ${JSON.stringify(jobData)}`);
      const { scrape_job_id } = jobData;
      if (!scrape_job_id) throw new Error("No scrape_job_id in response — check backend logs");

      setScrapeStatus(`Job #${scrape_job_id} queued — waiting for extension scrape…`);
      console.log(`[scrapeForPublisher] job #${scrape_job_id} created, polling every 10s up to 90s`);

      // Poll up to 90 s (extension polls every 10 s, so allow ~3 cycles + processing time)
      const deadline = Date.now() + 90_000;
      let lastStatus = "";
      while (Date.now() < deadline && isMounted.current) {
        await new Promise(r => setTimeout(r, 10000));
        const statusRes = await fetch(`${API_BASE_URL}/api/scrape-jobs/${scrape_job_id}/status`, {
          credentials: "include", headers: authHeaders,
        });
        if (!statusRes.ok) {
          console.warn(`[scrapeForPublisher] status poll returned ${statusRes.status}`);
          continue;
        }
        const statusData = await statusRes.json();
        const { status } = statusData;
        if (status !== lastStatus) {
          console.log(`[scrapeForPublisher] job #${scrape_job_id} status → ${status}`, statusData);
          lastStatus = status;
        }
        if (status === "completed") {
          setScrapeStatus("Scraped — fetching publisher…");
          await new Promise(r => setTimeout(r, 500)); // let DB settle

          // statusData.content_id is the referenceContentId the extension stored the
          // publisher against (via scrape-reference). Query that row, not the task content.
          const refContentId = statusData.content_id;
          const lookupId = refContentId ?? contentId;
          const pubRes = await fetch(`${API_BASE_URL}/api/publishers/for-content/${lookupId}`, {
            credentials: "include", headers: authHeaders,
          });
          const pubData = pubRes.ok ? await pubRes.json() : null;
          const scrapedName = pubData?.publisher_name;
          const scrapedPublisherId = pubData?.publisher_id;
          console.log(`[scrapeForPublisher] publisher from ref content ${lookupId}:`, scrapedName, pubData);

          if (scrapedName && scrapedPublisherId) {
            // scrapeReference has already replaced the content→publisher link in
            // the database. Reflect that committed state immediately; requiring
            // another "Save publisher link" click left the modal and reference
            // list showing stale pre-scrape data.
            setResolvedId(scrapedPublisherId);
            setCustomName(scrapedName);
            setShowRelink(false);
            setRescrapeDetected(false);
            if (pubData?.admiralty_code) applyAdmiraltyCode(pubData.admiralty_code);
            onPublisherLinkedRef.current?.(scrapedPublisherId, scrapedName, pubData?.admiralty_code ?? null);
            loadEnrichment(scrapedPublisherId, true);

            // The extension job completes after the publisher link is written,
            // while publisher enrichment deliberately continues in the backend.
            // Follow that second phase so its profile/crest appears without
            // closing and reopening the modal.
            setScrapeStatus(`Publisher updated to "${scrapedName}" — enrichment running…`);
            const enrichmentDeadline = Date.now() + 45_000;
            let completedCode = pubData?.admiralty_code ?? null;
            while (!completedCode && Date.now() < enrichmentDeadline && isMounted.current) {
              await new Promise(r => setTimeout(r, 3000));
              const refreshedPubRes = await fetch(`${API_BASE_URL}/api/publishers/for-content/${lookupId}`, {
                credentials: "include", headers: authHeaders,
              });
              const refreshedPub = refreshedPubRes.ok ? await refreshedPubRes.json() : null;
              completedCode = refreshedPub?.admiralty_code ?? null;
              loadEnrichment(scrapedPublisherId, true);
            }
            if (completedCode) {
              applyAdmiraltyCode(completedCode);
              onPublisherLinkedRef.current?.(scrapedPublisherId, scrapedName, completedCode);
              setScrapeStatus(`Publisher updated to "${scrapedName}" · SourceCrest ${completedCode}`);
            } else {
              setScrapeStatus(`Publisher updated to "${scrapedName}"; enrichment has not produced a SourceCrest yet.`);
            }
          } else {
            setScrapeStatus("Scrape completed, but no publisher was detected.");
          }

          // The publisher linked by scrapeReference is authoritative here. A
          // second identity resolution can still point at an older duplicate
          // publisher record and overwrite the modal state we just refreshed.
          if (!scrapedPublisherId) loadSourceIdentity(true);
          break;
        }
        if (status === "failed") {
          const errorMessage = String(statusData?.error_message || "");
          console.error("[scrapeForPublisher] job failed", statusData);

          if (/No tab found for URL/i.test(errorMessage)) {
            setScrapeStatus("Extension could not find the opened tab. Keep it open, then retry the explicit re-scrape.");
            break;
          }

          setScrapeStatus("Scrape failed — try reloading the tab and retrying.");
          break;
        }
        setScrapeStatus(`Job #${scrape_job_id} ${status}… (keep the tab open)`);
      }
      if (Date.now() >= deadline) {
        console.warn(`[scrapeForPublisher] job #${scrape_job_id} timed out after 90s`);
        setScrapeStatus("Timed out — is the extension running in that tab?");
      }
    } catch (e: any) {
      console.error("[scrapeForPublisher] error:", e);
      setScrapeStatus(`Error: ${e?.message}`);
    } finally {
      setScrapePolling(false);
    }
  }, [sourceUrl, contentId, scrapePolling, authHeaders, loadSourceIdentity, loadLineage, resolvedId, enrichment, publisherName]);

  const loadEnrichment = useCallback((overrideId?: number, background = false) => {
    const id = overrideId ?? resolvedId;
    if (!id) {
      setEnrichment(null);
      setLoading(false);
      return;
    }
    // Background reloads must not replace the modal body with a spinner. Doing
    // so shrinks/recenters the modal and makes controls move under the pointer.
    if (!background) setLoading(true);
    const params = contentId ? `?contentId=${encodeURIComponent(String(contentId))}` : "";
    fetch(`${API_BASE_URL}/api/publishers/${id}/enrichment${params}`, { credentials: "include", headers: authHeaders })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: EnrichmentData) => {
        setEnrichment(d);
        if (d.admiraltyCode) {
          applyAdmiraltyCode(d.admiraltyCode);
        }
      })
      .catch(() => {})
      .finally(() => { if (!background) setLoading(false); });
  }, [resolvedId, contentId, authHeaders]);

  useEffect(() => {
    if (isOpen) {
      setEnrichResult(null); setEnrichError(null); setLinkError(null);
      setDomainCheckResult(null); setLiveAdmiraltyCode(null);
      loadEnrichment();
      if (!publisherId) setShowRelink(true);
    }
  }, [isOpen, loadEnrichment]);

  useEffect(() => {
    if (!resolvedId && sourceIdentity?.publisherId) {
      setResolvedId(sourceIdentity.publisherId);
      loadEnrichment(sourceIdentity.publisherId);
    }
  }, [resolvedId, sourceIdentity?.publisherId, loadEnrichment]);

  // ── Enrich & Link: create/find publisher, run AllSides/AdFontes/Wikipedia, link to content ─
  const linkPublisher = async () => {
    if (!contentId || linking) return;
    setLinking(true);
    setLinkError(null);
    setEnrichRunning(true);
    setEnrichResult(null);
    setEnrichError(null);
    try {
      const nameToLink = (customName || publisherName).trim();
      if (!nameToLink) throw new Error("Publisher name is required");
      const res = await fetch(`${API_BASE_URL}/api/publishers/enrich-and-link`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          name: nameToLink,
          domain: sourceIdentity?.rootDomain ?? undefined,
          contentId,
          sourceUrl: sourceUrl ?? undefined,
          force: rescrapeDetected,
          skipExternalSignals: true,
          skipOwnSiteOrgStatus: false,
          maxProviderConcurrency: 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Server error ${res.status}`);
      }
      const data = await res.json();
      const newId: number | undefined = data.publisherId;
      if (!newId) throw new Error("Publisher created but ID not returned — check DB logs");
      setResolvedId(newId);
      const enrichResult = data.enrichResult ?? null;
      setEnrichResult(enrichResult);
      if (contentId && enrichResult?.admiraltyUpdates?.[contentId]) {
        applyAdmiraltyCode(enrichResult.admiraltyUpdates[contentId]);
      }
      onPublisherLinked?.(newId, nameToLink, enrichResult?.admiraltyUpdates?.[contentId] ?? enrichResult?.admiraltyCode ?? null);
      loadEnrichment(newId);
      setRescrapeDetected(false);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to enrich & link publisher";
      setLinkError(msg);
      setEnrichError(msg);
      toast({
        title: "Publisher not linked",
        description: msg,
        status: "error",
        duration: 5000,
        isClosable: true,
        position: "top-right",
      });
    } finally {
      setLinking(false);
      setEnrichRunning(false);
    }
  };

  // Refresh ratings and the crest for the publisher already linked here.
  // Identity discovery and extension scraping are intentionally separate.
  const forceRefreshPublisher = async () => {
    const targetId = resolvedId ?? sourceIdentity?.publisherId ?? domainCheckResult?.publisherId ?? undefined;
    if (!targetId || enrichRunning) return;
    setEnrichRunning(true);
    setEnrichResult(null);
    setEnrichError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/publishers/${targetId}/enrich`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          force: true,
          contentId: contentId ?? null,
          sourceUrl: sourceUrl ?? null,
          skipExternalSignals: true,
          skipOwnSiteOrgStatus: true,
          maxProviderConcurrency: 1,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data.result ?? data;
      setEnrichResult(result);
      const newCode = result?.admiraltyUpdates?.[contentId ?? ""] ?? result?.admiraltyCode;
      if (newCode) {
        applyAdmiraltyCode(newCode);
        onPublisherLinked?.(targetId, enrichment?.publisher.publisher_name ?? publisherName, newCode);
      }
      loadEnrichment(targetId, true);
    } catch (err: any) {
      setEnrichError(err?.message ?? "Force refresh failed");
    } finally {
      setEnrichRunning(false);
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const firstProfile  = enrichment?.profiles[0];
  const bestVeracityRating = useMemo(() => {
    const scored = enrichment?.ratings
      ?.filter((rating) => rating.veracity_score != null)
      .sort((a, b) => Number(b.veracity_score) - Number(a.veracity_score));
    return scored?.[0] ?? null;
  }, [enrichment]);
  const liveProfile   = useMemo(() => normalizeSourceProfile({
    publisher_name: enrichment?.publisher.publisher_name ?? publisherName,
    rating_label:   bestVeracityRating?.rating_label ?? enrichment?.ratings[0]?.rating_label,
    rating_type:    firstProfile?.source_type ?? bestVeracityRating?.rating_type ?? enrichment?.ratings[0]?.rating_type,
    veracity_score: bestVeracityRating?.veracity_score,
  }), [enrichment, publisherName, firstProfile, bestVeracityRating]);
  const governmentOperatorName = useMemo(() => {
    if (enrichment?.sourceAlignment?.marker !== "GOV") return null;
    const storedOperator = enrichment.publisherStatus?.ultimate_publisher_or_interest_group;
    if (storedOperator && storedOperator !== "government public authority") return storedOperator;
    const evidenceText = [
      ...(enrichment.publisherStatus?.evidence?.map(item => item.snippet) ?? []),
      ...enrichment.profiles.flatMap(profile => [profile.ownership_notes]),
    ].filter(Boolean).join(" ");
    return /\bFederal Office of Public Health(?:\s*\(FOPH\)|\s+FOPH)?\b/i.test(evidenceText)
      ? "Federal Office of Public Health (FOPH)"
      : null;
  }, [enrichment]);

  const facebookContainer = useMemo(() => {
    const isFacebook = /facebook/i.test(contentPlatform ?? "") || /facebook\.com/i.test(sourceUrl ?? "");
    if (!isFacebook) return null;
    const sp = socialProvenance as Record<string, unknown> | null;
    const name = (sp?.containerName as string | undefined) ??
      (!isNumericFacebookGroupPlaceholder(contentChannel) ? contentChannel : null);
    if (!name) return null;
    return {
      name,
      containerType: (sp?.containerType as string | undefined) ?? "facebook_group",
      directSocialPublisher: sp?.directSocialPublisher as string | undefined,
    };
  }, [contentPlatform, sourceUrl, socialProvenance, contentChannel]);

  const displayType: SourceType =
    sourceType ?? (sourceIdentity?.sourceType as SourceType | undefined) ?? liveProfile.sourceType;
  const displayReliability: Reliability =
    reliability ?? (sourceIdentity?.reliability as Reliability | undefined) ?? liveProfile.reliability;
  const detectedPlatformAccount = sourceIdentity?.candidates?.find((candidate) =>
    candidate.source === "platform_account" &&
    candidate.confidence === "high" &&
    candidate.name
  );
  const preferredDisplayedPlatformAccount =
    contentChannel && !isNumericFacebookGroupPlaceholder(contentChannel)
      ? contentChannel
      : detectedPlatformAccount?.name;
  const suppressGenericPlatformRating =
    !!preferredDisplayedPlatformAccount &&
    sourceUrl != null &&
    /facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com/i.test(sourceUrl) &&
    isGenericSocialPublisherName(enrichment?.publisher.publisher_name ?? publisherName);
  const displayedPublisherName = suppressGenericPlatformRating
    ? preferredDisplayedPlatformAccount
    : (enrichment?.publisher.publisher_name ?? sourceIdentity?.publisherName ?? publisherName);
  const displayedReliability: Reliability = suppressGenericPlatformRating ? "unchecked" : displayReliability;
  const displayedType: SourceType = suppressGenericPlatformRating ? (sourceIdentity?.sourceType as SourceType) || "social" : displayType;
  const displayedAdmiraltyCode = suppressGenericPlatformRating
    ? null
    : (liveAdmiraltyCode ?? (enrichment as any)?.admiraltyCode ?? liveProfile.admiraltyCode ?? admiraltyCode);

  const visibleRatings = suppressGenericPlatformRating ? [] : (enrichment?.ratings ?? []);
  const allSides   = visibleRatings.find(r => r.source?.toLowerCase().includes("allsides"));
  const adFontes   = visibleRatings.find(r => r.source?.toLowerCase().includes("ad fontes") || r.source?.toLowerCase().includes("adfont"));
  const mbfc       = visibleRatings.find(r => r.source?.toLowerCase().includes("mbfc") || r.source?.toLowerCase().includes("media bias"));
  const otherRatings = visibleRatings.filter(r => r !== allSides && r !== adFontes && r !== mbfc && r.veracity_score != null) ?? [];
  const hasRatings   = !!(allSides || adFontes || mbfc || otherRatings.length);
  const externalSignals = suppressGenericPlatformRating ? [] : (enrichment?.externalSignals ?? []);
  const latestSignalFor = (labelOrKey: string) => {
    const key = PROVIDER_KEY[labelOrKey] || labelOrKey.toLowerCase().replace(/\s+/g, "_");
    return externalSignals.find((signal) => String(signal.provider || "").toLowerCase() === key);
  };
  const parseFlags = (flags: ExternalSignal["flags"]) => {
    if (Array.isArray(flags)) return flags;
    if (!flags) return [];
    try {
      const parsed = JSON.parse(String(flags));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [String(flags)];
    }
  };
  const signalStatus = (signal?: ExternalSignal | null, provider?: { requiresConfig?: boolean }) => {
    if (!signal) return { label: "not run", color: "var(--mr-text-muted)", enabled: true };
    if (signal.error_status === "missing_config" && provider?.requiresConfig === false) {
      return { label: "needs rerun", color: "#F6AD55", enabled: true };
    }
    if (signal.error_status === "missing_config") return { label: "not configured", color: "#A0AEC0", enabled: false };
    if (signal.error_status === "not_implemented") return { label: "not implemented", color: "#A0AEC0", enabled: false };
    if (signal.error_status === "disabled") return { label: "disabled", color: "#A0AEC0", enabled: false };
    if (signal.error_status === "no_match") return { label: "no match", color: "#F6AD55", enabled: true };
    if (signal.error_status || parseFlags(signal.flags).some((flag) => String(flag).startsWith("provider_"))) {
      return { label: signal.error_status || "attempted", color: "#F6AD55", enabled: true };
    }
    if (signal.normalized_score != null) return { label: `${signal.admiralty_effect_type} ${Math.round(Number(signal.normalized_score))}`, color: "#48BB78", enabled: true };
    return { label: signal.admiralty_effect_type || "stored", color: "#48BB78", enabled: true };
  };
  const latestRunStatusFor = (key: string) => {
    return enrichResult?.results?.[key]?.status ?? enrichResult?.[key]?.status ?? latestPersistedRunFor(key)?.status;
  };
  function latestPersistedRunFor(key: string) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return enrichment?.enrichmentRuns?.find(run =>
      String(run.provider || "").toLowerCase().replace(/[^a-z0-9]/g, "") === normalized
    );
  }
  const isProviderDisabled = (provider: (typeof ENRICHMENT_PROVIDERS)[number]) =>
    provider.enabled === false || signalStatus(latestSignalFor(provider.key), provider).enabled === false;
  const disabledEnrichmentProviders = ENRICHMENT_PROVIDERS.filter(isProviderDisabled);
  const signalSummary = (signal?: ExternalSignal | null) => {
    if (!signal) return "No recent provider result stored yet.";
    const bits = [
      signal.reliability_bucket ? `bucket ${signal.reliability_bucket}` : null,
      signal.cap ? `cap ${signal.cap}` : null,
      signal.matched_name ? `match ${signal.matched_name}` : null,
      signal.matched_domain ? signal.matched_domain : null,
      signal.explanation,
    ].filter(Boolean);
    return bits.join(" · ") || signal.error_status || "Provider attempted.";
  };

  const reliabilityScheme = (r: Reliability) =>
    r === "high" ? "green" : r === "medium" ? "blue" : r === "mixed" ? "yellow" : r === "low" ? "orange" : r === "flagged" ? "red" : "gray";

  const providerDot = (key: string) => {
    const signal = latestSignalFor(key);
    if (signal) return signalStatus(signal).color;
    if (enrichRunning) return "#f6ad55";
    const s = latestRunStatusFor(key);
    if (s === "found")     return "#48bb78";
    if (s === "skipped")   return "var(--mr-blue)";
    if (s === "not_found" || s === "error") return "#fc8181";
    return visibleRatings.some(r => r.source?.toLowerCase().includes(key.toLowerCase())) ? "#48bb78" : "var(--mr-text-muted)";
  };

  const biasScheme = (label?: string) => {
    if (!label) return "gray";
    const l = label.toLowerCase();
    if (l.includes("far left")) return "purple";
    if (l.includes("left"))     return "blue";
    if (l.includes("far right")) return "red";
    if (l.includes("right"))    return "orange";
    if (l.includes("center"))   return "green";
    return "gray";
  };

  const activePublisherId = resolvedId ?? sourceIdentity?.publisherId ?? domainCheckResult?.publisherId ?? undefined;
  const noId = !activePublisherId;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered scrollBehavior="inside" motionPreset="none">
        <ModalOverlay bg="rgba(0,0,0,0.6)" />
        <ModalContent borderRadius="2xl" overflow="hidden" maxH="90vh"
          style={{
            background: "linear-gradient(145deg,rgba(8,14,26,0.98) 0%,rgba(4,7,16,0.99) 100%)",
            border: "1px solid rgba(0,162,255,0.3)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
        >
          {/* ── Header ── */}
          <ModalHeader pb={2} pt={5} position="relative" zIndex={1}>
            <HStack spacing={3}>
              <SourceCrest publisherName={displayedPublisherName ?? publisherName}
                sourceType={displayedType} reliability={displayedReliability} score={suppressGenericPlatformRating ? undefined : liveProfile.score}
                admiraltyCode={displayedAdmiraltyCode ?? undefined}
                alignment={suppressGenericPlatformRating ? null : enrichment?.sourceAlignment}
                size="lg" />
              <VStack align="start" spacing={0} flex={1} minW={0}>
                <Text className="mr-heading" fontSize="md" letterSpacing="0.06em" noOfLines={2}>
                  {displayedPublisherName}
                </Text>
                <HStack spacing={1} mt="3px" flexWrap="wrap">
                  <Badge fontSize="2xs" bg="rgba(0,162,255,0.15)" color="var(--mr-blue)"
                    border="1px solid rgba(0,162,255,0.35)">{displayedType}</Badge>
                  <Badge fontSize="2xs" colorScheme={reliabilityScheme(displayedReliability)} variant="subtle">
                    {displayedReliability}
                  </Badge>
                  {enrichment?.publisher.domain && (
                    <Badge fontSize="2xs" bg="rgba(255,255,255,0.05)" color="var(--mr-text-muted)"
                      border="1px solid rgba(255,255,255,0.1)">{enrichment.publisher.domain}</Badge>
                  )}
                  <Tooltip label={noId ? "Link a publisher first" : "Refresh ratings and rebuild this publisher's SourceCrest. Does not open a tab or change the publisher link."} hasArrow>
                    <Button size="xs" height="18px" px={2} fontSize="2xs"
                      leftIcon={<RepeatIcon boxSize="9px" />}
                      isLoading={enrichRunning} loadingText="Refreshing"
                      isDisabled={noId || enrichRunning}
                      onClick={forceRefreshPublisher}
                      bg="rgba(0,162,255,0.12)" color="var(--mr-blue)"
                      border="1px solid rgba(0,162,255,0.35)" borderRadius="md"
                      _hover={{ bg: "rgba(0,162,255,0.22)" }}>
                      Force refresh
                    </Button>
                  </Tooltip>
                </HStack>
              </VStack>
            </HStack>
          </ModalHeader>
          <ModalCloseButton color="var(--mr-text-muted)" zIndex={10}
            _hover={{ color: "var(--mr-blue)", bg: "rgba(0,162,255,0.1)" }} />

          <ModalBody pb={4} position="relative" zIndex={1} overflowY="auto" minH="420px">
            {loading ? (
              <HStack justify="center" py={8}>
                <Spinner size="sm" color="var(--mr-blue)" />
                <Text fontSize="sm" color="var(--mr-text-muted)">Loading…</Text>
              </HStack>
            ) : (
              <VStack spacing={3} align="stretch">

                {/* ══ Publisher status + scrape ══════════════════════════ */}
                {contentId && (() => {
                  const isLinked   = !!activePublisherId;
                  const isSocial   = sourceUrl ? /facebook\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com/i.test(sourceUrl) : false;
                  const linkedName   = enrichment?.publisher.publisher_name ?? (isLinked ? (customName || publisherName) : null);

                  return (
                    <Box px={3} py={3} borderRadius="xl"
                      style={{ background: "rgba(0,162,255,0.03)", border: "1px solid rgba(0,162,255,0.15)" }}
                    >
                      <VStack spacing={2} align="stretch">

                        {/* Platform / channel row */}
                        {(contentPlatform || isSocial || contentChannel) && (
                          <HStack spacing={3} flexWrap="wrap">
                            <HStack spacing={1}>
                              <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">Platform</Text>
                              <Badge fontSize="2xs" px={2} borderRadius="sm"
                                style={{ background: "rgba(0,162,255,0.12)", color: "var(--mr-blue)", border: "1px solid rgba(0,162,255,0.3)" }}>
                                {contentPlatform
                                  ? contentPlatform.charAt(0).toUpperCase() + contentPlatform.slice(1)
                                  : (isSocial ? "Social" : "Web")}
                              </Badge>
                            </HStack>
                            {contentChannel && (
                              <HStack spacing={1}>
                                <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">Channel</Text>
                                <Badge fontSize="2xs" px={2} borderRadius="sm"
                                  style={{ background: "rgba(255,255,255,0.06)", color: "var(--mr-text-primary)", border: "1px solid rgba(255,255,255,0.12)" }}>
                                  {contentChannel}
                                </Badge>
                              </HStack>
                            )}
                          </HStack>
                        )}

                        {/* ── Facebook container provenance ── */}
                        {facebookContainer && (
                          <Box pt="2px">
                            <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">
                              {facebookContainer.containerType === "facebook_group" ? "Posted in group" : "Posted via"}
                            </Text>
                            <Text fontSize="sm" fontWeight="900" color="var(--mr-text-primary)" lineHeight="1.25">
                              {facebookContainer.name}
                            </Text>
                            {facebookContainer.directSocialPublisher && (
                              <Text fontSize="2xs" color="var(--mr-text-muted)" mt="2px">
                                Posted by {facebookContainer.directSocialPublisher}
                              </Text>
                            )}
                          </Box>
                        )}

                        {/* ── Publisher status ── */}
                        <HStack spacing={2} justify="space-between" align="center" flexWrap="wrap">
                          <HStack spacing={1}>
                            {isLinked ? (
                              <Text fontSize="xs" color="#48bb78" fontWeight="700">
                                ✓ {linkedName ?? "Publisher linked"}
                              </Text>
                            ) : (
                              <Text fontSize="xs" color="rgba(246,173,85,0.85)" fontWeight="600">
                                ○ No publisher linked
                              </Text>
                            )}
                          </HStack>
                        </HStack>

                        {/* Linked article domain (social chain info) */}
                        {linkedPublisher && (
                          <HStack spacing={2} flexWrap="wrap" align="center">
                            <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">
                              Linked article
                            </Text>
                            <Badge fontSize="xs" px={2} py="2px" borderRadius="md" fontWeight="700"
                              style={{ background: "rgba(72,187,120,0.12)", color: "#48bb78", border: "1px solid rgba(72,187,120,0.35)" }}>
                              {linkedPublisher}
                            </Badge>
                            {domainCheckLoading && <Spinner size="xs" color="var(--mr-blue)" />}
                          </HStack>
                        )}

                        {/* ── Background lookup result ── */}
                        {domainCheckResult && !domainCheckLoading && (
                          domainCheckResult.pageBlocked ? (
                            <Text fontSize="2xs" color="rgba(252,129,129,0.75)">
                              Background fetch blocked — Re-scrape opens the page in a tab so the extension can read it.
                            </Text>
                          ) : (
                            <HStack spacing={2} align="center" flexWrap="wrap">
                              <Text fontSize="2xs" color="rgba(72,187,120,0.9)">
                                Found: <Text as="span" fontWeight="700">{domainCheckResult.publisherName ?? domainCheckResult.rootDomain}</Text>
                                {domainCheckResult.publisherId && " · in DB"}
                              </Text>
                              {!isLinked && (
                                <Button size="xs"
                                  onClick={() => {
                                    setCustomName(domainCheckResult.publisherName ?? domainCheckResult.rootDomain ?? linkedPublisher ?? "");
                                    setShowRelink(true);
                                  }}
                                  bg="rgba(72,187,120,0.15)" color="#48bb78"
                                  border="1px solid rgba(72,187,120,0.4)" borderRadius="md"
                                  height="20px" px={3} fontSize="2xs" fontWeight="700"
                                  _hover={{ bg: "rgba(72,187,120,0.28)" }}>
                                  Link this publisher
                                </Button>
                              )}
                            </HStack>
                          )
                        )}

                        {/* ── Background lookup button (when not linked, no result yet) ── */}
                        {!isLinked && sourceUrl && !domainCheckResult && !domainCheckLoading && (
                          <Button size="xs"
                            onClick={() => checkPublisherDomain(sourceUrl)}
                            bg="rgba(255,255,255,0.04)" color="var(--mr-text-muted)"
                            border="1px solid rgba(255,255,255,0.1)" borderRadius="md"
                            height="22px" px={3} fontSize="2xs" fontWeight="600"
                            _hover={{ bg: "rgba(255,255,255,0.08)", color: "var(--mr-text-primary)" }}>
                            Try background publisher lookup
                          </Button>
                        )}

                        {scrapeStatus && (
                          <Text fontSize="2xs" color="rgba(246,173,85,0.65)">{scrapeStatus}</Text>
                        )}
                      </VStack>
                    </Box>
                  );
                })()}

                {enrichment?.sourceAlignment && (
                  <Box px={3} py={3} borderRadius="xl"
                    style={{ background: "rgba(246,173,85,0.06)", border: "1px solid rgba(246,173,85,0.28)" }}>
                    <HStack justify="space-between" align="start" spacing={3}>
                      <VStack align="start" spacing={1}>
                        <HStack spacing={2} flexWrap="wrap">
                          <Badge fontSize="2xs" color="#fff" bg="rgba(246,173,85,0.28)"
                            border="1px solid rgba(246,173,85,0.6)">
                            {enrichment.sourceAlignment.marker}
                          </Badge>
                          <Text fontSize="xs" fontWeight="800" color="var(--mr-text-primary)">
                            {enrichment.sourceAlignment.label}
                          </Text>
                          <Text fontSize="2xs" color="#f6ad55" textTransform="uppercase">
                            {enrichment.sourceAlignment.degree} material-interest risk
                            {enrichment.sourceAlignment.riskScore != null ? ` · ${Math.round(enrichment.sourceAlignment.riskScore)}/100` : ""}
                          </Text>
                        </HStack>
                        {governmentOperatorName && (
                          <Box pt="2px">
                            <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">
                              Operated by
                            </Text>
                            <Text fontSize="sm" fontWeight="900" color="var(--mr-text-primary)" lineHeight="1.25">
                              {governmentOperatorName}
                            </Text>
                          </Box>
                        )}
                        <Text fontSize="2xs" color="var(--mr-text-muted)" lineHeight="1.55">
                          {enrichment.sourceAlignment.explanation || "This publisher has a disclosed institutional alignment that may matter for claims affecting its interests."}
                        </Text>
                        {enrichment.publisherStatus?.evidence?.find(item => item.source_url)?.source_url && (
                          <Link href={enrichment.publisherStatus.evidence.find(item => item.source_url)?.source_url ?? undefined}
                            isExternal fontSize="2xs" color="var(--mr-blue)">
                            View self-described evidence <ExternalLinkIcon mx="2px" />
                          </Link>
                        )}
                      </VStack>
                    </HStack>
                  </Box>
                )}

                {/* ══ How we identified this source ══════════════════════ */}
                {sourceUrl && (sourceIdentity || identityLoading) && (
                  <Box borderRadius="lg" overflow="hidden"
                    style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                    {/* Drawer header — always visible */}
                    <HStack
                      px={3} py="6px" justify="space-between" cursor="pointer"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                      onClick={() => setShowIdentity(v => !v)}
                    >
                      <HStack spacing={2}>
                        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">
                          How we identified this source
                        </Text>
                        {identityLoading && <Spinner size="xs" color="var(--mr-text-muted)" />}
                        {sourceIdentity && !identityLoading && (
                          <Tooltip label={LEVEL_LABEL[sourceIdentity.resolutionLevel]?.desc} hasArrow openDelay={200}>
                            <Badge fontSize="2xs" px={1} py="1px" borderRadius="sm" cursor="help"
                              style={{
                                background: "rgba(255,255,255,0.05)",
                                border: `1px solid ${LEVEL_LABEL[sourceIdentity.resolutionLevel]?.color ?? "rgba(255,255,255,0.15)"}`,
                                color: LEVEL_LABEL[sourceIdentity.resolutionLevel]?.color ?? "rgba(255,255,255,0.5)",
                              }}>
                              {LEVEL_LABEL[sourceIdentity.resolutionLevel]?.label ?? "Unknown"}
                            </Badge>
                          </Tooltip>
                        )}
                        {sourceIdentity?.pageBlocked && (
                          <Badge fontSize="2xs" bg="rgba(252,129,129,0.08)" color="rgba(252,129,129,0.7)"
                            border="1px solid rgba(252,129,129,0.2)">blocked</Badge>
                        )}
                        {sourceIdentity?.needsHumanReview && !sourceIdentity?.pageBlocked && (
                          <Badge fontSize="2xs" bg="rgba(246,173,85,0.08)" color="rgba(246,173,85,0.6)"
                            border="1px solid rgba(246,173,85,0.2)">needs review</Badge>
                        )}
                      </HStack>
                      <HStack spacing={1}>
                        {showIdentity ? <ChevronUpIcon color="var(--mr-text-muted)" boxSize="12px"/> : <ChevronDownIcon color="var(--mr-text-muted)" boxSize="12px"/>}
                      </HStack>
                    </HStack>
                    <Collapse in={showIdentity} animateOpacity>
                      {sourceIdentity && !identityLoading && (
                        <Box px={3} pb={3} pt={2}>
                          {sourceIdentity.sourceType === "social" ? (
                            <Text fontSize="2xs" color="var(--mr-text-muted)" mb={2} lineHeight="1.6">
                              <Text as="span" color="var(--mr-text-primary)">{sourceIdentity.metadata?.platformName ?? "Social platform"}</Text>
                              {sourceIdentity.metadata?.platformAccountName && (
                                <> · group/page: <Text as="span" color="var(--mr-text-primary)">{sourceIdentity.metadata.platformAccountName}</Text></>
                              )}
                              {linkedPublisher
                                ? <> · linked article: <Text as="span" color="#48bb78">{linkedPublisher}</Text></>
                                : " · linked article publisher not yet extracted"}
                            </Text>
                          ) : (
                            <Text fontSize="2xs" color="var(--mr-text-muted)" mb={2} lineHeight="1.6">
                              {LEVEL_LABEL[sourceIdentity.resolutionLevel]?.desc ?? "Status unknown."}
                              {sourceIdentity.rootDomain && <> Domain: <Text as="span" color="var(--mr-text-primary)">{sourceIdentity.rootDomain}</Text></>}
                              {sourceIdentity.metadata?.platformName && ` · Platform: ${sourceIdentity.metadata.platformName}`}
                              {sourceIdentity.metadata?.platformAccountName && ` (${sourceIdentity.metadata.platformAccountName})`}
                            </Text>
                          )}
                          {/* Scrape fallback — shown for all URL types including social */}
                          {contentId && (sourceIdentity.pageBlocked || !sourceIdentity.candidates?.some(c => c.confidence === "high")) && (
                            <Box>
                              {sourceIdentity.pageBlocked && (
                                <Text fontSize="2xs" color="rgba(252,129,129,0.7)" mb={1}>
                                  The backend fetch is blocked for this URL. Use the extension scrape button only when you want to open a tab and read the page directly.
                                </Text>
                              )}
                              {scrapeStatus && (
                                <Text fontSize="2xs" color="rgba(246,173,85,0.7)" mb={1}>{scrapeStatus}</Text>
                              )}
                              <Text fontSize="2xs" color="var(--mr-text-muted)">
                                Use Open tab &amp; re-scrape source under Change publisher only if background lookup cannot recover the identity.
                              </Text>
                            </Box>
                          )}
                        </Box>
                      )}
                    </Collapse>
                  </Box>
                )}

                {/* ══ Is this the original source? ═══════════════════════ */}
                {sourceUrl && (lineage || lineageLoading) && (
                  <Box borderRadius="lg" overflow="hidden"
                    style={{ border: lineage?.lineageType && lineage.lineageType !== "original" && lineage.lineageType !== "unknown"
                      ? "1px solid rgba(246,173,85,0.2)" : "1px solid rgba(255,255,255,0.08)" }}>
                    <HStack
                      px={3} py="6px" justify="space-between" cursor="pointer"
                      style={{ background: "rgba(255,255,255,0.03)" }}
                      onClick={() => setShowLineage(v => !v)}
                    >
                      <HStack spacing={2}>
                        <Text fontSize="2xs" color="var(--mr-text-muted)" textTransform="uppercase" letterSpacing="0.08em">
                          Is this the original source?
                        </Text>
                        {lineageLoading && <Spinner size="xs" color="var(--mr-text-muted)" />}
                        {lineage && !lineageLoading && (
                          <Badge fontSize="2xs" px={1} borderRadius="sm"
                            style={{
                              background: "rgba(255,255,255,0.05)",
                              border: `1px solid ${LINEAGE_META[lineage.lineageType]?.color ?? "rgba(255,255,255,0.15)"}`,
                              color: LINEAGE_META[lineage.lineageType]?.color ?? "rgba(255,255,255,0.5)",
                            }}>
                            {LINEAGE_META[lineage.lineageType]?.label ?? lineage.lineageType}
                          </Badge>
                        )}
                      </HStack>
                      <HStack spacing={1}>
                        <Button size="xs" variant="ghost" color="var(--mr-text-muted)" height="14px" minW="auto" px={1}
                          _hover={{ color: "var(--mr-blue)" }}
                          onClick={e => { e.stopPropagation(); loadLineage(true); }}
                          title="Re-detect lineage">
                          <RepeatIcon boxSize="9px" />
                        </Button>
                        {showLineage ? <ChevronUpIcon color="var(--mr-text-muted)" boxSize="12px"/> : <ChevronDownIcon color="var(--mr-text-muted)" boxSize="12px"/>}
                      </HStack>
                    </HStack>
                    <Collapse in={showLineage} animateOpacity>
                      {lineage && !lineageLoading && (
                        <Box px={3} pb={3} pt={2}>
                          <LineagePanel lineage={lineage} loading={false} onRefresh={() => loadLineage(true)} />
                        </Box>
                      )}
                    </Collapse>
                  </Box>
                )}

                {/* ══ Fix or update the publisher link ══════════════════ */}
                {contentId && (
                  <Box borderRadius="lg" overflow="hidden"
                    style={{
                      background: noId ? "rgba(246,173,85,0.05)" : "transparent",
                      border: noId ? "1px solid rgba(246,173,85,0.35)" : "1px solid rgba(255,255,255,0.08)",
                      boxShadow: noId ? "0 0 16px rgba(246,173,85,0.06)" : "none",
                    }}>
                    {/* Drawer header */}
                    <HStack
                      px={3} py="6px" justify="space-between" cursor="pointer"
                      style={{ background: noId ? "rgba(246,173,85,0.06)" : "rgba(255,255,255,0.03)" }}
                      onClick={() => setShowRelink(v => !v)}
                    >
                      <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.08em"
                        style={{ color: noId ? "#f6ad55" : "var(--mr-text-muted)" }}>
                        {noId ? "Publisher not linked — action required" : "Change publisher"}
                      </Text>
                      {showRelink ? <ChevronUpIcon color="var(--mr-text-muted)" boxSize="12px"/> : <ChevronDownIcon color="var(--mr-text-muted)" boxSize="12px"/>}
                    </HStack>
                    <Collapse in={showRelink} animateOpacity>
                      <Box px={3} py={3}>
                        <Text fontSize="2xs" color="var(--mr-text-muted)" mb={2} lineHeight="1.6">
                          {noId
                            ? "No publisher record is linked to this article yet. Choose a name below and click Link publisher — this creates the publisher record, fetches available ratings, and links everything in one step."
                            : "The linked publisher can be corrected here. Candidates below are names detected automatically from the article URL — they may differ from the publisher shown in the title if it was set manually via scrape."}
                        </Text>
                        <Tooltip label="Fallback only: opens the source in a new tab, queues an extension scrape, then refreshes and offers the detected publisher." hasArrow>
                          <Button size="xs"
                            bg="rgba(246,173,85,0.1)" color="#f6ad55"
                            border="1px solid rgba(246,173,85,0.35)" borderRadius="md"
                            isLoading={scrapePolling} loadingText="Waiting for extension…"
                            isDisabled={!sourceUrl || scrapePolling}
                            onClick={() => scrapeForPublisher(undefined, true)}>
                            Open tab &amp; re-scrape source
                          </Button>
                        </Tooltip>
                    </Box>
                    </Collapse>
                  </Box>
                )}

                {/* ══ Re-link inner content (candidates + input) — kept outside Collapse so layout is stable */}
                {contentId && showRelink && (
                  <Box px={3} pb={1}>
                    <VStack spacing={2} align="stretch">
                      {linkedPublisher && (
                        <Box>
                          <Text fontSize="2xs" color="var(--mr-text-muted)" mb={1}>
                            Linked article publisher — click to use:
                          </Text>
                          <Button size="xs"
                            onClick={() => setCustomName(linkedPublisher)}
                            bg={customName === linkedPublisher ? "rgba(72,187,120,0.25)" : "rgba(72,187,120,0.08)"}
                            color={customName === linkedPublisher ? "#48bb78" : "rgba(72,187,120,0.8)"}
                            border={`1px solid ${customName === linkedPublisher ? "rgba(72,187,120,0.5)" : "rgba(72,187,120,0.25)"}`}
                            borderRadius="md" height="20px" px={2} fontSize="2xs"
                            _hover={{ bg: "rgba(72,187,120,0.2)", color: "#48bb78" }}
                            title="Publisher of the article shared in this social post"
                          >
                            {linkedPublisher}
                            <Text as="span" ml={1} opacity={0.5} fontSize="8px" textTransform="uppercase">
                              linked article
                            </Text>
                          </Button>
                        </Box>
                      )}
                      {sourceIdentity?.candidates?.length ? (
                        <Box>
                          <Text fontSize="2xs" color="var(--mr-text-muted)" mb={1}>
                            Resolution candidates — click to select:
                          </Text>
                          <HStack spacing={1} flexWrap="wrap">
                            {sourceIdentity.candidates.map((c, i) => (
                              <Button key={i} size="xs"
                                onClick={() => setCustomName(c.name)}
                                bg={customName === c.name ? "rgba(246,173,85,0.25)" : "rgba(255,255,255,0.04)"}
                                color={customName === c.name ? "#f6ad55" : "var(--mr-text-muted)"}
                                border={`1px solid ${customName === c.name ? "rgba(246,173,85,0.5)" : "rgba(255,255,255,0.1)"}`}
                                borderRadius="md" height="20px" px={2} fontSize="2xs"
                                _hover={{ bg: "rgba(246,173,85,0.15)", color: "#f6ad55" }}
                                title={`Source: ${c.source} · Confidence: ${c.confidence}`}
                              >
                                {c.name}
                                <Text as="span" ml={1} opacity={0.5} fontSize="8px" textTransform="uppercase">
                                  {c.source}
                                </Text>
                              </Button>
                            ))}
                          </HStack>
                        </Box>
                      ) : null}
                      <HStack spacing={1}>
                        <Input
                          size="xs"
                          value={customName}
                          onChange={e => { setCustomName(e.target.value); setDomainCheckResult(null); }}
                          placeholder="Publisher name or domain (e.g. emfacts.com)"
                          borderRadius="md"
                          style={{
                            background: "rgba(255,255,255,0.05)",
                            border: `1px solid ${noId ? "rgba(246,173,85,0.35)" : "rgba(255,255,255,0.15)"}`,
                            color: "var(--mr-text-primary)",
                            fontSize: "0.75rem",
                          }}
                          _placeholder={{ color: "var(--mr-text-muted)" }}
                        />
                        <Tooltip label="Try to identify publisher from this domain in the background (no tab needed)" hasArrow openDelay={300}>
                          <Button size="xs"
                            bg="rgba(255,255,255,0.05)" color="var(--mr-text-muted)"
                            border="1px solid rgba(255,255,255,0.12)" borderRadius="md"
                            height="24px" px={2} fontSize="2xs" flexShrink={0}
                            isLoading={domainCheckLoading} loadingText="…"
                            isDisabled={!customName.trim()}
                            _hover={{ bg: "rgba(0,162,255,0.15)", color: "var(--mr-blue)", borderColor: "rgba(0,162,255,0.4)" }}
                            onClick={() => checkPublisherDomain(customName)}
                          >
                            Check
                          </Button>
                        </Tooltip>
                      </HStack>
                      {/* Domain check result */}
                      {domainCheckResult && (
                        <Box px={2} py={1} borderRadius="md"
                          style={{
                            background: domainCheckResult.pageBlocked
                              ? "rgba(252,129,129,0.06)" : "rgba(72,187,120,0.06)",
                            border: domainCheckResult.pageBlocked
                              ? "1px solid rgba(252,129,129,0.2)" : "1px solid rgba(72,187,120,0.2)",
                          }}>
                          {domainCheckResult.pageBlocked ? (
                            <VStack align="start" spacing={1}>
                              <Text fontSize="2xs" color="rgba(252,129,129,0.8)">
                                Background check blocked — page requires login or blocks bots.
                              </Text>
                            </VStack>
                          ) : (
                            <Text fontSize="2xs" color="rgba(72,187,120,0.9)" lineHeight="1.5">
                              Found: <Text as="span" fontWeight="700">{domainCheckResult.publisherName}</Text>
                              {domainCheckResult.publisherId && " · already in DB"}
                              {domainCheckResult.resolutionStatus && ` · ${domainCheckResult.resolutionStatus.replace(/_/g," ")}`}
                            </Text>
                          )}
                        </Box>
                      )}
                      <HStack spacing={2} align="center">
                        <Button size="xs"
                          bg={noId ? "rgba(246,173,85,0.15)" : "rgba(0,162,255,0.12)"}
                          color={noId ? "#f6ad55" : "var(--mr-blue)"}
                          border={`1px solid ${noId ? "rgba(246,173,85,0.4)" : "rgba(0,162,255,0.35)"}`}
                          borderRadius="md"
                          _hover={{ bg: noId ? "rgba(246,173,85,0.28)" : "rgba(0,162,255,0.25)" }}
                          isLoading={linking || enrichRunning}
                          loadingText={enrichRunning ? "Enriching…" : "Linking…"}
                          isDisabled={!customName.trim()}
                          onClick={linkPublisher}
                        >
                          {rescrapeDetected ? "Save publisher link & force refresh" : "Save publisher link"}
                        </Button>
                        {linkError && (
                          <Text fontSize="2xs" color="#fc8181">{linkError}</Text>
                        )}
                      </HStack>
                    </VStack>
                  </Box>
                )}

                {/* ══ PIPELINE 1: Media Enrichment ══════════════════════════ */}
                <ActionPanel
                  title="Media Enrichment"
                  subtitle="Direct providers and profiles; disabled ratings remain visible historically"
                  accentVar="var(--mr-blue)"
                  borderVar="rgba(0,162,255,0.35)"
                  glowVar="rgba(0,162,255,0.08)"
                  disabled={noId}
                  disabledReason={noId ? "awaiting link" : undefined}
                >
                  {/* Provider status rows */}
                  <VStack spacing={1} align="stretch" mb={3} mt={2}>
                    {ENRICHMENT_PROVIDERS.filter(p => !isProviderDisabled(p)).map(p => {
                      const rating = visibleRatings.find(r =>
                        r.source?.toLowerCase().includes(p.key.toLowerCase())
                      );
                      const signal = latestSignalFor(p.key);
                      const persistedRun = latestPersistedRunFor(p.key);
                      const runStatus = latestRunStatusFor(p.key);
                      const storedStatus = signal ? signalStatus(signal, p) : rating
                        ? { label: "rating on file", color: "#48BB78", enabled: true }
                        : runStatus
                          ? {
                              label: runStatus === "found" ? "found" : runStatus.replace(/_/g, " "),
                              color: runStatus === "found" ? "#48BB78" : runStatus === "skipped" ? "var(--mr-blue)" : "#F6AD55",
                              enabled: true,
                            }
                          : signalStatus(signal, p);
                      const explicitlyDisabled = "enabled" in p && p.enabled === false;
                      const isQuickRefreshProvider = QUICK_REFRESH_PROVIDER_KEYS.has(p.key);
                      const status = explicitlyDisabled
                        ? { label: p.disabledReason || "disabled", color: "var(--mr-text-muted)", enabled: false }
                        : enrichRunning && isQuickRefreshProvider
                          ? { label: "checking", color: "#F6AD55", enabled: true }
                        : storedStatus;
                      return (
                        <HStack key={p.key} spacing={3} py="5px" align="start"
                          borderBottom="1px solid rgba(0,162,255,0.08)" _last={{ borderBottom: "none" }}>
                          <Box w="7px" h="7px" borderRadius="full" flexShrink={0} mt="5px"
                            style={{ background: status.color, boxShadow: `0 0 6px ${status.color}` }} />
                          <VStack align="start" spacing={0.5} flex={1} minW={0}>
                            <HStack spacing={1.5} flexWrap="wrap">
                              <Text fontSize="xs" fontWeight="700" color="var(--mr-text-primary)" minW="78px">{p.label}</Text>
                              <Badge fontSize="2xs" color={status.color} bg="rgba(255,255,255,0.04)" border="1px solid rgba(255,255,255,0.09)">
                                {status.enabled ? "enabled" : "disabled"}
                              </Badge>
                              <Badge fontSize="2xs" color={status.color} bg="rgba(255,255,255,0.04)" border="1px solid rgba(255,255,255,0.09)">
                                {status.label}
                              </Badge>
                              {signal?.cap && (
                                <Badge fontSize="2xs" color="#F6AD55" bg="rgba(246,173,85,0.08)" border="1px solid rgba(246,173,85,0.2)">
                                  cap {signal.cap}
                                </Badge>
                              )}
                            </HStack>
                            <Text fontSize="2xs" color="var(--mr-text-muted)" noOfLines={2}>
                              {signal ? signalSummary(signal) : rating
                                ? `${rating.rating_type || "rating"}${rating.veracity_score != null ? ` · ${Math.round(Number(rating.veracity_score))}%` : ""}${rating.rating_label ? ` · ${rating.rating_label}` : ""}`
                                : persistedRun
                                  ? `${persistedRun.status.replace(/_/g, " ")}${persistedRun.error_message ? ` · ${persistedRun.error_message}` : ""}`
                                  : p.desc}
                            </Text>
                            <HStack spacing={2} flexWrap="wrap">
                              {signal?.evidence_url && (
                                <Link href={signal.evidence_url} isExternal fontSize="2xs" color="var(--mr-blue)">
                                  evidence <ExternalLinkIcon mx="2px" />
                                </Link>
                              )}
                              {signal?.retrieved_at && (
                                <Text fontSize="2xs" color="var(--mr-text-muted)">
                                  {new Date(signal.retrieved_at).toLocaleTimeString()}
                                </Text>
                              )}
                              {rating?.last_checked && !signal?.retrieved_at && (
                                <Text fontSize="2xs" color="var(--mr-text-muted)">
                                  rating {new Date(rating.last_checked).toLocaleDateString()}
                                </Text>
                              )}
                              {persistedRun?.created_at && !signal?.retrieved_at && !rating?.last_checked && (
                                <Text fontSize="2xs" color="var(--mr-text-muted)">
                                  attempted {new Date(persistedRun.created_at).toLocaleTimeString()}
                                </Text>
                              )}
                            </HStack>
                          </VStack>
                        </HStack>
                      );
                    })}
                  </VStack>

                  {disabledEnrichmentProviders.length > 0 && (
                    <Box mb={3} borderRadius="md" border="1px solid rgba(255,255,255,0.08)" overflow="hidden">
                      <HStack px={3} py={2} justify="space-between" cursor="pointer"
                        bg="rgba(255,255,255,0.025)"
                        onClick={() => setShowDisabledProviders(value => !value)}>
                        <Text fontSize="2xs" color="var(--mr-text-muted)" fontWeight="700">
                          Disabled / unavailable resources ({disabledEnrichmentProviders.length})
                        </Text>
                        {showDisabledProviders
                          ? <ChevronUpIcon color="var(--mr-text-muted)" boxSize="12px" />
                          : <ChevronDownIcon color="var(--mr-text-muted)" boxSize="12px" />}
                      </HStack>
                      <Collapse in={showDisabledProviders} animateOpacity={false}>
                        <VStack spacing={0} align="stretch" px={3} pb={2}>
                          {disabledEnrichmentProviders.map(provider => {
                            const signal = latestSignalFor(provider.key);
                            const rating = visibleRatings.find(item =>
                              item.source?.toLowerCase().includes(provider.key.toLowerCase())
                            );
                            const status = provider.enabled === false
                              ? provider.disabledReason || "disabled"
                              : signalStatus(signal, provider).label;
                            return (
                              <HStack key={provider.key} py="5px" justify="space-between" align="start"
                                borderTop="1px solid rgba(255,255,255,0.05)">
                                <VStack align="start" spacing={0} minW={0}>
                                  <Text fontSize="xs" color="var(--mr-text-muted)" fontWeight="700">{provider.label}</Text>
                                  <Text fontSize="2xs" color="var(--mr-text-muted)" noOfLines={2}>
                                    {rating
                                      ? `Historical ${rating.rating_label || rating.rating_type || "rating"}${rating.last_checked ? ` · ${new Date(rating.last_checked).toLocaleDateString()}` : ""}`
                                      : provider.desc}
                                  </Text>
                                </VStack>
                                <Badge fontSize="2xs" color="#A0AEC0" bg="rgba(255,255,255,0.04)">{status}</Badge>
                              </HStack>
                            );
                          })}
                        </VStack>
                      </Collapse>
                    </Box>
                  )}

                  {enrichRunning && (
                    <Box mt={2} px={3} py={2} borderRadius="md"
                      style={{ background: "rgba(246,173,85,0.08)", border: "1px solid rgba(246,173,85,0.25)" }}>
                      <HStack spacing={2}>
                        <Spinner size="xs" color="#F6AD55" />
                        <Text fontSize="2xs" color="#F6AD55">
                          Refresh request is running on the backend. This panel will stay in place until the summary returns.
                        </Text>
                      </HStack>
                    </Box>
                  )}

                  {/* Feedback */}
                  {enrichResult && !enrichRunning && (
                    <Box mt={2} px={3} py={2} borderRadius="md"
                      style={{
                        background: enrichResult.status === "skipped" ? "rgba(0,162,255,0.08)" : "rgba(72,187,120,0.1)",
                        border: enrichResult.status === "skipped" ? "1px solid rgba(0,162,255,0.2)" : "1px solid rgba(72,187,120,0.25)",
                      }}>
                      <Text fontSize="2xs"
                        style={{ color: enrichResult.status === "skipped" ? "var(--mr-blue)" : "#68d391" }}>
                        {enrichResult.status === "skipped"
                          ? `All providers up to date (${enrichResult.reason ?? "fresh"})`
                          : `Checked ${enrichResult.tasks_run ?? 0} active provider(s): ${Object.entries(enrichResult.results ?? {})
                              .filter(([name]) => name !== "SearchLlmRatingFallback")
                              .map(([name, value]) => `${name} ${value.status}`)
                              .join(" · ") || "no provider results returned"}`}
                      </Text>
                    </Box>
                  )}
                  {enrichError && (
                    <Box mt={2} px={3} py={2} borderRadius="md"
                      style={{ background: "rgba(252,129,129,0.1)", border: "1px solid rgba(252,129,129,0.25)" }}>
                      <Text fontSize="2xs" color="#fc8181">{enrichError}</Text>
                    </Box>
                  )}
                </ActionPanel>

                {/* ══ PIPELINE 2: Validity Checks ═══════════════════════════ */}
                <ActionPanel
                  title="Validity Checks"
                  subtitle="OpenSanctions · GDI · CourtListener — writes to credibility records"
                  accentVar="var(--mr-purple)"
                  borderVar="rgba(139,92,246,0.35)"
                  glowVar="rgba(139,92,246,0.08)"
                  disabled={noId}
                  disabledReason={noId ? "awaiting link" : undefined}
                >
                  {/* Provider rows */}
                  <VStack spacing={1} align="stretch" mb={3} mt={2}>
                    {CREDIBILITY_PROVIDERS.map(p => (
                      <HStack key={p.label} spacing={3} py="3px"
                        borderBottom="1px solid rgba(139,92,246,0.08)" _last={{ borderBottom: "none" }}>
                        <Box w="7px" h="7px" borderRadius="full" flexShrink={0}
                          style={{ background: "var(--mr-text-muted)", boxShadow: "none" }} />
                        <Text fontSize="xs" fontWeight="700" color="var(--mr-text-primary)" minW="110px">{p.label}</Text>
                        <Text fontSize="2xs" color="var(--mr-text-muted)" flex={1}>{p.desc}</Text>
                      </HStack>
                    ))}
                  </VStack>

                  <Tooltip
                    label={noId ? "Link a publisher record first (see above)" : "OpenSanctions · GDI · CourtListener"}
                    placement="top" shouldWrapChildren
                  >
                    <Button size="xs"
                      bg="rgba(139,92,246,0.15)" color="var(--mr-purple)"
                      border="1px solid rgba(139,92,246,0.4)" borderRadius="md"
                      _hover={{ bg: "rgba(139,92,246,0.3)", boxShadow: "0 0 14px rgba(139,92,246,0.3)" }}
                      isDisabled={noId}
                      onClick={() => setCredibilityOpen(true)}
                    >
                      Run Validity Checks
                    </Button>
                  </Tooltip>
                </ActionPanel>

                {/* ══ Current ratings (shown when table has data) ═══════════ */}
                {hasRatings && (
                  <VStack spacing={2} align="stretch">
                    <Text fontSize="2xs" fontWeight="700" color="var(--mr-text-muted)"
                      textTransform="uppercase" letterSpacing="0.12em" px={1} pt={1}>
                      Current Ratings
                    </Text>

                    {[allSides, adFontes, mbfc, ...otherRatings].filter(Boolean).map((r, i) => (
                      <RatingCard key={i} accent="rgba(0,162,255,0.35)" glow="rgba(0,162,255,0.08)">
                        <HStack justify="space-between" mb={2} flexWrap="wrap" gap={1}>
                          <Text fontSize="xs" fontWeight="800" textTransform="uppercase" letterSpacing="0.08em"
                            style={{ color: "var(--mr-blue)", textShadow: "0 0 10px rgba(0,162,255,0.6)" }}>
                            {r!.source}
                          </Text>
                          {r!.url && (
                            <Link href={r!.url} isExternal fontSize="2xs" color="var(--mr-text-muted)"
                              _hover={{ color: "var(--mr-blue)" }}>
                              source <ExternalLinkIcon mx="2px" />
                            </Link>
                          )}
                        </HStack>
                        {r!.rating_label && (
                          <Badge colorScheme={biasScheme(r!.rating_label)} mb={1} px={2} py={1} fontSize="xs"
                            style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)" }}>
                            {r!.rating_label}
                          </Badge>
                        )}
                        {r!.bias_score != null && <BiasBar value={r!.bias_score} />}
                        {r!.veracity_score != null && (
                          <ScoreBar value={r!.veracity_score} label="Veracity score" />
                        )}
                        {r!.evidence_quote && (
                          <Box mt={2} pl={2}
                            style={{ borderLeft: "2px solid rgba(0,162,255,0.35)", boxShadow: "-3px 0 10px rgba(0,162,255,0.08)" }}>
                            <Text fontSize="2xs" color="var(--mr-text-muted)" fontStyle="italic" noOfLines={3} lineHeight="1.6">
                              "{r!.evidence_quote}"
                            </Text>
                          </Box>
                        )}
                      </RatingCard>
                    ))}
                  </VStack>
                )}

                {/* Publisher profile notes */}
                {firstProfile && (firstProfile.credibility_notes || firstProfile.ownership_notes || firstProfile.country) && (
                  <RatingCard accent="rgba(0,162,255,0.2)" glow="rgba(0,162,255,0.04)">
                    <Text fontSize="2xs" fontWeight="700" color="var(--mr-text-muted)"
                      textTransform="uppercase" letterSpacing="0.1em" mb={2}>Profile</Text>
                    <VStack spacing={2} align="stretch">
                      {firstProfile.country && (
                        <HStack><Text fontSize="xs" color="var(--mr-text-muted)" minW="70px">Country</Text>
                          <Text fontSize="xs" color="var(--mr-text-primary)">{firstProfile.country}</Text></HStack>
                      )}
                      {firstProfile.credibility_notes && (
                        <Text fontSize="xs" color="var(--mr-text-primary)" noOfLines={4} lineHeight="1.5">
                          {firstProfile.credibility_notes}
                        </Text>
                      )}
                    </VStack>
                  </RatingCard>
                )}

                {/* Empty + no id state */}
                {!hasRatings && !loading && (
                  <Box px={3} py={2} borderRadius="md"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <Text fontSize="xs" color="var(--mr-text-muted)" textAlign="center">
                      {noId
                        ? "Link a publisher record above to enable enrichment."
                        : "No ratings yet — use Force refresh at the top to fetch available provider ratings."}
                    </Text>
                  </Box>
                )}
              </VStack>
            )}
          </ModalBody>

          <ModalFooter gap={2} borderTop="1px solid rgba(0,162,255,0.1)" bg="rgba(0,0,0,0.2)"
            position="relative" zIndex={1}>
            {!noId && (
              <Button size="sm" className="mr-button" rightIcon={<ExternalLinkIcon />}
                onClick={() => { onClose(); navigate(`/credibility?publisherId=${activePublisherId}`); }}>
                Credibility Checks
              </Button>
            )}
            <Button size="sm" bg="transparent" color="var(--mr-text-muted)"
              border="1px solid rgba(255,255,255,0.1)"
              _hover={{ color: "var(--mr-text-primary)", borderColor: "rgba(255,255,255,0.2)" }}
              onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {publisherId && (
        <CredibilityInfoModal
          isOpen={credibilityOpen}
          onClose={() => setCredibilityOpen(false)}
          entityType="publisher"
          entityId={publisherId}
          entityName={enrichment?.publisher.publisher_name ?? publisherName}
        />
      )}
    </>
  );
};

export default SourceDetailModal;
