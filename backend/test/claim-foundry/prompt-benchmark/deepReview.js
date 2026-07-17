// Deep review rows (render-spec v2): re-renders EXISTING raw artifacts into
// per-claim rows with [C1]/[C2]/[HOST] provenance, grounding excerpts, and
// failure classifications. Display-only; no new inputs enter generation.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CF1_STRATEGY_FIELDS } from "../../../src/claim-foundry/evidenceStrategyMap.js";
import { prepareArticle } from "./generationRun.js";

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

// R4: failure class + stage, from the provenance error and the agent trace.
export function classifyFailure(error, trace) {
  if (!error) return null;
  // Host verification runs between model-call steps and is not itself a trace
  // step, so known codes map to their stage directly; otherwise use the failed
  // step, then the stage reached (last completed step).
  const STAGE_BY_CODE = {
    CF1_AGENT_SEMANTIC_INVALID: "semantic_inventory_verification",
    CF1_MISSING_PILLAR_COVERAGE: "host_selection",
    CF1_INSUFFICIENT_SELECTED_CLAIMS: "host_selection",
    CF1_AGENT_ENRICHMENT_INVALID: "selected_claim_enrichment_verification",
    CF1_VERIFICATION_FAILED: "package_verification",
  };
  const steps = trace?.steps ?? [];
  const failedStep = steps.find((step) => step.status === "failed");
  const lastCompleted = [...steps].reverse().find((step) => step.status === "completed");
  const stage = STAGE_BY_CODE[error.code] ?? failedStep?.stage
    ?? (lastCompleted ? `after_${lastCompleted.stage}` : "unknown");
  const klass = /BUDGET|TOKEN/.test(error.code ?? "") ? "token_ceiling"
    : /TIMEOUT/.test(error.code ?? "") ? "timeout"
      : /UNAVAILABLE|TRANSPORT/.test(error.code ?? "") ? "transport"
        : /SEMANTIC_INVALID|ENRICHMENT_INVALID|INVALID_STRUCTURED/.test(error.code ?? "")
          ? "schema_invalid" : "verification_failed";
  return { failureClass: klass, failureStage: stage, errorCode: error.code ?? null,
    errorMessage: error.message ?? null };
}

const strategyBySourceTypes = new Map(Object.entries(CF1_STRATEGY_FIELDS)
  .map(([name, fields]) => [JSON.stringify(fields.sourceTypes), name]));

function excerpt(unitIds, unitsById, wordCap = 600) {
  const units = (unitIds ?? []).map((id) => ({ id, text: unitsById.get(id) ?? "(unit not found)" }));
  const total = units.reduce((sum, unit) => sum + unit.text.split(/\s+/).length, 0);
  if (total <= wordCap) return units.map((unit) => `[${unit.id}] ${unit.text}`).join("\n");
  return units.map((unit) => {
    const firstSentence = unit.text.split(/(?<=[.!?])\s+/)[0] ?? unit.text;
    return `[${unit.id}] ${firstSentence} …`;
  }).join("\n") + "\n(excerpted: full units exceed the display cap — look up unit IDs)";
}

