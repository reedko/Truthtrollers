// dashboard/src/pages/EvidenceMapPage.tsx
// Evidence Map — visual hierarchy of claims → linked evidence sources
// MR dark-glass styling; SourceCrest per evidence item.

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  Spinner,
  Center,
  Tooltip,
  Button,
  Flex,
} from "@chakra-ui/react";
import { useTaskStore } from "../store/useTaskStore";
import { useAuthStore } from "../store/useAuthStore";
import { useClaimLinkSession } from "../hooks/useClaimLinkSession";
import {
  fetchReferenceClaimTaskLinks,
  ReferenceClaimTaskLink,
} from "../services/referenceClaimRelevance";
import { fetchContentScores } from "../services/useDashboardAPI";
import SourceCrest from "../components/SourceCrest";
import BareGauge from "../components/BareGauge";
import { normalizeSourceProfile } from "../utils/normalizeSourceProfile";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";

// ── Layout constants ──────────────────────────────────────────────────────────
const COL_W = 260;   // px per claim column
const COL_GAP = 20;  // px gap between columns
const CONNECTOR = "rgba(0, 162, 255, 0.55)";
const CONNECTOR_GLOW = "0 0 8px rgba(0, 162, 255, 0.4)";

// ── Stance config ─────────────────────────────────────────────────────────────
type Stance = "support" | "refute" | "nuance" | "insufficient";

const STANCE: Record<Stance, { border: string; bg: string; glow: string; label: string; badge: string }> = {
  support:      { border: "#22c55e", bg: "rgba(34,197,94,0.08)",   glow: "0 0 16px rgba(34,197,94,0.25)",   label: "Supports",   badge: "green"  },
  refute:       { border: "#ef4444", bg: "rgba(239,68,68,0.08)",   glow: "0 0 16px rgba(239,68,68,0.25)",   label: "Refutes",    badge: "red"    },
  nuance:       { border: "#3b82f6", bg: "rgba(59,130,246,0.08)",  glow: "0 0 16px rgba(59,130,246,0.25)",  label: "Qualifies",  badge: "blue"   },
  insufficient: { border: "#6b7280", bg: "rgba(107,114,128,0.05)", glow: "none",                             label: "Insufficient", badge: "gray" },
};

function getStance(s?: string): Stance {
  if (s === "support" || s === "supports") return "support";
  if (s === "refute"  || s === "refutes")  return "refute";
  if (s === "nuance"  || s === "related")  return "nuance";
  return "insufficient";
}

// ── Verdict from 0-1 score ────────────────────────────────────────────────────
function scoreVerdict(score: number | null): { label: string; sub: string } {
  if (score === null) return { label: "Pending Assessment", sub: "Evidence links not yet evaluated." };
  if (score >= 0.85) return { label: "Strongly Supported",       sub: "Evidence strongly corroborates the claim." };
  if (score >= 0.70) return { label: "Largely True",             sub: "Substantial evidence supports the claim." };
  if (score >= 0.55) return { label: "Mostly True, Needs Context", sub: "Supported, but context or nuance is missing." };
  if (score >= 0.40) return { label: "Mixed / Partially True",   sub: "Evidence is divided or only partially supportive." };
  if (score >= 0.25) return { label: "Mostly Unsubstantiated",   sub: "Limited supporting evidence; refuting evidence present." };
  return              { label: "Not Supported",                  sub: "Evidence does not corroborate the claim." };
}

// ── Internal data types ───────────────────────────────────────────────────────
interface EvidenceItem {
  link: ReferenceClaimTaskLink;
  reference?: ReferenceWithClaims;
  letterIdx: string; // "A", "B", "C" …
}

interface ClaimWithEvidence {
  claim: Claim;
  numIdx: number;      // 1-based claim number
  evidence: EvidenceItem[];
  isLoading: boolean;
}

// ── Small reusable connector elements ─────────────────────────────────────────
const VLine = ({ h = "28px", color = CONNECTOR }: { h?: string; color?: string }) => (
  <Box w="2px" minH={h} bg={color} boxShadow={CONNECTOR_GLOW} mx="auto" />
);

