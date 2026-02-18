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
} from "@chakra-ui/react";
import { Claim, ReferenceWithClaims } from "../../../../shared/entities/types";
import {
  fetchReferenceClaimTaskLinks,
  assessReferenceClaimRelevance,
  enrichClaimsWithRelevance,
  sortClaimsByRelevance,
  ClaimWithRelevance,
} from "../../services/referenceClaimRelevance";

interface RelevanceScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskClaim: Claim | null;
  references: ReferenceWithClaims[];
  onSelectReferenceClaim?: (claim: ClaimWithRelevance, referenceId: number) => void;
  // Opens the ClaimLinkOverlay pre-populated with AI suggestion
  onOpenLinkOverlay?: (
    sourceClaim: { claim_id: number; claim_text: string },
    rationale: string,
    supportLevel: number
  ) => void;
}

const RelevanceScanModal: React.FC<RelevanceScanModalProps> = ({
  isOpen,
  onClose,
  taskClaim,
  references,
  onSelectReferenceClaim,
  onOpenLinkOverlay,
}) => {
  const toast = useToast();
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
  const [topClaims, setTopClaims] = useState<ClaimWithRelevance[]>([]);
  const [claimReferenceMap, setClaimReferenceMap] = useState<Map<number, number>>(new Map());
  const [allReferenceClaims, setAllReferenceClaims] = useState<Claim[]>([]);
  const lastTaskClaimId = useRef<number | null>(null);

  // ── On open: load existing links immediately, don't re-scan ──────────────
  useEffect(() => {
    if (isOpen && taskClaim) {
      // Only reload if the task claim changed
      if (taskClaim.claim_id !== lastTaskClaimId.current) {
        lastTaskClaimId.current = taskClaim.claim_id;
        loadExistingLinks();
      }
    }
  }, [isOpen, taskClaim?.claim_id]); // eslint-disable-line

  // ── Build the reference claim data and reference map ──────────────────────
  const buildReferenceClaims = () => {
    const all: Claim[] = [];
    const refMap = new Map<number, number>();

    references.forEach((ref) => {
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

      if (all.length === 0) {
        setTopClaims([]);
        setIsLoadingExisting(false);
        return;
      }

      const existingLinks = await fetchReferenceClaimTaskLinks(taskClaim.claim_id);
      const enriched = enrichClaimsWithRelevance(all, taskClaim.claim_id, existingLinks);
      const sorted = sortClaimsByRelevance(enriched);
      const withLinks = sorted.filter((c) => c.hasLink);

      setTopClaims(withLinks);
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
      // Rebuild reference claim data if empty
      let claims = allReferenceClaims;
      let refMap = claimReferenceMap;
      if (claims.length === 0) {
        const built = buildReferenceClaims();
        claims = built.all;
        refMap = built.refMap;
      }

      if (claims.length === 0) {
        toast({
          title: "No reference claims found",
          description: "References need their claims extracted first.",
          status: "info",
          duration: 5000,
        });
        setIsScanning(false);
        return;
      }

      // Fetch existing links to skip already-assessed claims
      const existingLinks = await fetchReferenceClaimTaskLinks(taskClaim.claim_id);
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
      const withLinks = sorted.filter((c) => c.hasLink).slice(0, 12);

      setTopClaims(withLinks);

      toast({
        title: newLinks.length > 0 ? `Found ${newLinks.length} new links` : "No new links found",
        description: newLinks.length > 0
          ? `Total: ${withLinks.length} relevant claims`
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
    if (!onOpenLinkOverlay) return;
    const supportLevel = claim.support_level ??
      (claim.stance === "support" ? (claim.confidence ?? 0.7)
        : claim.stance === "refute" ? -(claim.confidence ?? 0.7)
        : 0);
    onOpenLinkOverlay(
      { claim_id: claim.claim_id, claim_text: claim.claim_text },
      claim.rationale || "",
      supportLevel
    );
    onClose();
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
    return "? UNKNOWN";
  };

  const isBusy = isLoadingExisting || isScanning;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent bg="gray.800" color="white" maxH="90vh">
        <ModalHeader>
          Relevant Reference Claims
          {taskClaim && (
            <Text fontSize="sm" fontWeight="normal" color="gray.400" mt={1}>
              For: "{taskClaim.claim_text.substring(0, 80)}{taskClaim.claim_text.length > 80 ? "…" : ""}"
            </Text>
          )}
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {/* Loading existing */}
          {isLoadingExisting && (
            <HStack justify="center" py={6}>
              <Spinner size="md" color="teal.400" />
              <Text color="gray.400">Loading previously scanned links…</Text>
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
                Click "Scan for Links" below to find relevant reference claims.
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
                    bg="gray.700"
                    borderRadius="md"
                    borderWidth="1px"
                    borderColor={`${stanceColor}.600`}
                    borderLeftWidth="4px"
                  >
                    <HStack justify="space-between" mb={2} wrap="wrap" gap={1}>
                      <HStack spacing={2}>
                        <Badge colorScheme="blue" fontSize="xs">#{index + 1}</Badge>
                        <Badge colorScheme={stanceColor} fontSize="xs">
                          {getStanceLabel(claim.stance)}
                        </Badge>
                        <Badge colorScheme="purple" fontSize="xs">
                          Score: {Math.round(claim.relevanceScore)}
                        </Badge>
                      </HStack>
                      <Tooltip label={`Confidence: ${Math.round((claim.confidence ?? 0) * 100)}%`}>
                        <Badge colorScheme="teal" fontSize="xs">
                          {Math.round((claim.confidence ?? 0) * 100)}% conf.
                        </Badge>
                      </Tooltip>
                    </HStack>

                    <Text fontSize="sm" mb={1}>{claim.claim_text}</Text>

                    {reference && (
                      <Text fontSize="xs" color="gray.400" mb={1}>
                        From: {reference.content_name}
                      </Text>
                    )}

                    {claim.rationale && (
                      <Text fontSize="xs" color="gray.500" fontStyle="italic" mb={3}>
                        {claim.rationale}
                      </Text>
                    )}

                    <HStack spacing={2} mt={2} wrap="wrap">
                      <Button
                        size="sm"
                        colorScheme="green"
                        leftIcon={<span>🔗</span>}
                        onClick={() => handleOpenLinkOverlay(claim)}
                        isDisabled={!onOpenLinkOverlay}
                      >
                        Create Link
                      </Button>
                      {onSelectReferenceClaim && referenceId && (
                        <Button
                          size="sm"
                          variant="outline"
                          colorScheme="blue"
                          onClick={() => onSelectReferenceClaim(claim, referenceId)}
                        >
                          View Reference
                        </Button>
                      )}
                    </HStack>
                  </Box>
                );
              })}
            </VStack>
          )}
        </ModalBody>

        <ModalFooter borderTopWidth="1px" borderColor="gray.700">
          <HStack spacing={3} w="100%" justify="space-between">
            <Button
              colorScheme="teal"
              variant="outline"
              onClick={runRelevanceScan}
              isLoading={isScanning}
              loadingText="Scanning…"
              isDisabled={isBusy}
              size="sm"
            >
              {topClaims.length > 0 ? "Scan for More Links" : "Scan for Links"}
            </Button>
            <Button colorScheme="gray" onClick={onClose} size="sm">
              Close
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default RelevanceScanModal;
