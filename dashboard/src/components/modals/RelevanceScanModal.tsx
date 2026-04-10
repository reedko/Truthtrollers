// src/components/modals/RelevanceScanModal.tsx
import React, { useState, useEffect, useRef } from "react";
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
  Progress,
  Badge,
  Spinner,
  Tooltip,
  Divider,
  useToast,
  useColorMode,
} from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import {
  fetchReferenceClaimTaskLinks,
  fetchReferenceDocumentLinks,
  assessReferenceClaimRelevance,
  enrichClaimsWithRelevance,
  sortClaimsByRelevance,
  ClaimWithRelevance,
  ReferenceDocumentLink,
} from "../../services/referenceClaimRelevance";
import { fetchClaimScoresForTask, fetchAIEvidenceLinks } from "../../services/useDashboardAPI";
import VerimeterBar from "../VerimeterBar";

interface RelevanceScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskClaim: Claim | null;
  references: ReferenceWithClaims[];
  onSelectReferenceClaim?: (claim: ClaimWithRelevance, referenceId: number) => void;
  // Opens the ClaimLinkOverlay pre-populated with AI suggestion
  onOpenLinkOverlay?: (
    sourceClaim: { claim_id: number; claim_text: string },
    targetClaim: Claim,
    rationale: string,
    supportLevel: number
  ) => void;
  contentId?: number; // Task content_id for fetching computed scores
  viewerId?: number | null; // User viewing for scope filtering
}

