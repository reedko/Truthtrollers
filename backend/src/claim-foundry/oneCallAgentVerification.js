import { Cf1Error } from "./errors.js";

const VERB = /\b(?:is|are|was|were|has|have|had|begins?|began|shows?|showed|finds?|found|includes?|included|evaluates?|evaluated|concludes?|concluded|causes?|caused|contributes?|contributed|increases?|increased|decreases?|decreased|differs?|differed|predicts?|predicted|requires?|required|contains?|contained|supports?|supported|rejects?|rejected|strikes?|struck|shakes?|shook|issues?|issued|reports?|reported|occurs?|occurred)\b/i;
const GENERIC = /^(?:future|further|other) studies|^evidence (?:emerges|shows)|^a single study|\bsmall sample\b|\bunverified\b/i;
const NEGATIVE = /\b(?:no|not|never|neither|similar|same|reject(?:s|ed)|lack(?:s|ed)?|excludes?|excluded|did not|does not|was not|were not)\b|non-significant/i;
const OBJECTIVE_ONLY = /\b(?:investigates?|examines?|explores?|discusses?|addresses?|focuses? on)\b/i;
const CAUSAL = /\b(?:caus(?:e|es|ed|al|ation)|leads? to|led to|results? in|resulted in|drives?|drove)\b/i;
const BEARING = /\b(?:article|thesis|pillar|argument|conclusion|interpretation|undermines?|weakens?|challenges?|affects?)\b/i;

function fail(message, path = "/") {
  throw new Cf1Error("CF1_INVALID_ONE_CALL_AGENT_OUTPUT", message, { status: 422, path });
}

function tokens(value) {
  const stop = new Set(["that", "this", "with", "from", "were", "their", "between",
    "among", "into", "than", "they", "study", "article", "findings"]);
  return new Set((String(value).toLocaleLowerCase().match(/[a-z0-9]{4,}/g) ?? [])
    .filter((word) => !stop.has(word)));
}

function overlap(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return { shared, ratio: shared / Math.max(1, new Set([...a, ...b]).size) };
}

function likelyDuplicate(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared >= 5 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.72;
}

function citedText(item, sourceUnits) {
  const units = new Map((sourceUnits ?? []).map((unit) => [unit.unitId, unit.text]));
  return (item.sourceUnitIds ?? []).map((id) => units.get(id) ?? "").join(" ");
}

function verifyWorks(item, sourceUnits, path) {
  if (!sourceUnits) return;
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit.text]));
  const source = (item.sourceUnitIds ?? []).map((unitId, index) => {
    if (!units.has(unitId)) fail("Unknown source unit", `${path}/sourceUnitIds/${index}`);
    return units.get(unitId);
  }).join("\n").toLocaleLowerCase();
  for (const [index, work] of (item.namedWorkHints ?? []).entries()) {
    if (work.year !== null && !source.includes(String(work.year))) {
      fail("Named-work year is not present in its cited source units", `${path}/namedWorkHints/${index}/year`);
    }
    for (const [identifierIndex, identifier] of (work.identifiers ?? []).entries()) {
      if (!source.includes(String(identifier).toLocaleLowerCase())) fail(
        "Named-work identifier is not present in its cited source units",
        `${path}/namedWorkHints/${index}/identifiers/${identifierIndex}`);
    }
  }
}