function claimRow({ base, selected, enriched, packageClaim, card, unitsById }) {
  const modelReject = enriched?.rejectIfOnly ?? [];
  const cardReject = card?.bearingCriteria?.rejectIfOnly ?? [];
  const emitted = enriched?.sourceStrategy ?? null;
  const resolved = card ? (strategyBySourceTypes.get(JSON.stringify(card.bestSourceTypes)) ?? null) : null;
  const supported = selected.ifSupportedEffect ?? null;
  const refuted = selected.ifRefutedEffect ?? null;
  const transformCheck = selected.scoreTransformCheck ?? null;
  const expectedTransform = supported === "weakens" && refuted === "strengthens" ? "invert"
    : supported === "strengthens" && refuted === "weakens" ? "normal"
      : supported === "unchanged" && refuted === "unchanged" ? "none" : "unresolved";
  return { ...base,
    origin: selected.origin ?? "model",
    claimText: selected.claimText,
    articleRole: selected.articleRole, articleUse: selected.articleUse,
    assertionSource: selected.assertionSource, materiality: selected.materiality,
    propositionCore: selected.propositionCore ?? null,
    ifSupportedEffect: supported, ifRefutedEffect: refuted,
    scoreTransformCheck: transformCheck, expectedTransform,
    transformConsistent: transformCheck ? transformCheck === expectedTransform : null,
    scope: selected.scope, relatedPillarLabels: selected.relatedPillarLabels ?? [],
    sourceUnitIds: selected.sourceUnitIds ?? [],
    evidenceUsefulnessHint: selected.evidenceUsefulnessHint ?? null,
    groundingText: excerpt(selected.sourceUnitIds, unitsById),
    revisedClaimText: enriched ? (enriched.revisedClaimText ?? "null — unchanged") : null,
    verificationTarget: enriched?.disputedQuestion?.verificationTarget ?? null,
    disputedProposition: enriched?.disputedQuestion?.disputedProposition ?? null,
    stipulatedByArticle: enriched?.disputedQuestion?.stipulatedByArticle ?? null,
    whyThisTarget: enriched?.disputedQuestion?.whyThisTarget ?? null,
    warrant: enriched?.warrant ?? card?.warrant ?? packageClaim?.warrant ?? null,
    supportCriteria: enriched?.supportCriteria ?? [], refuteCriteria: enriched?.refuteCriteria ?? [],
    qualifyCriteria: enriched?.qualifyCriteria ?? [], mustMatch: enriched?.mustMatch ?? [],
    rejectIfOnly_model: modelReject,
    rejectIfOnly_host: cardReject.filter((entry) => !modelReject.includes(entry)),
    sourceStrategy_emitted: emitted, sourceStrategy_resolved: resolved,
    hostStrategyOverride: Boolean(emitted && resolved && emitted !== resolved),
    searchConcepts: enriched?.searchConcepts ?? [],
    relevantNamedWorkIds: enriched?.relevantNamedWorkIds ?? [],
    cautions: enriched?.cautions ?? [],
    gradeTarget: packageClaim?.gradeTarget ?? null,
    scoreTransform: packageClaim?.scoreTransform ?? null,
    verificationQuestion: card?.falsifiability?.verificationQuestion ?? null,
    hostWarnings: card?.warnings ?? [],
  };
}

function call1ClaimRow({ base, selected, diagnostic, unitsById }) {
  const supported = diagnostic?.ifSupportedEffect ?? null;
  const refuted = diagnostic?.ifRefutedEffect ?? null;
  const transform = diagnostic?.scoreTransformCheck ?? null;
  const expectedTransform = supported === "weakens" && refuted === "strengthens" ? "invert"
    : supported === "strengthens" && refuted === "weakens" ? "normal"
      : supported === "unchanged" && refuted === "unchanged" ? "none" : "unresolved";
  return { ...claimRow({ base, selected: { ...selected, origin: "model" },
    enriched: null, packageClaim: null, card: null, unitsById }),
    propositionCore: diagnostic?.propositionCore ?? null,
    ifSupportedEffect: supported,
    ifRefutedEffect: refuted,
    scoreTransformCheck: transform,
    assertionSourceKind: diagnostic?.assertionSourceKind ?? null,
    assertionSourceName: diagnostic?.assertionSourceName ?? null,
    expectedTransform,
    transformConsistent: transform && expectedTransform ? transform === expectedTransform : null,
  };
}

