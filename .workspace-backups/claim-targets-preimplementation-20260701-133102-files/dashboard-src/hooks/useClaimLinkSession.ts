/**
 * useClaimLinkSession
 *
 * Shared data layer for both Workspace and CaseFocus.
 * Provides caseClaims, references, and claimScores from the canonical
 * service functions (with proper scope + viewer params) so both views
 * always read from the same endpoints and can never diverge.
 *
 * Workspace keeps its own RelationshipMap-specific fetches
 * (fetchClaimsAndLinkedReferencesForTask, fetchAIEvidenceLinks).
 * CaseFocus keeps its own per-claim fetchReferenceClaimTaskLinks.
 * Neither of those are "shared" data — they're view-specific.
 */

import { useState, useEffect, useCallback } from "react";
import {
  fetchClaimsWithEvidence,
  fetchReferencesWithClaimsForTask,
  fetchClaimScoresForTask,
} from "../services/useDashboardAPI";
import { Claim, ReferenceWithClaims } from "../../../shared/entities/types";

interface UseClaimLinkSessionOptions {
  contentId: number;
  viewerId: number | null;
  scope?: "user" | "all" | "admin";
}

export interface UseClaimLinkSessionResult {
  /** Task-level case claims (from fetchClaimsWithEvidence — same shape both views need) */
  caseClaims: Claim[];
  /** References with their embedded claims (from fetchReferencesWithClaimsForTask) */
  references: ReferenceWithClaims[];
  /** Verimeter scores keyed by claim_id */
  claimScores: Record<number, number>;
  /** True while the initial references load is in flight */
  isLoading: boolean;
  /** Trigger re-fetch of caseClaims only */
  refreshClaims: () => void;
  /** Trigger re-fetch of references only */
  refreshReferences: () => void;
  /** Trigger re-fetch of claimScores only (call after a link is created) */
  refreshScores: () => void;
  /** Trigger re-fetch of everything */
  refreshAll: () => void;
}

export function useClaimLinkSession({
  contentId,
  viewerId,
  scope = "all",
}: UseClaimLinkSessionOptions): UseClaimLinkSessionResult {
  const [caseClaims, setCaseClaims] = useState<Claim[]>([]);
  const [references, setReferences] = useState<ReferenceWithClaims[]>([]);
  const [claimScores, setClaimScores] = useState<Record<number, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Version counters drive re-fetches without needing boolean toggles
  const [claimsVer, setClaimsVer] = useState(0);
  const [refsVer, setRefsVer] = useState(0);
  const [scoresVer, setScoresVer] = useState(0);

  // ── caseClaims ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!contentId) return;
    fetchClaimsWithEvidence(contentId, viewerId, scope)
      .then(setCaseClaims)
      .catch((err) => {
        console.error("[useClaimLinkSession] claims fetch failed:", err);
        setCaseClaims([]);
      });
  }, [contentId, viewerId, scope, claimsVer]);

  // ── references ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!contentId) return;
    setIsLoading(true);
    fetchReferencesWithClaimsForTask(contentId, viewerId, scope)
      .then((refs) => {
        setReferences(refs);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("[useClaimLinkSession] references fetch failed:", err);
        setReferences([]);
        setIsLoading(false);
      });
  }, [contentId, viewerId, scope, refsVer]);

  // ── claimScores ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!contentId) return;
    fetchClaimScoresForTask(contentId, viewerId)
      .then(setClaimScores)
      .catch((err) => {
        console.error("[useClaimLinkSession] scores fetch failed:", err);
        setClaimScores({});
      });
  }, [contentId, viewerId, scoresVer]);

  // ── callbacks ───────────────────────────────────────────────────────────────
  const refreshClaims = useCallback(() => setClaimsVer((v) => v + 1), []);
  const refreshReferences = useCallback(() => setRefsVer((v) => v + 1), []);
  const refreshScores = useCallback(() => setScoresVer((v) => v + 1), []);
  const refreshAll = useCallback(() => {
    setClaimsVer((v) => v + 1);
    setRefsVer((v) => v + 1);
    setScoresVer((v) => v + 1);
  }, []);

  return {
    caseClaims,
    references,
    claimScores,
    isLoading,
    refreshClaims,
    refreshReferences,
    refreshScores,
    refreshAll,
  };
}