const RelevanceScanModal: React.FC<RelevanceScanModalProps> = ({
  isOpen,
  onClose,
  taskClaim,
  references,
  onSelectReferenceClaim,
  onOpenLinkOverlay,
  contentId,
  viewerId,
}) => {
  const { colorMode } = useColorMode();
  const toast = useToast();

  // Debug logging
  useEffect(() => {
    if (isOpen && taskClaim) {
      console.log('[RelevanceScanModal] OPENED - taskClaim:', taskClaim.claim_id, 'references:', references.length, 'contentId:', contentId);
    }
  }, [isOpen]);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [topClaims, setTopClaims] = useState<ClaimWithRelevance[]>([]);
  const [documentLinks, setDocumentLinks] = useState<ReferenceDocumentLink[]>([]);
  const [claimReferenceMap, setClaimReferenceMap] = useState<Map<number, number>>(new Map());
  const [allReferenceClaims, setAllReferenceClaims] = useState<Claim[]>([]);
  const lastTaskClaimId = useRef<number | null>(null);
  const [scanMode, setScanMode] = useState<'quick' | 'deep'>('quick');

  // NEW: Computed verimeter score from linked reference claims
  const [computedScore, setComputedScore] = useState<number | null>(null);

  // Debug panel expand/collapse state
  const [debugExpanded, setDebugExpanded] = useState(false);

  // ── On open: load existing links immediately, don't re-scan ──────────────
  useEffect(() => {
    if (isOpen && taskClaim) {
      // Only reload if the task claim changed
      if (taskClaim.claim_id !== lastTaskClaimId.current) {
        lastTaskClaimId.current = taskClaim.claim_id;
        loadExistingLinks();
        loadComputedScore();
      }
    }
  }, [isOpen, taskClaim?.claim_id]); // eslint-disable-line

  // ── Load computed verimeter score based on reference claim links ──────────
  const loadComputedScore = async () => {
    if (!contentId || !taskClaim) return;

    try {
      const scores = await fetchClaimScoresForTask(contentId, viewerId ?? null);
      const score = scores[taskClaim.claim_id];
      setComputedScore(score !== undefined ? score : null);
    } catch (err) {
      console.error("[RelevanceScan] Error loading computed score:", err);
      setComputedScore(null);
    }
  };

  // ── Build the reference claim data and reference map ──────────────────────
  const buildReferenceClaims = (linkedReferenceIds?: Set<number>) => {
    const all: Claim[] = [];
    const refMap = new Map<number, number>();

    // Filter references based on mode
    const refsToUse = linkedReferenceIds
      ? references.filter(ref => linkedReferenceIds.has(ref.reference_content_id))
      : references;

    refsToUse.forEach((ref) => {
      let refClaims: any = ref.claims;
      if (typeof refClaims === "string") {
        try { refClaims = JSON.parse(refClaims); } catch { return; }
      }
      if (Array.isArray(refClaims)) {
        refClaims.forEach((c: any) => {
          if (c?.claim_id && c?.claim_text) {
            all.push(c);
            refMap.set(c.claim_id, ref.reference_content_id);
          }
        });
      }
    });

    setAllReferenceClaims(all);
    setClaimReferenceMap(refMap);
    return { all, refMap };
  };

  // ── Load existing scanned links from DB ───────────────────────────────────
  const loadExistingLinks = async () => {
    if (!taskClaim) return;
    setIsLoadingExisting(true);

    try {
      const { all, refMap } = buildReferenceClaims();

      console.log(`🔍 [RelevanceScan] Loading links for task claim ${taskClaim.claim_id}`);
      console.log(`🔍 [RelevanceScan] Built ${all.length} reference claims from ${references.length} references`);

      const existingLinks = await fetchReferenceClaimTaskLinks(taskClaim.claim_id);
      console.log(`🔍 [RelevanceScan] Fetched ${existingLinks.length} claim-to-claim links from backend:`, existingLinks);

      // Also fetch document-level links (reference_claim_links)
      const docLinks = await fetchReferenceDocumentLinks(taskClaim.claim_id);
      console.log(`🔍 [RelevanceScan] Fetched ${docLinks.length} document-level links from backend:`, docLinks);
      setDocumentLinks(docLinks);

      // 🔧 FIX: Add linked claims that aren't in the references array
      // This ensures manually linked claims show up even if their reference is filtered out
      const allClaimsMap = new Map<number, Claim>();
      all.forEach(c => allClaimsMap.set(c.claim_id, c));

      for (const link of existingLinks) {
        if (!allClaimsMap.has(link.reference_claim_id) && link.reference_claim_text) {
          // This claim is linked but not in our references array - add it!
          const missingClaim: Claim = {
            claim_id: link.reference_claim_id,
            claim_text: link.reference_claim_text,
            claim_type: 'evidence',
            veracity_score: 0,
            confidence_level: link.confidence,
            last_verified: new Date().toISOString(),
          };
          allClaimsMap.set(link.reference_claim_id, missingClaim);
          console.log(`🔍 [RelevanceScan] Added missing linked claim ${link.reference_claim_id} from ${link.source_name}`);
        }
      }

      const allClaims = Array.from(allClaimsMap.values());
      console.log(`🔍 [RelevanceScan] Total claims after adding missing linked: ${allClaims.length}`);

      if (allClaims.length === 0) {
        setTopClaims([]);
        setIsLoadingExisting(false);
        return;
      }

      const enriched = enrichClaimsWithRelevance(allClaims, taskClaim.claim_id, existingLinks);
      const sorted = sortClaimsByRelevance(enriched);

      // 🎯 FILTER: Only show relevant claims
      // - Manual links (hasLink = true) are always shown
      // - AI assessments must be meaningful (not "insufficient" with low scores)
      const assessed = sorted.filter((c) => {
        if (!c.stance) return false; // No assessment at all
        if (c.hasLink) return true; // Always show manual links

        // For AI assessments, filter out irrelevant ones
        const isIrrelevant = c.stance === 'insufficient' &&
                            Math.abs(c.relevanceScore) < 10 &&
                            (c.confidence ?? 0) < 0.5;

        return !isIrrelevant;
      });

      console.log(`🔍 [RelevanceScan] After enriching and filtering: ${assessed.length} claims (${assessed.filter(c => c.hasLink).length} manual links, ${assessed.filter(c => !c.hasLink).length} AI assessments)`);
      setTopClaims(assessed);
    } catch (err) {
      console.error("[RelevanceScan] Error loading existing links:", err);
    } finally {
      setIsLoadingExisting(false);
    }
  };

  // ── Scan for NEW links only (skips already-assessed claims) ───────────────
  const runRelevanceScan = async (mode?: 'quick' | 'deep') => {
    if (!taskClaim) return;

    const effectiveMode = mode || scanMode;
    console.log(`🔍 [runRelevanceScan] Starting scan - mode param: ${mode}, scanMode state: ${scanMode}, effectiveMode: ${effectiveMode}`);

    setIsScanning(true);
    setScanProgress({ current: 0, total: 0 });

    try {
      // First build all reference claims to get the mapping
      const initialBuild = buildReferenceClaims();
      let claims = initialBuild.all;
      let refMap = initialBuild.refMap;

      // Fetch existing AI assessments from reference_claim_task_links
      const existingLinks = await fetchReferenceClaimTaskLinks(taskClaim.claim_id);

      // For quick mode, fetch references that have dotted lines (reference_claim_links)
      // AND include references with existing high-relevance assessments
      const linkedReferenceIds = new Set<number>();

      if (effectiveMode === 'quick' && contentId) {
        try {
          // Get references with dotted lines using same approach as workspace
          // This fetches from reference_claim_links (document-level AI evidence links)
          console.log(`⚡ [Quick Scan] Fetching AI evidence links for content ${contentId}`);

          const aiEvidenceLinks = await fetchAIEvidenceLinks(contentId);
          console.log(`⚡ [Quick Scan] Fetched ${aiEvidenceLinks.length} AI evidence links`);

          // Filter to only links for THIS task claim
          const linksForThisClaim = aiEvidenceLinks.filter(
            (link) => link.task_claim_id === taskClaim.claim_id
          );
          console.log(`⚡ [Quick Scan] Found ${linksForThisClaim.length} dotted line links for task claim ${taskClaim.claim_id}`);

          // Extract unique reference_content_ids
          linksForThisClaim.forEach((link) => {
            linkedReferenceIds.add(link.reference_content_id);
          });

          console.log(`⚡ [Quick Scan] Will scan claims from ${linkedReferenceIds.size} references with dotted-line connections`);
        } catch (err) {
          console.error("[Quick Scan] Error fetching AI evidence links:", err);
        }
      }

      // If quick mode, rebuild with only linked references
      if (effectiveMode === 'quick' && linkedReferenceIds.size > 0) {
        const built = buildReferenceClaims(linkedReferenceIds);
        claims = built.all;
        refMap = built.refMap;
        console.log(`⚡ [Quick Scan] Scanning ${claims.length} claims from ${linkedReferenceIds.size} references with dotted lines`);
      } else if (effectiveMode === 'quick') {
        toast({
          title: "No dotted line sources found",
          description: "No sources with evidence engine links to this task claim. Try Deep Scan to search all sources.",
          status: "info",
          duration: 5000,
        });
        setIsScanning(false);
        return;
      } else {
        console.log(`🔍 [Deep Scan] Scanning ${claims.length} claims from ${references.length} references`);
      }

      if (claims.length === 0) {
        toast({
          title: "No source claims found",
          description: "Sources need their claims extracted first.",
          status: "info",
          duration: 5000,
        });
        setIsScanning(false);
        return;
      }

      // Use existing links to skip already-assessed claims
      const existingIds = new Set(existingLinks.map((l) => l.reference_claim_id));

      const toAssess = claims
        .filter((c) => !existingIds.has(c.claim_id))
        .slice(0, 10);

      if (toAssess.length === 0) {
        toast({
          title: "All claims already assessed",
          description: "Nothing new to scan. All reference claims have already been evaluated.",
          status: "info",
          duration: 4000,
        });
        setIsScanning(false);
        return;
      }

      setScanProgress({ current: 0, total: toAssess.length });

      const newLinks = [];
      let skippedAsIrrelevant = 0;
      for (let i = 0; i < toAssess.length; i++) {
        const claim = toAssess[i];
        setScanProgress({ current: i + 1, total: toAssess.length });
        try {
          const { link } = await assessReferenceClaimRelevance(
            claim.claim_id,
            taskClaim.claim_id,
            claim.claim_text,
            taskClaim.claim_text
          );
          if (link) {
            newLinks.push(link);
          } else {
            skippedAsIrrelevant++;
          }
        } catch (err) {
          console.error(`Failed to assess claim ${claim.claim_id}:`, err);
        }
      }

      // Merge with existing and re-display
      const allLinks = [...existingLinks, ...newLinks];
      const enriched = enrichClaimsWithRelevance(claims, taskClaim.claim_id, allLinks);
      const sorted = sortClaimsByRelevance(enriched);

      // 🎯 FILTER: Show only relevant claims
      const relevant = sorted.filter((c) => {
        if (!c.stance) return false;
        if (c.hasLink) return true; // Always show manual links

        // Filter out irrelevant AI assessments
        const isIrrelevant = c.stance === 'insufficient' &&
                            Math.abs(c.relevanceScore) < 10 &&
                            (c.confidence ?? 0) < 0.5;
        return !isIrrelevant;
      });

      const top12 = relevant.slice(0, 12);
      const withLinks = top12.filter((c) => c.hasLink);

      setTopClaims(top12);

      const scanModeLabel = effectiveMode === 'quick' ? 'Quick' : 'Deep';

      // Build toast description
      let toastDescription = '';
      if (newLinks.length > 0) {
        toastDescription = `Showing ${top12.length} top claims (${withLinks.length} linked, ${top12.length - withLinks.length} AI suggestions)`;
        if (skippedAsIrrelevant > 0) {
          toastDescription += `. ${skippedAsIrrelevant} claims filtered as irrelevant`;
        }
      } else if (skippedAsIrrelevant > 0) {
        toastDescription = `Assessed ${toAssess.length} claims but all ${skippedAsIrrelevant} were deemed irrelevant (insufficient evidence or low confidence)`;
      } else if (effectiveMode === 'quick') {
        toastDescription = "All claims in linked references already assessed. Try Deep Scan for more.";
      } else {
        toastDescription = "All claims were already assessed";
      }

      toast({
        title: newLinks.length > 0 ? `${scanModeLabel} Scan: Found ${newLinks.length} new assessments` : `${scanModeLabel} Scan: No new relevant claims`,
        description: toastDescription,
        status: newLinks.length > 0 ? "success" : "info",
        duration: 5000,
      });
    } catch (err) {
      console.error("[Relevance Scan] Error:", err);
      toast({ title: "Scan failed", status: "error", duration: 5000 });
    } finally {
      setIsScanning(false);
      setScanProgress({ current: 0, total: 0 });
    }
  };

  const handleOpenLinkOverlay = (claim: ClaimWithRelevance) => {
    console.log("[RelevanceScanModal] handleOpenLinkOverlay called for claim:", claim.claim_id);

    if (!onOpenLinkOverlay) {
      console.error("[RelevanceScanModal] ERROR: onOpenLinkOverlay callback is not provided!");
      toast({
        title: "Configuration Error",
        description: "Link overlay callback not configured",
        status: "error",
        duration: 3000,
      });
      return;
    }
    if (!taskClaim) {
      console.error("[RelevanceScanModal] ERROR: No task claim available!");
      return;
    }
    const supportLevel = claim.support_level ??
      (claim.stance === "support" ? (claim.confidence ?? 0.7)
        : claim.stance === "refute" ? -(claim.confidence ?? 0.7)
        : 0);
    console.log("[RelevanceScanModal] Calling onOpenLinkOverlay with:", {
      sourceClaim_id: claim.claim_id,
      sourceClaim_text: claim.claim_text.substring(0, 50),
      targetClaim_id: taskClaim.claim_id,
      targetClaim_text: taskClaim.claim_text.substring(0, 50),
      rationale: claim.rationale?.substring(0, 50),
      supportLevel
    });

    try {
      onOpenLinkOverlay(
        { claim_id: claim.claim_id, claim_text: claim.claim_text },
        taskClaim,
        claim.rationale || "",
        supportLevel
      );
      console.log("[RelevanceScanModal] onOpenLinkOverlay callback completed successfully");
    } catch (error) {
      console.error("[RelevanceScanModal] ERROR calling onOpenLinkOverlay:", error);
    }
  };

  const handleDeleteLink = async (referenceClaimId: number) => {
    if (!taskClaim) return;

    try {
      const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";
      const response = await fetch(`${API_BASE_URL}/api/delete-claim-link`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          source_claim_id: referenceClaimId,
          target_claim_id: taskClaim.claim_id,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to delete link");
      }

      toast({
        title: "Link deleted",
        status: "success",
        duration: 2000,
      });

      // Reload links
      await loadExistingLinks();
      await loadComputedScore();
    } catch (err) {
      console.error("[RelevanceScan] Error deleting link:", err);
      toast({
        title: "Failed to delete link",
        status: "error",
        duration: 3000,
      });
    }
  };

  const getStanceColor = (stance?: string) => {
    if (stance === "support") return "green";
    if (stance === "refute") return "red";
    if (stance === "nuance") return "yellow";
    return "gray";
  };

  const getStanceLabel = (stance?: string) => {
    if (stance === "support") return "✓ SUPPORTS";
    if (stance === "refute") return "✗ REFUTES";
    if (stance === "nuance") return "~ NUANCED";
    if (stance === "insufficient") return "⊘ INSUFFICIENT";
    return "? UNKNOWN";
  };

  const isBusy = isLoadingExisting || isScanning;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(8px)" bg={colorMode === "dark" ? "rgba(0, 0, 0, 0.6)" : "rgba(255, 255, 255, 0.3)"} />
      <ModalContent
        bg={colorMode === "dark" ? "rgba(10, 15, 25, 0.85)" : "rgba(255, 255, 255, 0.5)"}
        backdropFilter="blur(30px)"
        color={colorMode === "dark" ? "white" : "gray.800"}
        maxH="90vh"
        border="2px solid"
        borderColor={colorMode === "dark" ? "rgba(113, 219, 255, 0.4)" : "rgba(71, 85, 105, 0.15)"}
        borderLeftRadius="24px"
        boxShadow={colorMode === "dark"
          ? "0 24px 64px rgba(0, 0, 0, 0.8), 0 12px 32px rgba(0, 0, 0, 0.6), 0 0 60px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)"
          : "0 24px 64px rgba(0, 0, 0, 0.06), 0 12px 32px rgba(0, 0, 0, 0.04), 0 0 60px rgba(71, 85, 105, 0.08), inset 0 2px 0 rgba(255, 255, 255, 0.95)"
        }
        position="relative"
        overflow="hidden"
      >
        {/* Curved left edge glow */}
        <Box
          position="absolute"
          left={0}
          top={0}
          width="32px"
          height="100%"
          background={colorMode === "dark"
            ? "linear-gradient(90deg, rgba(113, 219, 255, 0.4) 0%, transparent 100%)"
            : "linear-gradient(90deg, rgba(71, 85, 105, 0.15) 0%, transparent 100%)"
          }
          borderLeftRadius="24px"
          pointerEvents="none"
          zIndex={0}
        />
        {/* Radial background glow */}
        <Box
          position="absolute"
          top="-20%"
          right="-10%"
          width="60%"
          height="60%"
          bgGradient={colorMode === "dark"
            ? "radial-gradient(circle, rgba(113, 219, 255, 0.15) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(148, 163, 184, 0.08) 0%, transparent 70%)"
          }
          pointerEvents="none"
          zIndex={0}
        />
        <ModalHeader>
          Case Claim Details
          {taskClaim && (
            <VStack align="stretch" mt={3} spacing={2}>
              {/* 🔍 DEBUG INFO - Collapsible */}
              <HStack
                p={2}
                bg={colorMode === "dark" ? "purple.900" : "purple.100"}
                borderRadius="md"
                fontSize="xs"
                fontFamily="monospace"
                justify="space-between"
                cursor="pointer"
                onClick={() => setDebugExpanded(!debugExpanded)}
                _hover={{ opacity: 0.8 }}
              >
                <Text color={colorMode === "dark" ? "purple.200" : "purple.800"}>
                  🔍 DEBUG {debugExpanded ? '▼' : '▶'}
                </Text>
                <Text fontSize="10px" color={colorMode === "dark" ? "purple.300" : "purple.600"}>
                  {debugExpanded ? 'Click to collapse' : 'Click to expand'}
                </Text>
              </HStack>
              {debugExpanded && (
                <Box p={2} bg={colorMode === "dark" ? "purple.900" : "purple.100"} borderRadius="md" fontSize="xs" fontFamily="monospace">
                  <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Task Content ID: {contentId ?? 'null'}</Text>
                  <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Task Claim ID: {taskClaim.claim_id}</Text>
                  <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Viewer ID: {viewerId ?? 'null'}</Text>
                  <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Sources Count: {references.length}</Text>
                </Box>
              )}

              <Box
                p={4}
                bg={colorMode === "dark" ? "rgba(15, 25, 40, 0.7)" : "rgba(255, 255, 255, 0.8)"}
                backdropFilter="blur(20px)"
                borderLeftRadius="20px"
                borderWidth="2px"
                borderColor={computedScore !== null
                  ? (computedScore > 0.5
                    ? (colorMode === "dark" ? "rgba(72, 187, 120, 0.6)" : "rgba(72, 187, 120, 0.4)")
                    : computedScore < -0.5
                    ? (colorMode === "dark" ? "rgba(245, 101, 101, 0.6)" : "rgba(245, 101, 101, 0.4)")
                    : (colorMode === "dark" ? "rgba(237, 137, 54, 0.6)" : "rgba(237, 137, 54, 0.4)"))
                  : (colorMode === "dark" ? "rgba(113, 219, 255, 0.6)" : "rgba(71, 85, 105, 0.3)")
                }
                boxShadow={colorMode === "dark"
                  ? `0 12px 32px rgba(0, 0, 0, 0.6), 0 6px 16px rgba(0, 0, 0, 0.4), 0 0 40px ${computedScore !== null ? (computedScore > 0.5 ? "rgba(72, 187, 120, 0.3)" : computedScore < -0.5 ? "rgba(245, 101, 101, 0.3)" : "rgba(237, 137, 54, 0.3)") : "rgba(113, 219, 255, 0.3)"}, inset 0 2px 0 rgba(255, 255, 255, 0.1)`
                  : `0 12px 32px rgba(0, 0, 0, 0.08), 0 6px 16px rgba(0, 0, 0, 0.05), 0 0 40px ${computedScore !== null ? (computedScore > 0.5 ? "rgba(72, 187, 120, 0.2)" : computedScore < -0.5 ? "rgba(245, 101, 101, 0.2)" : "rgba(237, 137, 54, 0.2)") : "rgba(71, 85, 105, 0.15)"}, inset 0 2px 0 rgba(255, 255, 255, 0.9)`
                }
                position="relative"
                overflow="hidden"
              >
                {/* Curved left edge glow */}
                <Box
                  position="absolute"
                  left={0}
                  top={0}
                  width="28px"
                  height="100%"
                  background={colorMode === "dark"
                    ? `linear-gradient(90deg, ${computedScore !== null ? (computedScore > 0.5 ? "rgba(72, 187, 120, 0.4)" : computedScore < -0.5 ? "rgba(245, 101, 101, 0.4)" : "rgba(237, 137, 54, 0.4)") : "rgba(113, 219, 255, 0.4)"} 0%, transparent 100%)`
                    : `linear-gradient(90deg, ${computedScore !== null ? (computedScore > 0.5 ? "rgba(72, 187, 120, 0.25)" : computedScore < -0.5 ? "rgba(245, 101, 101, 0.25)" : "rgba(237, 137, 54, 0.25)") : "rgba(71, 85, 105, 0.2)"} 0%, transparent 100%)`
                  }
                  borderLeftRadius="20px"
                  pointerEvents="none"
                  zIndex={0}
                />
                <Text fontSize="sm" fontWeight="semibold" color="white" mb={2}>
                  "{taskClaim.claim_text}"
                </Text>
                <VStack align="stretch" spacing={3}>
                  {computedScore !== null ? (
                    <>
                      <VerimeterBar score={computedScore} size="md" />
                      <HStack justify="center">
                        <Badge colorScheme="blue" fontSize="xs" variant="outline">
                          {topClaims.filter(c => c.hasLink).length} manual link{topClaims.filter(c => c.hasLink).length !== 1 ? "s" : ""}
                        </Badge>
                        <Text fontSize="xs" color="gray.400">•</Text>
                        <Text fontSize="xs" color="gray.400">
                          Computed from linked reference claims
                        </Text>
                      </HStack>
                    </>
                  ) : (
                    <VStack spacing={2}>
                      <Text fontSize="sm" color="gray.400" textAlign="center">
                        No computed score yet
                      </Text>
                      <Text fontSize="xs" color="gray.500" textAlign="center">
                        Link source claims below to generate Verimeter score
                      </Text>
                    </VStack>
                  )}
                </VStack>
              </Box>
              <Text fontSize="xs" fontWeight="semibold" color="gray.400" mt={2}>
                Linked Source Claims:
              </Text>
            </VStack>
          )}
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {/* Loading existing */}
          {isLoadingExisting && (
            <HStack justify="center" py={6}>
              <Spinner size="md" color="teal.400" />
              <Text color={colorMode === "dark" ? "gray.400" : "gray.600"}>Loading previously scanned links…</Text>
            </HStack>
          )}

          {/* Scanning progress */}
          {isScanning && (
            <Box mb={4}>
              <HStack justify="space-between" mb={2}>
                <Text fontSize="sm" color="gray.400">
                  {scanProgress.total === 0 ? "Preparing scan…" : "Assessing new claims…"}
                </Text>
                {scanProgress.total > 0 && (
                  <Text fontSize="sm" color="teal.300">
                    {scanProgress.current} / {scanProgress.total}
                  </Text>
                )}
              </HStack>
              <Progress
                value={scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : undefined}
                isIndeterminate={scanProgress.total === 0}
                colorScheme="teal"
                size="sm"
                borderRadius="md"
              />
            </Box>
          )}

          {/* Empty state */}
          {!isBusy && topClaims.length === 0 && documentLinks.length === 0 && (
            <Box textAlign="center" py={10}>
              <Text color="gray.400" fontSize="md" mb={2}>No scanned links yet</Text>
              <Text color="gray.500" fontSize="sm" mb={4}>
                Click "Scan for Links" below to find relevant source claims.
              </Text>
            </Box>
          )}

          {/* Document-level links (reference_claim_links) */}
          {!isLoadingExisting && documentLinks.length > 0 && (
            <VStack spacing={3} align="stretch" mb={4}>
              <HStack justify="space-between" mb={1}>
                <Text fontSize="xs" color="gray.500" fontStyle="italic" fontWeight="semibold">
                  📄 {documentLinks.length} Document-Level Assessment{documentLinks.length !== 1 ? "s" : ""}
                </Text>
              </HStack>

              {documentLinks.map((docLink) => {
                const reference = references.find(r => r.reference_content_id === docLink.reference_content_id);
                const stanceColor = getStanceColor(docLink.stance);

                return (
                  <Box
                    key={docLink.ref_claim_link_id}
                    p={4}
                    bg={colorMode === "dark" ? "rgba(88, 28, 135, 0.25)" : "rgba(237, 233, 254, 0.8)"}
                    backdropFilter="blur(15px)"
                    borderLeftRadius="18px"
                    borderWidth="2px"
                    borderColor={`${stanceColor}.500`}
                    borderStyle="dashed"
                    boxShadow={colorMode === "dark"
                      ? "0 8px 24px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 30px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)"
                      : "0 8px 24px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.04), 0 0 30px rgba(139, 92, 246, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.95)"
                    }
                    position="relative"
                    overflow="hidden"
                  >
                    {/* Curved left edge glow */}
                    <Box
                      position="absolute"
                      left={0}
                      top={0}
                      width="24px"
                      height="100%"
                      background={colorMode === "dark"
                        ? "linear-gradient(90deg, rgba(139, 92, 246, 0.5) 0%, transparent 100%)"
                        : "linear-gradient(90deg, rgba(139, 92, 246, 0.25) 0%, transparent 100%)"
                      }
                      borderLeftRadius="18px"
                      pointerEvents="none"
                      zIndex={0}
                    />
                    <HStack justify="space-between" mb={2} wrap="wrap" gap={1}>
                      <HStack spacing={2} wrap="wrap">
                        <Badge colorScheme="purple" fontSize="xs">DOCUMENT</Badge>
                        <Badge colorScheme={stanceColor} fontSize="xs">
                          {getStanceLabel(docLink.stance)}
                        </Badge>
                        {docLink.support_level !== undefined && docLink.support_level !== null && (
                          <Tooltip label="Support level: -100 (refutes) to +100 (supports)">
                            <Badge colorScheme="blue" fontSize="xs" cursor="help">
                              Level: {Math.round(docLink.support_level)}
                            </Badge>
                          </Tooltip>
                        )}
                        {docLink.confidence !== undefined && (
                          <Tooltip label={`AI confidence: ${Math.round(docLink.confidence * 100)}%`}>
                            <Badge colorScheme="teal" fontSize="xs" cursor="help">
                              Confidence: {Math.round(docLink.confidence * 100)}%
                            </Badge>
                          </Tooltip>
                        )}
                      </HStack>
                    </HStack>

                    {reference && (
                      <VStack align="start" spacing={1} mb={2}>
                        <Text fontSize="sm" fontWeight="semibold" color={colorMode === "dark" ? "blue.300" : "blue.700"}>
                          Source: {reference.content_name}
                        </Text>
                        {reference.url && (
                          <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"} isTruncated>
                            URL: {reference.url}
                          </Text>
                        )}
                        {reference.publisher_name && (
                          <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                            Publisher: {reference.publisher_name}
                          </Text>
                        )}
                      </VStack>
                    )}

                    {docLink.rationale && (
                      <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.700"} fontStyle="italic" mb={2}>
                        <strong>Rationale:</strong> {docLink.rationale}
                      </Text>
                    )}

                    {docLink.evidence_text && (
                      <Box
                        p={2}
                        bg={colorMode === "dark" ? "gray.800" : "gray.50"}
                        borderRadius="md"
                        borderLeft="3px solid"
                        borderColor={colorMode === "dark" ? "purple.500" : "purple.400"}
                      >
                        <Text fontSize="xs" color={colorMode === "dark" ? "gray.300" : "gray.700"} fontStyle="italic">
                          <strong>Evidence Snippet:</strong><br />
                          "{docLink.evidence_text}"
                        </Text>
                      </Box>
                    )}
                  </Box>
                );
              })}
            </VStack>
          )}

          {/* Results list */}
          {!isLoadingExisting && topClaims.length > 0 && (
            <VStack spacing={3} align="stretch">
              <HStack justify="space-between" mb={1}>
                <Text fontSize="xs" color="gray.500" fontStyle="italic" fontWeight="semibold">
                  🔗 {topClaims.length} Claim-Level Link{topClaims.length !== 1 ? "s" : ""}
                </Text>
                {isScanning && <Spinner size="xs" color="teal.400" />}
              </HStack>

              {topClaims.map((claim, index) => {
                const referenceId = claimReferenceMap.get(claim.claim_id);
                const reference = references.find(r => r.reference_content_id === referenceId);
                const stanceColor = getStanceColor(claim.stance);

                return (
                  <Box
                    key={claim.claim_id}
                    p={4}
                    bg={colorMode === "dark" ? "rgba(15, 25, 40, 0.6)" : "rgba(248, 250, 252, 0.4)"}
                    backdropFilter="blur(20px)"
                    borderLeftRadius="18px"
                    borderWidth="2px"
                    borderColor={`${stanceColor}.500`}
                    boxShadow={colorMode === "dark"
                      ? `0 8px 24px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 30px rgba(113, 219, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)`
                      : `0 12px 36px rgba(0, 0, 0, 0.08), 0 6px 20px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03), inset 0 2px 0 rgba(255, 255, 255, 0.9)`
                    }
                    position="relative"
                    overflow="hidden"
                    _hover={{
                      transform: "translateY(-4px) translateZ(0)",
                      boxShadow: colorMode === "dark"
                        ? `0 12px 32px rgba(0, 0, 0, 0.6), 0 6px 16px rgba(0, 0, 0, 0.4), 0 0 40px rgba(113, 219, 255, 0.3), inset 0 2px 0 rgba(255, 255, 255, 0.15)`
                        : `0 20px 48px rgba(0, 0, 0, 0.12), 0 10px 28px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(0, 0, 0, 0.04), inset 0 3px 0 rgba(255, 255, 255, 1)`,
                    }}
                    transition="all 0.2s ease"
                  >
                    {/* Curved left edge glow */}
                    <Box
                      position="absolute"
                      left={0}
                      top={0}
                      width="24px"
                      height="100%"
                      background={colorMode === "dark"
                        ? `linear-gradient(90deg, ${stanceColor === "green" ? "rgba(72, 187, 120, 0.4)" : stanceColor === "red" ? "rgba(245, 101, 101, 0.4)" : stanceColor === "yellow" ? "rgba(237, 137, 54, 0.4)" : "rgba(113, 219, 255, 0.4)"} 0%, transparent 100%)`
                        : `linear-gradient(90deg, ${stanceColor === "green" ? "rgba(72, 187, 120, 0.25)" : stanceColor === "red" ? "rgba(245, 101, 101, 0.25)" : stanceColor === "yellow" ? "rgba(237, 137, 54, 0.25)" : "rgba(71, 85, 105, 0.2)"} 0%, transparent 100%)`
                      }
                      borderLeftRadius="18px"
                      pointerEvents="none"
                      zIndex={0}
                    />
                    <HStack justify="space-between" mb={2} wrap="wrap" gap={1}>
                      <HStack spacing={2} wrap="wrap">
                        <Badge colorScheme="blue" fontSize="xs">#{index + 1}</Badge>
                        <Badge colorScheme={stanceColor} fontSize="xs">
                          {getStanceLabel(claim.stance)}
                        </Badge>
                        <Tooltip label="Relevance score: -100 (strongly refutes) to +100 (strongly supports)">
                          <Badge colorScheme="purple" fontSize="xs" cursor="help">
                            Relevance: {Math.round(claim.relevanceScore)}
                          </Badge>
                        </Tooltip>
                        <Tooltip label={`AI confidence in this assessment: ${Math.round((claim.confidence ?? 0) * 100)}%`}>
                          <Badge colorScheme="teal" fontSize="xs" cursor="help">
                            Confidence: {Math.round((claim.confidence ?? 0) * 100)}%
                          </Badge>
                        </Tooltip>
                      </HStack>
                    </HStack>

                    <Text fontSize="sm" mb={2} color={colorMode === "dark" ? "gray.100" : "gray.800"}>{claim.claim_text}</Text>

                    {reference && (
                      <VStack align="start" spacing={1} mb={2}>
                        <Text fontSize="xs" fontWeight="semibold" color={colorMode === "dark" ? "blue.300" : "blue.600"}>
                          Source: {reference.content_name}
                        </Text>
                        {reference.publisher_name && (
                          <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                            Publisher: {reference.publisher_name}
                          </Text>
                        )}
                        {reference.author_name && (
                          <Text fontSize="xs" color={colorMode === "dark" ? "gray.400" : "gray.600"}>
                            Author: {reference.author_name}
                          </Text>
                        )}
                      </VStack>
                    )}

                    {claim.rationale && (
                      <Text fontSize="xs" color={colorMode === "dark" ? "gray.500" : "gray.600"} fontStyle="italic" mb={3}>
                        {claim.rationale}
                      </Text>
                    )}

                    <HStack spacing={2} mt={2} wrap="wrap" position="relative" zIndex={1}>
                      <Button
                        size="sm"
                        bg={claim.hasLink ? "rgba(237, 137, 54, 0.12)" : "rgba(72, 187, 120, 0.12)"}
                        border="1px solid"
                        borderColor={claim.hasLink ? "rgba(237, 137, 54, 0.3)" : "rgba(72, 187, 120, 0.3)"}
                        color={claim.hasLink ? "#ed8936" : "#48bb78"}
                        boxShadow="0 6px 20px rgba(0, 0, 0, 0.3)"
                        leftIcon={<span>{claim.hasLink ? "✏️" : "🔗"}</span>}
                        onClick={() => handleOpenLinkOverlay(claim)}
                        _hover={{
                          bg: claim.hasLink ? "rgba(237, 137, 54, 0.18)" : "rgba(72, 187, 120, 0.18)",
                          borderColor: claim.hasLink ? "rgba(237, 137, 54, 0.5)" : "rgba(72, 187, 120, 0.5)",
                        }}
                      >
                        {claim.hasLink ? "Edit Link" : "Create Link"}
                      </Button>
                      {claim.hasLink && (
                        <Button
                          size="sm"
                          bg="rgba(245, 101, 101, 0.12)"
                          border="1px solid"
                          borderColor="rgba(245, 101, 101, 0.3)"
                          color="#f56565"
                          boxShadow="0 6px 20px rgba(0, 0, 0, 0.3)"
                          leftIcon={<span>🗑️</span>}
                          onClick={async () => {
                            if (confirm(`Delete link to "${claim.claim_text.substring(0, 50)}..."?`)) {
                              await handleDeleteLink(claim.claim_id);
                            }
                          }}
                          _hover={{
                            bg: "rgba(245, 101, 101, 0.18)",
                            borderColor: "rgba(245, 101, 101, 0.5)",
                          }}
                        >
                          Delete Link
                        </Button>
                      )}
                      {onSelectReferenceClaim && referenceId && (
                        <Button
                          size="sm"
                          bg="rgba(66, 153, 225, 0.12)"
                          border="1px solid"
                          borderColor="rgba(66, 153, 225, 0.3)"
                          color="#4299e1"
                          boxShadow="0 6px 20px rgba(0, 0, 0, 0.3)"
                          onClick={() => onSelectReferenceClaim(claim, referenceId)}
                          _hover={{
                            bg: "rgba(66, 153, 225, 0.18)",
                            borderColor: "rgba(66, 153, 225, 0.5)",
                          }}
                        >
                          View Source
                        </Button>
                      )}
                    </HStack>
                  </Box>
                );
              })}
            </VStack>
          )}
        </ModalBody>

        <ModalFooter
          borderTopWidth="2px"
          borderColor={colorMode === "dark" ? "rgba(113, 219, 255, 0.3)" : "rgba(71, 85, 105, 0.15)"}
          bg={colorMode === "dark" ? "rgba(10, 15, 25, 0.8)" : "rgba(255, 255, 255, 0.6)"}
          backdropFilter="blur(20px)"
        >
          <HStack spacing={3} w="100%" justify="space-between">
            <Button
              bg="rgba(72, 187, 120, 0.12)"
              border="1px solid"
              borderColor="rgba(72, 187, 120, 0.3)"
              color="#48bb78"
              boxShadow="0 6px 20px rgba(0, 0, 0, 0.3)"
              onClick={() => {
                setScanMode('quick');
                runRelevanceScan('quick');
              }}
              isLoading={isScanning}
              loadingText="Scanning…"
              isDisabled={isBusy}
              size="sm"
              leftIcon={<span>⚡</span>}
              _hover={{
                bg: "rgba(72, 187, 120, 0.18)",
                borderColor: "rgba(72, 187, 120, 0.5)",
              }}
            >
              Quick Scan
            </Button>
            <Button
              bg="rgba(167, 139, 250, 0.12)"
              border="1px solid"
              borderColor="rgba(167, 139, 250, 0.3)"
              color="#a78bfa"
              boxShadow="0 6px 20px rgba(0, 0, 0, 0.3)"
              onClick={() => {
                setScanMode('deep');
                runRelevanceScan('deep');
              }}
              isLoading={isScanning}
              loadingText="Scanning…"
              isDisabled={isBusy}
              size="sm"
              leftIcon={<span>🔍</span>}
              _hover={{
                bg: "rgba(167, 139, 250, 0.18)",
                borderColor: "rgba(167, 139, 250, 0.5)",
              }}
            >
              Deep Scan
            </Button>
            <Button
              bg="rgba(160, 174, 192, 0.12)"
              border="1px solid"
              borderColor="rgba(160, 174, 192, 0.3)"
              color="#a0aec0"
              boxShadow="0 6px 20px rgba(0, 0, 0, 0.3)"
              onClick={onClose}
              size="sm"
              _hover={{
                bg: "rgba(160, 174, 192, 0.18)",
                borderColor: "rgba(160, 174, 192, 0.5)",
              }}
            >
              Close
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RelevanceScanModal;
