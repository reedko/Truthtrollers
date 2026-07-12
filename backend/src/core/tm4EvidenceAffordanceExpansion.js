// backend/src/core/tm4EvidenceAffordanceExpansion.js
//
// TM4 — generic sidecar evidence-affordance / query-expansion.
//
// A selected claim is often the best DISPLAY claim (article-representative) but
// an UNSELECTED sibling raw claim may have stronger evidence-DOCUMENT affordance
// (it points at a released/reworked report, a reanalysis, a dataset, a legal
// filing, a package insert…). This module lets a selected claim INHERIT the
// evidence-search hints of such siblings — enriching Phase 3 query hints and
// bearing criteria — WITHOUT promoting the sibling to a Workspace claim.
//
// Fully generic: relatedness and affordance are computed from structural
// signals (Phase 2 cluster, reconciliation group, section neighborhood,
// predicate family, shared named entities) and the domain-agnostic
// evidenceAffordance feature. NO article-specific rules, names, or entities.
//
// Generic examples (comments only — never in production prompts):
//   Selected:  "A whistleblower said the agency altered safety data."
//   Sibling:   "The agency later released a revised report claiming no signal."
//     → the selected claim stays visible; Phase 3 query hints gain terms for the
//       revised report / original report / reanalysis / correction-retraction.
//
//   Selected:  "The company misrepresented emissions test results."
//   Sibling:   "The company submitted a revised emissions report to regulators."
//     → evidence search also receives report / regulatory-filing query hints.
//
//   Selected:  "The city claimed the water was safe." (opponent / invert)
//   Sibling:   "Internal water-quality reports showed elevated lead levels."
//     → opponent substantive-invert posture is untouched; evidence search can
//       also discover the water-quality reports.

import { computeClaimFeatures } from "./tm4SelectorFeatures.js";

const STOP = new Set(("the a an of to in on for and or but with that this those these is are was were be been being it its as by from at not no about into their they we you our have has had do does did will would can could should than then so such which who what when where why how there here also more most other some any all each over under between after before during against said says stated claim claims").split(" "));

const norm = (t) => String(t || "").toLowerCase().replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
const section = (claimId) => {
  const m = String(claimId || "").match(/^S(\d+)/);
  return m ? Number(m[1]) : null;
};

/** Lowercased set of a claim's named entities (Phase-1 arrays + text-derived). */
function entitySet(claim, features) {
  const arrs = [
    ...(claim.namedActors || []),
    ...(claim.namedOrganizations || []),
    ...(claim.namedLawsOrPolicies || []),
    ...(claim.namedSubstancesOrProducts || []),
    ...(claim.namedStudiesOrDocuments || []),
    ...(features?.derivedEntities || []),
  ];
  return new Set(arrs.map((e) => norm(e)).filter((e) => e && e.length > 2));
}

/** Generic document-class words a claim's text uses (for query/bearing hints). */
const DOC_CLASS_TERMS = [
  "report", "study", "studies", "reanalysis", "re-analysis", "reworked", "revised",
  "retraction", "correction", "erratum", "dataset", "database", "registry",
  "filing", "petition", "lawsuit", "docket", "deposition", "settlement", "ruling",
  "statute", "regulation", "amendment", "act", "law", "memo", "audit", "insert",
  "label", "monograph", "email", "e-mail", "foia", "contract", "procurement",
  "filing", "disclosure", "transcript", "minutes", "record", "records", "document",
];
function docClassTerms(text) {
  const t = norm(text);
  return DOC_CLASS_TERMS.filter((w) => new RegExp(`\\b${w.replace(/[-]/g, "[- ]?")}\\b`).test(t));
}

/**
 * Map a sibling's affordance signals to a generic document-identity class the
 * targetizer can attach as target metadata. No domain vocabulary.
 */
function documentAffordanceClass(signals = []) {
  const has = (s) => signals.includes(s);
  if (has("released_or_reworked_study")) return "reanalysis_or_methodology_dispute";
  if (has("court_or_legal_filing") || has("law_or_regulation")) return "legal_record_identity";
  if (has("dataset_or_database")) return "dataset_identity";
  if (has("government_report") || has("package_insert_or_label")) return "document_identity_needs_disambiguation";
  if (has("named_or_dated_study") || has("generic_study_reference")) return "study_identity_needs_disambiguation";
  return "evidence_landscape";
}

/**
 * Relatedness signals between a selected claim and a candidate sibling. Generic,
 * structural — never topical string matching against a fixture.
 */
