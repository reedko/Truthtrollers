import { openAiLLM } from "./openAiLLM.js";
import PromptManager from "./promptManager.js";
import { classifyAttributionClaim } from "../utils/normalizeEvidenceClaim.js";
import logger from "../utils/logger.js";
import { normalizeEvaluationTarget, replaceClaimEvaluationTargets } from "./evaluationTargetStore.js";
import { deriveClaimTypeFlags } from "./localClaimExtraction.js";

const ALLOWED_STANCES = new Set(["endorses", "rejects", "neutral", "unclear"]);
const ALLOWED_FUNCTIONS = new Set([
  "thesis",
  "supporting_premise",
  "evidence",
  "opposing_claim_to_refute",
  "background",
  "reported_neutral",
  "unclear",
]);
const ALLOWED_TRANSFORMS = new Set(["normal", "invert", "none", "review"]);

export const COMPLEX_MAPPING_PROMPT = {
  system: `Resolve one complex claim using only its article thesis, claim text, exact local
excerpt, and already-extracted local metadata. Return strict JSON only. Do not fact-check and do
not use outside knowledge.

Separate attribution (who made an allegation) from substantive truth (whether the alleged conduct
occurred). Preserve the named actor, alleged action, object acted upon, and study/document clues.
Do not broaden a specific misconduct or data-handling allegation into a generic topic. If the exact
study is not named, say underspecified and retain every available identity clue.`,
  user: `ARTICLE THESIS:
{{articleThesis}}

ONE CLAIM:
{{claimText}}

LOCAL SOURCE EXCERPT:
{{localSourceExcerpt}}

EXTRACTED LOCAL METADATA:
{{metadataJson}}

Return:
{
  "objectClaim": "",
  "speakerEntity": "",
  "subjectEntity": "",
  "allegedAction": "",
  "actionObject": "",
  "namedStudyOrDocument": "",
  "studyIdentityClues": [],
  "impliesInference": false,
  "inferenceText": "",
  "articleStance": "endorses|rejects|neutral|unclear",
  "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
  "mappingStatus": "resolved|underspecified",
  "confidence": 0,
  "rationale": ""
}`,
  parameters: {},
};

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeBool(value) {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

function fillTemplate(template, vars) {
  return String(template || "").replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function deriveTransform(argumentFunction, stance, existingTransform) {
  if (ALLOWED_TRANSFORMS.has(existingTransform)) return existingTransform;
  if (argumentFunction === "opposing_claim_to_refute" || stance === "rejects") return "invert";
  if (argumentFunction === "background" || argumentFunction === "reported_neutral" || stance === "neutral") return "none";
  if (argumentFunction === "unclear" || stance === "unclear") return "review";
  return "normal";
}

function needsStudyIdentityTarget(inputClaim, objectClaim, targets) {
  const text = [
    inputClaim?.text,
    objectClaim,
    ...(targets || []).flatMap((target) => [target.targetText, target.objectText, target.allegedAction]),
  ].filter(Boolean).join(" ");
  const referencesWork = /\b(?:study|studies|dataset|data|report|analysis|analyses|paper|protocol|research|authors?'? results|evidence)\b/i.test(text);
  const identityAffectsAdjudication = /\b(?:manipulat|omit|exclud|destroy|suppress|conceal|fabricat|alter|reanalysis|method|subgroup|confound|result|link|associat|caus)\w*/i.test(text);
  return referencesWork && identityAffectsAdjudication &&
    !(targets || []).some((target) => target.targetType === "study_identity");
}

export function normalizeMappingItem(raw, inputClaim) {
  const attribution = classifyAttributionClaim(inputClaim.text);
  const rawFunction = String(raw?.argumentFunction || raw?.argument_function || "").trim();
  const rawStance = String(raw?.articleStanceTowardObjectClaim || raw?.articleStance || raw?.article_stance || "").trim();
  const rawTransform = String(raw?.scoreTransform || raw?.score_transform || "").trim();

  const argumentFunction = ALLOWED_FUNCTIONS.has(rawFunction) ? rawFunction : "unclear";
  const articleStance = ALLOWED_STANCES.has(rawStance) ? rawStance : "unclear";
  const scoreTransform = deriveTransform(argumentFunction, articleStance, rawTransform);
  const isAttribution = normalizeBool(raw?.isAttribution ?? raw?.is_attribution) ?? attribution.isAttribution;
  const objectClaim = String(raw?.objectClaim || raw?.object_claim_text || attribution.objectText || inputClaim.objectText || inputClaim.text || "")
    .trim()
    .replace(/\s+/g, " ");

  const context = {
    claimId: Number(raw?.claimId || raw?.claim_id || inputClaim.id),
    claimText: inputClaim.text,
    objectClaim,
    articleStance,
    scoreTransform,
    mappingConfidence: clamp01(raw?.confidence ?? raw?.argument_mapping_confidence, 0),
    mappingRationale: String(raw?.rationale || "").trim().slice(0, 1000),
  };
  const rawTargets = Array.isArray(raw?.targets) ? raw.targets : [];
  const targets = rawTargets.map((target, index) => {
    const targetType = String(target?.targetType || target?.target_type || "substantive");
    const explicitTargetTransform = String(target?.scoreTransform || target?.score_transform || "").trim();
    const targetTransform = ALLOWED_TRANSFORMS.has(explicitTargetTransform)
      ? explicitTargetTransform
      : ["attribution", "study_identity"].includes(targetType)
        ? "none"
        : (isAttribution && scoreTransform === "none" ? "review" : scoreTransform);
    return normalizeEvaluationTarget(
      { ...target, scoreTransform: targetTransform },
      { ...context, targetOrder: index },
    );
  });
  if (!targets.some((target) => target.targetType === "substantive")) {
    targets.push(normalizeEvaluationTarget({
      targetType: "substantive",
      targetText: objectClaim,
      objectText: objectClaim,
      scoreTransform: isAttribution && scoreTransform === "none" ? "review" : scoreTransform,
    }, { ...context, targetOrder: targets.length }));
  }
  if (isAttribution && !targets.some((target) => target.targetType === "attribution")) {
    targets.unshift(normalizeEvaluationTarget({
      targetType: "attribution",
      targetText: inputClaim.text,
      subjectEntity: attribution.speakerEntity,
      scoreTransform: "none",
      verdictEligible: true,
    }, { ...context, targetOrder: 0 }));
    targets.forEach((target, index) => { target.targetOrder = index; });
  }
  if (needsStudyIdentityTarget(inputClaim, objectClaim, targets)) {
    targets.push(normalizeEvaluationTarget({
      targetType: "study_identity",
      targetText: `Resolve the exact study, dataset, report, analysis, protocol, or paper referenced by: ${objectClaim}`,
      objectText: objectClaim,
      scoreTransform: "none",
      searchEligible: true,
      verdictEligible: false,
      resolutionStatus: "underspecified",
    }, { ...context, targetOrder: targets.length }));
  }

  return {
    claimId: context.claimId,
    objectClaim,
    isAttribution,
    speakerEntity: String(raw?.speakerEntity || raw?.speaker_entity || attribution.speakerEntity || inputClaim.speakerEntity || "").trim(),
    articleStance,
    argumentFunction,
    scoreTransform,
    accountabilityEligible: normalizeBool(raw?.accountabilityEligible ?? raw?.accountability_eligible) ?? Boolean(attribution.accountabilityEligible),
    confidence: context.mappingConfidence,
    rationale: context.mappingRationale,
    targets,
  };
}

function cleanMappingValue(value, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function stringList(value, max = 12) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanMappingValue(item, 300)).filter(Boolean))].slice(0, max)
    : [];
}

