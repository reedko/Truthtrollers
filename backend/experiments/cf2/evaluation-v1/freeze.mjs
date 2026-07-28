#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCf2Article } from "../pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const freezeId = "cf2-v7-ab-f01-f03-f08-20260724";
const sourceSuite = path.join(
  root,
  "artifacts/claim-foundry/cf2/v7-ab-f01-f08-r1-20260724",
);
const fixtureIds = ["CF1-F01", "CF1-F03", "CF1-F08"];
const frozenDir = path.join(here, "frozen");
const observedDir = path.join(here, "observed");
const reviewsDir = path.join(here, "reviews");
const tracesDir = path.join(here, "traces");
for (const directory of [frozenDir, observedDir, reviewsDir, tracesDir]) {
  mkdirSync(directory, { recursive: true });
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const writeJson = (filePath, value) => writeFileSync(filePath, json(value));
const hashFile = (filePath) => sha256(readFileSync(filePath));
function writeReviewTemplate(filePath, template) {
  if (!existsSync(filePath)) {
    writeJson(filePath, template);
    return template;
  }
  const existing = JSON.parse(readFileSync(filePath, "utf8"));
  if (existing.freezeId !== template.freezeId
    || existing.fixtureId !== template.fixtureId
    || existing.frozenInventorySha256 !== template.frozenInventorySha256) {
    throw new Error(
      `Refusing to overwrite incompatible review file: ${filePath}`,
    );
  }
  return existing;
}
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

function compactUnit(unit) {
  return {
    unitId: unit.unitId,
    order: unit.order,
    type: unit.type,
    text: unit.text,
  };
}

function candidateDisposition(candidateId, judgment, rejection, selected) {
  if (rejection) {
    return {
      terminalStatus: "quarantined",
      terminalReason: rejection.code,
      eligibleUnderTreatmentFallback: false,
    };
  }
  if (!judgment) {
    return {
      terminalStatus: "missing_call_b_judgment",
      terminalReason: "No valid judgment or quarantine record",
      eligibleUnderTreatmentFallback: false,
    };
  }
  const primaryEligible = judgment.effectIfTrue !== "no_effect"
    || judgment.articleTreatment === "challenged";
  const fallbackEligible = judgment.effectIfTrue === "no_effect"
    && judgment.articleTreatment === "adopted";
  if (selected) {
    return {
      terminalStatus: "selected",
      terminalReason: selected.selectionBasis ?? "selected_without_recorded_basis",
      eligibleUnderTreatmentFallback: true,
    };
  }
  if (primaryEligible || fallbackEligible) {
    return {
      terminalStatus: "eligible_not_selected",
      terminalReason: "portfolio_capacity_or_balancing",
      eligibleUnderTreatmentFallback: true,
    };
  }
  return {
    terminalStatus: "ineligible_not_selected",
    terminalReason: judgment.articleTreatment === "reported"
      && judgment.effectIfTrue === "no_effect"
      ? "reported_plus_no_effect"
      : "no_effect_without_adopted_or_challenged_treatment",
    eligibleUnderTreatmentFallback: false,
  };
}

function observedTuple(candidate, judgment, rawCallB, article) {
  const layers = judgment?.attributionLayers ?? rawCallB?.attributionLayers ?? [];
  const substantiveAssertion = judgment?.assertionText
    ?? rawCallB?.substantiveAssertion
    ?? null;
  const substantiveGroundingUnitIds = judgment?.groundingUnitIds
    ?? rawCallB?.groundingUnitIds
    ?? [];
  const sourceName = judgment?.sourceName ?? null;
  const sourceKind = judgment?.sourceKind ?? "unknown";
  const sourceUnitIds = judgment?.sourceUnitIds ?? [];
  return {
    surfaceStatement: candidate.surfaceAssertion ?? candidate.rawAssertion,
    surfaceUnitIds: candidate.groundingUnitIds,
    reportingVoice: article.authors?.length
      ? {
          name: article.authors.join(", "),
          kind: "article_voice",
          unitIds: [],
        }
      : null,
    attributionLayers: layers,
    substantiveAssertion,
    substantiveGroundingUnitIds,
    contentSupplier: sourceName
      ? {
          name: sourceName,
          kind: sourceKind,
          unitIds: sourceUnitIds,
          origin: judgment?.sourceNameOrigin ?? null,
        }
      : null,
    primaryVerificationTarget: substantiveAssertion
      ? "substantive_content"
      : "unresolved",
  };
}

function blankTupleReview(observed) {
  return {
    observed,
    review: {
      status: "unreviewed",
      tupleVerdict: "not_reviewed",
      fieldVerdicts: {
        surface: "not_reviewed",
        layerStructure: "not_reviewed",
        substantiveAssertion: "not_reviewed",
        grounding: "not_reviewed",
        contentSupplier: "not_reviewed",
        verificationTarget: "not_reviewed",
      },
      correctedTuple: null,
      notes: "",
    },
  };
}

function blankPositionReview(candidateId, judgment, selected, rejection) {
  return {
    candidateId,
    observed: {
      articleTreatment: judgment?.articleTreatment ?? null,
      legacyEffectIfTrue: judgment?.effectIfTrue ?? null,
      selected: Boolean(selected),
      selectionBasis: selected?.selectionBasis ?? null,
      rejected: Boolean(rejection),
      rejectionCode: rejection?.code ?? null,
    },
    review: {
      status: "unreviewed",
      articleTreatmentGold: "not_reviewed",
      targetRelationsGold: [],
      relevanceGold: "not_reviewed",
      selectionGold: null,
      notes: "",
    },
  };
}

function renderFixtureSection(inventory, trace, tupleReview, positionReview) {
  const unitById = new Map(inventory.sourceUnits.map((unit) => [unit.unitId, unit]));
  const traceById = new Map(trace.candidates.map((candidate) =>
    [candidate.candidateId, candidate]));
  const tupleById = new Map(tupleReview.items.map((item) => [item.candidateId, item]));
  const rows = inventory.candidates.map((candidate) => {
    const item = traceById.get(candidate.candidateId);
    const tuple = tupleById.get(candidate.candidateId);
    const disposition = item.disposition.terminalStatus;
    const className = disposition === "selected" ? "selected"
      : disposition === "quarantined" ? "quarantined"
        : disposition === "ineligible_not_selected" ? "excluded" : "";
    const unitText = [...new Set([
      ...candidate.groundingUnitIds,
      ...candidate.contextUnitIds,
    ])].map((unitId) => {
      const unit = unitById.get(unitId);
      return unit ? `[${unit.unitId}] ${unit.text}` : `[${unitId}] MISSING`;
    }).join("\n");
    return `<tr class="${className}">
      <td>${escapeHtml(candidate.candidateId)}</td>
      <td>${escapeHtml(disposition)}</td>
      <td><strong>${escapeHtml(candidate.surfaceAssertion)}</strong></td>
      <td>${escapeHtml(item.callB.validatedJudgment?.articleTreatment ?? "—")}</td>
      <td>${escapeHtml(item.callB.validatedJudgment?.effectIfTrue ?? "—")}</td>
      <td>${escapeHtml(item.selection.finalAssertion?.sourceName ?? "—")}</td>
      <td>${escapeHtml(item.disposition.terminalReason)}</td>
    </tr>
    <tr><td></td><td colspan="6"><details>
      <summary>Complete discovery-to-selection trace and tuple-review scaffold</summary>
      <h4>Call A and host preparation</h4>
      <pre>${escapeHtml(JSON.stringify({
        rawCallA: item.discovery.rawCallA,
        hostPrepared: item.hostPreparation,
      }, null, 2))}</pre>
      <h4>Call B, validation, and selection</h4>
      <pre>${escapeHtml(JSON.stringify({
        rawCallB: item.callB.rawOutput,
        validatedJudgment: item.callB.validatedJudgment,
        rejection: item.callB.rejection,
        selection: item.selection,
        disposition: item.disposition,
      }, null, 2))}</pre>
      <h4>Observed discourse tuple</h4>
      <pre>${escapeHtml(JSON.stringify(tuple.observed, null, 2))}</pre>
      <h4>Relevant source units</h4>
      <pre>${escapeHtml(unitText)}</pre>
    </details></td></tr>`;
  }).join("\n");
  const dispositions = Object.groupBy
    ? Object.groupBy(trace.candidates, (item) => item.disposition.terminalStatus)
    : trace.candidates.reduce((groups, item) => {
      const key = item.disposition.terminalStatus;
      (groups[key] ??= []).push(item);
      return groups;
    }, {});
  return `<section id="${escapeHtml(inventory.fixtureId)}">
    <h2>${escapeHtml(inventory.fixtureId)} · ${escapeHtml(inventory.article.title)}</h2>
    <p><strong>Legacy atomic thesis:</strong>
      ${escapeHtml(inventory.observedOrientation.legacyThesisAssertion)}</p>
    <p>${inventory.candidates.length} frozen candidates ·
      ${(dispositions.selected ?? []).length} selected ·
      ${(dispositions.quarantined ?? []).length} quarantined ·
      ${(dispositions.ineligible_not_selected ?? []).length} semantically excluded ·
      ${(dispositions.eligible_not_selected ?? []).length} eligible but not selected</p>
    <details><summary>Article-position-map review scaffold</summary>
      <pre>${escapeHtml(JSON.stringify(positionReview, null, 2))}</pre>
    </details>
    <table><thead><tr><th>ID</th><th>Terminal status</th><th>Call A assertion</th>
      <th>Treatment</th><th>Legacy effect</th><th>Final source</th><th>Reason</th>
      </tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

const manifestEntries = [];
const renderedSections = [];

for (const fixtureId of fixtureIds) {
  const sourceResultPath = path.join(sourceSuite, fixtureId, "result.json");
  const fixturePath = path.join(
    root,
    "backend/test/claim-foundry/fixtures",
    fixtureId,
    "article.json",
  );
  const fixtureMetadataPath = path.join(
    root,
    "backend/test/claim-foundry/fixtures",
    fixtureId,
    "fixture-metadata.json",
  );
  const evaluationKeyPath = path.join(
    root,
    "backend/test/claim-foundry/prompt-evaluation-keys",
    `${fixtureId}.json`,
  );
  const sourceBytes = readFileSync(sourceResultPath);
  const result = JSON.parse(sourceBytes);
  const rawFixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const rawArticle = rawFixture.article ?? rawFixture;
  const { sourceUnits } = prepareCf2Article(rawArticle);
  const rawCallA = result.calls.callA.rawOutput;
  if (rawCallA.candidates.length !== result.candidates.length) {
    throw new Error(`${fixtureId} Call A count differs from prepared inventory`);
  }
  const judgmentById = new Map(result.candidateJudgments.map((item) =>
    [item.candidateId, item]));
  const rejectionById = new Map(result.candidateRejections.map((item) =>
    [item.candidateId, item]));
  const selectedById = new Map(result.assertions.map((item) =>
    [item.candidateId, item]));
  const rawCallBById = new Map((result.calls.callB.rawOutput.assertions ?? [])
    .map((item) => [item.candidateId, item]));

  const inventory = {
    schemaVersion: "cf2.frozenCandidateInventory.v1",
    freezeId,
    fixtureId,
    frozenAt: "2026-07-24",
    source: {
      architecture: result.architecture,
      resultPath: path.relative(root, sourceResultPath),
      resultSha256: sha256(sourceBytes),
      generatedAt: result.generatedAt,
      callA: {
        requestedModel: result.calls.callA.requestedModel,
        returnedModel: result.calls.callA.returnedModel,
        responseId: result.calls.callA.responseId,
        systemFingerprint: result.calls.callA.systemFingerprint,
        promptSha256: result.calls.callA.promptSha256,
        schemaSha256: result.calls.callA.schemaSha256,
        rawOutputSha256: sha256(JSON.stringify(rawCallA)),
      },
      fixtureMetadataPath: path.relative(root, fixtureMetadataPath),
      fixtureMetadataSha256: hashFile(fixtureMetadataPath),
      evaluationKeyPath: path.relative(root, evaluationKeyPath),
      evaluationKeySha256: hashFile(evaluationKeyPath),
    },
    article: result.article,
    observedOrientation: {
      legacyThesisAssertion: result.thesisAssertion,
    },
    sourceUnits: sourceUnits.map(compactUnit),
    rawCallAOutput: rawCallA,
    candidates: result.candidates.map((candidate, index) => ({
      candidateId: candidate.candidateId,
      rawCallA: rawCallA.candidates[index],
      surfaceAssertion: candidate.surfaceAssertion ?? candidate.rawAssertion,
      hostPreparedAssertion: candidate.rawAssertion,
      groundingUnitIds: candidate.groundingUnitIds,
      groundingAudit: candidate.groundingAudit ?? null,
      contextUnitIds: candidate.contextUnits.map((unit) => unit.unitId),
      currentWorkFrameAudit: candidate.currentWorkFrameAudit ?? null,
      attributionCues: candidate.attributionCues ?? [],
    })),
  };

  const inventoryPath = path.join(frozenDir, `${fixtureId}.inventory.json`);
  writeJson(inventoryPath, inventory);
  const inventorySha256 = hashFile(inventoryPath);

  const trace = {
    schemaVersion: "cf2.candidateLineageTrace.v1",
    freezeId,
    fixtureId,
    frozenInventorySha256: inventorySha256,
    sourceResultSha256: inventory.source.resultSha256,
    candidates: inventory.candidates.map((candidate) => {
      const judgment = judgmentById.get(candidate.candidateId) ?? null;
      const rejection = rejectionById.get(candidate.candidateId) ?? null;
      const selected = selectedById.get(candidate.candidateId) ?? null;
      return {
        candidateId: candidate.candidateId,
        discovery: {
          rawCallA: candidate.rawCallA,
          assignedCandidateId: candidate.candidateId,
        },
        hostPreparation: {
          surfaceAssertion: candidate.surfaceAssertion,
          hostPreparedAssertion: candidate.hostPreparedAssertion,
          groundingUnitIds: candidate.groundingUnitIds,
          groundingAudit: candidate.groundingAudit,
          contextUnitIds: candidate.contextUnitIds,
          currentWorkFrameAudit: candidate.currentWorkFrameAudit,
          attributionCues: candidate.attributionCues,
        },
        callB: {
          rawOutput: rawCallBById.get(candidate.candidateId) ?? null,
          validatedJudgment: judgment,
          rejection,
        },
        selection: {
          selected: Boolean(selected),
          selectionBasis: selected?.selectionBasis ?? null,
          finalAssertion: selected,
        },
        disposition: candidateDisposition(
          candidate.candidateId,
          judgment,
          rejection,
          selected,
        ),
      };
    }),
  };
  const tracePath = path.join(tracesDir, `${fixtureId}.trace.json`);
  writeJson(tracePath, trace);

  const tupleItems = inventory.candidates.map((candidate) => {
    const judgment = judgmentById.get(candidate.candidateId) ?? null;
    const rawCallB = rawCallBById.get(candidate.candidateId) ?? null;
    return {
      candidateId: candidate.candidateId,
      ...blankTupleReview(observedTuple(candidate, judgment, rawCallB, result.article)),
    };
  });
  const tupleReviewTemplate = {
    schemaVersion: "cf2.discourseTupleReview.v1",
    fixtureId,
    freezeId,
    frozenInventorySha256: inventorySha256,
    instructions: "Review the observed tuple field by field. Correct the tuple only from the frozen article units. Do not use outside evidence or the sealed evaluation key as assertion text.",
    items: tupleItems,
  };
  const tupleReviewPath = path.join(
    reviewsDir,
    `${fixtureId}.discourse-tuples.review.json`,
  );
  const tupleReview = writeReviewTemplate(tupleReviewPath, tupleReviewTemplate);

  const positionReviewTemplate = {
    schemaVersion: "cf2.articlePositionMapReview.v1",
    fixtureId,
    freezeId,
    frozenInventorySha256: inventorySha256,
    instructions: "Define atomic article positions or central factual payloads from the frozen article. Then review treatment, target-specific effect, relevance, and selection independently for every candidate.",
    observedPositionMap: {
      source: "CF2 V7 legacy single atomic thesis",
      articleMode: null,
      positions: [{
        positionId: "LEGACY_SINGLE_THESIS",
        coreQuestion: null,
        articlePosition: result.thesisAssertion,
        positionUnitIds: [],
        importance: "unresolved",
      }],
    },
    review: {
      status: "unreviewed",
      mapQuality: {
        coverage: "not_reviewed",
        atomicity: "not_reviewed",
        direction: "not_reviewed",
        genreFit: "not_reviewed",
      },
      correctedArticleMode: "unreviewed",
      correctedPositions: [],
      notes: "",
    },
    candidateReviews: inventory.candidates.map((candidate) =>
      blankPositionReview(
        candidate.candidateId,
        judgmentById.get(candidate.candidateId),
        selectedById.get(candidate.candidateId),
        rejectionById.get(candidate.candidateId),
      )),
  };
  const positionReviewPath = path.join(
    reviewsDir,
    `${fixtureId}.article-position-map.review.json`,
  );
  const positionReview = writeReviewTemplate(
    positionReviewPath,
    positionReviewTemplate,
  );

  const observedPrediction = {
    schemaVersion: "cf2.frozenObservedPrediction.v1",
    fixtureId,
    freezeId,
    frozenInventorySha256: inventorySha256,
    articlePositions: [{
      positionId: "LEGACY_SINGLE_THESIS",
      coreQuestion: null,
      articlePosition: result.thesisAssertion,
      positionUnitIds: [],
    }],
    candidateOutputs: inventory.candidates.map((candidate) => {
      const judgment = judgmentById.get(candidate.candidateId) ?? null;
      const selected = selectedById.get(candidate.candidateId) ?? null;
      const rawCallB = rawCallBById.get(candidate.candidateId) ?? null;
      return {
        candidateId: candidate.candidateId,
        discourseTuple: observedTuple(candidate, judgment, rawCallB, result.article),
        articleTreatment: judgment?.articleTreatment ?? null,
        targetEffects: judgment
          ? [{
              positionId: "LEGACY_SINGLE_THESIS",
              effectIfTrue: judgment.effectIfTrue,
            }]
          : [],
        relevance: null,
        selected: Boolean(selected),
        selectionBasis: selected?.selectionBasis ?? null,
      };
    }),
  };
  const observedPath = path.join(
    observedDir,
    `${fixtureId}.observed-prediction.json`,
  );
  writeJson(observedPath, observedPrediction);

  manifestEntries.push({
    fixtureId,
    sourceResultPath: path.relative(root, sourceResultPath),
    sourceResultSha256: inventory.source.resultSha256,
    inventoryPath: path.relative(here, inventoryPath),
    inventorySha256,
    tracePath: path.relative(here, tracePath),
    traceSha256: hashFile(tracePath),
    discourseTupleReviewPath: path.relative(here, tupleReviewPath),
    articlePositionMapReviewPath: path.relative(here, positionReviewPath),
    observedPredictionPath: path.relative(here, observedPath),
    observedPredictionSha256: hashFile(observedPath),
    candidateCount: inventory.candidates.length,
    validJudgmentCount: result.candidateJudgments.length,
    quarantineCount: result.candidateRejections.length,
    selectedCount: result.assertions.length,
  });
  renderedSections.push(renderFixtureSection(
    inventory,
    trace,
    tupleReview,
    positionReview,
  ));
}

const manifest = {
  schemaVersion: "cf2.frozenEvaluationManifest.v1",
  freezeId,
  frozenAt: "2026-07-24",
  sourceSuitePath: path.relative(root, sourceSuite),
  purpose: "Frozen evaluation of discourse tuples, article position maps, treatment, target-specific effect, relevance, and selection.",
  fixtures: manifestEntries,
};
writeJson(path.join(frozenDir, "manifest.json"), manifest);

const report = `<!doctype html><html><head><meta charset="utf-8">
<title>CF2 frozen evaluation apparatus v1</title>
<style>
body{font:14px system-ui;margin:24px;color:#17202a;max-width:1800px}
table{border-collapse:collapse;width:100%;margin:12px 0 30px}
th,td{border:1px solid #ccd3d8;padding:7px;vertical-align:top;text-align:left}
th{background:#edf1f4}.selected td{background:#eef8ef}
.quarantined td{background:#ffe8e8}.excluded td{background:#f6f6f6}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f7;padding:12px;max-height:600px;overflow:auto}
details{margin:10px 0}summary{cursor:pointer;font-weight:700}
.meta{background:#eef5ff;border:1px solid #9ebce0;padding:12px}
nav a{margin-right:14px}
</style></head><body>
<h1>CF2 frozen evaluation apparatus v1</h1>
<div class="meta">Freeze: <strong>${escapeHtml(freezeId)}</strong><br>
Source suite: ${escapeHtml(path.relative(root, sourceSuite))}<br>
The review dimensions are independent. This apparatus emits no composite score.<br>
Guide: <a href="REVIEW_GUIDE.md">REVIEW_GUIDE.md</a> ·
Manifest: <a href="frozen/manifest.json">frozen/manifest.json</a></div>
<nav><a href="#CF1-F01">F01</a><a href="#CF1-F03">F03</a>
<a href="#CF1-F08">F08</a></nav>
<h2>Review dimensions</h2>
<ol>
<li>Discourse-tuple correctness: surface, layers, substantive assertion, grounding, supplier, verification target.</li>
<li>Article-position-map quality: coverage, atomicity, direction, and genre fit.</li>
<li>Article treatment.</li>
<li>Effect relative to a named article position.</li>
<li>Portfolio relevance.</li>
<li>Final selection.</li>
</ol>
${renderedSections.join("\n")}
</body></html>`;
writeFileSync(path.join(here, "report.html"), report);
console.log(path.join(here, "report.html"));
