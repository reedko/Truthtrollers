#!/usr/bin/env node

/**
 * TM4 Phase 3 Target QUALITY Audit (audit-only, deterministic)
 *
 * Reviews an existing Phase 3 targetizer output package for target-type
 * quality BEFORE any evidence/bearing run. Does NOT regenerate Phase 1/2/3,
 * does NOT run evidence, persist, or call the reducer.
 *
 * Usage:
 *   node tm4_phase3_target_quality_audit.mjs [targets_package.json]
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, "../../backend/logs");
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

async function findLatestTargets() {
  const files = await fs.readdir(logsDir);
  const matches = files.filter(f => /^tm4_phase3_targets_.*\.json$/.test(f)).sort();
  return matches.length ? path.join(logsDir, matches[matches.length - 1]) : null;
}

// ---- detectors -----------------------------------------------------------

const NAMED_OBJECT_RE =
  /\bVAERS\b|\b(19|20)\d{2}\b[^.]*\b(stud(?:y|ies)|report|trial|paper|analysis|survey|documentary|film|meeting|dataset|transcript|compilation)\b|\bUniversity of [A-Z][a-z]+\b|\b[A-Z][a-z]+ (?:Study|Report|Act|Transcript|Documentary)\b/;

const LITERATURE_EXISTENCE_RE =
  /\bno (?:credible |peer[- ]reviewed )?stud(?:y|ies)\b|there (?:are|is) no\b|have (?:not )?been (?:no )?stud/i;

const LOGICAL_MAXIM_RE = /correlation does not imply causation|correlation (?:is|does) not/i;

const ACTION_MISCONDUCT_RE =
  /ordered the destruction|destroyed|manipulat|reworked|covered up|conceal|suppress|leaked?|released a/i;

const RHETORICAL_RE =
  /\b(set the stage|paved the way|breathtaking|bombardment|uproar|loudly trumpeting|deadliest|inexplicably|would be considered|breathtaking|game[- ]?changer|stage for)\b/i;

const CAUSAL_LEAP_RE =
  /\b(set the stage|paved the way|enabled|led to|resulted in|gave rise|created the conditions|caused|because of|as a result|opened the door)\b/i;

function isStudyIdentitySpecific(t) {
  const named = (t.queryHints?.studiesOrDocuments || []).length > 0;
  const specific = NAMED_OBJECT_RE.test(t.targetText || "");
  return named || specific;
}

function isCompoundOrRhetorical(text) {
  const commas = (text.match(/,/g) || []).length;
  const conjunctions = (text.match(/\b(and|as well as|along with)\b/gi) || []).length;
  return (
    RHETORICAL_RE.test(text) ||
    (commas >= 3 && text.length > 120) ||
    (conjunctions >= 2 && text.length > 150)
  );
}

function isGenericBearing(t) {
  const mm = t.bearingCriteria?.mustMatch || [];
  return mm.some(m =>
    /^the core factual proposition$|^evidence directly addressing it$|enough identifying details of the study/i.test(m)
  );
}

async function main() {
  console.log("🔍 TM4 Phase 3 Target QUALITY Audit (deterministic, audit-only)\n");

  const pkgPath = process.argv[2] || (await findLatestTargets());
  if (!pkgPath) {
    console.error("❌ No Phase 3 targets package found in backend/logs");
    process.exit(1);
  }
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  const targets = pkg.targets || [];
  console.log(`✅ Targets package: ${path.basename(pkgPath)}`);
  console.log(`   Targets to review: ${targets.length}\n`);

  // Index: source claim -> its targets (for double-verdict detection)
  const byClaim = new Map();
  for (const t of targets) {
    if (!byClaim.has(t.sourceClaimId)) byClaim.set(t.sourceClaimId, []);
    byClaim.get(t.sourceClaimId).push(t);
  }

  const flags = []; // {targetId, issueType, severity, detail, targetType}
  const acknowledged = []; // targets explicitly marked review/needs-split (fix 4)
  const weakBearing = []; // targets with explicit weak=true bearing (fix 5)
  const addFlag = (t, issueType, severity, detail) =>
    flags.push({ targetId: t.targetId, targetType: t.targetType, issueType, severity, detail });

  for (const t of targets) {
    // ---- Check 1: study_identity specificity ------------------------
    if (t.targetType === "study_identity") {
      if (LITERATURE_EXISTENCE_RE.test(t.targetText)) {
        addFlag(t, "study_identity_should_be_evidence_landscape", "high",
          `asserts existence/absence of a body of literature, not a specific study → reclassify as evidence_landscape/literature_existence: "${t.targetText}"`);
      } else if (LOGICAL_MAXIM_RE.test(t.targetText)) {
        addFlag(t, "study_identity_misfire_logical_maxim", "high",
          `logical maxim, not a study/document: "${t.targetText}"`);
      } else if (ACTION_MISCONDUCT_RE.test(t.targetText) && !isStudyIdentitySpecific(t)) {
        addFlag(t, "study_identity_misfire_action_claim", "high",
          `action/misconduct claim, not a study-object identity: "${t.targetText}"`);
      } else if (!isStudyIdentitySpecific(t)) {
        addFlag(t, "study_identity_no_specific_object", "medium",
          `no named/identifiable study, document, dataset, law, report, or film: "${t.targetText}"`);
      }
    }

    // ---- Check 2: inference distinctness -----------------------------
    if (t.targetType === "inference") {
      const echoesVisible = (t.targetText || "").trim() === (t.visibleClaimText || "").trim();
      const hasCausalLeap = CAUSAL_LEAP_RE.test(t.visibleClaimText || "");
      if (echoesVisible) {
        addFlag(t, "inference_echoes_visible_claim", "high",
          `targetText is the original visible claim, not a distinct inferred proposition${hasCausalLeap ? "" : " (and no clear cause→effect leap present)"}: "${t.targetText}"`);
      }
    }

    // ---- Check 3: attribution verdict eligibility --------------------
    if (t.targetType === "attribution") {
      const siblings = byClaim.get(t.sourceClaimId) || [];
      const substantiveSibling = siblings.find(s => s.targetType === "substantive");
      if (t.verdictEligible && t.scoreTransform !== "none") {
        if (substantiveSibling && substantiveSibling.scoreTransform === t.scoreTransform) {
          addFlag(t, "attribution_verdict_double_count", "high",
            `verdictEligible=true/${t.scoreTransform} while a substantive sibling target carries the same verdict — attribution should be scoreTransform=none/verdictEligible=false (provenance only): "${t.targetText.slice(0, 90)}"`);
        } else {
          addFlag(t, "attribution_verdict_review", "low",
            `verdictEligible=true/${t.scoreTransform}; confirm the attribution itself (not the underlying proposition) is the article's allegation: "${t.targetText.slice(0, 90)}"`);
        }
      }
    }

    // ---- Check 4: substantive atomic/searchable ----------------------
    if (t.targetType === "substantive") {
      // Targets explicitly marked by fix 4 as review/needs-split are
      // ACKNOWLEDGED, not open flags — bucket them separately.
      if (t.needsAtomicSplit === true || t.qualityStatus === "review") {
        acknowledged.push({
          targetId: t.targetId,
          reason: t.mappingReason || "marked needsAtomicSplit/review",
        });
      } else if (isCompoundOrRhetorical(t.targetText)) {
        addFlag(t, "substantive_broad_or_rhetorical", "medium",
          `targetText is compound/rhetorical, not atomic+searchable: "${t.targetText.slice(0, 120)}"`);
      }
    }

    // ---- Check 5: bearing usefulness ---------------------------------
    const bc = t.bearingCriteria || {};
    const isWeak = bc.weak === true;
    // A target that explicitly acknowledges weak bearing (weak=true) is allowed
    // to have an empty mustMatch, provided it still gives shouldMatch keywords,
    // a rejectIfOnly guard, and bearingNotes explaining why.
    if (isWeak) {
      if (!(bc.rejectIfOnly || []).length || !(bc.bearingNotes || "").length) {
        addFlag(t, "bearing_missing_criteria", "high",
          `weak bearing must still provide rejectIfOnly and bearingNotes`);
      } else if (isGenericBearing(t)) {
        // weak targets must NOT use generic mustMatch phrasing
        addFlag(t, "bearing_generic", "medium",
          `weak bearing still uses generic mustMatch: [${(bc.mustMatch || []).join(" | ")}]`);
      } else {
        weakBearing.push({ targetId: t.targetId, notes: bc.bearingNotes });
      }
    } else if (!(bc.mustMatch || []).length || !(bc.rejectIfOnly || []).length) {
      addFlag(t, "bearing_missing_criteria", "high",
        `missing mustMatch or rejectIfOnly`);
    } else if (isGenericBearing(t)) {
      addFlag(t, "bearing_generic", "medium",
        `generic mustMatch would admit weak/tangential sources: [${(bc.mustMatch || []).join(" | ")}]`);
    }
  }

  // ---- aggregate ---------------------------------------------------------
  const flaggedTargetIds = new Set(flags.map(f => f.targetId));
  const byIssue = {};
  for (const f of flags) byIssue[f.issueType] = (byIssue[f.issueType] || 0) + 1;
  const bySeverity = {};
  for (const f of flags) bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;

  const passingCount = targets.length - flaggedTargetIds.size;

  console.log("=".repeat(70));
  console.log("Quality Review Results");
  console.log("=".repeat(70) + "\n");
  console.log(`  Total targets reviewed: ${targets.length}`);
  console.log(`  Targets passing quality (no flags): ${passingCount}`);
  console.log(`  Targets with ≥1 flag: ${flaggedTargetIds.size}`);
  console.log(`  Acknowledged (marked review/needsAtomicSplit): ${acknowledged.length}`);
  console.log(`  Weak bearing (explicit weak=true, not generic): ${weakBearing.length}`);
  console.log(`  Total flags: ${flags.length}`);
  console.log(`\n  Flags by issue type:`);
  Object.entries(byIssue).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`    ${k}: ${v}`));
  console.log(`\n  Flags by severity: ${JSON.stringify(bySeverity)}\n`);

  // 10 flagged examples (severity-ranked, diverse issue types)
  const sevRank = { high: 0, medium: 1, low: 2 };
  const ranked = [...flags].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  const tenExamples = [];
  const seenIssue = new Set();
  // first pass: one per issue type
  for (const f of ranked) {
    if (tenExamples.length >= 10) break;
    if (!seenIssue.has(f.issueType)) {
      seenIssue.add(f.issueType);
      tenExamples.push(f);
    }
  }
  // fill remaining by severity
  for (const f of ranked) {
    if (tenExamples.length >= 10) break;
    if (!tenExamples.includes(f)) tenExamples.push(f);
  }

  const recommendations = [
    {
      area: "study_identity",
      change:
        "Gate study_identity on a concrete identifiable object (named study/document/dataset/law/report/film, or year+publication-type, or known register like VAERS). If the text asserts the existence/absence of a body of literature (\"no credible studies linking X to Y\"), emit a new `evidence_landscape` / `literature_existence` target type instead. Never emit study_identity for action/misconduct claims or logical maxims (\"correlation does not imply causation\").",
    },
    {
      area: "inference",
      change:
        "Do not copy visibleClaimText into inference targetText. Synthesize the DISTINCT inferred proposition (the cause→effect link, e.g. \"The 1986 Act causally enabled industry capture and safety-messaging campaigns\") separate from the underlying fact. Require an explicit cause→effect structure; drop matches that are merely dramatic wording (\"created an uproar\") with no separable inferred claim.",
    },
    {
      area: "attribution",
      change:
        "On opponent/slogan claims, set attribution scoreTransform=none and verdictEligible=false — the invert verdict belongs on the substantive target only. Set verdictEligible=true for an attribution target only when the attribution itself is the article's allegation (e.g. an institution officially stated/classified something) AND no substantive sibling already carries that verdict. Add an explicit double-verdict guard so one proposition is not judged twice.",
    },
    {
      area: "substantive",
      change:
        "Add an atomicity/rhetoric pass: split compound targetText (≥3 clauses / multiple conjunctions) into atomic targets, and strip editorial framing (\"set the stage\", \"breathtaking\", \"loudly trumpeting\", \"would be considered\") so targetText is a plain searchable proposition. Flag residual rhetoric with needsAtomicSplit for a rewrite pass.",
    },
    {
      area: "bearing",
      change:
        "Replace the generic fallback mustMatch (\"the core factual proposition\" / \"evidence directly addressing it\" / \"enough identifying details\") with entity-derived criteria. When no specific entities exist, set bearingCriteria.weak=true so the bearing/evidence stage down-weights rather than silently admitting tangential sources.",
    },
  ];

  // ---- reports -----------------------------------------------------------
  const outJson = {
    timestamp: TIMESTAMP,
    sourcePackage: path.basename(pkgPath),
    fixture: pkg.fixture,
    totalTargets: targets.length,
    passingCount,
    flaggedTargetCount: flaggedTargetIds.size,
    acknowledgedCount: acknowledged.length,
    acknowledged,
    weakBearingCount: weakBearing.length,
    weakBearing,
    totalFlags: flags.length,
    flagsByIssueType: byIssue,
    flagsBySeverity: bySeverity,
    flags,
    recommendations,
    confirmations: {
      noEvidence: true,
      noPersistence: true,
      noReducer: true,
      productionUnchanged: true,
      regeneratedPhases: false,
    },
  };
  const jsonPath = path.join(logsDir, `tm4_phase3_target_quality_${TIMESTAMP}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(outJson, null, 2));
  console.log(`✅ JSON: ${jsonPath}`);

  const targetById = new Map(targets.map(t => [t.targetId, t]));
  const md = `# TM4 Phase 3 Target Quality Audit
**Timestamp:** ${TIMESTAMP}
**Source package:** ${path.basename(pkgPath)} (fixed targetizer output — NOT regenerated)
**Fixture:** ${pkg.fixture}

Deterministic quality review before any evidence/bearing run.
No evidence · no persistence · no reducer · no production changes · phases not regenerated.

## Summary
| Metric | Value |
|---|---|
| Total targets reviewed | ${targets.length} |
| Targets passing quality (no flags) | ${passingCount} |
| Targets with ≥1 flag | ${flaggedTargetIds.size} |
| Acknowledged (review/needsAtomicSplit) | ${acknowledged.length} |
| Weak bearing (explicit weak=true, not generic) | ${weakBearing.length} |
| Total flags | ${flags.length} |

${weakBearing.length ? `**Weak-bearing targets (explicit weak=true — keyword shouldMatch + rejectIfOnly + notes, no generic mustMatch):**\n${weakBearing.map(w => `- \`${w.targetId}\` — ${w.notes}`).join("\n")}` : ""}

${acknowledged.length ? `**Acknowledged (marked review/needsAtomicSplit — not open flags):**\n${acknowledged.map(a => `- \`${a.targetId}\` — ${a.reason}`).join("\n")}` : ""}

**Flags by issue type:**
${Object.entries(byIssue).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- \`${k}\`: ${v}`).join("\n")}

**Flags by severity:** ${Object.entries(bySeverity).map(([k, v]) => `${k}: ${v}`).join(" · ")}

## Check-by-Check
### 1. Study identity
- study_identity targets: ${targets.filter(t => t.targetType === "study_identity").length}
- flagged: ${flags.filter(f => f.issueType.startsWith("study_identity")).length}
${flags.filter(f => f.issueType.startsWith("study_identity")).map(f => `  - \`${f.targetId}\` [${f.severity}] ${f.detail}`).join("\n")}

### 2. Inference
- inference targets: ${targets.filter(t => t.targetType === "inference").length}
- flagged: ${flags.filter(f => f.issueType.startsWith("inference")).length}
${flags.filter(f => f.issueType.startsWith("inference")).map(f => {
    const t = targetById.get(f.targetId);
    return `  - \`${f.targetId}\` [${f.severity}] leap: ${CAUSAL_LEAP_RE.test(t.visibleClaimText) ? "cause→effect cue present but not extracted" : "no genuine cause→effect leap"} — ${f.detail}`;
  }).join("\n")}

### 3. Attribution
- attribution targets: ${targets.filter(t => t.targetType === "attribution").length}
- verdictEligible attribution targets: ${targets.filter(t => t.targetType === "attribution" && t.verdictEligible).length}
- flagged: ${flags.filter(f => f.issueType.startsWith("attribution")).length}
${flags.filter(f => f.issueType.startsWith("attribution")).map(f => `  - \`${f.targetId}\` [${f.severity}] ${f.detail}`).join("\n")}

### 4. Substantive
- substantive targets: ${targets.filter(t => t.targetType === "substantive").length}
- flagged compound/rhetorical: ${flags.filter(f => f.issueType === "substantive_broad_or_rhetorical").length}
${flags.filter(f => f.issueType === "substantive_broad_or_rhetorical").map(f => `  - \`${f.targetId}\` ${f.detail}`).join("\n")}

### 5. Bearing criteria
- generic bearing: ${flags.filter(f => f.issueType === "bearing_generic").length}
- missing criteria: ${flags.filter(f => f.issueType === "bearing_missing_criteria").length}

## 10 Flagged Target Examples
${tenExamples.map((f, i) => {
    const t = targetById.get(f.targetId);
    return `### ${i + 1}. \`${f.targetId}\` — ${f.issueType} [${f.severity}]
- type: \`${t.targetType}\` | scoreTransform: \`${t.scoreTransform}\` | verdictEligible: ${t.verdictEligible}
- sourceClaim \`${t.sourceClaimId}\`: "${t.visibleClaimText}"
- targetText: "${t.targetText}"
- issue: ${f.detail}`;
  }).join("\n\n")}

## Recommended Rule Changes
${recommendations.map((r, i) => `${i + 1}. **${r.area}** — ${r.change}`).join("\n\n")}

## Confirmation
No evidence ✅ · No persistence ✅ · No reducer ✅ · Production unchanged ✅ · Phases NOT regenerated ✅
`;

  const mdPath = path.join(logsDir, `tm4_phase3_target_quality_audit_${TIMESTAMP}.md`);
  await fs.writeFile(mdPath, md);
  console.log(`✅ Markdown: ${mdPath}\n`);

  console.log("=".repeat(70));
  console.log(`Reviewed ${targets.length} · passing ${passingCount} · flagged ${flaggedTargetIds.size} · flags ${flags.length}`);
  console.log("=".repeat(70));
}

main().catch(e => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