function stripTerminalPunctuation(value) {
  return cleanMappingValue(value).replace(/[.!?]+$/, "");
}

function extractAllegedAction(text) {
  const match = cleanMappingValue(text).match(
    /\b(manipulated|omitted|excluded|destroyed|suppressed|concealed|fabricated|altered|falsified|withheld)\b/i,
  );
  return match?.[1]?.toLowerCase() || "";
}

function extractPassiveActor(text) {
  const match = cleanMappingValue(text).match(
    /\bby\s+(?:the\s+)?([A-Z][A-Za-z0-9.&' -]{1,80}?)(?=[,.;]|$)/,
  );
  return cleanMappingValue(match?.[1], 255);
}

function extractActionObject(text, action, actor) {
  let object = stripTerminalPunctuation(text);
  if (!object) return "";
  if (action) {
    const passive = new RegExp(
      `\\s+(?:had\\s+been|has\\s+been|have\\s+been|was|were|is|are)\\s+${action}(?:\\s+by\\s+(?:the\\s+)?[^,.;]+)?$`,
      "i",
    );
    object = object.replace(passive, "").trim();
    if (actor) {
      const active = new RegExp(`^${actor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:allegedly\\s+)?${action}\\s+`, "i");
      object = object.replace(active, "").trim();
    }
  }
  return object;
}

function extractExplicitStudyYear(text) {
  const source = cleanMappingValue(text, 10000);
  for (const pattern of [
    /\b((?:19|20)\d{2})\b(?:(?!\b(?:19|20)\d{2}\b).){0,45}\b(?:study|paper|analysis|dataset|results?|protocol)\b/i,
    /\b(?:study|paper|analysis|dataset|results?|protocol)\b(?:(?!\b(?:19|20)\d{2}\b).){0,45}\b((?:19|20)\d{2})\b/i,
  ]) {
    const year = Number(source.match(pattern)?.[1]);
    if (year) return year;
  }
  return null;
}

function actionNoun(action) {
  const normalized = cleanMappingValue(action, 100).toLowerCase();
  return {
    manipulated: "manipulation",
    omitted: "omission",
    excluded: "exclusion",
    destroyed: "destruction",
    suppressed: "suppression",
    concealed: "concealment",
    fabricated: "fabrication",
    altered: "alteration",
    falsified: "falsification",
    withheld: "withholding",
  }[normalized] || normalized || "conduct";
}

function argumentFunctionForClaim(claim, refinement = {}) {
  const explicit = cleanMappingValue(refinement.argumentFunction || refinement.argument_function, 64);
  if (ALLOWED_FUNCTIONS.has(explicit)) return explicit;
  const role = cleanMappingValue(claim.finalRole || claim.localRoleSuggestion || claim.role, 32);
  if (role === "thesis") return "thesis";
  if (role === "pillar" || role === "pillar_support" || role === "supporting_premise") return "supporting_premise";
  if (role === "opposing_claim") return "opposing_claim_to_refute";
  if (role === "background") return "background";
  if (role === "evidence") return "evidence";
  return "unclear";
}

export function claimNeedsComplexMapping(claim = {}) {
  const flags = deriveClaimTypeFlags(claim.text, claim.claimType || {});
  const confidence = Number(claim.localExtractionConfidence);
  return Boolean(
    flags.attribution || flags.misconduct || flags.causation || flags.disputed_study ||
    flags.legal_or_regulatory || (Number.isFinite(confidence) && confidence < 0.65),
  );
}

export function buildDeterministicClaimMapping(inputClaim = {}, refinement = {}) {
  const claimText = cleanMappingValue(inputClaim.text || inputClaim.claimText);
  const attribution = classifyAttributionClaim(claimText);
  const flags = deriveClaimTypeFlags(claimText, inputClaim.claimType || {});
  const localExcerpt = cleanMappingValue(inputClaim.localSourceExcerpt || claimText, 10000);
  const articleStanceRaw = cleanMappingValue(
    refinement.articleStance || refinement.article_stance || inputClaim.articleStance || inputClaim.extractionArticleStance,
    32,
  );
  const articleStance = ALLOWED_STANCES.has(articleStanceRaw) ? articleStanceRaw : "unclear";
  const argumentFunction = argumentFunctionForClaim(inputClaim, refinement);
  let scoreTransform = deriveTransform(argumentFunction, articleStance, "");
  const objectClaim = cleanMappingValue(
    refinement.objectClaim || refinement.object_claim_text || attribution.objectText || inputClaim.objectText || claimText,
  );
  const speakerEntity = cleanMappingValue(
    refinement.speakerEntity || refinement.speaker_entity || attribution.speakerEntity || inputClaim.speakerEntity,
    255,
  );
  const namedActors = stringList(inputClaim.namedActors || inputClaim.namedEntities);
  const passiveActor = extractPassiveActor(objectClaim);
  const subjectEntity = cleanMappingValue(
    refinement.subjectEntity || refinement.subject_entity || passiveActor ||
      namedActors.find((actor) => actor.toLowerCase() !== speakerEntity.toLowerCase()) || "",
    255,
  );
  const rawAllegedAction = cleanMappingValue(
    refinement.allegedAction || refinement.alleged_action || inputClaim.allegedAction,
    255,
  );
  const allegedAction = extractAllegedAction(rawAllegedAction) ||
    extractAllegedAction(objectClaim) ||
    extractAllegedAction(localExcerpt) ||
    rawAllegedAction;
  const actionObject = cleanMappingValue(
    refinement.actionObject || refinement.action_object || extractActionObject(objectClaim, allegedAction, subjectEntity),
  );
  const studyNames = stringList([
    ...(inputClaim.namedStudiesOrDocuments || inputClaim.studiesOrDocuments || []),
    refinement.namedStudyOrDocument || refinement.named_study_or_document,
    ...(refinement.studyIdentityClues || refinement.study_identity_clues || []),
  ]);
  const confidence = clamp01(
    refinement.confidence,
    Number.isFinite(Number(inputClaim.localExtractionConfidence))
      ? Number(inputClaim.localExtractionConfidence)
      : 0.72,
  );
  const rationale = cleanMappingValue(refinement.rationale || "Targets constructed from local extraction metadata.", 1000);
  const context = {
    claimId: Number(inputClaim.id),
    claimText,
    objectClaim,
    articleStance,
    scoreTransform,
    mappingConfidence: confidence,
    mappingRationale: rationale,
  };
  const targets = [];

  if (flags.attribution || attribution.isAttribution) {
    if (speakerEntity && objectClaim) {
      targets.push(normalizeEvaluationTarget({
        targetType: "attribution",
        targetText: `${speakerEntity} made the allegation that ${stripTerminalPunctuation(objectClaim)}.`,
        subjectEntity: speakerEntity,
        predicate: attribution.attributionVerb || "made allegation",
        objectText: objectClaim,
        sourceExcerpt: localExcerpt,
        scoreTransform: "none",
        searchEligible: true,
        verdictEligible: true,
        resolutionStatus: "mapped",
      }, { ...context, targetOrder: targets.length }));
    }
  }

  const misconductComplete = !flags.misconduct || Boolean(subjectEntity && allegedAction && actionObject);
  const isBackground = argumentFunction === "background" || flags.background;
  if (misconductComplete) {
    const substantiveText = flags.misconduct
      ? `${subjectEntity} allegedly ${allegedAction} ${stripTerminalPunctuation(actionObject)}.`
      : objectClaim;
    if (substantiveText) {
      targets.push(normalizeEvaluationTarget({
        targetType: "substantive",
        targetText: substantiveText,
        subjectEntity,
        predicate: allegedAction,
        objectText: actionObject || objectClaim,
        allegedAction,
        sourceExcerpt: localExcerpt,
        scoreTransform,
        searchEligible: !isBackground,
        verdictEligible: !isBackground,
        resolutionStatus: "mapped",
      }, { ...context, targetOrder: targets.length }));
    }
  }

  const needsStudyIdentity = flags.disputed_study || studyNames.length > 0;
  if (needsStudyIdentity) {
    const namedStudy = studyNames[0] || "";
    const explicitStudyYear = extractExplicitStudyYear(`${localExcerpt} ${objectClaim}`);
    targets.push(normalizeEvaluationTarget({
      targetType: "study_identity",
      targetText: namedStudy
        ? `Resolve the exact study or document: ${namedStudy}.`
        : `Resolve the exact study, dataset, subgroup, or protocol referenced by: ${stripTerminalPunctuation(objectClaim)}.`,
      subjectEntity,
      objectText: actionObject || objectClaim,
      allegedAction,
      studyTitle: namedStudy,
      studyYear: explicitStudyYear,
      sourceExcerpt: localExcerpt,
      scoreTransform: "none",
      searchEligible: Boolean(namedStudy || actionObject || objectClaim),
      verdictEligible: false,
      resolutionStatus: namedStudy ? "mapped" : "underspecified",
    }, { ...context, targetOrder: targets.length }));
  }

  const impliesInference = flags.misconduct && misconductComplete &&
    (refinement.impliesInference !== false && refinement.implies_inference !== false);
  if (impliesInference) {
    const inferenceText = cleanMappingValue(
      refinement.inferenceText || refinement.inference_text ||
        `The alleged ${actionNoun(allegedAction)} of ${stripTerminalPunctuation(actionObject)} concealed or misrepresented evidence.`,
    );
    targets.push(normalizeEvaluationTarget({
      targetType: "inference",
      targetText: inferenceText,
      subjectEntity,
      predicate: "concealed or misrepresented evidence",
      objectText: actionObject,
      allegedAction,
      sourceExcerpt: localExcerpt,
      scoreTransform,
      searchEligible: true,
      verdictEligible: true,
      resolutionStatus: "mapped",
    }, { ...context, targetOrder: targets.length }));
  }

  const targetMappingUnresolved = Boolean(flags.misconduct && !misconductComplete);
  if (targetMappingUnresolved) {
    scoreTransform = "review";
    for (const target of targets) {
      target.verdictEligible = false;
      target.scoreTransform = "none";
    }
  }
  const finalRationale = targetMappingUnresolved
    ? `target_mapping_unresolved: missing ${[
        !subjectEntity && "actor",
        !allegedAction && "action",
        !actionObject && "object",
      ].filter(Boolean).join(", ")}. ${rationale}`.slice(0, 1000)
    : rationale;
  for (let index = 0; index < targets.length; index += 1) {
    targets[index].targetOrder = index;
    targets[index].mappingRationale = finalRationale;
    targets[index].mappingConfidence = targetMappingUnresolved ? Math.min(confidence, 0.35) : confidence;
  }

  return {
    claimId: Number(inputClaim.id),
    objectClaim,
    isAttribution: Boolean(flags.attribution || attribution.isAttribution),
    speakerEntity,
    articleStance,
    argumentFunction,
    scoreTransform,
    accountabilityEligible: targetMappingUnresolved ? false : Boolean(attribution.accountabilityEligible),
    confidence: targetMappingUnresolved ? Math.min(confidence, 0.35) : confidence,
    rationale: finalRationale,
    targetMappingUnresolved,
    targets,
  };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function mapArgumentFunctions({
  query,
  taskContentId,
  claims = [],
  llm = openAiLLM,
}) {
  if (!query) throw new Error("mapArgumentFunctions: missing query");
  if (!taskContentId) throw new Error("mapArgumentFunctions: missing taskContentId");
  if (!Array.isArray(claims) || claims.length === 0) return [];

  const promptManager = new PromptManager(query);
  const complexClaims = claims.filter(claimNeedsComplexMapping);
  const complexPrompt = complexClaims.length
    ? await promptManager.getPrompt("claim_complex_target_mapping", COMPLEX_MAPPING_PROMPT)
    : COMPLEX_MAPPING_PROMPT;
  const articleThesis = cleanMappingValue(
    claims.find((claim) => claim.documentThesis)?.documentThesis ||
      claims.find((claim) => String(claim.role || "").toLowerCase() === "thesis")?.text ||
      claims[0]?.text,
    3000,
  );

  const mapped = await mapWithConcurrency(claims, 3, async (claim) => {
    if (!claimNeedsComplexMapping(claim)) {
      return { ...buildDeterministicClaimMapping(claim), mappingMethod: "deterministic" };
    }
    const metadata = {
      localRoleSuggestion: claim.localRoleSuggestion || claim.role || "unclear",
      articleStance: claim.articleStance || claim.extractionArticleStance || "unclear",
      namedActors: claim.namedActors || claim.namedEntities || [],
      namedStudiesOrDocuments: claim.namedStudiesOrDocuments || claim.studiesOrDocuments || [],
      allegedAction: claim.allegedAction || "",
      claimType: claim.claimType || {},
      thesisCandidate: Boolean(claim.thesisCandidate),
      pillarCandidate: Boolean(claim.pillarCandidate),
      localExtractionConfidence: claim.localExtractionConfidence ?? null,
    };
    try {
      const response = await llm.generate({
        system: complexPrompt.system || COMPLEX_MAPPING_PROMPT.system,
        user: fillTemplate(complexPrompt.user || COMPLEX_MAPPING_PROMPT.user, {
          articleThesis,
          claimText: claim.text,
          localSourceExcerpt: claim.localSourceExcerpt || claim.text,
          metadataJson: JSON.stringify(metadata),
        }),
        schemaHint: "",
        temperature: 0,
        maxRetries: 1,
        timeout: 30000,
      });
      return {
        ...buildDeterministicClaimMapping(claim, response?.mapping || response || {}),
        mappingMethod: "complex_llm_plus_deterministic",
      };
    } catch (error) {
      logger.warn(`[argumentMapping] Small mapping request failed for claim ${claim.id}; using local deterministic mapping: ${error.message}`);
      return {
        ...buildDeterministicClaimMapping(claim),
        mappingMethod: "deterministic_after_complex_llm_failure",
      };
    }
  });

  const claimTextById = new Map(claims.map((claim) => [Number(claim.id), cleanMappingValue(claim.text, 500)]));

  for (const item of mapped) {
    await query(
      `UPDATE content_claims
          SET object_claim_text = ?,
              is_attribution = ?,
              speaker_entity = NULLIF(?, ''),
              article_stance = ?,
              argument_function = ?,
              score_transform = ?,
              accountability_eligible = ?,
              argument_mapping_confidence = ?,
              argument_mapping_rationale = NULLIF(?, '')
        WHERE content_id = ? AND claim_id = ?`,
      [
        item.objectClaim || null,
        item.isAttribution ? 1 : 0,
        item.speakerEntity || "",
        item.articleStance,
        item.argumentFunction,
        item.scoreTransform,
        item.accountabilityEligible ? 1 : 0,
        item.confidence,
        item.rationale || "",
        taskContentId,
        item.claimId,
      ]
    );
    const persistedTargets = await replaceClaimEvaluationTargets(query, taskContentId, item.claimId, item.targets);
    logger.log(`[EVALUATION_TARGETS_MAPPED] ${JSON.stringify({
      event: "evaluation_targets_mapped",
      taskContentId,
      claimId: item.claimId,
      claimText: claimTextById.get(Number(item.claimId)) || "",
      mappingMethod: item.mappingMethod,
      targetMappingUnresolved: item.targetMappingUnresolved,
      mappingConfidence: item.confidence,
      mappingRationale: cleanMappingValue(item.rationale, 500),
      targets: (persistedTargets.length ? persistedTargets : item.targets).slice(0, 8).map((target) => ({
        evaluationTargetId: target.evaluationTargetId || null,
        targetType: target.targetType,
        targetText: cleanMappingValue(target.targetText, 500),
        subjectEntity: cleanMappingValue(target.subjectEntity, 200),
        predicate: cleanMappingValue(target.predicate, 200),
        objectText: cleanMappingValue(target.objectText, 500),
        allegedAction: cleanMappingValue(target.allegedAction, 200),
        studyTitle: cleanMappingValue(target.studyTitle, 300),
        studyIdentifier: cleanMappingValue(target.studyIdentifier, 200),
        sourceExcerpt: cleanMappingValue(target.sourceExcerpt, 500),
        searchEligible: target.searchEligible,
        verdictEligible: target.verdictEligible,
        resolutionStatus: target.resolutionStatus,
        mappingConfidence: target.mappingConfidence,
      })),
    })}`);
  }

  logger.log(`🧭 [argumentMapping] Mapped ${mapped.length} claims for content ${taskContentId}; ${complexClaims.length} used bounded one-claim mapping requests`);
  return mapped;
}
