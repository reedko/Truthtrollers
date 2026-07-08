/**
 * phase1ClaimReconciler.js
 *
 * Audit-only, article-LOCAL stance reconciliation for Phase 1 visible claims.
 *
 * Runs AFTER Phase 1 atomic extraction and BEFORE Phase 2 organization /
 * Phase 3 readiness packaging. Its job is narrow: when the same or a
 * near-identical visible claim is extracted more than once in a single article
 * with divergent stance (articleUse / likelyScoreTransform), detect it and
 * either reconcile it to a consistent stance or flag the group for review.
 *
 * This is NOT global claim deduplication and it does NOT delete occurrences.
 * Every input occurrence is preserved as its own output record. Original
 * records are never mutated in place — reconciled copies are returned and each
 * carries a `reconciliation` block with before/after snapshots.
 *
 * No evidence. No persistence. No reducer. No LLM.
 */

const MESSAGING_SPEAKER_RE =
  /public health|public-health|messaging|\bad\b|advertisement|cdc|health department|official|authorities|slogan|campaign|jcph/i;

// Well-known public-health reassurance slogans in this problem domain. Used as
// a supporting signal that a duplicate group is opponent/slogan material.
const SLOGAN_TEXT_RE =
  /more aluminum by eating a tomato|ethylmercury[^.!?]*not harmful|no credible studies[^.!?]*(link|chronic)|tested more than any other medicine|safe and effective|vaccines are safe/i;

/**
 * Normalize claim text for duplicate detection:
 * lowercase, strip curly quotes, remove leading heading/bullet/number
 * artifacts, strip punctuation, collapse whitespace.
 */
export function normalizeClaimText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .toLowerCase()
    // curly quotes / dashes → ascii
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—‒]/g, "-")
    // leading heading/bullet/number artifacts: "•", "- ", "1.", "1)", "a."
    .replace(/^\s*(?:[-*•·▪]+|\d+[.)]|[a-z][.)])\s+/i, "")
    // drop all punctuation (keep alphanumerics and spaces)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/** Sørensen–Dice coefficient over character bigrams (conservative fuzzy match). */
export function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = s => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };

  const aB = bigrams(a);
  const bB = bigrams(b);
  let overlap = 0;
  let aTotal = 0;
  for (const c of aB.values()) aTotal += c;
  let bTotal = 0;
  for (const c of bB.values()) bTotal += c;
  for (const [g, ca] of aB.entries()) {
    const cb = bB.get(g) || 0;
    overlap += Math.min(ca, cb);
  }
  return (2 * overlap) / (aTotal + bTotal);
}

function getTransform(claim) {
  return claim?.targetHints?.likelyScoreTransform || "";
}

function looksLikeSloganOrMessaging(group) {
  return group.some(
    c =>
      c.articleUse === "used_as_opponent_claim" ||
      c.claimForm === "quoted_claim" ||
      c.claimForm === "attributed_assertion" ||
      MESSAGING_SPEAKER_RE.test(c.speakerOrSource || "") ||
      SLOGAN_TEXT_RE.test(c.visibleClaimText || "") ||
      SLOGAN_TEXT_RE.test(c.embeddedSubstantiveClaim || "")
  );
}

/** Union-Find helpers. */
function makeDSU(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = x => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  return { find, union };
}

/**
 * Reconcile Phase 1 visible-claim occurrences for article-local stance
 * consistency.
 *
 * @param {Array<object>} claims  Phase 1 visible claim records.
 * @param {object} options
 *   - similarityThreshold: Dice threshold for near-duplicate (default 0.9)
 *   - idField: claim id field name (default "claimId")
 * @returns {{claims: Array<object>, diagnostics: object}}
 */
