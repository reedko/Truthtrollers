import { findUngroundedIdentifierHints, isIdentifierFormatValid } from "./identifierHints.js";
import {
  articleStanceForScoreTransform,
  deriveSelectedClaimPosture,
} from "./claimPosture.js";

function issue(code, path, message, relatedIds = []) {
  return { code, path, message, relatedIds };
}

export function verifyTargetsAndCards(packageValue) {
  const errors = [];
  const targets = packageValue.phase3Targets ?? [];
  const cards = packageValue.evidenceNeedCards ?? [];
  const selectedClaims = packageValue.selectedEvaluationClaims ?? [];
  const targetCounts = new Map();

  for (const card of cards) targetCounts.set(card.targetId, (targetCounts.get(card.targetId) ?? 0) + 1);
  for (const [index, target] of targets.entries()) {
    const path = `/phase3Targets/${index}`;
    const selectedIndex = selectedClaims.findIndex((candidate) =>
      candidate.selectedClaimId === target.selectedClaimId);
    const selected = selectedClaims[selectedIndex];
    const posture = selected
      ? deriveSelectedClaimPosture(selected, packageValue.rawAssertions)
      : null;
    if (targetCounts.get(target.targetId) !== 1) {
      errors.push(issue("CF1_TARGET_CARD_CARDINALITY", path, "Every target must have exactly one Evidence Need Card", [target.targetId]));
    }
    if (target.mappingStatus === "unresolved" && target.verdictEligible) {
      errors.push(issue("CF1_UNRESOLVED_TARGET_VERDICT", `${path}/verdictEligible`, "Unresolved target cannot be verdict eligible", [target.targetId]));
    }
    if (["attribution_provenance", "source_identity"].includes(target.targetType)
      && (target.scoreTransform !== "none" || target.verdictEligible)) {
      errors.push(issue("CF1_INVALID_TARGET_POSTURE", path, "Attribution/source target must use none and not affect verdict", [target.targetId]));
    }
    if (target.targetType === "article_endorsed_substantive"
      && (target.scoreTransform !== "normal" || !target.verdictEligible)) {
      errors.push(issue("CF1_INVALID_TARGET_POSTURE", path, "Endorsed substantive target must use normal and be verdict eligible", [target.targetId]));
    }
    if (target.targetType === "opponent_substantive"
      && (target.scoreTransform !== "invert" || !target.verdictEligible)) {
      errors.push(issue("CF1_INVALID_TARGET_POSTURE", path, "Opponent target must use invert and be verdict eligible", [target.targetId]));
    }
    if (selected && (selected.scoreTransform !== target.scoreTransform
      || selected.verdictEligible !== target.verdictEligible)) {
      errors.push(issue("CF1_CLAIM_TARGET_POSTURE_MISMATCH", path,
        "Selected claim and target must use the same score transform and verdict eligibility",
        [selected.selectedClaimId, target.targetId]));
    }
    if (selected && (selected.scoreTransform !== posture.scoreTransform
      || selected.verdictEligible !== posture.verdictEligible
      || target.targetType !== posture.targetType)) {
      errors.push(issue("CF1_DERIVED_POSTURE_MISMATCH",
        `/selectedEvaluationClaims/${selectedIndex}`,
        "Claim and target posture must match the host derivation from article role/use",
        [selected.selectedClaimId, target.targetId]));
    }
    if (selected && articleStanceForScoreTransform(selected.scoreTransform)
      !== articleStanceForScoreTransform(target.scoreTransform)) {
      errors.push(issue("CF1_PROJECTED_STANCE_MISMATCH", path,
        "Selected claim and target would project contradictory article stances",
        [selected.selectedClaimId, target.targetId]));
    }
  }

  for (const [index, card] of cards.entries()) {
    const path = `/evidenceNeedCards/${index}`;
    const target = targets.find((candidate) => candidate.targetId === card.targetId);
    if (!target) continue;
    for (const field of ["selectedClaimId", "targetText", "targetType", "scoreTransform", "searchEligible", "verdictEligible"]) {
      if (card[field] !== target[field]) errors.push(issue("CF1_CARD_TARGET_MISMATCH", `${path}/${field}`, `${field} must copy its target`, [card.cardId, target.targetId]));
    }
    const criteria = card.bearingCriteria ?? {};
    const substantive = ["article_endorsed_substantive", "opponent_substantive"].includes(target.targetType);
    if (target.searchEligible && substantive && !criteria.weak
      && (!(criteria.mustMatch?.length) || !(criteria.rejectIfOnly?.length))) {
      errors.push(issue("CF1_WEAK_BEARING_CRITERIA", `${path}/bearingCriteria`, "Searchable substantive target needs mustMatch and rejectIfOnly", [card.cardId]));
    }
    const identifierSource = `${packageValue.article?.text ?? ""}\n${packageValue.article?.url ?? ""}`;
    for (const hint of findUngroundedIdentifierHints(card.identifierHints, identifierSource)) {
      errors.push(issue("CF1_UNGROUNDED_IDENTIFIER", `${path}/identifierHints/${hint.field}`, `Identifier is not grounded in article: ${hint.value}`, [card.cardId]));
    }
    for (const [field, values] of Object.entries(card.identifierHints ?? {})) {
      for (const value of values ?? []) {
        if (!isIdentifierFormatValid(value, field)) errors.push(issue("CF1_INVALID_IDENTIFIER", `${path}/identifierHints/${field}`, `Malformed identifier: ${value}`, [card.cardId]));
      }
    }
  }
  return errors;
}
