import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  Grid,
  HStack,
  Input,
  Select,
  Spinner,
  Text,
  VStack,
  Badge,
  useToast,
} from "@chakra-ui/react";
import { api } from "../../services/api";
import { Claim } from "../../../../shared/entities/types";
import { useTaskStore } from "../../store/useTaskStore";

type ClaimRole = "thesis" | "pillar" | "evidence" | "background";

interface HierarchyContent {
  content_id: number;
  content_name: string;
  url?: string;
  media_source?: string;
  details?: string;
}

interface HierarchySuggestion {
  claim_id: number;
  claim_role: ClaimRole;
  parent_claim_id: number | null;
  claim_depth: number;
  centrality_score: number;
  verifiability_score: number;
  claim_order: number;
  reason?: string;
}

interface DraftMap {
  [claimId: number]: Partial<Claim>;
}

const toClaimPatch = (patch: {
  claim_role?: string | null;
  parent_claim_id?: number | null;
  claim_depth?: number | null;
  centrality_score?: number | null;
  verifiability_score?: number | null;
  claim_order?: number | null;
}): Partial<Claim> => ({
  claim_role: patch.claim_role ?? undefined,
  parent_claim_id: patch.parent_claim_id ?? null,
  claim_depth: patch.claim_depth ?? null,
  centrality_score: patch.centrality_score ?? null,
  verifiability_score: patch.verifiability_score ?? null,
  claim_order: patch.claim_order ?? null,
});

const roleOrder: ClaimRole[] = ["thesis", "pillar", "evidence", "background"];

const roleAccent = (role?: string) => {
  const value = String(role || "").toLowerCase();
  if (value === "thesis" || value === "task") return "#63B3ED";
  if (value === "pillar") return "#9F7AEA";
  if (value === "evidence" || value === "reference" || value === "snippet") return "#38A169";
  return "#A0AEC0";
};

const roleLabel = (claim: Claim) => {
  const value = String(claim.claim_role || claim.claim_type || "background").toLowerCase();
  if (value === "task" || value === "thesis") return "THESIS";
  if (value === "pillar") return "PILLAR";
  if (value === "evidence" || value === "reference" || value === "snippet") return "EVIDENCE";
  return "BACKGROUND";
};

