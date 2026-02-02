// src/services/relevanceScoring.ts
/**
 * Relevance scoring utilities for GameSpace
 * Sorts and filters references based on their evidentiary support for task claims
 */

import { ReferenceWithClaims } from "../../../shared/entities/types";

export interface ReferenceClaimLink {
  link_id: number;
  task_claim_id: number;
  reference_content_id: number;
  stance: "support" | "refute" | "nuance" | "insufficient";
  score: number; // 0-120 (quality * 100)
  confidence: number; // 0-1
  support_level: number; // stance_multiplier * confidence * quality
  rationale?: string;
  quote?: string;
  created_by_ai: boolean;
  task_claim_text?: string;
  reference_title?: string;
  reference_url?: string;
}

export interface ReferenceWithRelevance extends ReferenceWithClaims {
  relevanceScore: number;
  stance?: "support" | "refute" | "nuance" | "insufficient";
  confidence?: number;
  support_level?: number;
  hasLink: boolean;
}

/**
 * Calculate relevance score for a reference given a task claim
 * Uses existing claim links if available, returns 0 if not linked
 */
export function calculateRelevanceScore(
  reference: ReferenceWithClaims,
  taskClaimId: number,
  claimLinks: ReferenceClaimLink[]
): { score: number; link: ReferenceClaimLink | null } {
  // Find link between this reference and the task claim
  const link = claimLinks.find(
    (l) =>
      l.task_claim_id === taskClaimId &&
      l.reference_content_id === reference.reference_content_id
  );

  if (!link) {
    return { score: 0, link: null };
  }

  // Relevance score is based on:
  // 1. Absolute support_level (how strong the relationship is, regardless of direction)
  // 2. Confidence (how certain we are)
  // 3. Stance bonus (support/refute more relevant than nuanced/insufficient)
  const stanceWeight = {
    support: 1.0,
    refute: 1.0,
    nuance: 0.7,
    insufficient: 0.3,
  };

  const stanceBonus = stanceWeight[link.stance] || 0.5;
  const score =
    Math.abs(link.support_level) * link.confidence * stanceBonus * 100;

  return { score, link };
}

/**
 * Enrich references with relevance scores for a given task claim
 */
export function enrichReferencesWithRelevance(
  references: ReferenceWithClaims[],
  taskClaimId: number,
  claimLinks: ReferenceClaimLink[]
): ReferenceWithRelevance[] {
  return references.map((ref) => {
    const { score, link } = calculateRelevanceScore(
      ref,
      taskClaimId,
      claimLinks
    );

    return {
      ...ref,
      relevanceScore: score,
      stance: link?.stance,
      confidence: link?.confidence,
      support_level: link?.support_level,
      hasLink: !!link,
    };
  });
}

/**
 * Sort references by relevance score (highest first)
 * References with links come first, sorted by relevance
 * References without links come last, sorted by date
 */
export function sortByRelevance(
  enrichedReferences: ReferenceWithRelevance[]
): ReferenceWithRelevance[] {
  return [...enrichedReferences].sort((a, b) => {
    // Linked references come before unlinked
    if (a.hasLink && !b.hasLink) return -1;
    if (!a.hasLink && b.hasLink) return 1;

    // Both linked: sort by relevance score
    if (a.hasLink && b.hasLink) {
      return b.relevanceScore - a.relevanceScore;
    }

    // Both unlinked: sort by created date (newest first)
    const dateA = new Date(a.created_at || 0).getTime();
    const dateB = new Date(b.created_at || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * Filter to show top N most relevant references
 */
export function getTopRelevantReferences(
  enrichedReferences: ReferenceWithRelevance[],
  limit: number = 20
): ReferenceWithRelevance[] {
  const sorted = sortByRelevance(enrichedReferences);
  return sorted.slice(0, limit);
}

/**
 * Check if references need evidence engine run
 * Returns true if many references lack links for this task claim
 */
export function needsEvidenceEngine(
  references: ReferenceWithClaims[],
  taskClaimId: number,
  claimLinks: ReferenceClaimLink[],
  threshold: number = 0.5 // 50% of references should have links
): boolean {
  if (references.length === 0) return false;

  const linkedCount = references.filter((ref) =>
    claimLinks.some(
      (link) =>
        link.task_claim_id === taskClaimId &&
        link.reference_content_id === ref.reference_content_id
    )
  ).length;

  const linkRatio = linkedCount / references.length;
  return linkRatio < threshold;
}
