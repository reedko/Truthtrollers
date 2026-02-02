// src/services/referenceClaimRelevance.ts
/**
 * Reference claim → Task claim relevance assessment
 * Manages claim-level (not document-level) relevance scoring
 */

import { Claim } from "../../../shared/entities/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export interface ReferenceClaimTaskLink {
  reference_claim_task_links_id: number;
  reference_claim_id: number;
  task_claim_id: number;
  stance: "support" | "refute" | "nuance" | "insufficient";
  score: number; // 0-120
  confidence: number; // 0-1
  support_level: number;
  rationale?: string;
  quote?: string;
  created_by_ai: boolean;
  verified_by_user_id?: number;
  created_at: string;
}

export interface ClaimWithRelevance extends Claim {
  relevanceScore: number;
  stance?: "support" | "refute" | "nuance" | "insufficient";
  confidence?: number;
  support_level?: number;
  rationale?: string;
  hasLink: boolean;
}

/**
 * Fetch reference claim → task claim links for a specific task claim
 */
export async function fetchReferenceClaimTaskLinks(
  taskClaimId: number
): Promise<ReferenceClaimTaskLink[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/reference-claim-task-links/${taskClaimId}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch reference claim task links");
  }

  return response.json();
}

/**
 * Assess a single reference claim against a task claim
 * Uses AI to determine relevance if not already assessed
 */
export async function assessReferenceClaimRelevance(
  referenceClaimId: number,
  taskClaimId: number,
  referenceClaimText: string,
  taskClaimText: string
): Promise<{ didAssess: boolean; link?: ReferenceClaimTaskLink }> {
  try {
    // Check if assessment already exists
    const existingLinks = await fetchReferenceClaimTaskLinks(taskClaimId);
    const existingLink = existingLinks.find(
      (link) => link.reference_claim_id === referenceClaimId
    );

    if (existingLink) {
      console.log(
        `[Claim Assessment] Using existing link for ref claim ${referenceClaimId}`
      );
      return { didAssess: false, link: existingLink };
    }

    console.log(
      `[Claim Assessment] Assessing ref claim ${referenceClaimId} → task claim ${taskClaimId}`
    );

    // Call backend to assess
    const response = await fetch(`${API_BASE_URL}/api/assess-claim-relevance`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        referenceClaimId,
        taskClaimId,
        referenceClaimText,
        taskClaimText,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claim assessment failed: ${error}`);
    }

    const result = await response.json();
    console.log(`[Claim Assessment] Complete - stance: ${result.link.stance}`);

    return { didAssess: true, link: result.link };
  } catch (error) {
    console.error("[Claim Assessment] Error:", error);
    throw error;
  }
}

/**
 * Calculate relevance score for a reference claim
 */
export function calculateClaimRelevanceScore(
  link: ReferenceClaimTaskLink | null
): number {
  if (!link) return 0;

  const stanceWeight = {
    support: 1.0,
    refute: 1.0,
    nuance: 0.7,
    insufficient: 0.3,
  };

  const stanceBonus = stanceWeight[link.stance] || 0.5;
  const score =
    Math.abs(link.support_level) * link.confidence * stanceBonus * 100;

  return score;
}

/**
 * Enrich reference claims with relevance scores
 */
export function enrichClaimsWithRelevance(
  referenceClaims: Claim[],
  taskClaimId: number,
  claimLinks: ReferenceClaimTaskLink[]
): ClaimWithRelevance[] {
  return referenceClaims.map((claim) => {
    const link = claimLinks.find(
      (l) =>
        l.task_claim_id === taskClaimId &&
        l.reference_claim_id === claim.claim_id
    );

    const relevanceScore = calculateClaimRelevanceScore(link);

    return {
      ...claim,
      relevanceScore,
      stance: link?.stance,
      confidence: link?.confidence,
      support_level: link?.support_level,
      rationale: link?.rationale,
      hasLink: !!link,
    };
  });
}

/**
 * Sort claims by relevance (linked first, then by score)
 */
export function sortClaimsByRelevance(
  enrichedClaims: ClaimWithRelevance[]
): ClaimWithRelevance[] {
  return [...enrichedClaims].sort((a, b) => {
    // Linked claims come first
    if (a.hasLink && !b.hasLink) return -1;
    if (!a.hasLink && b.hasLink) return 1;

    // Both linked: sort by relevance score
    if (a.hasLink && b.hasLink) {
      return b.relevanceScore - a.relevanceScore;
    }

    // Both unlinked: maintain original order
    return 0;
  });
}

/**
 * Batch assess multiple reference claims against a task claim
 * Only assesses claims that don't have existing links
 */
export async function batchAssessReferenceClaims(
  referenceClaims: Claim[],
  taskClaimId: number,
  taskClaimText: string
): Promise<{
  assessedCount: number;
  links: ReferenceClaimTaskLink[];
}> {
  try {
    // Get existing links
    const existingLinks = await fetchReferenceClaimTaskLinks(taskClaimId);

    // Find claims that need assessment
    const claimsNeedingAssessment = referenceClaims.filter(
      (claim) =>
        !existingLinks.some(
          (link) => link.reference_claim_id === claim.claim_id
        )
    );

    if (claimsNeedingAssessment.length === 0) {
      console.log(
        `[Batch Assessment] All ${referenceClaims.length} claims already assessed`
      );
      return { assessedCount: 0, links: existingLinks };
    }

    console.log(
      `[Batch Assessment] Assessing ${claimsNeedingAssessment.length} claims`
    );

    // Assess each claim (could be parallelized, but being conservative for API usage)
    const newLinks: ReferenceClaimTaskLink[] = [];
    for (const claim of claimsNeedingAssessment) {
      const { link } = await assessReferenceClaimRelevance(
        claim.claim_id,
        taskClaimId,
        claim.claim_text,
        taskClaimText
      );
      if (link) {
        newLinks.push(link);
      }
    }

    const allLinks = [...existingLinks, ...newLinks];

    console.log(
      `[Batch Assessment] Complete - ${newLinks.length} new assessments`
    );

    return { assessedCount: newLinks.length, links: allLinks };
  } catch (error) {
    console.error("[Batch Assessment] Error:", error);
    throw error;
  }
}