function verifySelected(item, index, sourceUnits) {
  const path = `/selectedClaims/${index}`;
  if (item.materiality === "low") fail("Selected claims cannot be low-materiality", `${path}/materiality`);
  if (!item.sourceUnitIds?.length) fail("Selected claim needs source unit grounding", `${path}/sourceUnitIds`);
  if (sourceUnits) {
    const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit.text]));
    const cited = item.sourceUnitIds.map((unitId) => units.get(unitId) ?? "").join(" ");
    if (overlap(item.claimText, cited).shared < 3) {
      fail("Selected wording is not materially grounded in its cited source units", `${path}/sourceUnitIds`);
    }
  }
  if (!VERB.test(item.claimText)) fail("Selected claim must be a complete falsifiable proposition", `${path}/claimText`);
  if (!BEARING.test(item.themeBearing)) fail(
    "themeBearing must explain the consequence for the article, thesis, or pillar", `${path}/themeBearing`);
  if (item.claimMode !== "attribution" && NEGATIVE.test(item.claimText)) {
    if (!NEGATIVE.test(item.claimTrueIf) || NEGATIVE.test(item.claimFalseIf)) {
      fail("True/false conditions reverse a negative target", `${path}/claimTrueIf`);
    }
  }
  for (const field of ["claimTrueIf", "claimFalseIf"]) {
    if (GENERIC.test(item[field])) fail(`${field} is generic rather than target-specific`, `${path}/${field}`);
  }
  if (item.claimMode === "attribution"
    && /^(?:the )?(?:article|authors?|study)$/i.test(item.assertionSource)) {
    fail("Attribution claim must name its actual assertion source", `${path}/assertionSource`);
  }
  if (item.claimMode === "attribution" && /\b(?:study|report|review|dataset|law|filing|transcript)\b/i.test(item.claimText)
    && !(item.namedWorkHints ?? []).length) {
    fail("Attributed work needs a named-work hint", `${path}/namedWorkHints`);
  }
  verifyWorks(item, sourceUnits, path);
}

function verifyThemeGate(output, sourceUnits) {
  const orientation = output?.orientation ?? {};
  const pillars = orientation.pillars ?? [];
  if (OBJECTIVE_ONLY.test(orientation.theme)) fail(
    "Theme states an objective or topic rather than the article's conclusion", "/orientation/theme");
  if (!VERB.test(orientation.theme)) fail(
    "Theme must state the article's argumentative point, not merely name its topic", "/orientation/theme");
  if (!VERB.test(orientation.thesis)) fail("Thesis must be a complete proposition", "/orientation/thesis");
  const labels = new Set();
  for (const [index, pillar] of pillars.entries()) {
    const label = pillar.label?.trim().toLocaleLowerCase();
    if (!label || labels.has(label)) fail("Pillar labels must be unique", `/orientation/pillars/${index}/label`);
    labels.add(label);
    if (!VERB.test(pillar.text)) fail("Pillar must be a proposition, not a topic heading",
      `/orientation/pillars/${index}/text`);
  }
  const covered = new Set();
  for (const [index, claim] of (output.selectedClaims ?? []).entries()) {
    if (!claim.relatedPillarLabels?.length) fail("Selected claim must bear on at least one pillar",
      `/selectedClaims/${index}/relatedPillarLabels`);
    for (const [labelIndex, label] of claim.relatedPillarLabels.entries()) {
      const normalized = label.trim().toLocaleLowerCase();
      if (!labels.has(normalized)) fail("Selected claim references an unknown pillar label",
        `/selectedClaims/${index}/relatedPillarLabels/${labelIndex}`);
      covered.add(normalized);
    }
  }
  const selected = output.selectedClaims ?? [];
  for (let left = 0; left < selected.length; left += 1) {
    for (let right = left + 1; right < selected.length; right += 1) {
      if (likelyDuplicate(selected[left].claimText, selected[right].claimText)) fail(
        "Selected portfolio contains near-duplicate propositions", `/selectedClaims/${right}/claimText`);
    }
  }
  const groundedCausal = (claim) => CAUSAL.test(claim.claimText)
    && CAUSAL.test(citedText(claim, sourceUnits));
  if ((CAUSAL.test(orientation.theme) || CAUSAL.test(orientation.thesis))
    && !selected.some((claim) => claim.articleRole === "thesis" && groundedCausal(claim))) fail(
    "Causal theme or thesis needs a causal thesis claim grounded in its cited source units",
    "/orientation/theme");
  for (const [index, pillar] of pillars.entries()) {
    if (CAUSAL.test(pillar.text) && !selected.some((claim) =>
      claim.relatedPillarLabels.some((label) => label.trim().toLocaleLowerCase()
        === pillar.label.trim().toLocaleLowerCase()) && groundedCausal(claim))) fail(
      "Causal pillar needs a causal selected claim grounded in its cited source units",
      `/orientation/pillars/${index}`);
  }
  for (const [index, pillar] of pillars.entries()) {
    if (["load_bearing", "major"].includes(pillar.importance)
      && !covered.has(pillar.label.trim().toLocaleLowerCase())) fail(
      "Every load-bearing or major pillar needs a selected evidence task",
      `/orientation/pillars/${index}`);
  }
}

