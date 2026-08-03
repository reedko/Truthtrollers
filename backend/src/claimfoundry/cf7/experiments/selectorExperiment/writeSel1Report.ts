import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Sel1FrozenInput,
  Sel1Output,
  Sel1Validation,
} from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../../../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const runId = "cf7-sel1-cf1-f03-20260729021343";
const runDirectory = path.join(
  repositoryRoot,
  "artifacts/claim-foundry/cf7/selector-experiment/CF1-F03",
  runId,
);

type ResultRow = {
  groupId: string;
  groupIndex: number;
  output: Sel1Output;
  validation: Sel1Validation;
  schemaIssues: unknown[];
  error: null;
};

type Accounting = {
  requestCount: number;
  completedRequestCount: number;
  failedRequestCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
};

const manualReview: Record<string, {
  selectionWinner: "A" | "B" | "tie";
  selectionNote: string;
  atomicityNote: string;
}> = {
  G1: {
    selectionWinner: "tie",
    selectionNote: "Both select H0002, a direct match to the sub-thesis.",
    atomicityNote: "Both preserve negation and meaning; B is slightly tighter.",
  },
  G2: {
    selectionWinner: "B",
    selectionNote:
      "B selects the explicit fervent-belief assertion; A selects a pronoun-dependent judgment about “these zealots.”",
    atomicityNote:
      "B resolves the subject and is standalone. A retains an unresolved demonstrative.",
  },
  G3: {
    selectionWinner: "tie",
    selectionNote: "Both select H0031 about alleged CDC data manipulation.",
    atomicityNote:
      "Both are readable; B removes the agency phrase and some temporal detail.",
  },
  G4: {
    selectionWinner: "B",
    selectionNote:
      "B selects the creation of the vaccine study group; A selects a rhetorical causal question.",
    atomicityNote:
      "A converts a question into a certain causal assertion. B is faithful but represents only the group-formation portion.",
  },
  G5: {
    selectionWinner: "B",
    selectionNote:
      "B selects the Act’s removal of manufacturer liability, the clearest anchor for the sub-thesis.",
    atomicityNote:
      "B cleanly isolates liability. A retains a long bundle of outcomes.",
  },
  G6: {
    selectionWinner: "B",
    selectionNote:
      "B selects the Vaxxed-triggered sharing statement; A selects a later bus-team activity.",
    atomicityNote: "B is standalone; A leaves “its dedicated team” unresolved.",
  },
  G7: {
    selectionWinner: "B",
    selectionNote:
      "B selects an asserted post-vaccination infant-death example; A selects the bus signature count.",
    atomicityNote:
      "B removes timing qualifiers and prevalence language, so it is cleaner but less specific.",
  },
  G8: {
    selectionWinner: "tie",
    selectionNote: "Both select H0100 about the suppressed 1999 study.",
    atomicityNote:
      "A preserves the reporting frame and drops one bundled outcome. B shifts from “learned about a study linking” to “a study linked,” weakening attribution.",
  },
  G9: {
    selectionWinner: "B",
    selectionNote:
      "B selects the assertion that explicitly covers exemptions and school access; A selects only the bill count.",
    atomicityNote:
      "B cleanly keeps the exemption proposition but drops the independent school-access proposition.",
  },
  G10: {
    selectionWinner: "B",
    selectionNote:
      "B selects the direct censorship assertion. A selects an unrelated SIDS chronology that leaked into the group.",
    atomicityNote: "B is atomic but very generic: “Censorship occurred.”",
  },
  G11: {
    selectionWinner: "tie",
    selectionNote: "Both select the creation of the vaccine study guide.",
    atomicityNote: "Both return the same faithful standalone sentence.",
  },
  G12: {
    selectionWinner: "A",
    selectionNote:
      "A selects a standalone statement about formerly pro-vaccine researchers; B selects a sentence beginning with unresolved “they.”",
    atomicityNote:
      "A is readable after pruning. B remains context-dependent and does not state the COVID-era trigger.",
  },
  G13: {
    selectionWinner: "B",
    selectionNote:
      "B directly selects parental fear of vaccinating babies; A selects the generic statement that any child’s death is tragic.",
    atomicityNote: "Both are atomic, but only B represents the group.",
  },
  G14: {
    selectionWinner: "B",
    selectionNote:
      "B selects the assertion describing reactions being classified as shaking symptoms; A selects a VAERS analysis count.",
    atomicityNote:
      "B rewrites the original classification claim into a direct list of vaccine reactions, losing the original attribution and predicate.",
  },
  G15: {
    selectionWinner: "B",
    selectionNote:
      "B selects the mechanism that injections bypass protective systems; A selects the vaccination schedule.",
    atomicityNote:
      "B remains compound: bypassing defenses and sending contents into the bloodstream are independently verdictable.",
  },
  G16: {
    selectionWinner: "B",
    selectionNote:
      "B selects an aluminum-harm assertion; A selects a vaccine schedule with no aluminum proposition.",
    atomicityNote:
      "B isolates one association with autism, intentionally dropping the other listed outcomes.",
  },
  G17: {
    selectionWinner: "B",
    selectionNote:
      "B selects a challenge to the ethylmercury-harmless claim; A selects the claim that childhood vaccines contain no mercury.",
    atomicityNote:
      "B preserves book attribution and negation, though neither selection directly states the full health-risk centroid.",
  },
  G18: {
    selectionWinner: "tie",
    selectionNote: "Both select H0190 about absent cumulative-load safety testing.",
    atomicityNote: "Both preserve the selected assertion verbatim.",
  },
  G19: {
    selectionWinner: "B",
    selectionNote:
      "B selects the explicit immunological-basis assertion; A selects a broader claim that no aluminum amount is safe.",
    atomicityNote:
      "B isolates the basis of the allowable dose and drops the contrasting non-toxicity clause.",
  },
  G20: {
    selectionWinner: "B",
    selectionNote:
      "B selects thimerosal deposition and conversion in the brain; A selects a downstream autism association.",
    atomicityNote:
      "B remains three claims: conversion, persistence, and resulting neuroinflammation. A is more atomic but less representative.",
  },
  G21: {
    selectionWinner: "tie",
    selectionNote: "Both select the 7.6-times-risk finding from H0217.",
    atomicityNote:
      "Both remove the independent secret-meeting proposition and retain the quantitative comparison.",
  },
  G22: {
    selectionWinner: "B",
    selectionNote:
      "B selects a CDC/FDA/manufacturer explanation claim; A selects an ethylmercury metabolism claim unrelated to manipulation.",
    atomicityNote:
      "B leaves a rhetorical quotation substantially unchanged and is not a clean independently verdictable proposition.",
  },
  G23: {
    selectionWinner: "B",
    selectionNote:
      "B selects hazardous-waste classification; A selects a mercury/ASD causality claim.",
    atomicityNote:
      "B still bundles exceeding the threshold with classification as hazardous waste.",
  },
  G24: {
    selectionWinner: "tie",
    selectionNote:
      "Both select H0256, the comparison with standards applied outside vaccines.",
    atomicityNote:
      "Both weaken the conditional framing. A strengthens “would be considered” to “is criminal”; B retains “considered” but still drops the product-exception condition.",
  },
};