function relatednessSignals(sel, sib) {
  const sig = [];
  if (sel.claim.phase2ClusterId && sel.claim.phase2ClusterId === sib.claim.phase2ClusterId) sig.push("same_phase2_cluster");
  const selGroup = sel.claim.reconciliation?.groupId, sibGroup = sib.claim.reconciliation?.groupId;
  if (selGroup && selGroup === sibGroup) sig.push("same_reconciliation_group");
  const selSec = section(sel.claim.claimId), sibSec = section(sib.claim.claimId);
  if (selSec != null && sibSec != null && Math.abs(selSec - sibSec) <= 1) sig.push("adjacent_section_neighborhood");
  if (sel.features.predicateFamily && sel.features.predicateFamily === sib.features.predicateFamily) sig.push("same_predicate_family");
  if (sel.features.broadLane && sel.features.broadLane === sib.features.broadLane) sig.push("same_broad_lane");
  const shared = [...sel.entities].filter((e) => sib.entities.has(e));
  if (shared.length) sig.push(`shared_entity:${shared.slice(0, 3).join(",")}`);
  return { signals: sig, sharedEntities: shared };
}

// A relation is "strong enough" to justify inheriting evidence hints when the
// claims share a cluster, a reconciliation group, a shared entity, or the same
// predicate family — or, more weakly, sit in the same broad lane AND section.
function isRelated(signals) {
  const strong = ["same_phase2_cluster", "same_reconciliation_group", "same_predicate_family"];
  if (signals.some((s) => strong.includes(s) || s.startsWith("shared_entity:"))) return true;
  return signals.includes("same_broad_lane") && signals.includes("adjacent_section_neighborhood");
}

/**
 * computeEvidenceAffordanceExpansion(selectedClaims, rawClaims, phase2Context, options)
 *
 * @param selectedClaims  the Phase 2b selectedEvaluationClaims
 * @param rawClaims       the full raw/reconciled occurrence pool (siblings live here)
 * @param phase2Context   { thesis, pillars, clusters, rebuttalFrame? }
 * @param options.nonSelectedReasons  Map/obj claimId → suppressionReason (for diagnostics)
 * @param options.minAffordanceGain   how much MORE affordance a sibling needs (default 0.08)
 * @param options.maxSiblingsPerClaim default 3
 * @returns { expansionByClaimId, diagnostics }
 *   expansionByClaimId[claimId] = {
 *     queryExpansionSourceClaimIds, additionalQueryTerms, siblingEvidenceHints,
 *     documentAffordanceHints, shouldMatchTerms, rejectIfOnlyTerms,
 *     documentAffordanceClass, selectedAffordance, siblingClaimsConsidered,
 *     siblingClaimsUsed
 *   }
 */
