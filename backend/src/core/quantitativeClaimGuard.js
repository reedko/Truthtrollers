const NUMBER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["hundred", 100],
]);

function normalized(value) {
  return String(value || "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

function numberValue(value) {
  const raw = String(value || "").toLowerCase();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return NUMBER_WORDS.get(raw) ?? null;
}

function clauseAt(text, index) {
  const left = Math.max(text.lastIndexOf(".", index), text.lastIndexOf(";", index), text.lastIndexOf("\n", index));
  const rightCandidates = [text.indexOf(".", index), text.indexOf(";", index), text.indexOf("\n", index)]
    .filter((value) => value >= 0);
  const right = rightCandidates.length ? Math.min(...rightCandidates) : text.length;
  return text.slice(left + 1, right).trim();
}

export function extractPrimaryQuantitativeConstraint(value) {
  const text = normalized(value);
  if (!text) return null;

  return extractQuantitativeConstraints(text)[0] || null;
}

export function extractQuantitativeConstraints(value) {
  const text = normalized(value);
  if (!text) return [];
  const constraints = [];
  const add = (match, comparator, numericValue) => {
    if (!match || !Number.isFinite(numericValue)) return;
    constraints.push({
      comparator,
      value: numericValue,
      raw: match[0],
      clause: clauseAt(text, match.index),
      index: match.index,
    });
  };

  const halfPattern = /\b(more than|over|greater than|at least|less than|under|fewer than|at most)\s+(?:one[- ]?)?half\b/g;
  for (const half of text.matchAll(halfPattern)) {
    const comparator = ["more than", "over", "greater than"].includes(half[1]) ? "gt"
      : half[1] === "at least" ? "gte"
        : ["less than", "under", "fewer than"].includes(half[1]) ? "lt" : "lte";
    add(half, comparator, 0.5);
  }

  const percentPattern = /\b(?:about|around|approximately|nearly|roughly)?\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b)/g;
  for (const percent of text.matchAll(percentPattern)) {
    add(percent, "eq", Number(percent[1]) / 100);
  }

  const fractionPattern = /\b(?:about|around|approximately|nearly|roughly)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine)\s+(?:in|out of(?: every)?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|hundred)\b/g;
  for (const fraction of text.matchAll(fractionPattern)) {
    const numerator = numberValue(fraction[1]);
    const denominator = numberValue(fraction[2]);
    if (numerator !== null && denominator) add(fraction, "eq", numerator / denominator);
  }

  const namedFractionPattern = /\b(?:about|around|approximately|nearly|roughly)?\s*(one|two|three)?[- ]?(half|halves|third|thirds|quarter|quarters)\b/g;
  for (const fraction of text.matchAll(namedFractionPattern)) {
    const numerator = fraction[1] ? numberValue(fraction[1]) : 1;
    const denominator = /^half/.test(fraction[2]) ? 2 : /^third/.test(fraction[2]) ? 3 : 4;
    if (numerator !== null) add(fraction, "eq", numerator / denominator);
  }

  return constraints
    .sort((left, right) => left.index - right.index || left.raw.length - right.raw.length)
    .filter((constraint, index, all) => index === 0 || !(
      constraint.index === all[index - 1].index && constraint.value === all[index - 1].value
    ));
}

function metricFor(text, constraint) {
  const full = normalized(text);
  const clause = normalized(constraint?.clause);
  const surgery = /\b(surger(?:y|ies|ical)|intervention|procedure|operation)\b/;
  const heartDefect = /\b(chd|chds|congenital heart|heart defect)/;
  const ageWindow = /\b(under|younger than|less than|below)\b.{0,35}\b(month|months|year|years|age|old)\b/;
  const surgeryPopulation = /\b(children|child|patients?|babies|infants?)\b.{0,55}\b(requiring|undergoing|having|receiving|need(?:ing)?|require[sd]?)\b.{0,30}\b(surger(?:y|ies|ical)|operation|procedure)\b/;

  if (surgeryPopulation.test(full) && ageWindow.test(full)) return "surgery_patient_age_share";
  if (/\bcritical\b/.test(clause) && heartDefect.test(clause) && !surgery.test(clause)) return "critical_chd_share";
  if (heartDefect.test(clause) && surgery.test(clause)) return "chd_surgery_share";
  if (heartDefect.test(clause) && /\b(birth|births|born|newborn)\b/.test(clause)) return "birth_prevalence";
  return "unknown";
}

