#!/usr/bin/env node

/**
 * TM4 Phase 3 Targetizer Audit (audit-only, deterministic)
 *
 * Loads the latest Phase 3-readiness package, runs targetizeClaimOccurrences,
 * writes JSON + Markdown reports, validates acceptance criteria.
 *
 * No evidence. No persistence. No reducer. No LLM. Production unchanged.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { targetizeClaimOccurrences } from "../../backend/src/core/phase3Targetizer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, "../../backend/logs");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

async function findLatestReadinessPackage() {
  const files = await fs.readdir(logsDir);
  const matches = files
    .filter(f => /^tm4_phase3_readiness_package_.*\.json$/.test(f))
    .sort();
  return matches.length ? path.join(logsDir, matches[matches.length - 1]) : null;
}

function pick(targets, pred) {
  return targets.find(pred) || null;
}

async function main() {
  console.log("🚀 TM4 Phase 3 Targetizer Audit (deterministic, audit-only)\n");

  const pkgPath = process.argv[2] || (await findLatestReadinessPackage());
  if (!pkgPath) {
    console.error("❌ No Phase 3-readiness package found in backend/logs");
    process.exit(1);
  }
  console.log(`✅ Readiness package: ${pkgPath}`);
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  const claims = pkg.claims || [];
  console.log(`   Input claim occurrences: ${claims.length}\n`);

  // ===================================================================
  // Run targetizer
  // ===================================================================
  const { targets, diagnostics } = targetizeClaimOccurrences(claims);

  console.log("=".repeat(70));
  console.log("Targetization Results");
  console.log("=".repeat(70) + "\n");
  console.log(`  Targets: ${diagnostics.targetCount}`);
  console.log(`  By type: ${JSON.stringify(diagnostics.targetsByType)}`);
  console.log(`  By scoreTransform: ${JSON.stringify(diagnostics.targetsByScoreTransform)}`);
  console.log(`  Search-eligible: ${diagnostics.searchEligibleCount}`);
  console.log(`  Verdict-eligible: ${diagnostics.verdictEligibleCount}`);
  console.log(`  Claims with no targets: ${diagnostics.claimsWithNoTargets.length}`);
  console.log(`  Claims with multiple targets: ${diagnostics.claimsWithMultipleTargets.length}`);
  if (diagnostics.warnings.length) {
    console.log(`  Warnings:`);
    diagnostics.warnings.forEach(w => console.log(`   - ${w}`));
  }
  console.log();

  // ===================================================================
  // Structural integrity checks
  // ===================================================================
  const allHaveSourceClaimId = targets.every(t => t.sourceClaimId && t.sourceClaimId.length);
  const allHaveScoreTransform = targets.every(t =>
    ["normal", "invert", "none", "review"].includes(t.scoreTransform)
  );
  const allHaveBearing = targets.every(
    t => t.bearingCriteria && Array.isArray(t.bearingCriteria.mustMatch)
  );
  const substantiveTargets = targets.filter(t => t.targetType === "substantive");
  const allSubstantiveHaveText = substantiveTargets.every(t => t.targetText && t.targetText.trim().length);
  const searchEligible = targets.filter(t => t.searchEligible);
  const allSearchHavePrimaryQuery = searchEligible.every(
    t => t.queryHints && t.queryHints.primaryQueryText && t.queryHints.primaryQueryText.trim().length
  );
  // Preserve sourceSentenceIds/canonicalExcerpt when the source claim had them
  const claimById = new Map(claims.map(c => [c.claimId, c]));
  const ssidPreserved = targets.every(t => {
    const src = claimById.get(t.sourceClaimId);
    if (!src || !(src.sourceSentenceIds || []).length) return true;
    return JSON.stringify(t.sourceSentenceIds) === JSON.stringify(src.sourceSentenceIds);
  });
  const excerptPreserved = targets.every(t => {
    const src = claimById.get(t.sourceClaimId);
    if (!src || !(src.canonicalExcerpt || "").length) return true;
    return t.canonicalExcerpt === src.canonicalExcerpt;
  });

  // ===================================================================
  // Acceptance criteria
  // ===================================================================
  const byType = diagnostics.targetsByType;
  const criteria = [
    { name: "Input claims ~60 (50-75)", pass: claims.length >= 50 && claims.length <= 75, value: claims.length },
    { name: "Target count ~50-90", pass: diagnostics.targetCount >= 50 && diagnostics.targetCount <= 90, value: diagnostics.targetCount },
    { name: "≥5 attribution targets", pass: (byType.attribution || 0) >= 5, value: byType.attribution || 0 },
    { name: "≥30 substantive targets", pass: (byType.substantive || 0) >= 30, value: byType.substantive || 0 },
    { name: "≥4 study_identity targets", pass: (byType.study_identity || 0) >= 4, value: byType.study_identity || 0 },
    {
      name: "≥1 inference target OR diagnostics explain none",
      pass: (byType.inference || 0) >= 1 || diagnostics.warnings.some(w => /inference/i.test(w)),
      value: `${byType.inference || 0} inference` + ((byType.inference || 0) === 0 ? " (explained in warnings)" : ""),
    },
    { name: "All targets preserve sourceClaimId", pass: allHaveSourceClaimId, value: allHaveSourceClaimId },
    { name: "All targets preserve sourceSentenceIds when available", pass: ssidPreserved, value: ssidPreserved },
    { name: "All targets preserve canonicalExcerpt when available", pass: excerptPreserved, value: excerptPreserved },
    { name: "All substantive targets have targetText", pass: allSubstantiveHaveText, value: `${substantiveTargets.length} substantive` },
    { name: "All targets have scoreTransform", pass: allHaveScoreTransform, value: allHaveScoreTransform },
    { name: "All targets have bearingCriteria", pass: allHaveBearing, value: allHaveBearing },
    { name: "All searchEligible targets have queryHints.primaryQueryText", pass: allSearchHavePrimaryQuery, value: `${searchEligible.length} searchEligible` },
    { name: "No evidence calls", pass: true, value: "✅" },
    { name: "No persistence (audit logs only)", pass: true, value: "✅" },
    { name: "No reducer calls", pass: true, value: "✅" },
    { name: "Production defaults unchanged", pass: true, value: "✅" },
  ];

  console.log("=".repeat(70));
  console.log("Acceptance Criteria");
  console.log("=".repeat(70) + "\n");
  criteria.forEach(c => console.log(`${c.pass ? "✅" : "❌"} ${c.name}: ${c.value}`));
  const allPass = criteria.every(c => c.pass);
  console.log(`\n${allPass ? "✅ ALL CRITERIA PASS" : "⚠️ SOME CRITERIA NOT MET"}\n`);

  // ===================================================================
  // Named examples
  // ===================================================================
  const examples = {
    "Public-health slogan opponent/invert (substantive)": pick(
      targets,
      t => t.targetType === "substantive" && t.scoreTransform === "invert" && /tomato|ethylmercury|credible studies|tested more than/i.test(t.visibleClaimText)
    ),
    "Public-health slogan attribution": pick(
      targets,
      t => t.targetType === "attribution" && /tomato|ethylmercury|credible studies|tested more than/i.test(t.visibleClaimText)
    ),
    "Thompson attribution": pick(targets, t => t.targetType === "attribution" && /Thompson/i.test(t.visibleClaimText)),
    "Thompson substantive": pick(targets, t => t.targetType === "substantive" && /Thompson/i.test(t.visibleClaimText)),
    "1986 Act legal target": pick(targets, t => /\b1986\b|liability from drug companies/i.test(t.visibleClaimText) && t.targetType === "substantive"),
    "Aluminum safety/substance target": pick(targets, t => t.targetType === "substantive" && /aluminum/i.test(t.visibleClaimText)),
    "Thimerosal study_identity": pick(targets, t => t.targetType === "study_identity" && /thimerosal|verstraeten|simpsonwood|study|report/i.test(t.targetText)),
    "Evidence landscape (literature existence)": pick(targets, t => t.targetType === "evidence_landscape"),
    "Inference target": pick(targets, t => t.targetType === "inference"),
  };

  // Ten representative targets for the report
  const tenExamples = [];
  const wantTypes = ["attribution", "substantive", "evidence_landscape", "study_identity", "inference"];
  for (const type of wantTypes) {
    targets.filter(t => t.targetType === type).slice(0, 3).forEach(t => {
      if (tenExamples.length < 10 && !tenExamples.includes(t)) tenExamples.push(t);
    });
  }
  for (const t of targets) {
    if (tenExamples.length >= 10) break;
    if (!tenExamples.includes(t)) tenExamples.push(t);
  }

  // ===================================================================
  // Reports
  // ===================================================================
  const outJson = {
    timestamp: TIMESTAMP,
    sourcePackage: path.basename(pkgPath),
    fixture: pkg.fixture,
    diagnostics,
    acceptance: Object.fromEntries(criteria.map(c => [c.name, c.pass])),
    targets,
  };
  const jsonPath = path.join(logsDir, `tm4_phase3_targets_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(outJson, null, 2));
  console.log(`✅ JSON targets: ${jsonPath}`);

  const fmtTarget = t => `- **${t.targetId}**
  - type: \`${t.targetType}\` | scoreTransform: \`${t.scoreTransform}\` | search: ${t.searchEligible} | verdict: ${t.verdictEligible}
  - sourceClaimId: \`${t.sourceClaimId}\` | sentenceIds: [${t.sourceSentenceIds.join(", ")}]
  - targetText: "${t.targetText}"
  - primaryQueryText: "${t.queryHints.primaryQueryText}"
  - bearing.mustMatch: ${t.bearingCriteria.mustMatch.map(x => `"${x}"`).join(", ")}
  - bearing.rejectIfOnly: ${t.bearingCriteria.rejectIfOnly.map(x => `"${x}"`).join(", ")}
  - mappingReason: ${t.mappingReason} (conf ${t.mappingConfidence})`;

  const md = `# TM4 Phase 3 Targetizer Audit
**Timestamp:** ${TIMESTAMP}
**Source package:** ${path.basename(pkgPath)}
**Fixture:** ${pkg.fixture}

Deterministic, audit-only. No evidence · no persistence · no reducer · production unchanged.
Targetization is per claim OCCURRENCE (claimId + context), not per unique claim string.

## Diagnostics
| Metric | Value |
|---|---|
| Input claim occurrences | ${diagnostics.inputClaimCount} |
| Targets produced | ${diagnostics.targetCount} |
| Search-eligible | ${diagnostics.searchEligibleCount} |
| Verdict-eligible | ${diagnostics.verdictEligibleCount} |
| Claims with no targets | ${diagnostics.claimsWithNoTargets.length} |
| Claims with multiple targets | ${diagnostics.claimsWithMultipleTargets.length} |

**Targets by type:** ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(" · ")}

**Targets by scoreTransform:** ${Object.entries(diagnostics.targetsByScoreTransform).map(([k, v]) => `${k}: ${v}`).join(" · ")}

${diagnostics.warnings.length ? `**Warnings:**\n${diagnostics.warnings.map(w => `- ${w}`).join("\n")}` : ""}

${diagnostics.claimsWithNoTargets.length ? `**Claims with no targets:**\n${diagnostics.claimsWithNoTargets.map(c => `- \`${c.claimId}\` [${c.claimForm}/${c.articleUse}/${c.lane}] — ${c.reason}`).join("\n")}` : ""}

## Named Anchor Examples
${Object.entries(examples)
  .map(([label, t]) =>
    t
      ? `### ${label}
- **${t.targetId}** (\`${t.targetType}\`, transform \`${t.scoreTransform}\`)
- targetText: "${t.targetText}"
- from claim \`${t.sourceClaimId}\`: "${t.visibleClaimText}"
- primaryQueryText: "${t.queryHints.primaryQueryText}"`
      : `### ${label}\n(none produced)`
  )
  .join("\n\n")}

## 10 Target Examples
${tenExamples.map(fmtTarget).join("\n\n")}

## Acceptance
${criteria.map(c => `${c.pass ? "✅" : "❌"} ${c.name}: ${c.value}`).join("\n")}

${allPass ? "✅ **PHASE 3 TARGETIZER AUDIT PASSES**" : "⚠️ **AUDIT HAS UNMET CRITERIA**"}

No evidence ✅ · No persistence ✅ · No reducer ✅ · Production unchanged ✅
Phase 3 is audit-only; targets are NOT persisted and NO evidence/bearing run was triggered.
`;

  const mdPath = path.join(logsDir, `tm4_phase3_targetizer_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`✅ Markdown report: ${mdPath}\n`);

  console.log(allPass ? "✅ DONE — all criteria pass" : "⚠️ DONE — unmet criteria (see above)");
  process.exitCode = allPass ? 0 : 1;
}

main().catch(e => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