export function reconcilePhase1ClaimOccurrences(claims, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.9;
  const idField = options.idField || "claimId";

  const input = Array.isArray(claims) ? claims : [];
  const n = input.length;

  // Deep copy so originals are never mutated in place.
  const out = input.map(c => JSON.parse(JSON.stringify(c)));

  // Precompute normalized text.
  const normVisible = input.map(c => normalizeClaimText(c.visibleClaimText || ""));
  const normEmbedded = input.map(c => normalizeClaimText(c.embeddedSubstantiveClaim || ""));

  // Build duplicate groups via union-find.
  const { find, union } = makeDSU(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let linked = false;
      // exact normalized visible match
      if (normVisible[i] && normVisible[i] === normVisible[j]) linked = true;
      // exact normalized embedded match (both present)
      else if (normEmbedded[i] && normEmbedded[i] === normEmbedded[j]) linked = true;
      // cross exact match: one's visible equals the other's embedded proposition
      else if (
        (normVisible[i] && normVisible[i] === normEmbedded[j]) ||
        (normEmbedded[i] && normEmbedded[i] === normVisible[j])
      )
        linked = true;
      // conservative fuzzy match on visible text
      else if (
        normVisible[i] &&
        normVisible[j] &&
        diceCoefficient(normVisible[i], normVisible[j]) >= similarityThreshold
      )
        linked = true;

      if (linked) union(i, j);
    }
  }

  // Collect groups (root -> member indexes).
  const rootToMembers = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!rootToMembers.has(r)) rootToMembers.set(r, []);
    rootToMembers.get(r).push(i);
  }

  const duplicateGroups = [];
  const stanceConflicts = [];
  let reconciledCount = 0;
  let flaggedForReviewCount = 0;
  let groupSeq = 0;

  for (const members of rootToMembers.values()) {
    if (members.length < 2) {
      // Singleton — no reconciliation.
      const idx = members[0];
      out[idx].reconciliation = {
        groupId: null,
        status: "none",
        reason: "unique claim (no duplicate/near-duplicate occurrence)",
        canonicalOccurrenceId: null,
        changed: false,
        before: snapshotStance(input[idx]),
        after: snapshotStance(input[idx]),
      };
      continue;
    }

    const groupId = `RG${String(++groupSeq).padStart(2, "0")}`;
    const groupClaims = members.map(i => input[i]);

    // Conflict detection.
    const articleUses = new Set(groupClaims.map(c => c.articleUse || ""));
    const transforms = new Set(groupClaims.map(c => getTransform(c)));
    const embeddedPresence = new Set(
      groupClaims.map(c => Boolean(c.embeddedSubstantiveClaim && c.embeddedSubstantiveClaim.length))
    );
    const hasQuotedOpponent = groupClaims.some(
      c =>
        c.articleUse === "used_as_opponent_claim" ||
        c.claimForm === "quoted_claim" ||
        c.claimForm === "attributed_assertion"
    );
    const hasDirectEndorsed = groupClaims.some(
      c =>
        c.articleUse === "endorsed_by_article" &&
        (c.claimForm === "direct_assertion" ||
          c.claimForm === "causal_claim" ||
          c.claimForm === "comparison_claim" ||
          c.claimForm === "statistical_claim")
    );

    const conflictReasons = [];
    if (articleUses.size > 1) conflictReasons.push("articleUse_divergent");
    if (transforms.size > 1) conflictReasons.push("scoreTransform_divergent");
    if (embeddedPresence.size > 1) conflictReasons.push("embedded_presence_mismatch");
    if (hasQuotedOpponent && hasDirectEndorsed) conflictReasons.push("quoted_opponent_vs_direct_endorsed");

    const hasConflict = conflictReasons.length > 0;

    const groupRecord = {
      groupId,
      occurrenceIds: members.map(i => input[i][idField] ?? null),
      sectionIds: members.map(i => input[i].sectionId ?? input[i].sectionIndex ?? null),
      normalizedKey: normVisible[members[0]] || normEmbedded[members[0]] || "",
      distinctArticleUse: Array.from(articleUses),
      distinctScoreTransform: Array.from(transforms),
      conflictReasons,
    };
    duplicateGroups.push(groupRecord);

    // Reconciliation decision.
    const opponentInvert = groupClaims.filter(
      c => c.articleUse === "used_as_opponent_claim" && getTransform(c) === "invert"
    );
    const slogan = looksLikeSloganOrMessaging(groupClaims);

    let status = "none";
    let reason = "duplicate group with consistent stance; no reconciliation needed";
    let canonicalIdx = members[0];

    if (hasConflict) {
      if (opponentInvert.length > 0 && slogan) {
        // Reconcile toward opponent/invert.
        status = "reconciled";
        // Canonical = most complete opponent/invert occurrence.
        canonicalIdx = pickCanonical(
          members.filter(
            i =>
              input[i].articleUse === "used_as_opponent_claim" &&
              getTransform(input[i]) === "invert"
          ),
          input
        );
        const canonical = input[canonicalIdx];
        const reconciledForm =
          canonical.claimForm === "attributed_assertion" ? "attributed_assertion" : "quoted_claim";
        reason =
          `reconciled to used_as_opponent_claim/invert (slogan/official-messaging duplicate); ` +
          `canonical occurrence ${canonical[idField]} [${conflictReasons.join(", ")}]`;

        for (const i of members) {
          const before = snapshotStance(input[i]);
          const rec = out[i];
          const isCanonical = i === canonicalIdx;

          if (!isCanonical) {
            // Apply canonical opponent stance to divergent occurrences.
            rec.articleUse = "used_as_opponent_claim";
            rec.targetHints = { ...(rec.targetHints || {}), likelyScoreTransform: "invert" };
            // Only upgrade claimForm if it is currently a direct/endorsed form.
            if (
              ["direct_assertion", "causal_claim", "comparison_claim", "statistical_claim", "background_claim"].includes(
                rec.claimForm
              )
            ) {
              rec.claimForm = reconciledForm;
            }
            // Fill embedded/speaker from canonical if missing.
            if (
              (!rec.embeddedSubstantiveClaim || !rec.embeddedSubstantiveClaim.length) &&
              canonical.embeddedSubstantiveClaim
            ) {
              rec.embeddedSubstantiveClaim = canonical.embeddedSubstantiveClaim;
            }
            if (
              (!rec.speakerOrSource || !rec.speakerOrSource.length) &&
              canonical.speakerOrSource
            ) {
              rec.speakerOrSource = canonical.speakerOrSource;
            }
          }

          rec.reconciliation = {
            groupId,
            status: "reconciled",
            reason: isCanonical
              ? `canonical occurrence for group ${groupId}`
              : `stance aligned to canonical ${canonical[idField]} (used_as_opponent_claim/invert)`,
            canonicalOccurrenceId: canonical[idField] ?? null,
            changed: !isCanonical && stanceChanged(before, snapshotStance(rec)),
            before,
            after: snapshotStance(rec),
          };
        }
        reconciledCount++;
      } else {
        // Conflict but no clear winner → flag for review, change nothing.
        status = "review";
        reason =
          `stance conflict without a clear opponent/invert slogan winner ` +
          `[${conflictReasons.join(", ")}]; flagged for manual review`;
        for (const i of members) {
          out[i].reconciliation = {
            groupId,
            status: "review",
            reason,
            canonicalOccurrenceId: null,
            changed: false,
            before: snapshotStance(input[i]),
            after: snapshotStance(input[i]),
          };
        }
        flaggedForReviewCount++;
      }
      stanceConflicts.push({ ...groupRecord, resolution: status, reason });
    } else {
      // Duplicate but consistent — record group, no changes.
      for (const i of members) {
        out[i].reconciliation = {
          groupId,
          status: "none",
          reason,
          canonicalOccurrenceId: input[canonicalIdx][idField] ?? null,
          changed: false,
          before: snapshotStance(input[i]),
          after: snapshotStance(input[i]),
        };
      }
    }
  }

  return {
    claims: out,
    diagnostics: {
      duplicateGroups,
      stanceConflicts,
      reconciledCount,
      flaggedForReviewCount,
      totalGroups: duplicateGroups.length,
      totalClaimsIn: n,
      totalClaimsOut: out.length,
    },
  };
}

