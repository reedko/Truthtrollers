// extension/src/services/claimsSourceMapper.ts
// ESM/TS
import browser from "webextension-polyfill";
import type { Lit_references } from "../entities/Task";

export interface ClaimSourcePick {
  claim: string;
  sources: { url: string; title?: string; stance?: string; why?: string }[];
}

/**
 * Ask BACKGROUND to:
 *  1) propose search queries per claim
 *  2) search+rank web results
 *  3) LLM-pick 1–3 sources per claim
 *
 * Returns Lit_references[] with origin="claim" and claims=[...]
 */
export async function mapClaimsToSources(
  claims: string[]
): Promise<Lit_references[]> {
  if (!Array.isArray(claims) || claims.length === 0) return [];

  try {
    // Keep our project-wide pattern: explicit cast of the response
    const response = (await browser.runtime.sendMessage({
      action: "claimsSourceMapper/map",
      payload: { claims },
    })) as { success: boolean; refs?: Lit_references[]; error?: string };

    if (response.success && Array.isArray(response.refs)) {
      return response.refs;
    }

    console.warn(
      "claimsSourceMapper response not ok:",
      response.error || response
    );
    return [];
  } catch (err) {
    console.error("claimsSourceMapper sendMessage failed:", err);
    return [];
  }
}

/**
 * Merge DOM refs and claim-picked refs:
 * - De-dupe by URL
 * - Preserve earliest content_name
 * - origin='claim' if any side flagged it
 * - Merge claims arrays
 */
export function mergeUniqueReferences(
  domRefs: Lit_references[],
  claimRefs: Lit_references[]
): Lit_references[] {
  const byUrl = new Map<string, Lit_references>();

  const mergeIn = (list: Lit_references[]) => {
    for (const r of list || []) {
      if (!r?.url) continue;
      const ex = byUrl.get(r.url);
      if (!ex) {
        byUrl.set(r.url, { ...r });
      } else {
        if (!ex.content_name && r.content_name)
          ex.content_name = r.content_name;
        if (r.origin === "claim") ex.origin = "claim";
        if (r.claims?.length) {
          const s = new Set([...(ex.claims || []), ...r.claims]);
          ex.claims = [...s];
        }
      }
    }
  };

  mergeIn(domRefs);
  mergeIn(claimRefs);
  return [...byUrl.values()];
}