const ArrowTip = ({ color = CONNECTOR }: { color?: string }) => (
  <Box
    w="0" h="0"
    borderLeft="5px solid transparent"
    borderRight="5px solid transparent"
    borderTop={`7px solid ${color}`}
    mx="auto"
  />
);

// ── Evidence card ─────────────────────────────────────────────────────────────
function EvidenceCard({
  ev, claimNum, references,
}: { ev: EvidenceItem; claimNum: number; references: ReferenceWithClaims[] }) {
  const stance = getStance(ev.link.stance);
  const s = STANCE[stance];
  const ref = ev.reference;
  const profile = normalizeSourceProfile({
    publisher_name: ref?.publisher_name,
    is_primary_source: ref?.is_primary_source,
    media_source: ref?.media_source,
    veracity_score: ref?.publisher_veracity ?? undefined,
    admiralty_code: ref?.admiralty_code ?? undefined,
  });

  const claimText = ev.link.reference_claim_text || ev.link.claim_text || "—";
  const rationale = ev.link.rationale;
  const confidencePct = ev.link.confidence != null ? Math.round(ev.link.confidence * 100) : null;

  return (
    <Box
      w={`${COL_W}px`}
      borderRadius="12px"
      border={`1.5px solid ${s.border}`}
      bg={s.bg}
      boxShadow={s.glow}
      p={3}
      position="relative"
      overflow="hidden"
      _hover={{ transform: "translateY(-2px)", transition: "transform 0.2s" }}
      transition="all 0.2s"
    >
      {/* Left accent bar */}
      <Box
        position="absolute" left={0} top={0} bottom={0} w="4px"
        bg={s.border} borderLeftRadius="12px" opacity={0.8}
      />

      <VStack align="start" spacing={1} pl={1}>
        {/* Label row */}
        <HStack spacing={2} justify="space-between" w="100%">
          <Text
            fontSize="9px" fontWeight="800" letterSpacing="0.12em"
            color={s.border} textTransform="uppercase"
          >
            EVIDENCE {claimNum}{ev.letterIdx}
          </Text>
          <Badge colorScheme={s.badge} fontSize="9px" px={1}>{s.label}</Badge>
        </HStack>

        {/* Reference title */}
        <Text fontSize="11px" fontWeight="700" color="var(--mr-text-primary)" noOfLines={2} lineHeight="1.35">
          {ref?.content_name || ev.link.source_name || "Unknown Source"}
        </Text>

        {/* Publisher row with SourceCrest */}
        <HStack spacing={2} align="center">
          <SourceCrest {...profile} size="xs" />
          <VStack align="start" spacing={0}>
            <Text fontSize="9px" color="var(--mr-text-muted)" noOfLines={1}>
              {profile.publisherName || "—"}
            </Text>
            {ref?.media_source && (
              <Text fontSize="9px" color="var(--mr-text-muted)" opacity={0.7}>
                {ref.media_source}
              </Text>
            )}
          </VStack>
        </HStack>

        {/* Claim text */}
        <Box
          bg="rgba(255,255,255,0.04)" borderRadius="6px" p={2} w="100%"
          borderLeft={`2px solid ${s.border}55`}
        >
          <Text fontSize="10px" color="var(--mr-text-secondary)" noOfLines={3} lineHeight="1.5">
            {claimText}
          </Text>
        </Box>

        {/* Rationale */}
        {rationale && (
          <Text fontSize="9px" color={s.border} fontStyle="italic" noOfLines={2} opacity={0.85}>
            "{rationale}"
          </Text>
        )}

        {/* Confidence */}
        {confidencePct !== null && (
          <HStack spacing={1}>
            <Text fontSize="9px" color="var(--mr-text-muted)" opacity={0.6}>Confidence:</Text>
            <Text fontSize="9px" color="var(--mr-text-muted)" fontWeight="600">
              {confidencePct}%
            </Text>
          </HStack>
        )}
      </VStack>
    </Box>
  );
}