function snapshotStance(claim) {
  return {
    articleUse: claim.articleUse || "",
    likelyScoreTransform: getTransform(claim),
    claimForm: claim.claimForm || "",
    hasEmbedded: Boolean(claim.embeddedSubstantiveClaim && claim.embeddedSubstantiveClaim.length),
    hasSpeaker: Boolean(claim.speakerOrSource && claim.speakerOrSource.length),
  };
}

function stanceChanged(before, after) {
  return (
    before.articleUse !== after.articleUse ||
    before.likelyScoreTransform !== after.likelyScoreTransform ||
    before.claimForm !== after.claimForm ||
    before.hasEmbedded !== after.hasEmbedded ||
    before.hasSpeaker !== after.hasSpeaker
  );
}

/** Pick the most metadata-complete occurrence as canonical. */
function pickCanonical(candidateIndexes, input) {
  let best = candidateIndexes[0];
  let bestScore = -1;
  for (const i of candidateIndexes) {
    const c = input[i];
    let s = 0;
    if (c.embeddedSubstantiveClaim && c.embeddedSubstantiveClaim.length) s += 2;
    if (c.speakerOrSource && c.speakerOrSource.length) s += 2;
    if (c.warrantHint && c.warrantHint.length) s += 1;
    if (c.claimForm === "quoted_claim" || c.claimForm === "attributed_assertion") s += 1;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

export default reconcilePhase1ClaimOccurrences;
