// Machine diagnostics + post-lock aggregation (coder plan §10.6). Metrics are
// computed only over what a phase manifest says was run; partial coverage is
// labeled partial.
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
};
const csv = (rows) => rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";

export function runMetricsCsv(manifest) {
  const rows = [["phase", "mode", "profileId", "subject", "repeat", "status",
    "totalTokens", "outputTokens", "elapsedMs", "transportAttempts"]];
  for (const run of manifest.runs) {
    rows.push([manifest.phase, manifest.mode, run.pairProfileId,
      run.fixtureId ?? run.packetId, run.repeat, run.status,
      run.usage?.totalTokens ?? "", run.usage?.outputTokens ?? "",
      run.elapsedMs ?? "", run.transportAttempts ?? ""]);
  }
  return csv(rows);
}

export function coverageSummary(manifest, { expectedSubjects, expectedProfiles }) {
  const ran = new Set(manifest.runs.map((run) =>
    `${run.pairProfileId}::${run.fixtureId ?? run.packetId}`));
  const missing = [];
  for (const profile of expectedProfiles) {
    for (const subject of expectedSubjects) {
      if (!ran.has(`${profile}::${subject}`)) missing.push({ profile, subject });
    }
  }
  return { partial: missing.length > 0, missing };
}

// Candidate-count variance per profile × subject across repeats (Call 1).
export function call1VarianceCsv(runsWithCounts) {
  const groups = new Map();
  for (const run of runsWithCounts) {
    const key = `${run.pairProfileId}::${run.subject}`;
    if (!groups.has(key)) groups.set(key, []);
    if (run.candidateCount != null) groups.get(key).push(run.candidateCount);
  }
  const rows = [["profileId", "subject", "repeats", "minCandidates", "maxCandidates",
    "meanCandidates"]];
  for (const [key, counts] of groups) {
    const [profileId, subject] = key.split("::");
    const mean = counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : "";
    rows.push([profileId, subject, counts.length, Math.min(...counts),
      Math.max(...counts), typeof mean === "number" ? mean.toFixed(2) : ""]);
  }
  return csv(rows);
}

// Post-lock aggregation: join locked scores with the producer key.
export function scoreSummary({ scores, producerKey }) {
  const byProfile = new Map();
  for (const packet of scores.packets ?? []) {
    for (const [label, entry] of Object.entries(packet.profiles ?? {})) {
      const profileId = producerKey[label] ?? label;
      if (!byProfile.has(profileId)) {
        byProfile.set(profileId, { dimensionTotals: {}, dimensionCounts: {},
          targets: { present: 0, partial: 0, absent: 0 } });
      }
      const agg = byProfile.get(profileId);
      for (const [dimension, score] of Object.entries(entry.dimensions ?? {})) {
        if (typeof score !== "number") continue;
        agg.dimensionTotals[dimension] = (agg.dimensionTotals[dimension] ?? 0) + score;
        agg.dimensionCounts[dimension] = (agg.dimensionCounts[dimension] ?? 0) + 1;
      }
      for (const judgment of Object.values(entry.targetJudgments ?? {})) {
        if (judgment in agg.targets) agg.targets[judgment] += 1;
      }
    }
  }
  const rows = [["profileId", "dimension", "meanScore", "n"]];
  const recall = [["profileId", "present", "partial", "absent", "recallRate"]];
  for (const [profileId, agg] of byProfile) {
    for (const [dimension, total] of Object.entries(agg.dimensionTotals)) {
      rows.push([profileId, dimension,
        (total / agg.dimensionCounts[dimension]).toFixed(2), agg.dimensionCounts[dimension]]);
    }
    const { present, partial, absent } = agg.targets;
    const denominator = present + partial + absent;
    recall.push([profileId, present, partial, absent,
      denominator ? ((present + 0.5 * partial) / denominator).toFixed(3) : ""]);
  }
  return { dimensionsCsv: csv(rows), recallCsv: csv(recall) };
}

export const CALL1_DIMENSIONS = ["required_concept_recall", "mandatory_shape_recall",
  "pillar_coverage", "thesis_theme_accuracy", "bridge_coverage", "atomicity",
  "specifics_preservation", "stance_fidelity", "filler_duplicate_count",
  "invented_bridge_count"];

export const CALL2_DIMENSIONS = ["disputed_proposition_fidelity", "attribution_substance_choice",
  "polarity_scope_preservation", "support_refute_symmetry", "concrete_qualification",
  "warranted_link_adequacy", "mustmatch_precision", "rejectifonly_usefulness",
  "strategy_fit", "searchconcept_discrimination", "named_work_correctness",
  "no_self_confirmation", "package_validity"];