export function computeEvidenceAffordanceExpansion(selectedClaims = [], rawClaims = [], phase2Context = {}, options = {}) {
  const minGain = options.minAffordanceGain ?? 0.08;
  const maxSiblings = options.maxSiblingsPerClaim ?? 3;
  const reasons = options.nonSelectedReasons instanceof Map
    ? options.nonSelectedReasons
    : new Map(Object.entries(options.nonSelectedReasons || {}));

  const selectedIds = new Set(selectedClaims.map((c) => c.claimId));

  // Feature-annotate every claim once (order-independent, deterministic).
  const annotate = (claim) => {
    const features = computeClaimFeatures(claim, phase2Context);
    return { claim, features, entities: entitySet(claim, features) };
  };
  const selAnn = selectedClaims.map(annotate);
  const siblingPool = rawClaims.filter((c) => !selectedIds.has(c.claimId)).map(annotate);

  const expansionByClaimId = {};
  const diagnostics = [];

  for (const sel of selAnn) {
    const selAff = sel.features.evidenceAffordance ?? 0;
    const considered = [];
    const used = [];

    for (const sib of siblingPool) {
      if (sib.claim.claimId === sel.claim.claimId) continue;
      const { signals } = relatednessSignals(sel, sib);
      if (!isRelated(signals)) continue;
      const sibAff = sib.features.evidenceAffordance ?? 0;
      const relatedRecord = {
        claimId: sib.claim.claimId,
        evidenceAffordance: Number(sibAff.toFixed(3)),
        primaryDocumentAffordance: !!sib.features.primaryDocumentAffordance,
        relatedness: signals,
        text: (sib.claim.visibleClaimText || "").slice(0, 120),
      };
      considered.push(relatedRecord);
      // Only siblings that are BOTH more document-affording and point at a
      // concrete document contribute.
      if (sib.features.primaryDocumentAffordance && sibAff >= selAff + minGain) {
        used.push({ ...relatedRecord, sib });
      }
    }

    if (!used.length) {
      if (considered.length) {
        diagnostics.push({
          selectedClaimId: sel.claim.claimId,
          selectedVisibleClaimText: sel.claim.visibleClaimText || "",
          selectedAffordance: Number(selAff.toFixed(3)),
          siblingClaimsConsidered: considered.map((s) => s.claimId),
          siblingClaimsUsed: [],
          note: "no related sibling had materially stronger document affordance",
        });
      }
      continue;
    }

    used.sort((a, b) => b.evidenceAffordance - a.evidenceAffordance);
    const top = used.slice(0, maxSiblings);

    const queryExpansionSourceClaimIds = top.map((s) => s.claimId);
    const additionalQueryTerms = new Set();
    const siblingEvidenceHints = [];
    const documentAffordanceHints = new Set();
    const shouldMatchTerms = new Set();
    let strongestSignals = [];
    let strongest = -1;

    for (const s of top) {
      const sib = s.sib;
      // Salient named entities from the sibling.
      for (const e of [
        ...(sib.claim.namedStudiesOrDocuments || []),
        ...(sib.claim.namedLawsOrPolicies || []),
        ...(sib.claim.namedOrganizations || []),
        ...(sib.claim.namedActors || []),
        ...(sib.claim.namedSubstancesOrProducts || []),
      ]) {
        if (e && String(e).trim()) additionalQueryTerms.add(String(e).trim());
      }
      // Document-class words the sibling text uses.
      const dct = docClassTerms(`${sib.claim.visibleClaimText || ""} ${sib.claim.embeddedSubstantiveClaim || ""}`);
      for (const w of dct) { additionalQueryTerms.add(w); shouldMatchTerms.add(w); }
      // A couple of content keywords from the sibling searchText.
      for (const w of norm(sib.claim.searchText || sib.claim.visibleClaimText || "").split(" ")) {
        if (w.length > 3 && !STOP.has(w) && !/^\d+$/.test(w)) additionalQueryTerms.add(w);
        if (additionalQueryTerms.size >= 14) break;
      }
      if (sib.features.studyOrDocumentHint) documentAffordanceHints.add(sib.features.studyOrDocumentHint);
      const cls = documentAffordanceClass(sib.features.evidenceAffordanceSignals);
      documentAffordanceHints.add(cls);
      siblingEvidenceHints.push(
        `${sib.claim.claimId} (affordance ${s.evidenceAffordance}, ${cls}): “${(sib.claim.visibleClaimText || "").slice(0, 90)}”`
      );
      if (s.evidenceAffordance > strongest) { strongest = s.evidenceAffordance; strongestSignals = sib.features.evidenceAffordanceSignals || []; }
    }

    const expansion = {
      queryExpansionSourceClaimIds,
      additionalQueryTerms: [...additionalQueryTerms].slice(0, 16),
      siblingEvidenceHints,
      documentAffordanceHints: [...documentAffordanceHints],
      shouldMatchTerms: [...shouldMatchTerms],
      rejectIfOnlyTerms: [
        "a source that only repeats the display claim without addressing the underlying document/record",
      ],
      documentAffordanceClass: documentAffordanceClass(strongestSignals),
      selectedAffordance: Number(selAff.toFixed(3)),
      siblingClaimsConsidered: considered.map((s) => s.claimId),
      siblingClaimsUsed: queryExpansionSourceClaimIds,
    };
    expansionByClaimId[sel.claim.claimId] = expansion;

    diagnostics.push({
      selectedClaimId: sel.claim.claimId,
      selectedVisibleClaimText: sel.claim.visibleClaimText || "",
      selectedAffordance: expansion.selectedAffordance,
      documentAffordanceClass: expansion.documentAffordanceClass,
      queryExpansionSourceClaimIds,
      documentAffordanceHints: expansion.documentAffordanceHints,
      siblingClaimsConsidered: considered.map((s) => s.claimId),
      siblingClaimsUsed: queryExpansionSourceClaimIds,
      siblingDetails: top.map((s) => ({
        claimId: s.claimId,
        evidenceAffordance: s.evidenceAffordance,
        relatedness: s.relatedness,
        whySiblingWasUsed: `stronger document affordance (${s.evidenceAffordance} ≥ selected ${expansion.selectedAffordance} + ${minGain}) and points at a concrete document class`,
        whySiblingWasNotSelected: reasons.get(s.claimId) || "not among the selected evaluation claims (below selection cut / lane diversity)",
      })),
    });
  }

  return { expansionByClaimId, diagnostics };
}

export default computeEvidenceAffordanceExpansion;