// Collect one row per claim across every run of a phase. Profile identities are
// replaced by opaque labels at collection time so downstream renderers cannot
// leak them.
export function collectDeepRows({ benchmarkDir, phase, manifest, labelsByProfile }) {
  const rows = [];
  const orientations = [];
  for (const run of manifest.runs) {
    const profileLabel = labelsByProfile.get(run.pairProfileId);
    if (!profileLabel) throw new Error(`No opaque label for a run profile (repeat ${run.repeat})`);
    const dir = path.join(benchmarkDir, "raw", phase, run.fixtureId, run.pairProfileId,
      String(run.repeat));
    const inner = readdirSync(dir).filter((name) => name.startsWith("cf1run_"))
      .map((name) => path.join(dir, name))[0] ?? null;
    const trace = inner ? readJson(path.join(inner, "cf1_agent_trace.json")) : null;
    const failure = run.status === "completed" ? null : classifyFailure(run.error ?? {}, trace);
    const verification = readJson(path.join(dir, "verification.json"));
    const base = { fixture: run.fixtureId, repeat: run.repeat, profile: profileLabel,
      runStatus: run.status, failureClass: failure ? `${failure.failureClass}:${failure.failureStage}` : "",
      packageValid: manifest.mode === "call1" ? null : verification?.valid ?? false };
    const call1Article = manifest.mode === "call1"
      ? readJson(path.resolve("backend/test/claim-foundry/fixtures", run.fixtureId, "article.json"))
      : null;
    const article = inner ? readJson(path.join(inner, "article.json")) : call1Article;
    const unitsById = article
      ? new Map(prepareArticle(article).articleDocument.sourceUnits
        .map((unit) => [unit.unitId, unit.text]))
      : new Map();
    const call1Raw = manifest.mode === "call1"
      ? readJson(path.join(dir, "semantic-inventory.model-raw.json")) : null;
    const inventory = inner ? readJson(path.join(inner, "semantic_inventory.json"))
      : manifest.mode === "call1"
        ? readJson(path.join(dir, "semantic-inventory.verified-pre-host.json")) : null;
    const orientation = inner ? readJson(path.join(inner, "article_orientation.json")) : null;
    orientations.push({ fixture: run.fixtureId, repeat: run.repeat, profile: profileLabel,
      runStatus: run.status, failure,
      theme: orientation?.theme ?? inventory?.theme?.text ?? null,
      thesis: orientation?.thesis ?? inventory?.thesis?.text ?? null,
      thesisHinge: inventory?.thesisHinge ?? null,
      pillars: (orientation?.pillars ?? inventory?.pillars ?? []).map((pillar) =>
        ({ label: pillar.label, importance: pillar.importance })),
      opponentScan: call1Raw?.opponentScan ?? [],
      call1CandidateCount: inventory?.candidateClaims?.length ?? null });
    if (manifest.mode === "call1") {
      if (inventory?.candidateClaims?.length) {
        inventory.candidateClaims.forEach((candidate, index) => rows.push(call1ClaimRow({ base,
          selected: candidate, diagnostic: call1Raw?.candidateClaims?.[index] ?? null, unitsById })));
      } else {
        rows.push({ ...base, origin: "", claimText: failure
          ? `(no verified inventory — ${failure.errorCode}: ${failure.errorMessage})`
          : "(no verified inventory)", groundingText: "", sourceUnitIds: [] });
      }
      continue;
    }
    if (run.status !== "completed") {
      if (inventory?.candidateClaims?.length) {
        // Call 1 reached and verified; later stage failed. Render the model's
        // pre-selection candidates as [C1]-only rows.
        for (const candidate of inventory.candidateClaims) {
          rows.push(claimRow({ base, selected: { ...candidate, origin: "model" },
            enriched: null, packageClaim: null, card: null, unitsById }));
        }
      } else {
        rows.push({ ...base, origin: "", claimText: `(no inventory — ${failure.errorCode}: ${failure.errorMessage})`,
          groundingText: "", sourceUnitIds: [] });
      }
      continue;
    }
    const critic = readJson(path.join(inner, "critic_report.json"));
    const enrichment = readJson(path.join(inner, "selected_enrichment.json"));
    const pkg = readJson(path.join(dir, "claim-package.json"));
    const enrichedById = new Map((enrichment?.enrichedClaims ?? [])
      .map((item) => [item.candidateId, item]));
    (critic?.selectedClaims ?? []).forEach((selected, index) => {
      rows.push(claimRow({ base, selected,
        enriched: enrichedById.get(selected.candidateId) ?? null,
        packageClaim: pkg?.selectedEvaluationClaims?.[index] ?? null,
        card: pkg?.evidenceNeedCards?.[index] ?? null, unitsById }));
    });
  }
  return { rows, orientations };
}

export const CSV_COLUMNS = ["fixture", "repeat", "profile", "origin", "runStatus",
  "failureClass", "propositionCore", "claimText", "articleRole", "articleUse", "assertionSource",
  "assertionSourceKind", "assertionSourceName", "ifSupportedEffect", "ifRefutedEffect",
  "scoreTransformCheck", "expectedTransform", "transformConsistent", "materiality",
  "scope", "relatedPillarLabels", "sourceUnitIds", "groundingText", "verificationTarget",
  "disputedProposition", "stipulatedByArticle", "whyThisTarget", "warrant", "supportCriteria",
  "refuteCriteria", "qualifyCriteria", "mustMatch", "rejectIfOnly_model", "rejectIfOnly_host",
  "sourceStrategy_emitted", "sourceStrategy_resolved", "searchConcepts",
  "relevantNamedWorkIds", "cautions", "packageValid"];

export function rowsToCsv(rows) {
  const cell = (value) => {
    const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  };
  return [CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => cell(row[column])).join(","))].join("\n") + "\n";
}
