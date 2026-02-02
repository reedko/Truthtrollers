// src/services/evidenceEngineClient.ts
/**
 * Client for triggering and monitoring evidence engine runs
 */

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

export interface EvidenceEngineRequest {
  taskContentId: number;
  claimIds: number[];
  readableText?: string;
}

export interface AIReference {
  referenceContentId: number;
  url: string;
  title: string;
  stance: string;
  why: string; // rationale
  quote: string;
  claims: number[]; // claim indices
  quality: number; // 0-1.2
  cleanText: string;
  scrapeStatus: "full" | "snippet_only" | "failed";
}

export interface EvidenceEngineResponse {
  aiReferences: AIReference[];
  failedCandidates: any[];
  claimConfidenceMap: Record<number, number>;
}

/**
 * Trigger evidence engine run for specific task claims
 */
export async function runEvidenceEngine(
  request: EvidenceEngineRequest
): Promise<EvidenceEngineResponse> {
  const response = await fetch(`${API_BASE_URL}/api/run-evidence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Evidence engine failed: ${error}`);
  }

  return response.json();
}

/**
 * Fetch existing reference-claim links for a task
 */
export async function fetchReferenceClaimLinks(
  taskContentId: number
): Promise<any[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/reference-claim-links/${taskContentId}`,
    {
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch reference claim links");
  }

  return response.json();
}

/**
 * Fetch reference-claim links for a specific claim only
 * More efficient than fetching all links for a task
 */
export async function fetchLinksForClaim(
  taskContentId: number,
  claimId: number
): Promise<any[]> {
  const allLinks = await fetchReferenceClaimLinks(taskContentId);
  return allLinks.filter((link: any) => link.task_claim_id === claimId);
}

/**
 * Check which claims need evidence engine run
 * Returns claim IDs that have insufficient links
 */
export async function getClaimsNeedingEvidence(
  taskContentId: number,
  claimIds: number[],
  minLinksPerClaim: number = 3
): Promise<number[]> {
  const links = await fetchReferenceClaimLinks(taskContentId);

  const claimLinkCounts = new Map<number, number>();
  claimIds.forEach((id) => claimLinkCounts.set(id, 0));

  links.forEach((link: any) => {
    const count = claimLinkCounts.get(link.task_claim_id);
    if (count !== undefined) {
      claimLinkCounts.set(link.task_claim_id, count + 1);
    }
  });

  return claimIds.filter(
    (id) => (claimLinkCounts.get(id) || 0) < minLinksPerClaim
  );
}

/**
 * Run evidence engine only for claims that need it
 * Returns true if engine was run, false if skipped
 */
export async function runEvidenceEngineIfNeeded(
  taskContentId: number,
  claimIds: number[],
  minLinksPerClaim: number = 3
): Promise<{ didRun: boolean; response?: EvidenceEngineResponse }> {
  const claimsNeedingEvidence = await getClaimsNeedingEvidence(
    taskContentId,
    claimIds,
    minLinksPerClaim
  );

  if (claimsNeedingEvidence.length === 0) {
    return { didRun: false };
  }

  console.log(
    `Running evidence engine for ${claimsNeedingEvidence.length} claims that need more evidence`
  );

  const response = await runEvidenceEngine({
    taskContentId,
    claimIds: claimsNeedingEvidence,
  });

  return { didRun: true, response };
}

/**
 * Optimized: Run evidence engine for a single claim with its text
 * More efficient - passes claim text directly to avoid backend lookups
 */
export async function runEvidenceForSingleClaim(
  taskContentId: number,
  claimId: number,
  claimText: string,
  minLinks: number = 3
): Promise<{ didRun: boolean; response?: EvidenceEngineResponse; existingLinks: any[] }> {
  try {
    // Check existing links for this specific claim
    const existingLinks = await fetchLinksForClaim(taskContentId, claimId);

    console.log(`[Evidence Engine] Claim has ${existingLinks.length} existing links (need ${minLinks})`);

    // Skip if we already have enough links
    if (existingLinks.length >= minLinks) {
      console.log(`[Evidence Engine] Skipping - claim already has sufficient evidence`);
      return { didRun: false, existingLinks };
    }

    console.log(`[Evidence Engine] Running for claim ${claimId}: "${claimText.substring(0, 60)}..."`);

    // Run evidence engine with claim text included
    const response = await runEvidenceEngine({
      taskContentId,
      claimIds: [claimId],
      readableText: claimText, // Pass claim text directly
    });

    console.log(`[Evidence Engine] Complete - found ${response?.aiReferences.length || 0} new references`);

    // Fetch updated links
    const updatedLinks = await fetchLinksForClaim(taskContentId, claimId);

    return { didRun: true, response, existingLinks: updatedLinks };
  } catch (error) {
    console.error("[Evidence Engine] Error:", error);
    throw error;
  }
}
