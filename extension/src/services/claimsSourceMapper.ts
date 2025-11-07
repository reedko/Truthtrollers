// extension/src/services/claimsSourceMapper.ts
// ESM/TS
import type { Lit_references } from "../entities/Task"; // <-- your shared type

export interface ClaimSourcePick {
  claim: string;
  sources: { url: string; title?: string; stance?: string; why?: string }[];
}

const BASE_URL = process.env.REACT_APP_BASE_URL || "http://localhost:5001";

/**
 * Ask backend to:
 *  1) propose search queries per claim
 *  2) search+rank web results
 *  3) LLM-pick 1–3 sources per claim
 *
 * Returns Lit_references[] with origin="claim" and claims=[...]
 */
export async function mapClaimsToSources(
  text: string,
  claims: string[]
): Promise<Lit_references[]> {
  if (!Array.isArray(claims) || claims.length === 0) return [];

  // 1) get suggested queries per claim
  const qRes = await fetch(`${BASE_URL}/api/claims/suggest-queries`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, claims }),
  });
  const qJson = await qRes.json();

  // items: [{ claim, queries, prefer_domains, avoid_domains }]
  const items = Array.isArray(qJson?.items) ? qJson.items : [];
  if (!items.length) return [];

  // 2) have backend search+map sources per claim
  const mRes = await fetch(`${BASE_URL}/api/claims/search-map`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const mJson = await mRes.json();

  const picks: ClaimSourcePick[] = Array.isArray(mJson?.results)
    ? mJson.results
    : [];

  // Build Lit_references[], merging duplicates by URL and accumulating claim texts
  const byUrl = new Map<string, Lit_references>();

  for (const pick of picks) {
    const cText = pick?.claim?.trim();
    if (!cText) continue;

    const srcs = Array.isArray(pick.sources) ? pick.sources : [];
    for (const s of srcs) {
      if (!s?.url || !s.url.startsWith("http")) continue;

      const existing = byUrl.get(s.url);
      if (existing) {
        // merge claim text
        const claimsSet = new Set([...(existing.claims || []), cText]);
        existing.claims = [...claimsSet];
      } else {
        byUrl.set(s.url, {
          url: s.url,
          content_name: s.title || s.url,
          origin: "claim",
          claims: [cText],
        });
      }
    }
  }

  return [...byUrl.values()];
}

/**
 * Utility to merge DOM refs and claim-picked refs into one unique list.
 * - De-dupes by URL
 * - Keeps earliest content_name, merges origin/claims as needed
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
        // prefer existing content_name, but keep if missing
        if (!ex.content_name && r.content_name)
          ex.content_name = r.content_name;

        // origin: if either says "claim", mark claim
        if (r.origin === "claim") ex.origin = "claim";

        // merge claims arrays
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