function verifyRevision(candidates, selected, findings, trace) {
  const initial = new Set(candidates.map((item) => item.claimText.trim().toLocaleLowerCase()));
  const revised = new Set(selected.map((item) => item.claimText.trim().toLocaleLowerCase()));
  const findingTypes = new Set(findings.map((item) => item.type));
  const addressed = new Set();
  trace.forEach((item, index) => {
    const path = `/revisionTrace/${index}`;
    if (!findingTypes.has(item.findingType)) fail("Revision references an unknown critic finding type", `${path}/findingType`);
    addressed.add(item.findingType);
    const before = item.beforeClaimText?.trim().toLocaleLowerCase() ?? null;
    const after = item.afterClaimText?.trim().toLocaleLowerCase() ?? null;
    if (item.action === "drop" && (after !== null || !initial.has(before) || revised.has(before))) {
      fail("Drop must cite an omitted initial claim and have null after text", path);
    }
    if (item.action === "add" && (before !== null || !revised.has(after))) fail("Add must have null before text and cite a selected claim", path);
    if (item.action === "rewrite" && (!initial.has(before) || !revised.has(after)
      || initial.has(after) || before === after || overlap(before, after).ratio < 0.2)) {
      fail("rewrite must transform its cited initial proposition into a new selected wording", path);
    }
    if (item.action === "merge" && (!initial.has(before) || !revised.has(after)
      || revised.has(before) || before === after
      || (!initial.has(after) && overlap(before, after).ratio < 0.2))) {
      fail("merge must remove its cited initial claim into one selected proposition", path);
    }
    if (item.action === "replace" && (!initial.has(before) || !initial.has(after)
      || !revised.has(after) || revised.has(before) || before === after)) {
      fail("replace must exchange one initial claim for another selected initial claim", path);
    }
  });
  if (!addressed.size) fail("At least one critic finding must drive an actual revision action", "/revisionTrace");
  if (initial.size === revised.size && [...initial].every((text) => revised.has(text))) {
    fail("Revised selected claims must differ from the initial inventory", "/selectedClaims");
  }
  if (candidates.length >= 12 && selected.length > candidates.length - 2) {
    fail("Full-article revision must omit at least two initial candidates", "/selectedClaims");
  }
}

export function verifyOneCallAgentOutput(output, { minimumInitial = 1, minimumSelected = 1,
  sourceUnits = null } = {}) {
  const candidates = output?.initialCandidates ?? [];
  const selected = output?.selectedClaims ?? [];
  const findings = output?.critic?.findings ?? [];
  if (candidates.length < minimumInitial || candidates.length > 20) fail(`Initial inventory must contain ${minimumInitial}-20 candidates`, "/initialCandidates");
  if (selected.length < minimumSelected || selected.length > 12) fail(`Revised portfolio must contain ${minimumSelected}-12 claims`, "/selectedClaims");
  if (!selected.some((item) => item.articleRole === "thesis")) fail("Revised portfolio needs a thesis claim", "/selectedClaims");
  if (!findings.length) fail("Semantic critic must produce at least one finding", "/critic/findings");
  candidates.forEach((item, index) => verifyWorks(item, sourceUnits, `/initialCandidates/${index}`));
  selected.forEach((item, index) => verifySelected(item, index, sourceUnits));
  verifyThemeGate(output, sourceUnits);
  verifyRevision(candidates, selected, findings, output.revisionTrace ?? []);
  return output;
}
