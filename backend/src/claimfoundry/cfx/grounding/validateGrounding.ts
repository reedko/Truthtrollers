import {
  cfxGroundingRowSchema,
} from "../schemas/groundingSchema.js";
import type {
  CfxDiagnostic,
  CfxFrozenArticle,
  CfxGroundingRow,
  CfxGroundingValidation,
  CfxRejectedGrounding,
  CfxValidatedGrounding,
} from "../types/index.js";

const STATUS_TYPE = {
  grounded_direct: "direct",
  grounded_distributed: "distributed",
  grounded_attributed: "attributed",
  partial: "partial",
  ambiguous: "ambiguous",
  unsupported: "none",
} as const;

function words(value: string): number {
  return value.match(/\b[\p{L}\p{N}'’-]+\b/gu)?.length ?? 0;
}

function diagnostic(
  code: string,
  message: string,
  propositionId?: string,
  path?: string,
  comparison?: Record<string, unknown>,
): CfxDiagnostic {
  return {
    code,
    message,
    ...(propositionId ? { propositionId } : {}),
    ...(path ? { path } : {}),
    ...(comparison ? { comparison } : {}),
  };
}

function validateRow(input: {
  row: CfxGroundingRow;
  article: CfxFrozenArticle;
}): {
  accepted: CfxValidatedGrounding | null;
  diagnostics: CfxDiagnostic[];
} {
  const { row, article } = input;
  const diagnostics: CfxDiagnostic[] = [];
  if (row.groundingType !== STATUS_TYPE[row.groundingStatus]) {
    diagnostics.push(diagnostic(
      "STATUS_TYPE_MISMATCH",
      `${row.groundingStatus} requires groundingType ${STATUS_TYPE[row.groundingStatus]}`,
      row.propositionId,
      "groundingType",
      {
        expected: STATUS_TYPE[row.groundingStatus],
        actual: row.groundingType,
      },
    ));
  }
  const segmentCount = row.evidenceSegments.length;
  if (row.groundingStatus === "unsupported" && segmentCount !== 0) {
    diagnostics.push(diagnostic(
      "UNSUPPORTED_HAS_EVIDENCE",
      "unsupported results must contain zero evidence segments",
      row.propositionId,
      "evidenceSegments",
    ));
  }
  if (row.groundingStatus === "grounded_direct" && segmentCount !== 1) {
    diagnostics.push(diagnostic(
      "DIRECT_SEGMENT_COUNT",
      "grounded_direct requires exactly one evidence segment",
      row.propositionId,
      "evidenceSegments",
    ));
  }
  if (row.groundingStatus === "grounded_distributed" && segmentCount < 2) {
    diagnostics.push(diagnostic(
      "DISTRIBUTED_SEGMENT_COUNT",
      "grounded_distributed requires at least two evidence segments",
      row.propositionId,
      "evidenceSegments",
    ));
  }
  if (row.groundingStatus === "grounded_attributed" && segmentCount < 1) {
    diagnostics.push(diagnostic(
      "ATTRIBUTED_SEGMENT_COUNT",
      "grounded_attributed requires at least one evidence segment",
      row.propositionId,
      "evidenceSegments",
    ));
  }
  if (
    (row.groundingStatus === "partial" || row.groundingStatus === "ambiguous")
    && segmentCount < 1
  ) {
    diagnostics.push(diagnostic(
      "QUALIFIED_SEGMENT_COUNT",
      `${row.groundingStatus} requires at least one evidence segment`,
      row.propositionId,
      "evidenceSegments",
    ));
  }
  if (
    row.groundingStatus === "partial"
    && (
      row.supportedComponents.length === 0
      || row.unsupportedComponents.length === 0
    )
  ) {
    diagnostics.push(diagnostic(
      "PARTIAL_COMPONENTS_REQUIRED",
      "partial results require supported and unsupported components",
      row.propositionId,
    ));
  }
  if (
    ["grounded_direct", "grounded_distributed", "grounded_attributed"]
      .includes(row.groundingStatus)
    && (
      row.supportedComponents.length > 0
      || row.unsupportedComponents.length > 0
    )
  ) {
    diagnostics.push(diagnostic(
      "FULL_GROUNDING_HAS_COMPONENTS",
      "fully grounded results require empty component arrays",
      row.propositionId,
    ));
  }
  if (
    row.groundingStatus === "ambiguous"
    && (!row.notes || row.notes.trim().length === 0)
  ) {
    diagnostics.push(diagnostic(
      "AMBIGUITY_NOTE_REQUIRED",
      "ambiguous results require a concise diagnostic note",
      row.propositionId,
      "notes",
    ));
  }

  const unitsById = new Map(
    article.sourceUnits.map((unit, index) => [
      unit.unitId,
      { unit, index },
    ]),
  );
  const sourceSnapshots: CfxValidatedGrounding["sourceSnapshots"] = [];
  row.evidenceSegments.forEach((segment, segmentIndex) => {
    const seen = new Set<string>();
    const resolved = segment.sourceUnitIds.map((unitId, unitIndex) => {
      if (seen.has(unitId)) {
        diagnostics.push(diagnostic(
          "DUPLICATE_UNIT_ID",
          `Evidence segment repeats ${unitId}`,
          row.propositionId,
          `evidenceSegments.${segmentIndex}.sourceUnitIds.${unitIndex}`,
        ));
      }
      seen.add(unitId);
      const found = unitsById.get(unitId);
      if (!found) {
        diagnostics.push(diagnostic(
          "UNKNOWN_UNIT_ID",
          `Evidence segment cites unknown unit ${unitId}`,
          row.propositionId,
          `evidenceSegments.${segmentIndex}.sourceUnitIds.${unitIndex}`,
        ));
      }
      return found;
    });
    const known = resolved.filter(
      (value): value is NonNullable<typeof value> => Boolean(value),
    );
    if (known.length !== segment.sourceUnitIds.length) return;
    for (let index = 1; index < known.length; index += 1) {
      if (known[index]!.index <= known[index - 1]!.index) {
        diagnostics.push(diagnostic(
          "UNIT_ORDER_VIOLATION",
          "Unit IDs must appear in source order",
          row.propositionId,
          `evidenceSegments.${segmentIndex}.sourceUnitIds`,
        ));
      }
      if (known[index]!.index !== known[index - 1]!.index + 1) {
        diagnostics.push(diagnostic(
          "NON_CONTIGUOUS_SEGMENT",
          "Non-contiguous units must use separate evidence segments",
          row.propositionId,
          `evidenceSegments.${segmentIndex}.sourceUnitIds`,
        ));
      }
    }
    const first = known[0]!.unit;
    const last = known.at(-1)!.unit;
    const citedUnitText = article.canonicalText.slice(
      first.charStart,
      last.charEnd,
    );
    if (!citedUnitText.includes(segment.verbatimEvidence)) {
      diagnostics.push(diagnostic(
        "EXACT_SUBSTRING_FAILURE",
        "verbatimEvidence is not an exact substring of the cited unit span",
        row.propositionId,
        `evidenceSegments.${segmentIndex}.verbatimEvidence`,
        {
          verbatimEvidence: segment.verbatimEvidence,
          citedUnitText,
        },
      ));
    } else {
      sourceSnapshots.push({
        sourceUnitIds: [...segment.sourceUnitIds],
        citedUnitText,
        exactSubstring: true,
      });
    }
  });

  if (diagnostics.length > 0) return { accepted: null, diagnostics };
  return {
    accepted: {
      ...row,
      validationStatus: "accepted",
      citedUnitCount: new Set(
        row.evidenceSegments.flatMap((segment) => segment.sourceUnitIds),
      ).size,
      quotedCharacterCount: row.evidenceSegments.reduce(
        (sum, segment) => sum + segment.verbatimEvidence.length,
        0,
      ),
      quotedWordCount: row.evidenceSegments.reduce(
        (sum, segment) => sum + words(segment.verbatimEvidence),
        0,
      ),
      evidenceSegmentCount: row.evidenceSegments.length,
      sourceSnapshots,
    },
    diagnostics: [],
  };
}

export function validateCfxGroundingResponse(input: {
  rawOutput: unknown;
  expectedPropositionIds: string[];
  article: CfxFrozenArticle;
}): CfxGroundingValidation {
  const acceptedRows: CfxValidatedGrounding[] = [];
  const rejectedRows: CfxRejectedGrounding[] = [];
  const diagnostics: CfxDiagnostic[] = [];
  const root = input.rawOutput as { groundings?: unknown } | null;
  if (
    !root
    || typeof root !== "object"
    || !Array.isArray(root.groundings)
  ) {
    const problem = diagnostic(
      "GROUNDING_ROOT_SCHEMA_FAILURE",
      "Provider output must contain a groundings array",
    );
    return {
      status: "FAIL",
      acceptedRows: [],
      rejectedRows: input.expectedPropositionIds.map((propositionId) => ({
        propositionId,
        rawRow: null,
        diagnostics: [problem],
        validationStatus: "rejected",
      })),
      diagnostics: [problem],
    };
  }
  const expected = new Set(input.expectedPropositionIds);
  const seen = new Set<string>();
  root.groundings.forEach((rawRow, rowIndex) => {
    const parsed = cfxGroundingRowSchema.safeParse(rawRow);
    if (!parsed.success) {
      const rawPropositionId =
        typeof (rawRow as { propositionId?: unknown })?.propositionId
          === "string"
          ? (rawRow as { propositionId: string }).propositionId
          : null;
      if (rawPropositionId && expected.has(rawPropositionId)) {
        seen.add(rawPropositionId);
      }
      const rowDiagnostics = parsed.error.issues.map((issue) => diagnostic(
        "GROUNDING_ROW_SCHEMA_FAILURE",
        issue.message,
        rawPropositionId ?? undefined,
        `groundings.${rowIndex}.${issue.path.join(".")}`,
      ));
      diagnostics.push(...rowDiagnostics);
      rejectedRows.push({
        propositionId: rawPropositionId,
        rawRow,
        diagnostics: rowDiagnostics,
        validationStatus: "rejected",
      });
      return;
    }
    const row = parsed.data;
    if (!expected.has(row.propositionId)) {
      const problem = diagnostic(
        "UNEXPECTED_PROPOSITION_ID",
        `Unexpected proposition ID ${row.propositionId}`,
        row.propositionId,
      );
      diagnostics.push(problem);
      rejectedRows.push({
        propositionId: row.propositionId,
        rawRow,
        diagnostics: [problem],
        validationStatus: "rejected",
      });
      return;
    }
    if (seen.has(row.propositionId)) {
      const problem = diagnostic(
        "DUPLICATE_PROPOSITION_ID",
        `Duplicate result for ${row.propositionId}`,
        row.propositionId,
      );
      diagnostics.push(problem);
      rejectedRows.push({
        propositionId: row.propositionId,
        rawRow,
        diagnostics: [problem],
        validationStatus: "rejected",
      });
      return;
    }
    seen.add(row.propositionId);
    const rowValidation = validateRow({ row, article: input.article });
    diagnostics.push(...rowValidation.diagnostics);
    if (rowValidation.accepted) {
      acceptedRows.push(rowValidation.accepted);
    } else {
      rejectedRows.push({
        propositionId: row.propositionId,
        rawRow,
        diagnostics: rowValidation.diagnostics,
        validationStatus: "rejected",
      });
    }
  });
  for (const propositionId of input.expectedPropositionIds) {
    if (seen.has(propositionId)) continue;
    const problem = diagnostic(
      "MISSING_PROPOSITION_ID",
      `Missing grounding result for ${propositionId}`,
      propositionId,
    );
    diagnostics.push(problem);
    rejectedRows.push({
      propositionId,
      rawRow: null,
      diagnostics: [problem],
      validationStatus: "rejected",
    });
  }
  return {
    status: diagnostics.length === 0 ? "PASS" : "FAIL",
    acceptedRows,
    rejectedRows,
    diagnostics,
  };
}