// ── Claim card ────────────────────────────────────────────────────────────────
function ClaimCard({ claim, numIdx, score }: { claim: Claim; numIdx: number; score?: number }) {
  return (
    <Box
      w={`${COL_W}px`}
      borderRadius="14px"
      border="1.5px solid rgba(0,162,255,0.35)"
      bg="rgba(0,15,35,0.85)"
      boxShadow="0 0 20px rgba(0,162,255,0.15), inset 0 1px 0 rgba(255,255,255,0.06)"
      p={3}
      position="relative"
      overflow="hidden"
    >
      <Box
        position="absolute" left={0} top={0} bottom={0} w="3px"
        bg="rgba(0,162,255,0.6)" borderLeftRadius="14px"
      />
      <VStack align="start" spacing={1} pl={1}>
        <HStack spacing={2} justify="space-between" w="100%">
          <Text
            fontSize="9px" fontWeight="800" letterSpacing="0.12em"
            color="rgba(0,162,255,0.8)" textTransform="uppercase"
          >
            CLAIM {numIdx}
          </Text>
          {score != null && (
            <Badge
              fontSize="9px"
              colorScheme={score >= 0.7 ? "green" : score >= 0.4 ? "yellow" : "red"}
              px={1}
            >
              {Math.round(score * 100)}%
            </Badge>
          )}
        </HStack>
        <Text fontSize="12px" fontWeight="600" color="var(--mr-text-primary)" lineHeight="1.4">
          {claim.claim_text}
        </Text>
      </VStack>
    </Box>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <Box
      p={3} borderRadius="10px"
      border="1px solid rgba(0,162,255,0.15)"
      bg="rgba(0,10,25,0.7)"
      minW="160px"
    >
      <Text fontSize="9px" fontWeight="700" letterSpacing="0.1em" color="rgba(0,162,255,0.7)" mb={2} textTransform="uppercase">
        Evidence Strength
      </Text>
      <VStack align="start" spacing={1}>
        {(Object.entries(STANCE) as [Stance, typeof STANCE[Stance]][]).map(([key, s]) => (
          <HStack key={key} spacing={2}>
            <Box w="16px" h="2px" bg={s.border} boxShadow={`0 0 4px ${s.border}`} borderRadius="1px" />
            <Text fontSize="10px" color="var(--mr-text-secondary)">{s.label}</Text>
          </HStack>
        ))}
      </VStack>
      <Text fontSize="9px" fontWeight="700" letterSpacing="0.1em" color="rgba(0,162,255,0.7)" mt={3} mb={2} textTransform="uppercase">
        Source Reliability
      </Text>
      <VStack align="start" spacing={1}>
        {[["A–B", "#14B8A6", "High (Primary/Govt/Academic)"],
          ["C",   "#00A2FF", "Medium (Journalism/Reference)"],
          ["D–E", "#F6AD55", "Low (Advocacy/Opinion)"],
          ["Ø",   "#718096", "Unrated"]].map(([code, color, label]) => (
          <HStack key={code} spacing={2}>
            <Text fontSize="9px" fontWeight="800" color={color as string} w="18px">{code}</Text>
            <Text fontSize="9px" color="var(--mr-text-secondary)">{label}</Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EvidenceMapPage() {
  const navigate = useNavigate();
  const { contentId: paramId } = useParams<{ contentId: string }>();
  const { selectedTask } = useTaskStore();
  const { user } = useAuthStore();

  const contentId = paramId ? parseInt(paramId, 10) : selectedTask?.content_id ?? 0;
  const viewerId = user?.user_id ?? null;

  const { caseClaims, references, isLoading: sessionLoading } = useClaimLinkSession({
    contentId,
    viewerId,
    scope: "all",
  });

  const [claimsWithEvidence, setClaimsWithEvidence] = useState<ClaimWithEvidence[]>([]);
  const [claimScores, setClaimScores] = useState<Record<number, number>>({});
  const [overallScore, setOverallScore] = useState<number | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // ── Fetch claim links once claims and references are ready ─────────────────
  useEffect(() => {
    if (!caseClaims.length || !contentId) return;

    setLoadingLinks(true);
    const refMap = new Map<number, ReferenceWithClaims>();
    references.forEach(r => refMap.set(r.reference_content_id, r));

    // Fetch links for all task claims in parallel
    Promise.all(
      caseClaims.map(async (claim, idx): Promise<ClaimWithEvidence> => {
        try {
          const links = await fetchReferenceClaimTaskLinks(claim.claim_id);
          const evidence: EvidenceItem[] = links.map((link, evIdx) => ({
            link,
            reference: link.reference_content_id ? refMap.get(link.reference_content_id) : undefined,
            letterIdx: String.fromCharCode(65 + evIdx), // A, B, C...
          }));
          return { claim, numIdx: idx + 1, evidence, isLoading: false };
        } catch {
          return { claim, numIdx: idx + 1, evidence: [], isLoading: false };
        }
      })
    ).then(results => {
      setClaimsWithEvidence(results);
      setLoadingLinks(false);
    });
  }, [caseClaims.length, contentId, references.length]);

  // ── Fetch scores ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!contentId) return;
    fetchContentScores(contentId, viewerId, "combined", 0.5)
      .then(s => setOverallScore(s?.verimeterScore != null ? s.verimeterScore / 100 : null))
      .catch(() => {});
    // Per-claim scores
    import("../services/useDashboardAPI").then(({ fetchClaimScoresForTask }) => {
      fetchClaimScoresForTask(contentId, viewerId)
        .then(scores => setClaimScores(scores ?? {}))
        .catch(() => {});
    });
  }, [contentId, viewerId]);

  const isLoading = sessionLoading || loadingLinks;
  const taskName = selectedTask?.content_name ?? "Content Under Review";
  const totalEvidence = claimsWithEvidence.reduce((n, c) => n + c.evidence.length, 0);
  const verdict = scoreVerdict(overallScore);

  // ── Horizontal bar width for the branch connector ─────────────────────────
  const numClaims = claimsWithEvidence.length;
  const branchBarW = numClaims > 1
    ? numClaims * COL_W + (numClaims - 1) * COL_GAP
    : COL_W;

  // ── Average confidence across all links ───────────────────────────────────
  const allLinks = claimsWithEvidence.flatMap(c => c.evidence.map(e => e.link));
  const avgConfidence = allLinks.length
    ? allLinks.reduce((s, l) => s + (l.confidence ?? 0), 0) / allLinks.length
    : null;

  if (!contentId) {
    return (
      <Center h="100vh" flexDir="column" gap={4}>
        <Text color="var(--mr-text-muted)">No task selected.</Text>
        <Button size="sm" className="mr-button" onClick={() => navigate(-1)}>Go Back</Button>
      </Center>
    );
  }

  return (
    <Box
      minH="100vh"
      bg="var(--mr-bg, #050a14)"
      color="var(--mr-text-primary, #e2e8f0)"
      overflowX="auto"
    >
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <Box
        px={6} py={4}
        borderBottom="1px solid rgba(0,162,255,0.15)"
        bg="rgba(0,10,25,0.9)"
        position="sticky" top={0} zIndex={10}
        backdropFilter="blur(8px)"
      >
        <HStack justify="space-between" align="flex-start">
          <HStack spacing={4} align="center">
            <Button size="sm" variant="ghost" color="var(--mr-text-muted)" onClick={() => navigate(-1)}>
              ← Back
            </Button>
            <VStack align="start" spacing={0}>
              <Text
                fontSize="22px" fontWeight="800" letterSpacing="0.08em"
                textTransform="uppercase"
                bgGradient="linear(to-r, rgba(0,162,255,0.9), rgba(100,220,255,0.7))"
                bgClip="text"
              >
                Evidence Map
              </Text>
              <Text fontSize="11px" color="var(--mr-text-muted)" maxW="360px">
                Visual map of claims, sources, and how evidence supports, refutes, or qualifies each claim.
              </Text>
            </VStack>
          </HStack>
          <HStack spacing={3} align="center">
            <HStack spacing={2}>
              <Box w="8px" h="8px" borderRadius="full" bg="#22c55e" boxShadow="0 0 6px #22c55e" />
              <Text fontSize="10px" color="var(--mr-text-muted)">{caseClaims.length} claims</Text>
            </HStack>
            <HStack spacing={2}>
              <Box w="8px" h="8px" borderRadius="full" bg="rgba(0,162,255,0.8)" boxShadow="0 0 6px rgba(0,162,255,0.8)" />
              <Text fontSize="10px" color="var(--mr-text-muted)">{totalEvidence} evidence items</Text>
            </HStack>
          </HStack>
        </HStack>
      </Box>

      {isLoading ? (
        <Center h="60vh">
          <VStack spacing={3}>
            <Spinner size="xl" color="rgba(0,162,255,0.8)" thickness="3px" />
            <Text color="var(--mr-text-muted)" fontSize="sm">Loading evidence map…</Text>
          </VStack>
        </Center>
      ) : (
        <Box p={6}>
          <HStack align="flex-start" spacing={6}>
            {/* ── Left panel: legend ───────────────────────────────────── */}
            <Box pt={2} flexShrink={0}>
              <Legend />
            </Box>

            {/* ── Main tree area ───────────────────────────────────────── */}
            <VStack spacing={0} align="center" flex={1} minW={`${numClaims * (COL_W + COL_GAP) + 80}px`}>

              {/* Content Under Review */}
              <Box
                maxW="520px" w="100%"
                borderRadius="16px"
                border="1.5px solid rgba(0,162,255,0.4)"
                bg="rgba(0,20,45,0.9)"
                boxShadow="0 0 30px rgba(0,162,255,0.2), inset 0 1px 0 rgba(255,255,255,0.08)"
                p={4}
                textAlign="center"
              >
                <Text
                  fontSize="9px" fontWeight="800" letterSpacing="0.15em"
                  color="rgba(0,162,255,0.7)" textTransform="uppercase" mb={1}
                >
                  Content Under Review
                </Text>
                <Text fontSize="15px" fontWeight="700" color="var(--mr-text-primary)" lineHeight="1.4">
                  "{taskName}"
                </Text>
              </Box>

              {/* Vertical drop to branch bar */}
              {numClaims > 0 && (
                <>
                  <VLine h="28px" />
                  {/* Horizontal branch bar */}
                  <Box position="relative" w={`${branchBarW}px`} h="2px">
                    <Box
                      position="absolute" top={0} left={0} right={0} h="2px"
                      bg={CONNECTOR} boxShadow={CONNECTOR_GLOW}
                    />
                  </Box>
                </>
              )}

              {/* Claims + evidence columns */}
              {numClaims === 0 ? (
                <Box
                  mt={8} p={6} borderRadius="12px"
                  border="1px dashed rgba(0,162,255,0.2)"
                  bg="rgba(0,10,25,0.5)"
                  textAlign="center"
                >
                  <Text color="var(--mr-text-muted)" fontSize="sm">No claims found for this task.</Text>
                  <Text color="var(--mr-text-muted)" fontSize="xs" mt={1}>
                    Add claims in the Workspace to populate the evidence map.
                  </Text>
                </Box>
              ) : (
                <HStack align="flex-start" spacing={`${COL_GAP}px`} pt={0}>
                  {claimsWithEvidence.map((cwe) => (
                    <VStack key={cwe.claim.claim_id} spacing={0} align="center" w={`${COL_W}px`}>

                      {/* Drop from branch bar to claim */}
                      <VLine h="28px" />
                      <ArrowTip />
                      <Box h="4px" />

                      {/* Claim card */}
                      <ClaimCard
                        claim={cwe.claim}
                        numIdx={cwe.numIdx}
                        score={claimScores[cwe.claim.claim_id]}
                      />

                      {/* Evidence items */}
                      {cwe.evidence.length === 0 ? (
                        <Box
                          mt={3} p={3} w="100%"
                          borderRadius="10px"
                          border="1px dashed rgba(255,255,255,0.08)"
                          textAlign="center"
                        >
                          <Text fontSize="10px" color="var(--mr-text-muted)" opacity={0.5}>
                            No evidence linked yet
                          </Text>
                        </Box>
                      ) : (
                        cwe.evidence.map((ev) => {
                          const stance = getStance(ev.link.stance);
                          const stanceColor = STANCE[stance].border;
                          return (
                            <VStack key={ev.link.reference_claim_task_links_id ?? ev.link.reference_claim_id} spacing={0} align="center" w="100%">
                              <VLine h="20px" color={stanceColor} />
                              <ArrowTip color={stanceColor} />
                              <Box h="4px" />
                              <EvidenceCard
                                ev={ev}
                                claimNum={cwe.numIdx}
                                references={references}
                              />
                            </VStack>
                          );
                        })
                      )}
                    </VStack>
                  ))}
                </HStack>
              )}

              {/* ── Overall Assessment ────────────────────────────────── */}
              {numClaims > 0 && (
                <Box
                  mt={10} w="100%" maxW={`${Math.max(branchBarW, 520)}px`}
                  borderRadius="16px"
                  border="1.5px solid rgba(0,162,255,0.25)"
                  bg="rgba(0,15,35,0.9)"
                  boxShadow="0 0 30px rgba(0,162,255,0.12), inset 0 1px 0 rgba(255,255,255,0.05)"
                  p={5}
                >
                  <HStack justify="space-between" align="center" flexWrap="wrap" gap={4}>
                    <VStack align="start" spacing={1} flex={1} minW="200px">
                      <HStack spacing={2}>
                        <Box
                          w="28px" h="28px" borderRadius="6px"
                          bg="rgba(0,162,255,0.15)"
                          border="1px solid rgba(0,162,255,0.3)"
                          display="flex" alignItems="center" justifyContent="center"
                          fontSize="14px"
                        >
                          🛡
                        </Box>
                        <Text
                          fontSize="9px" fontWeight="800" letterSpacing="0.12em"
                          color="rgba(0,162,255,0.7)" textTransform="uppercase"
                        >
                          Overall Assessment
                        </Text>
                      </HStack>
                      <Text fontSize="18px" fontWeight="800" color="var(--mr-text-primary)">
                        {verdict.label}
                      </Text>
                      <Text fontSize="11px" color="var(--mr-text-muted)" maxW="420px">
                        {verdict.sub}
                      </Text>
                      {/* Stance distribution summary */}
                      {allLinks.length > 0 && (
                        <HStack spacing={3} mt={1} flexWrap="wrap">
                          {(["support","refute","nuance","insufficient"] as Stance[]).map(s => {
                            const count = allLinks.filter(l => getStance(l.stance) === s).length;
                            if (count === 0) return null;
                            return (
                              <HStack key={s} spacing={1}>
                                <Box w="8px" h="8px" borderRadius="full" bg={STANCE[s].border} />
                                <Text fontSize="10px" color="var(--mr-text-muted)">
                                  {count} {STANCE[s].label.toLowerCase()}
                                </Text>
                              </HStack>
                            );
                          })}
                        </HStack>
                      )}
                    </VStack>

                    {/* Gauge */}
                    <VStack spacing={1} align="center" flexShrink={0}>
                      <Text fontSize="10px" color="var(--mr-text-muted)" letterSpacing="0.08em" textTransform="uppercase">
                        {avgConfidence !== null ? "Avg Confidence" : "Evidence Score"}
                      </Text>
                      {(overallScore !== null || avgConfidence !== null) ? (
                        <BareGauge score={avgConfidence ?? overallScore ?? 0} />
                      ) : (
                        <Box
                          w="80px" h="80px" borderRadius="full"
                          border="2px solid rgba(0,162,255,0.2)"
                          display="flex" alignItems="center" justifyContent="center"
                        >
                          <Text fontSize="10px" color="var(--mr-text-muted)">N/A</Text>
                        </Box>
                      )}
                      <Text fontSize="11px" fontWeight="600" color="rgba(0,162,255,0.8)">
                        {avgConfidence !== null
                          ? `${Math.round(avgConfidence * 100)}%`
                          : overallScore !== null
                            ? `${Math.round(overallScore * 100)}%`
                            : "—"}
                      </Text>
                    </VStack>
                  </HStack>
                </Box>
              )}

            </VStack>
          </HStack>
        </Box>
      )}

      {/* Footer note */}
      <Box
        px={6} py={3}
        borderTop="1px solid rgba(0,162,255,0.1)"
        bg="rgba(0,5,15,0.8)"
      >
        <HStack justify="space-between">
          <Text fontSize="10px" color="var(--mr-text-muted)" opacity={0.5} fontStyle="italic">
            Note: Evidence map reflects AI-assessed and manually linked evidence. Links are continually updated as new sources are added.
          </Text>
          <Text fontSize="10px" color="var(--mr-text-muted)" opacity={0.4}>
            TruthTrollers Evidence Map
          </Text>
        </HStack>
      </Box>
    </Box>
  );
}