function markdown(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function main(): Promise<void> {
  const frozen = await readJson<Sel1FrozenInput>(
    path.join(runDirectory, "frozen_input.json"),
  );
  const selectorA = await readJson<ResultRow[]>(
    path.join(runDirectory, "selector_A_results.json"),
  );
  const selectorB = await readJson<ResultRow[]>(
    path.join(runDirectory, "selector_B_results.json"),
  );
  const accounting = await readJson<Accounting>(
    path.join(runDirectory, "request_accounting.json"),
  );
  const manifest = await readJson<Record<string, unknown>>(
    path.join(runDirectory, "run_manifest.json"),
  );
  const artifactHashes = await readJson<{
    aggregateSha256: string;
    files: Array<{ name: string; bytes: number; sha256: string }>;
  }>(path.join(runDirectory, "artifact_hashes.json"));
  const aByGroup = new Map(selectorA.map((row) => [row.groupId, row]));
  const bByGroup = new Map(selectorB.map((row) => [row.groupId, row]));
  const selectedSame = frozen.groups.filter((group) =>
    aByGroup.get(group.groupId)!.output.selectedAssertionId
      === bByGroup.get(group.groupId)!.output.selectedAssertionId).length;
  const reviewCounts = Object.values(manualReview).reduce(
    (counts, row) => {
      counts[row.selectionWinner] += 1;
      return counts;
    },
    { A: 0, B: 0, tie: 0 },
  );
  const aProtected = selectorA.reduce(
    (sum, row) => sum + row.validation.introducedProtectedTokens.length,
    0,
  );
  const bProtected = selectorB.reduce(
    (sum, row) => sum + row.validation.introducedProtectedTokens.length,
    0,
  );

  const lines: string[] = [
    "# CF7 SEL-1 Selector Experiment Report",
    "",
    "## Run identity",
    "",
    `- Run ID: \`${runId}\``,
    `- Source GDE-2 run: \`${frozen.sourceRunId}\``,
    `- Status: **${String(manifest.status).toUpperCase()}**`,
    `- Model: \`${String(manifest.model)}\``,
    "- Requests expected/completed/failed: 48/48/0",
    "- Retries: 0",
    `- Source input hash: \`${frozen.sourceInputHash}\``,
    `- Source G-B file SHA-256: \`${frozen.sourceGde2GroupFileSha256}\``,
    `- Artifact aggregate SHA-256: \`${artifactHashes.aggregateSha256}\``,
    "- Article text visible: no",
    "- Provenance beyond assertion IDs visible: no",
    "- Sealed evaluator visible: no",
    "",
    "## Controlled comparison",
    "",
    "- Semantic groups evaluated: 24",
    "- Selector A receives group ID plus assertion IDs/texts.",
    "- Selector B receives the identical group data plus the frozen G-B synthesized sub-thesis.",
    "- Both selectors use the same schema, settings, atomicity instructions, and per-group request boundary.",
    `- Same selected assertion: ${selectedSame}/24`,
    `- Different selected assertion: ${24 - selectedSame}/24`,
    `- Manual representative-quality adjudication: B better ${reviewCounts.B}, A better ${reviewCounts.A}, tie ${reviewCounts.tie}.`,
    "",
    "## Metric summary",
    "",
    "| Metric | Selector A | Selector B | Judgment |",
    "|---|---:|---:|---|",
    "| Structurally valid selections | 24/24 | 24/24 | Tie |",
    `| Better representative in pairwise review | ${reviewCounts.A} | ${reviewCounts.B} | B |`,
    "| Clear contextual/introductory selection failures | 4 | 2 | B |",
    "| Deterministic protected-token flags | "
      + `${aProtected} | ${bProtected} | One B morphology-sensitive flag; manual review required |`,
    "| Manual semantic-drift risks in atomic rewriting | 2 | 3 | Neither is self-validating |",
    "| Polarity generally preserved | yes | yes | Tie, with certainty/conditional exceptions |",
    "| Attribution generally preserved | mixed | mixed | Both lose framing in some rewrites |",
    "",
    "The counts above use direct review against the selected source assertion and group. They are evaluation judgments, not model-generated scores.",
    "",
    "## Group-by-group comparison",
    "",
  ];

  for (const group of frozen.groups) {
    const a = aByGroup.get(group.groupId)!;
    const b = bByGroup.get(group.groupId)!;
    const aSource = group.assertions.find(
      (row) => row.assertionId === a.output.selectedAssertionId,
    )!.assertionText;
    const bSource = group.assertions.find(
      (row) => row.assertionId === b.output.selectedAssertionId,
    )!.assertionText;
    const review = manualReview[group.groupId]!;
    lines.push(
      `### ${group.groupId}`,
      "",
      `**G-B sub-thesis:** ${group.semanticSubThesis}`,
      "",
      "| | Selector A | Selector B |",
      "|---|---|---|",
      `| Selected ID | ${a.output.selectedAssertionId} | ${b.output.selectedAssertionId} |`,
      `| Selected assertion | ${markdown(aSource)} | ${markdown(bSource)} |`,
      `| Atomic assertion | ${markdown(a.output.atomicAssertion)} | ${markdown(b.output.atomicAssertion)} |`,
      `| Protected-token flags | ${a.validation.introducedProtectedTokens.map((row) => row.token).join(", ") || "none"} | ${b.validation.introducedProtectedTokens.map((row) => row.token).join(", ") || "none"} |`,
      "",
      `- Representative judgment: **${review.selectionWinner}** — ${review.selectionNote}`,
      `- Atomicity judgment: ${review.atomicityNote}`,
      "",
    );
  }

  lines.push(
    "## Comparative analysis",
    "",
    "### Did the semantic sub-thesis improve assertion selection?",
    "",
    "**Yes, materially.** Selector B changed 17 of 24 selections. Direct review rated B stronger in 16 groups, A stronger in one, and seven ties. The largest gains occurred where Selector A latched onto a locally salient but semantically peripheral row:",
    "",
    "- G10: A chose a SIDS chronology; B chose the direct censorship assertion.",
    "- G13: A chose “The death of any child is tragic”; B chose parental fear of vaccinating.",
    "- G16: A chose a vaccine schedule; B chose an aluminum-harm assertion.",
    "- G23: A chose mercury/ASD causality; B chose hazardous-waste classification.",
    "",
    "### Did B consistently choose better representatives?",
    "",
    "Not universally. G12 regressed: B selected a context-dependent “they” sentence, while A selected a standalone statement. G2 also demonstrates centroid inheritance risk: the G-B sub-thesis itself conflates populations, so alignment with it does not prove the underlying group is coherent.",
    "",
    "### Contextual and introductory selections",
    "",
    "The sub-thesis reduced obvious contextual or introductory failures. A selected unresolved or structurally weak rows in G2, G4, G6, and G13. B’s clearest remaining failures were G12’s unresolved “they” and G22’s rhetorical quotation.",
    "",
    "### Evidence-ready assertion quality",
    "",
    "Selector B produced the stronger candidate inventory because its selections more often matched the group centroid and were standalone. It is not automatically evidence-ready: the atomic rewrite can still alter attribution, certainty, or logical structure, and the source G-B partition itself omitted seven assertions and duplicated five.",
    "",
    "### Atomicity",
    "",
    "Deferring atomicization until after semantic selection is viable for many rows. Clean examples include B-G5 (manufacturer liability), B-G16 (one aluminum/autism association), and both G21 outputs (the quantitative risk finding separated from the meeting claim).",
    "",
    "The singular `atomicAssertion` field is insufficient when the selected source contains multiple independently verdictable propositions. Remaining decomposition cases include:",
    "",
    "- B-G15: bypasses protective mechanisms and sends contents into the bloodstream.",
    "- B-G20: converts to inorganic mercury, remains trapped, and results in neuroinflammation.",
    "- B-G23: exceeds a threshold and is classified as hazardous waste.",
    "- B-G24: affected populations, safety-limit comparison, and criminality framing.",
    "- A-G22: metabolism plus long-term persistence in multiple organs.",
    "",
    "### Information loss and unsupported rewriting",
    "",
    "Some information loss is legitimate atomic pruning, such as B-G9 dropping the independent school-access proposition and B-G16 selecting one outcome from a long list. Other changes are semantic risks:",
    "",
    "- A-G4 turns a rhetorical causal question into a certain causal assertion.",
    "- B-G8 changes “our group learned about a study linking…” into “a study linked…,” weakening attribution.",
    "- B-G14 changes a claim about symptoms being classified as shaking into a direct vaccine-reaction list.",
    "- Both G24 rewrites weaken the source’s conditional framing; A additionally strengthens “would be considered criminal” to “is criminal.”",
    "",
    "The deterministic protected-content scan flagged B-G8’s `linked` token. That flag is morphology-sensitive because the source says `linking`; it is useful diagnostic evidence but not, by itself, a semantic verdict.",
    "",
    "### Groups that cannot be faithfully represented by one atomic assertion",
    "",
    "The clearest cases are G2, G3, G5, G8, G14, G15, G17, G20, G21, G22, G23, and G24. These groups contain multiple mechanisms, events, actors, or evidentiary propositions. A single row can be representative, but it cannot preserve the group’s complete substantive coverage.",
    "",
    "## Research questions",
    "",
    "### Primary",
    "",
    "**Does a semantic sub-thesis improve selection? Yes.** In this controlled run it produced a better representative in 16/24 groups, versus 1/24 for assertion-only selection, with seven ties.",
    "",
    "### Secondary",
    "",
    "**Can atomicization be deferred until after selection? Provisionally yes, but not with a mandatory single-string result.** Selection-first atomicization often produced cleaner candidates without major loss, but several rows still required multiple independently grounded children, and a few rewrites changed attribution, certainty, or logical form.",
    "",
    "## Architecture judgment",
    "",
    "**SEL1_PASS_WITH_REVISIONS**",
    "",
    "The two-call semantic architecture is supported as a candidate-generation design:",
    "",
    "Assertions → grouping → sub-thesis → representative selection → atomicization",
    "",
    "Required revisions before treating outputs as evidence-ready:",
    "",
    "1. Preserve the selected source assertion alongside every atomic child.",
    "2. Allow one-or-more atomic children rather than one mandatory string.",
    "3. Validate attribution, polarity, modality, numbers, and causal language against the selected source.",
    "4. Route heterogeneous groups to multi-representative or decomposition handling.",
    "5. Do not allow the selector stage to conceal missing or duplicate assignments from the upstream grouping stage.",
    "",
    "## Integrity and accounting",
    "",
    `- Input tokens: ${accounting.inputTokens}`,
    `- Cached input tokens: ${accounting.cachedInputTokens}`,
    `- Output tokens: ${accounting.outputTokens}`,
    `- Total tokens: ${accounting.totalTokens}`,
    `- Aggregate request latency: ${accounting.latencyMs} ms`,
    `- Immutable run-artifact files hashed: ${artifactHashes.files.length}`,
    "- Raw provider responses preserved: 48/48",
    "- Response IDs preserved: 48/48",
    "- Additional model calls during evaluation: 0",
  );

  const reportDirectory = path.join(
    repositoryRoot,
    "artifacts/claim-foundry/cf7/selector-experiment/reports",
    runId,
  );
  await mkdir(path.dirname(reportDirectory), { recursive: true });
  await mkdir(reportDirectory, { recursive: false });
  const reportText = `${lines.join("\n")}\n`;
  const reportName = "sel1_selector_experiment_report.md";
  await writeFile(path.join(reportDirectory, reportName), reportText, {
    encoding: "utf8",
    flag: "wx",
  });
  const reportManifest = {
    schemaVersion: "cf7.sel1ReportManifest.v1",
    runId,
    reportFile: reportName,
    reportSha256: sha256(reportText),
    sourceRunArtifactAggregateSha256: artifactHashes.aggregateSha256,
    semanticReviewMethod:
      "Direct comparison of both selector outputs with each frozen group, selected source assertion, and G-B sub-thesis; no model or sealed evaluator used.",
    modelCallsMade: 0,
  };
  const manifestText = `${JSON.stringify(reportManifest, null, 2)}\n`;
  await writeFile(
    path.join(reportDirectory, "report_manifest.json"),
    manifestText,
    { encoding: "utf8", flag: "wx" },
  );
  await chmod(path.join(reportDirectory, reportName), 0o444);
  await chmod(path.join(reportDirectory, "report_manifest.json"), 0o444);
  await chmod(reportDirectory, 0o555);
  process.stdout.write(`${JSON.stringify({
    reportDirectory,
    ...reportManifest,
    selectionComparison: {
      same: selectedSame,
      different: 24 - selectedSame,
      manualWinnerCounts: reviewCounts,
    },
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
