import { canonicalHash } from "../../shared/sourceUnits/index.js";
import type {
  Cf7S3ParentRow,
  Cf7S3RoutingDecision,
  Cf7S3RoutingManifest,
  Cf7S3RoutingSignal,
} from "./types.js";

const FINITE_VERB = /\b(?:is|are|was|were|be|has|have|had|does|do|did|found|finds|showed|shows|reported|reports|said|says|caused|causes|increased|increases|decreased|decreases|linked|links|associated|associates|became|becomes|remained|remains|led|leads|required|requires|recommended|recommends|announced|announces|approved|approves|rejected|rejects|observed|observes|concluded|concludes)\b/gi;
const DATE_OR_EVENT = /\b(?:18|19|20)\d{2}\b|\b(?:first|second|third|fourth|then|later|subsequently|afterward)\b/gi;
const NAMED_ACTOR = /\b[A-Z][A-Za-z0-9'-]{1,}(?:\s+[A-Z][A-Za-z0-9'-]{1,})*/g;

function matches(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0;
  return text.match(pattern) ?? [];
}

export function classifyCf7S3CompoundCandidate(
  parent: Cf7S3ParentRow,
): Cf7S3RoutingDecision {
  const text = parent.assertionText;
  const signals: Cf7S3RoutingSignal[] = [];
  const finiteVerbs = matches(FINITE_VERB, text);
  const clausalConjunction = /\b(?:and|but|while|whereas|yet)\b/i.test(text);
  if (text.includes(";")) signals.push("semicolon");
  if (/\bnot only\b[\s\S]*\bbut also\b/i.test(text)) {
    signals.push("not_only_but_also");
  }
  if (clausalConjunction && finiteVerbs.length >= 2) {
    signals.push("multiple_clausal_conjunction");
  }
  if (
    finiteVerbs.length >= 2
    && /[,—–:]|\b(?:which|who|that|because|after|before)\b/i.test(text)
  ) {
    signals.push("multiple_independent_predicates");
  }
  if (matches(DATE_OR_EVENT, text).length >= 2 && finiteVerbs.length >= 2) {
    signals.push("multiple_dates_or_events");
  }
  const actors = new Set(matches(NAMED_ACTOR, text).filter(
    (actor) => !/^(?:The|This|That|These|Those|A|An|In|On|At|By|After|Before)$/
      .test(actor),
  ));
  if (actors.size >= 2 && clausalConjunction && finiteVerbs.length >= 2) {
    signals.push("multiple_named_actors");
  }
  if (
    /\b(?:and|as well as)\b/i.test(text)
    && /\b(?:outcomes?|effects?|symptoms?|rates?|deaths?|injuries?|risks?)\b/i
      .test(text)
    && finiteVerbs.length >= 2
  ) {
    signals.push("multiple_outcomes");
  }
  if (
    /\b(?:because|caused?|led to|resulted in|therefore|consequently)\b/i
      .test(text)
    && finiteVerbs.length >= 2
  ) {
    signals.push("causal_chain");
  }
  if (
    /\b(?:study|analysis|research|trial|report)\b/i.test(text)
    && /\b(?:found|showed|reported|concluded)\b/i.test(text)
    && /\b(?:then|subsequently|responded|announced|recommended|approved|rejected|changed)\b/i
      .test(text)
  ) {
    signals.push("study_result_and_response");
  }
  return {
    parentHarvestRowId: parent.harvestRowId,
    routed: signals.length > 0,
    signals: [...new Set(signals)],
  };
}

export function buildCf7S3RoutingManifest(
  parents: Cf7S3ParentRow[],
): Cf7S3RoutingManifest {
  const decisions = parents.map(classifyCf7S3CompoundCandidate);
  const withoutHash = {
    schemaVersion: "cf7.s3RoutingManifest.v1" as const,
    classifierVersion: "cf7.compoundCandidate.v1" as const,
    totalParentCount: parents.length,
    routedParentCount: decisions.filter((decision) => decision.routed).length,
    bypassedParentCount: decisions.filter((decision) => !decision.routed).length,
    decisions,
  };
  return {
    ...withoutHash,
    routingManifestHash: canonicalHash(withoutHash),
  };
}
