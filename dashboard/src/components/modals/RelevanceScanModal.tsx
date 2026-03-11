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
  assessReferenceClaimRelevance,
  enrichClaimsWithRelevance,
  sortClaimsByRelevance,
  ClaimWithRelevance,
} from "../../services/referenceClaimRelevance";
import { fetchClaimScoresForTask } from "../../services/useDashboardAPI";
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
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [topClaims, setTopClaims] = useState<ClaimWithRelevance[]>([]);
  const [claimReferenceMap, setClaimReferenceMap] = useState<Map<number, number>>(new Map());
  const [allReferenceClaims, setAllReferenceClaims] = useState<Claim[]>([]);
  const lastTaskClaimId = useRef<number | null>(null);
  const [scanMode, setScanMode] = useState<'quick' | 'deep'>('quick');

  // NEW: Computed verimeter score from linked reference claims
  const [computedScore, setComputedScore] = useState<number | null>(null);

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

      if (all.length === 0) {
        setTopClaims([]);
        setIsLoadingExisting(false);
        return;
      }

      const existingLinks = await fetchReferenceClaimTaskLinks(taskClaim.claim_id);
      console.log(`🔍 [RelevanceScan] Fetched ${existingLinks.length} links from backend:`, existingLinks);

      const enriched = enrichClaimsWithRelevance(all, taskClaim.claim_id, existingLinks);
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
  const runRelevanceScan = async () => {
    if (!taskClaim) return;

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

      if (scanMode === 'quick') {
        try {
          // Get references with dotted lines for this TASK CLAIM
          // Uses /api/task-claim/reference-links/:taskClaimId endpoint
          const url = `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5001"}/api/task-claim/reference-links/${taskClaim.claim_id}`;
          console.log(`⚡ [Quick Scan] Fetching dotted lines for task claim ${taskClaim.claim_id} from: ${url}`);

          const response = await fetch(url, { credentials: "include" });
          console.log(`⚡ [Quick Scan] Response status: ${response.status}`);

          if (response.ok) {
            const dottedLineRefs = await response.json();
            console.log(`⚡ [Quick Scan] API returned ${dottedLineRefs.length} dotted line records:`, dottedLineRefs);

            dottedLineRefs.forEach((link: any) => {
              linkedReferenceIds.add(link.reference_content_id);
            });
            console.log(`⚡ [Quick Scan] Found ${linkedReferenceIds.size} unique references with dotted-line connections`);
          } else {
            console.error(`⚡ [Quick Scan] API error: ${response.status} ${response.statusText}`);
          }

          console.log(`⚡ [Quick Scan] Will scan all claims from ${linkedReferenceIds.size} references`);
        } catch (err) {
          console.error("[Quick Scan] Error fetching reference links:", err);
        }
      }

      // If quick mode, rebuild with only linked references
      if (scanMode === 'quick' && linkedReferenceIds.size > 0) {
        const built = buildReferenceClaims(linkedReferenceIds);
        claims = built.all;
        refMap = built.refMap;
        console.log(`⚡ [Quick Scan] Scanning ${claims.length} claims from ${linkedReferenceIds.size} references with dotted lines`);
      } else if (scanMode === 'quick') {
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
          if (link) newLinks.push(link);
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

      const scanModeLabel = scanMode === 'quick' ? 'Quick' : 'Deep';
      toast({
        title: newLinks.length > 0 ? `${scanModeLabel} Scan: Found ${newLinks.length} new assessments` : `${scanModeLabel} Scan: No new assessments`,
        description: newLinks.length > 0
          ? `Showing ${top12.length} top claims (${withLinks.length} linked, ${top12.length - withLinks.length} unlinked)`
          : scanMode === 'quick'
          ? "All claims in linked references already assessed. Try Deep Scan for more."
          : "All claims were already assessed",
        status: newLinks.length > 0 ? "success" : "info",
        duration: 3000,
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
    if (!onOpenLinkOverlay) {
      console.error("[RelevanceScanModal] onOpenLinkOverlay callback is not provided!");
      return;
    }
    if (!taskClaim) {
      console.error("[RelevanceScanModal] No task claim available!");
      return;
    }
    const supportLevel = claim.support_level ??
      (claim.stance === "support" ? (claim.confidence ?? 0.7)
        : claim.stance === "refute" ? -(claim.confidence ?? 0.7)
        : 0);
    console.log("[RelevanceScanModal] Opening link overlay with:", {
      sourceClaim_id: claim.claim_id,
      targetClaim_id: taskClaim.claim_id,
      rationale: claim.rationale,
      supportLevel
    });
    onOpenLinkOverlay(
      { claim_id: claim.claim_id, claim_text: claim.claim_text },
      taskClaim,
      claim.rationale || "",
      supportLevel
    );
    onClose();
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
      <ModalOverlay />
      <ModalContent
        bg={colorMode === "dark" ? "gray.800" : "linear-gradient(135deg, rgba(248, 250, 252, 0.98), rgba(241, 245, 249, 1))"}
        color={colorMode === "dark" ? "white" : "gray.800"}
        maxH="90vh"
        border="1px solid"
        borderColor={colorMode === "dark" ? "gray.700" : "rgba(71, 85, 105, 0.3)"}
      >
        <ModalHeader>
          Case Claim Details
          {taskClaim && (
            <VStack align="stretch" mt={3} spacing={2}>
              {/* 🔍 DEBUG INFO */}
              <Box p={2} bg={colorMode === "dark" ? "purple.900" : "purple.100"} borderRadius="md" fontSize="xs" fontFamily="monospace">
                <Text color={colorMode === "dark" ? "purple.200" : "purple.800"}>🔍 DEBUG:</Text>
                <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Task Content ID: {contentId ?? 'null'}</Text>
                <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Task Claim ID: {taskClaim.claim_id}</Text>
                <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Viewer ID: {viewerId ?? 'null'}</Text>
                <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Sources Count: {references.length}</Text>
              </Box>

              <Box
                p={3}
                bg="gray.700"
                borderRadius="md"
                borderWidth="2px"
                borderColor={computedScore !== null ? (computedScore > 0.5 ? "green.500" : computedScore < -0.5 ? "red.500" : "yellow.500") : "blue.500"}
              >
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
          {!isBusy && topClaims.length === 0 && (
            <Box textAlign="center" py={10}>
              <Text color="gray.400" fontSize="md" mb={2}>No scanned links yet</Text>
              <Text color="gray.500" fontSize="sm" mb={4}>
                Click "Scan for Links" below to find relevant source claims.
              </Text>
            </Box>
          )}

          {/* Results list */}
          {!isLoadingExisting && topClaims.length > 0 && (
            <VStack spacing={3} align="stretch">
              <HStack justify="space-between" mb={1}>
                <Text fontSize="xs" color="gray.500" fontStyle="italic">
                  {topClaims.length} link{topClaims.length !== 1 ? "s" : ""} found
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
                    bg={colorMode === "dark" ? "gray.700" : "rgba(248, 250, 252, 0.8)"}
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor={colorMode === "dark" ? `${stanceColor}.600` : `${stanceColor}.400`}
                    borderLeftWidth="4px"
                  >
                    {/* 🔍 DEBUG: Show IDs for each claim */}
                    <Box mb={2} p={1} bg={colorMode === "dark" ? "purple.900" : "purple.100"} borderRadius="sm" fontSize="10px" fontFamily="monospace">
                      <Text color={colorMode === "dark" ? "purple.300" : "purple.700"}>Source Content: {referenceId ?? 'null'} | Source Claim: {claim.claim_id}</Text>
                    </Box>

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

                    <HStack spacing={2} mt={2} wrap="wrap">
                      <Button
                        size="sm"
                        colorScheme={claim.hasLink ? "yellow" : "green"}
                        leftIcon={<span>{claim.hasLink ? "✏️" : "🔗"}</span>}
                        onClick={() => handleOpenLinkOverlay(claim)}
                      >
                        {claim.hasLink ? "Edit Link" : "Create Link"}
                      </Button>
                      {claim.hasLink && (
                        <Button
                          size="sm"
                          colorScheme="red"
                          variant="outline"
                          leftIcon={<span>🗑️</span>}
                          onClick={async () => {
                            if (confirm(`Delete link to "${claim.claim_text.substring(0, 50)}..."?`)) {
                              await handleDeleteLink(claim.claim_id);
                            }
                          }}
                        >
                          Delete Link
                        </Button>
                      )}
                      {onSelectReferenceClaim && referenceId && (
                        <Button
                          size="sm"
                          variant="outline"
                          colorScheme="blue"
                          onClick={() => onSelectReferenceClaim(claim, referenceId)}
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

        <ModalFooter borderTopWidth="1px" borderColor={colorMode === "dark" ? "gray.700" : "gray.300"}>
          <VStack w="100%" spacing={3}>
            {/* Scan Mode Toggle */}
            <HStack w="100%" justify="center" spacing={2}>
              <Badge colorScheme="gray" fontSize="xs">Scan Mode:</Badge>
              <Button
                size="xs"
                colorScheme={scanMode === 'quick' ? 'green' : 'gray'}
                variant={scanMode === 'quick' ? 'solid' : 'outline'}
                onClick={() => setScanMode('quick')}
                isDisabled={isBusy}
              >
                ⚡ Quick Scan
              </Button>
              <Button
                size="xs"
                colorScheme={scanMode === 'deep' ? 'purple' : 'gray'}
                variant={scanMode === 'deep' ? 'solid' : 'outline'}
                onClick={() => setScanMode('deep')}
                isDisabled={isBusy}
              >
                🔍 Deep Scan
              </Button>
            </HStack>

            {/* Scan Mode Description */}
            <Text fontSize="xs" color="gray.400" textAlign="center">
              {scanMode === 'quick'
                ? "Quick: Scan claims in references already linked to this task (faster)"
                : "Deep: Scan all claims in all references (slower, more thorough)"}
            </Text>

            {/* Action Buttons */}
            <HStack spacing={3} w="100%" justify="space-between">
              <Button
                colorScheme="teal"
                variant="outline"
                onClick={runRelevanceScan}
                isLoading={isScanning}
                loadingText="Scanning…"
                isDisabled={isBusy}
                size="sm"
                leftIcon={<span>{scanMode === 'quick' ? '⚡' : '🔍'}</span>}
              >
                {topClaims.length > 0 ? "Scan for More Links" : `${scanMode === 'quick' ? 'Quick' : 'Deep'} Scan`}
              </Button>
              <Button colorScheme="gray" onClick={onClose} size="sm">
                Close
              </Button>
            </HStack>
          </VStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RelevanceScanModal;
