import type {
  Cf7S3ContextUnit,
  Cf7S3ParentRow,
} from "./types.js";

export const CF7_S3_SYSTEM_PROMPT = `You perform one narrow task: decide whether each supplied claim requires decomposition into independently verdictable claims.

Use only the supplied parent rows and source units. Do not use outside knowledge and
do not fact-check. Preserve names, numbers, dates, comparators, modality, negation,
uncertainty, quotation status, allegation status, causal strength, and grounding.

A claim is atomic only if the entire statement can receive a single evidentiary
verdict from one substantially unified body of evidence.

If one part of the statement could reasonably be true while another part could be
false, the statement is not atomic and must be split.

Grammatical unity is not evidentiary unity.

Examples:
- "The treatment reduced fever and caused kidney injury." has two independently
  verdictable outcomes and must be split.
- "The exposure caused inflammation and the inflammation damaged the liver." has
  multiple causal assertions and must be split.
- "The study found no benefit, and the agency subsequently withdrew approval." has
  a study finding and a later institutional action and must be split.
- "The report alleges fraud, concealment, and retaliation." must be split when each
  listed allegation could receive a different evidentiary verdict.
- "The study reported a 20% increase relative to controls." remains one claim because
  the result, magnitude, and comparator form one evidentiary proposition.

Evaluate every supplied parent exactly once. Never combine separate parents.

Actions:
- keep_verbatim: the parent does not require decomposition. Emit only the parent ID
  and action. The host will copy canonical text and grounding; do not emit children.
- split: emit at least two independently verdictable children. Each child may cite
  only grounding IDs supplied for that parent. Do not rewrite merely for style.`;

function renderContext(units: Cf7S3ContextUnit[]): string {
  return units.map((unit) =>
    `[${unit.unitId}] [${unit.role}] ${unit.text}`).join("\n");
}

function renderParents(parents: Cf7S3ParentRow[]): string {
  return parents.map((parent) => JSON.stringify({
    parentHarvestRowId: parent.harvestRowId,
    assertionText: parent.assertionText,
    groundingUnitIds: parent.groundingUnitIds,
  })).join("\n");
}

export function buildCf7S3UserPrompt(input: {
  batchIndex: number;
  batchCount: number;
  contextUnits: Cf7S3ContextUnit[];
  parents: Cf7S3ParentRow[];
}): string {
  return `DECOMPOSITION BATCH ${input.batchIndex} OF ${input.batchCount}

SOURCE CONTEXT

${renderContext(input.contextUnits)}

ROUTED PARENT ROWS

${renderParents(input.parents)}

TASK

Return one decision for every parent row, in supplied order. Use keep_verbatim when
one substantially unified body of evidence can decide the entire claim. Use split
when any component could reasonably receive a different verdict. Do not omit or
duplicate a parent.`;
}