export default function ClaimHierarchyEditor() {
  const toast = useToast();
  const selectedTask = useTaskStore((state) => state.selectedTask);
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId);
  const [contentIdInput, setContentIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [batchSaving, setBatchSaving] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [content, setContent] = useState<HierarchyContent | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [suggestions, setSuggestions] = useState<HierarchySuggestion[]>([]);

  const grouped = useMemo(() => {
    const byId = new Map<number, Claim>();
    const children = new Map<number, Claim[]>();
    const roots: Claim[] = [];

    claims.forEach((claim) => byId.set(claim.claim_id, claim));
    const sortClaims = (a: Claim, b: Claim) =>
      roleOrder.indexOf(String(a.claim_role || a.claim_type || "background").toLowerCase() as ClaimRole) -
        roleOrder.indexOf(String(b.claim_role || b.claim_type || "background").toLowerCase() as ClaimRole) ||
      (a.claim_order ?? 999999) - (b.claim_order ?? 999999) ||
      (b.centrality_score ?? 0) - (a.centrality_score ?? 0) ||
      a.claim_id - b.claim_id;

    claims.forEach((claim) => {
      const parentId = claim.parent_claim_id ?? null;
      if (parentId != null && byId.has(parentId)) {
        const list = children.get(parentId) || [];
        list.push(claim);
        children.set(parentId, list);
      } else {
        roots.push(claim);
      }
    });
    roots.sort(sortClaims);
    children.forEach((list) => list.sort(sortClaims));

    return { roots, children };
  }, [claims]);

  const selectedClaim = selectedClaimId
    ? claims.find((c) => c.claim_id === selectedClaimId) || null
    : null;

  useEffect(() => {
    if (selectedClaimId == null && claims.length > 0) {
      setSelectedClaimId(claims[0].claim_id);
    }
  }, [claims, selectedClaimId]);

  const loadContentById = useCallback(async (contentId: number) => {
    if (!Number.isInteger(contentId) || contentId <= 0) {
      throw new Error("Invalid contentId");
    }

    setLoading(true);
    try {
      const response = await api.get(`/api/admin/content/${contentId}/claims-hierarchy`);
      setContent(response.data.content || null);
      setClaims(response.data.claims || []);
      setSuggestions([]);
      setDrafts({});
      setSelectedClaimId(response.data.claims?.[0]?.claim_id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedTaskId || content?.content_id === selectedTaskId) return;
    setContentIdInput(String(selectedTaskId));
    void loadContentById(selectedTaskId).catch((error: any) => {
      console.error("Failed to load selected task hierarchy:", error);
      toast({
        title: "Failed to load selected case hierarchy",
        description: error.response?.data?.error || error.message || "Unknown error",
        status: "error",
        duration: 4000,
      });
    });
  }, [content?.content_id, loadContentById, selectedTaskId, toast]);

  const loadContent = async () => {
    const contentId = Number(contentIdInput);
    if (!Number.isInteger(contentId) || contentId <= 0) {
      toast({
        title: "Enter a valid content ID",
        status: "warning",
        duration: 2500,
      });
      return;
    }

    try {
      await loadContentById(contentId);
    } catch (error: any) {
      console.error("Failed to load hierarchy:", error);
      toast({
        title: "Failed to load content hierarchy",
        description: error.response?.data?.error || error.message || "Unknown error",
        status: "error",
        duration: 4000,
      });
      setContent(null);
      setClaims([]);
      setSuggestions([]);
    }
  };

  const loadSelectedTask = async () => {
    if (!selectedTaskId) return;
    try {
      setContentIdInput(String(selectedTaskId));
      await loadContentById(selectedTaskId);
    } catch (error: any) {
      console.error("Failed to load selected task hierarchy:", error);
      toast({
        title: "Failed to load selected case hierarchy",
        description: error.response?.data?.error || error.message || "Unknown error",
        status: "error",
        duration: 4000,
      });
    }
  };

  const updateDraft = (claimId: number, patch: Partial<Claim>) => {
    setDrafts((prev) => ({
      ...prev,
      [claimId]: {
        ...(prev[claimId] || {}),
        ...patch,
      },
    }));
  };

  const saveClaim = async (claim: Claim) => {
    const draft = drafts[claim.claim_id] || {};
    const payload = {
      claim_role: draft.claim_role ?? claim.claim_role ?? null,
      parent_claim_id: draft.parent_claim_id ?? claim.parent_claim_id ?? null,
      claim_depth: draft.claim_depth ?? claim.claim_depth ?? null,
      centrality_score: draft.centrality_score ?? claim.centrality_score ?? null,
      verifiability_score: draft.verifiability_score ?? claim.verifiability_score ?? null,
      claim_order: draft.claim_order ?? claim.claim_order ?? null,
    };

    setSavingId(claim.claim_id);
    try {
      await api.put(
        `/api/admin/content/${content?.content_id}/claims/${claim.claim_id}/hierarchy`,
        payload,
      );
      setClaims((prev) =>
        prev.map((c) =>
          c.claim_id === claim.claim_id
            ? {
                ...c,
                ...toClaimPatch(payload),
              }
            : c,
        ),
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[claim.claim_id];
        return next;
      });
      toast({
        title: "Hierarchy updated",
        status: "success",
        duration: 2000,
      });
    } catch (error: any) {
      console.error("Failed to save hierarchy:", error);
      toast({
        title: "Failed to save hierarchy",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 4000,
      });
    } finally {
      setSavingId(null);
    }
  };

  const saveDrafts = async () => {
    if (!content?.content_id) return;

    const updates = Object.entries(drafts).map(([claimId, draft]) => {
      const claim = claims.find((c) => c.claim_id === Number(claimId));
      return {
        claim_id: Number(claimId),
        claim_role: draft.claim_role ?? claim?.claim_role ?? null,
        parent_claim_id: draft.parent_claim_id ?? claim?.parent_claim_id ?? null,
        claim_depth: draft.claim_depth ?? claim?.claim_depth ?? null,
        centrality_score: draft.centrality_score ?? claim?.centrality_score ?? null,
        verifiability_score: draft.verifiability_score ?? claim?.verifiability_score ?? null,
        claim_order: draft.claim_order ?? claim?.claim_order ?? null,
      };
    });

    if (updates.length === 0) {
      toast({
        title: "No hierarchy changes to apply",
        status: "info",
        duration: 2000,
      });
      return;
    }

    setBatchSaving(true);
    try {
      await api.put(`/api/admin/content/${content.content_id}/claims-hierarchy/batch`, {
        updates,
      });
      setClaims((prev) =>
        prev.map((claim) => {
          const update = updates.find((u) => u.claim_id === claim.claim_id);
          return update ? { ...claim, ...toClaimPatch(update) } : claim;
        }),
      );
      setDrafts({});
      toast({
        title: "Hierarchy changes applied",
        description: `${updates.length} claim${updates.length === 1 ? "" : "s"} updated.`,
        status: "success",
        duration: 2500,
      });
    } catch (error: any) {
      console.error("Failed to apply hierarchy drafts:", error);
      toast({
        title: "Failed to apply hierarchy changes",
        description: error.response?.data?.error || error.message || "Unknown error",
        status: "error",
        duration: 4000,
      });
    } finally {
      setBatchSaving(false);
    }
  };

  const suggestHierarchy = async () => {
    if (!content?.content_id) return;
    setSuggesting(true);
    try {
      const response = await api.post(
        `/api/admin/content/${content.content_id}/claims-hierarchy/suggest`,
      );
      const nextSuggestions = response.data.suggestions || [];
      setSuggestions(nextSuggestions);

      const nextDrafts: DraftMap = {};
      nextSuggestions.forEach((s: HierarchySuggestion) => {
        nextDrafts[s.claim_id] = {
          claim_role: s.claim_role,
          parent_claim_id: s.parent_claim_id,
          claim_depth: s.claim_depth,
          centrality_score: s.centrality_score,
          verifiability_score: s.verifiability_score,
          claim_order: s.claim_order,
        };
      });
      setDrafts(nextDrafts);
      toast({
        title: "AI suggestions loaded",
        description: "Review and apply the suggested hierarchy changes.",
        status: "success",
        duration: 2500,
      });
    } catch (error: any) {
      console.error("Failed to suggest hierarchy:", error);
      toast({
        title: "Failed to generate suggestions",
        description: error.response?.data?.error || "Unknown error",
        status: "error",
        duration: 4000,
      });
    } finally {
      setSuggesting(false);
    }
  };

  const renderNode = (claim: Claim, depth = 0): React.ReactNode => {
    const childClaims = grouped.children.get(claim.claim_id) || [];
    const effective = { ...claim, ...(drafts[claim.claim_id] || {}) } as Claim;
    return (
      <Box key={claim.claim_id} w="100%">
        <Box
          onClick={() => setSelectedClaimId(claim.claim_id)}
          cursor="pointer"
          p={3}
          borderRadius="md"
          border="1px solid"
          borderColor={selectedClaimId === claim.claim_id ? roleAccent(effective.claim_role) : "rgba(100,116,139,0.25)"}
          bg={selectedClaimId === claim.claim_id ? "rgba(15, 23, 42, 0.9)" : "rgba(15, 23, 42, 0.65)"}
          ml={depth > 0 ? 4 : 0}
          boxShadow="0 8px 24px rgba(0,0,0,0.35)"
        >
          <HStack justify="space-between" align="start" spacing={3}>
            <VStack align="start" spacing={1} minW={0} flex="1">
              <HStack spacing={2} flexWrap="wrap">
                <Badge colorScheme="cyan">#{claim.claim_id}</Badge>
                <Badge
                  variant="outline"
                  borderColor={roleAccent(effective.claim_role)}
                  color={roleAccent(effective.claim_role)}
                >
                  {roleLabel(effective)}
                </Badge>
                <Badge variant="outline">L{effective.claim_depth ?? "?"}</Badge>
                {effective.centrality_score != null && <Badge variant="subtle">C{Math.round(Number(effective.centrality_score))}</Badge>}
                {effective.verifiability_score != null && <Badge variant="subtle">V{Math.round(Number(effective.verifiability_score))}</Badge>}
              </HStack>
              <Text fontSize="sm" noOfLines={3}>
                {claim.claim_text}
              </Text>
              {(drafts[claim.claim_id]?.claim_role || drafts[claim.claim_id]?.parent_claim_id != null) && (
                <Text fontSize="xs" color="gray.400">
                  Draft changes pending
                </Text>
              )}
            </VStack>
            <Button
              size="sm"
              variant="outline"
              isLoading={savingId === claim.claim_id}
              onClick={(e) => {
                e.stopPropagation();
                void saveClaim(claim);
              }}
            >
              Apply
            </Button>
          </HStack>
        </Box>
        {childClaims.length > 0 && (
          <VStack align="stretch" spacing={2} mt={2} pl={3} borderLeft="1px solid rgba(148,163,184,0.25)">
            {childClaims.map((child) => renderNode(child, depth + 1))}
          </VStack>
        )}
      </Box>
    );
  };

  return (
    <VStack align="stretch" spacing={4}>
      <HStack align="end" spacing={3} flexWrap="wrap">
        <FormControl maxW="240px">
          <FormLabel fontSize="sm">Content ID</FormLabel>
          <Input
            value={contentIdInput}
            onChange={(e) => setContentIdInput(e.target.value)}
            placeholder="Enter content_id"
            bg="rgba(15, 23, 42, 0.7)"
          />
        </FormControl>
        <Button onClick={loadContent} isLoading={loading}>
          Load Claims
        </Button>
        {selectedTaskId && (
          <Button
            variant="outline"
            onClick={() => void loadSelectedTask()}
            isLoading={loading}
          >
            Use Selected Case
          </Button>
        )}
        <Button onClick={suggestHierarchy} isLoading={suggesting} isDisabled={!content}>
          Suggest Hierarchy
        </Button>
        <Button
          colorScheme="cyan"
          onClick={saveDrafts}
          isLoading={batchSaving}
          isDisabled={!content || Object.keys(drafts).length === 0}
        >
          Apply All Drafts
        </Button>
      </HStack>

      {selectedTaskId && (
        <Text fontSize="sm" color="gray.400">
          Selected case: #{selectedTaskId}
          {selectedTask?.content_name ? ` ${selectedTask.content_name}` : ""}
        </Text>
      )}

      {content && (
        <Box p={4} borderWidth="1px" borderRadius="md" bg="rgba(15, 23, 42, 0.65)">
          <Text fontWeight="bold">{content.content_name}</Text>
          <Text fontSize="sm" color="gray.400" noOfLines={2}>
            {content.url || content.media_source || "No source metadata"}
          </Text>
        </Box>
      )}

      {suggestions.length > 0 && (
        <Box p={4} borderWidth="1px" borderColor="cyan.700" borderRadius="md" bg="rgba(0, 162, 255, 0.06)">
          <Text fontSize="sm" fontWeight="bold" mb={2}>AI Suggestions</Text>
          <VStack align="stretch" spacing={2}>
            {suggestions.slice(0, 8).map((s) => (
              <HStack key={s.claim_id} justify="space-between" align="start">
                <Text fontSize="xs">
                  Claim #{s.claim_id}: {s.claim_role}
                  {s.parent_claim_id ? ` → parent ${s.parent_claim_id}` : ""}
                </Text>
                <Text fontSize="xs" color="gray.400" maxW="60%">
                  {s.reason}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      )}

      {loading ? (
        <HStack py={8} justify="center">
          <Spinner />
          <Text>Loading claims…</Text>
        </HStack>
      ) : (
        <Grid templateColumns={{ base: "1fr", xl: "1.4fr 1fr" }} gap={4} alignItems="start">
          <VStack align="stretch" spacing={3}>
            {claims.length === 0 ? (
              <Box p={4} borderWidth="1px" borderRadius="md" bg="rgba(15, 23, 42, 0.5)">
                <Text>No claims loaded.</Text>
              </Box>
            ) : (
              grouped.roots.map((claim) => renderNode(claim))
            )}
          </VStack>

          <Box p={4} borderWidth="1px" borderRadius="md" bg="rgba(15, 23, 42, 0.72)">
            <Text fontWeight="bold" mb={3}>Selected Claim</Text>
            {selectedClaim ? (
              <VStack align="stretch" spacing={3}>
                <Box>
                  <Text fontSize="sm" fontWeight="semibold" mb={1}>Claim</Text>
                  <Text fontSize="sm" color="gray.300">{selectedClaim.claim_text}</Text>
                </Box>

                <FormControl>
                  <FormLabel fontSize="sm">Role</FormLabel>
                  <Select
                    value={(drafts[selectedClaim.claim_id]?.claim_role as string) ?? selectedClaim.claim_role ?? "background"}
                    onChange={(e) => updateDraft(selectedClaim.claim_id, { claim_role: e.target.value as ClaimRole })}
                  >
                    <option value="thesis">Thesis</option>
                    <option value="pillar">Pillar</option>
                    <option value="evidence">Evidence</option>
                    <option value="background">Background</option>
                  </Select>
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm">Parent Claim</FormLabel>
                  <Select
                    value={String((drafts[selectedClaim.claim_id]?.parent_claim_id ?? selectedClaim.parent_claim_id ?? "") || "")}
                    onChange={(e) =>
                      updateDraft(selectedClaim.claim_id, {
                        parent_claim_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">No parent</option>
                    {claims
                      .filter((c) => c.claim_id !== selectedClaim.claim_id)
                      .map((c) => (
                        <option key={c.claim_id} value={c.claim_id}>
                          #{c.claim_id} {c.claim_text.slice(0, 80)}
                        </option>
                      ))}
                  </Select>
                </FormControl>

                <Grid templateColumns="repeat(2, 1fr)" gap={3}>
                  <FormControl>
                    <FormLabel fontSize="sm">Claim Order</FormLabel>
                    <Input
                      type="number"
                      value={String(drafts[selectedClaim.claim_id]?.claim_order ?? selectedClaim.claim_order ?? "")}
                      onChange={(e) =>
                        updateDraft(selectedClaim.claim_id, {
                          claim_order: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="sm">Centrality</FormLabel>
                    <Input
                      type="number"
                      value={String(drafts[selectedClaim.claim_id]?.centrality_score ?? selectedClaim.centrality_score ?? "")}
                      onChange={(e) =>
                        updateDraft(selectedClaim.claim_id, {
                          centrality_score: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </FormControl>
                </Grid>

                <FormControl>
                  <FormLabel fontSize="sm">Verifiability</FormLabel>
                  <Input
                    type="number"
                    value={String(drafts[selectedClaim.claim_id]?.verifiability_score ?? selectedClaim.verifiability_score ?? "")}
                    onChange={(e) =>
                      updateDraft(selectedClaim.claim_id, {
                        verifiability_score: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </FormControl>

                <Button
                  colorScheme="cyan"
                  onClick={() => void saveClaim(selectedClaim)}
                  isLoading={savingId === selectedClaim.claim_id}
                >
                  Save Selected
                </Button>
              </VStack>
            ) : (
              <Text fontSize="sm" color="gray.400">
                Select a claim to edit its hierarchy.
              </Text>
            )}
          </Box>
        </Grid>
      )}
    </VStack>
  );
}
