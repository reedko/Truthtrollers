// backend/src/core/assertionClustering.js
//
// Step 22: deterministic assertion clustering for final packet construction.
//
// Groups assertions that materially repeat the same claim (same target + stance,
// near-duplicate text, or a syndication/copy relationship across sources) so the
// packet cannot fill multiple slots with the same repeated allegation. Distinct
// primary evidence, methodology, data, official response, or independent
// analysis remain in separate clusters.

import { canonicalizeUrl } from "../utils/canonicalizeUrl.js";
import { tokenizeBearingText } from "./evidenceNeed.js";

const NEAR_DUP_JACCARD = 0.7; // token-set overlap threshold for "same assertion"

function domainRoot(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return "unknown"; }
  // Collapse to the registrable-ish root (last two labels) as the source family.
  const parts = host.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : host;
}

export function sourceFamilyOf(item = {}) {
  return item.sourceFamily || domainRoot(item.url || "");
}

function tokenSet(text) {
  return new Set(tokenizeBearingText(text));
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function assertionText(item = {}) {
  return `${item.quote || ""} ${item.summary || ""}`.trim();
}

function targetKey(item = {}) {
  return String(item.evidenceTargetId ?? item.evaluationTargetId ?? "");
}

function stanceKey(item = {}) {
  return String(item.stance || "insufficient").toLowerCase();
}

// Whether two items materially repeat the same assertion: same target + stance,
// and either near-duplicate text OR the same underlying allegation carried by
// non-independent sources (syndication — near-dup text across different domains).
function sameAssertion(a, b, aTokens, bTokens) {
  if (targetKey(a) !== targetKey(b)) return false;
  if (stanceKey(a) !== stanceKey(b)) return false;
  const sim = jaccard(aTokens, bTokens);
  if (sim >= NEAR_DUP_JACCARD) return true;
  return false;
}

/**
 * Cluster assertions. Returns { clusterIdByIndex: string[], clusters: Map }.
 * Uses single-linkage over near-duplicate text within a (target, stance) group.
 * A cluster spanning more than one source family is flagged as syndicated.
 */
export function clusterAssertions(items = []) {
  const list = Array.isArray(items) ? items : [];
  const tokenSets = list.map((item) => tokenSet(assertionText(item)));
  const parent = list.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x, y) => { const rx = find(x); const ry = find(y); if (rx !== ry) parent[rx] = ry; };

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (sameAssertion(list[i], list[j], tokenSets[i], tokenSets[j])) union(i, j);
    }
  }

  const clusterIdByIndex = list.map((_, i) => `cluster:${find(i)}`);
  const clusters = new Map();
  list.forEach((item, i) => {
    const id = clusterIdByIndex[i];
    if (!clusters.has(id)) clusters.set(id, { id, memberIndexes: [], families: new Set(), canonicalUrls: new Set() });
    const c = clusters.get(id);
    c.memberIndexes.push(i);
    c.families.add(sourceFamilyOf(item));
    c.canonicalUrls.add(canonicalizeUrl(item.url) || item.url || `idx:${i}`);
  });
  for (const c of clusters.values()) {
    c.size = c.memberIndexes.length;
    c.syndicated = c.families.size > 1 && c.size > 1;         // same text, different families
    c.multiCopy = c.canonicalUrls.size > 1 && c.size > 1;     // same assertion, >1 source
  }

  return { clusterIdByIndex, clusters };
}