function compare(task, evidence) {
  const tolerance = Math.max(0.005, Math.abs(task.value) * 0.025);
  if (task.comparator === "gt") return evidence.value > task.value ? "support" : "refute";
  if (task.comparator === "gte") return evidence.value + tolerance >= task.value ? "support" : "refute";
  if (task.comparator === "lt") return evidence.value < task.value ? "support" : "refute";
  if (task.comparator === "lte") return evidence.value - tolerance <= task.value ? "support" : "refute";
  return Math.abs(evidence.value - task.value) <= tolerance ? "support" : "refute";
}

/**
 * Deterministically correct quantitative stance when the task and evidence
 * express comparable measures. If their denominators/metrics differ, prevent
 * a support label but do not invent a refutation.
 */
export function assessQuantitativeClaim({ taskClaimText, evidenceText, proposedStance = null } = {}) {
  const task = extractPrimaryQuantitativeConstraint(taskClaimText);
  if (!task) return null;

  const taskMetric = metricFor(taskClaimText, task);
  const evidenceConstraints = extractQuantitativeConstraints(evidenceText);
  const evidenceCandidates = evidenceConstraints.map((constraint) => ({
    constraint,
    metric: metricFor(evidenceText, constraint),
  }));
  const comparableCandidate = evidenceCandidates.find(({ metric }) => metric === taskMetric && metric !== "unknown");
  const selectedCandidate = comparableCandidate || evidenceCandidates[0] || null;
  const evidence = selectedCandidate?.constraint || null;
  const evidenceMetric = selectedCandidate?.metric || "no_quantitative_constraint";

  if (!evidence) {
    const hasAbsoluteCount = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s+(?:surger(?:y|ies)|procedures?|operations?|patients?|children|babies|infants?|births?)\b/i.test(String(evidenceText || ""));
    return {
      stance: "insufficient",
      comparable: false,
      task,
      evidence: null,
      taskMetric,
      evidenceMetric,
      reason: hasAbsoluteCount
        ? `Quantitative guard: an absolute count without a denominator cannot establish task ${task.comparator} ${Number((task.value * 100).toFixed(3))}% on ${taskMetric}.`
        : `Quantitative guard: evidence provides no percentage or fraction comparable to task ${task.comparator} ${Number((task.value * 100).toFixed(3))}% on ${taskMetric}.`,
      overridesProposedStance: String(proposedStance || "").toLowerCase() === "support",
    };
  }

  if (taskMetric === "unknown" || evidenceMetric === "unknown" || taskMetric !== evidenceMetric) {
    return {
      stance: "insufficient",
      comparable: false,
      task,
      evidence,
      taskMetric,
      evidenceMetric,
      reason: `Quantitative guard: evidence measure ${evidenceMetric} is not comparable to task measure ${taskMetric}; denominator or outcome differs.`,
      overridesProposedStance: String(proposedStance || "").toLowerCase() === "support",
    };
  }

  const stance = compare(task, evidence);
  return {
    stance,
    comparable: true,
    task,
    evidence,
    taskMetric,
    evidenceMetric,
    reason: `Quantitative guard: evidence=${Number((evidence.value * 100).toFixed(3))}% ${stance === "support" ? "satisfies" : "contradicts"} task ${task.comparator} ${Number((task.value * 100).toFixed(3))}% on ${taskMetric}.`,
    overridesProposedStance: Boolean(proposedStance) && stance !== String(proposedStance).toLowerCase(),
  };
}

export function applyQuantitativeStanceGuard({ taskClaimText, evidenceText, proposedStance } = {}) {
  const assessment = assessQuantitativeClaim({ taskClaimText, evidenceText, proposedStance });
  if (!assessment) return null;
  if (!assessment.comparable && String(proposedStance || "").toLowerCase() !== "support") return null;
  return assessment;
}
