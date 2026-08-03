import type { Cf7ValidatedHarvestResult } from "./schema.js";

export type Cf7HarvestFinding = {
  code: "CF7_OUT_OF_RANGE_GROUNDING" | "CF7_EMPTY_CHUNK";
  chunkId: string;
  rowKind: "disputed" | "assertion" | null;
  assertionText: string | null;
  invalidUnitIds: string[];
};

export type Cf7AcceptedHarvestRow = {
  rowKind: "disputed" | "assertion";
  assertionText: string;
  groundingUnitIds: string[];
};

export function validateHarvestGrounding(input: {
  chunkId: string;
  chunkUnitIds: string[];
  output: Cf7ValidatedHarvestResult;
}): {
  acceptedRows: Cf7AcceptedHarvestRow[];
  findings: Cf7HarvestFinding[];
} {
  const allowed = new Set(input.chunkUnitIds);
  const acceptedRows: Cf7AcceptedHarvestRow[] = [];
  const findings: Cf7HarvestFinding[] = [];
  const rows = [
    ...input.output.disputedAssertions.map((row) => ({
      ...row,
      rowKind: "disputed" as const,
    })),
    ...input.output.assertions.map((row) => ({
      ...row,
      rowKind: "assertion" as const,
    })),
  ];

  for (const row of rows) {
    const groundingUnitIds = [...new Set(row.groundingUnitIds)];
    const invalidUnitIds = groundingUnitIds.filter((unitId) => !allowed.has(unitId));
    if (invalidUnitIds.length) {
      findings.push({
        code: "CF7_OUT_OF_RANGE_GROUNDING",
        chunkId: input.chunkId,
        rowKind: row.rowKind,
        assertionText: row.assertionText,
        invalidUnitIds,
      });
      continue;
    }
    acceptedRows.push({
      rowKind: row.rowKind,
      assertionText: row.assertionText,
      groundingUnitIds,
    });
  }

  if (rows.length === 0) {
    findings.push({
      code: "CF7_EMPTY_CHUNK",
      chunkId: input.chunkId,
      rowKind: null,
      assertionText: null,
      invalidUnitIds: [],
    });
  }
  return { acceptedRows, findings };
}
