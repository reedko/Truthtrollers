import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCfxGroundingResponse,
} from "../../../src/claimfoundry/cfx/grounding/validateGrounding.js";
import type {
  CfxFrozenArticle,
  CfxGroundingRow,
} from "../../../src/claimfoundry/cfx/types/index.js";

const canonicalText = "Alpha claim. Beta claim. Gamma claim.";
const article: CfxFrozenArticle = {
  fixtureId: "synthetic",
  fixturePath: "/synthetic",
  fixtureFileSha256: "fixture",
  articleTextSha256: "article",
  normalizedArticleHash: "normalized",
  sourceUnitManifestHash: "units",
  articleTitle: "Synthetic",
  articleText: canonicalText,
  canonicalText,
  articleCharacterCount: canonicalText.length,
  sourceUnitCount: 3,
  sourceUnits: [
    { unitId: "U0001", text: "Alpha claim.", charStart: 0, charEnd: 12 },
    { unitId: "U0002", text: "Beta claim.", charStart: 13, charEnd: 24 },
    { unitId: "U0003", text: "Gamma claim.", charStart: 25, charEnd: 37 },
  ],
  unitProjection: "",
  unitProjectionSha256: "projection",
};

function row(
  overrides: Partial<CfxGroundingRow> = {},
): CfxGroundingRow {
  return {
    propositionId: "P01",
    groundingStatus: "grounded_direct",
    groundingType: "direct",
    evidenceSegments: [{
      sourceUnitIds: ["U0001"],
      verbatimEvidence: "Alpha claim.",
    }],
    supportedComponents: [],
    unsupportedComponents: [],
    notes: null,
    ...overrides,
  };
}

test("validator accepts direct one-unit and contiguous multi-unit grounding", () => {
  const one = validateCfxGroundingResponse({
    rawOutput: { groundings: [row()] },
    expectedPropositionIds: ["P01"],
    article,
  });
  assert.equal(one.status, "PASS");
  assert.equal(one.acceptedRows[0]?.quotedCharacterCount, 12);

  const multi = validateCfxGroundingResponse({
    rawOutput: {
      groundings: [row({
        evidenceSegments: [{
          sourceUnitIds: ["U0001", "U0002"],
          verbatimEvidence: "Alpha claim. Beta claim.",
        }],
      })],
    },
    expectedPropositionIds: ["P01"],
    article,
  });
  assert.equal(multi.status, "PASS");
  assert.equal(multi.acceptedRows[0]?.citedUnitCount, 2);
});

test("validator accepts distributed, attributed, partial, ambiguous, and unsupported results", () => {
  const cases: CfxGroundingRow[] = [
    row({
      groundingStatus: "grounded_distributed",
      groundingType: "distributed",
      evidenceSegments: [
        { sourceUnitIds: ["U0001"], verbatimEvidence: "Alpha claim." },
        { sourceUnitIds: ["U0003"], verbatimEvidence: "Gamma claim." },
      ],
    }),
    row({
      groundingStatus: "grounded_attributed",
      groundingType: "attributed",
    }),
    row({
      groundingStatus: "partial",
      groundingType: "partial",
      supportedComponents: ["alpha"],
      unsupportedComponents: ["delta"],
    }),
    row({
      groundingStatus: "ambiguous",
      groundingType: "ambiguous",
      notes: "Two materially different readings remain.",
    }),
    row({
      groundingStatus: "unsupported",
      groundingType: "none",
      evidenceSegments: [],
    }),
  ];
  for (const value of cases) {
    const result = validateCfxGroundingResponse({
      rawOutput: { groundings: [value] },
      expectedPropositionIds: ["P01"],
      article,
    });
    assert.equal(result.status, "PASS", value.groundingStatus);
  }
});

test("validator rejects exact-quote mismatch, unknown units, order errors, and fused non-contiguous units independently", () => {
  const invalidRows = [
    row({
      propositionId: "P01",
      evidenceSegments: [{
        sourceUnitIds: ["U0001"],
        verbatimEvidence: "Altered claim.",
      }],
    }),
    row({
      propositionId: "P02",
      evidenceSegments: [{
        sourceUnitIds: ["U9999"],
        verbatimEvidence: "Unknown.",
      }],
    }),
    row({
      propositionId: "P03",
      evidenceSegments: [{
        sourceUnitIds: ["U0002", "U0001"],
        verbatimEvidence: "Alpha claim. Beta claim.",
      }],
    }),
    row({
      propositionId: "P04",
      evidenceSegments: [{
        sourceUnitIds: ["U0001", "U0003"],
        verbatimEvidence: "Alpha claim. Beta claim. Gamma claim.",
      }],
    }),
  ];
  const result = validateCfxGroundingResponse({
    rawOutput: { groundings: invalidRows },
    expectedPropositionIds: ["P01", "P02", "P03", "P04"],
    article,
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.acceptedRows.length, 0);
  assert.equal(result.rejectedRows.length, 4);
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.ok(codes.has("EXACT_SUBSTRING_FAILURE"));
  assert.ok(codes.has("UNKNOWN_UNIT_ID"));
  assert.ok(codes.has("UNIT_ORDER_VIOLATION"));
  assert.ok(codes.has("NON_CONTIGUOUS_SEGMENT"));
});

test("coverage validation reports malformed, duplicate, missing, and unexpected rows without discarding valid siblings", () => {
  const result = validateCfxGroundingResponse({
    rawOutput: {
      groundings: [
        row({ propositionId: "P01" }),
        row({ propositionId: "P01" }),
        row({ propositionId: "P99" }),
        { propositionId: "P02", assertion: "prohibited mutation" },
      ],
    },
    expectedPropositionIds: ["P01", "P02", "P03"],
    article,
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.acceptedRows.length, 1);
  assert.equal(result.acceptedRows[0]?.propositionId, "P01");
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.ok(codes.has("DUPLICATE_PROPOSITION_ID"));
  assert.ok(codes.has("UNEXPECTED_PROPOSITION_ID"));
  assert.ok(codes.has("GROUNDING_ROW_SCHEMA_FAILURE"));
  assert.ok(codes.has("MISSING_PROPOSITION_ID"));
});

test("status/type mismatch, duplicate units, and prohibited mutation fields are rejected", () => {
  const result = validateCfxGroundingResponse({
    rawOutput: {
      groundings: [
        row({
          propositionId: "P01",
          groundingType: "distributed",
        }),
        row({
          propositionId: "P02",
          evidenceSegments: [{
            sourceUnitIds: ["U0001", "U0001"],
            verbatimEvidence: "Alpha claim.",
          }],
        }),
        {
          ...row({ propositionId: "P03" }),
          rewrittenAssertion: "A forbidden replacement",
        },
      ],
    },
    expectedPropositionIds: ["P01", "P02", "P03"],
    article,
  });
  assert.equal(result.status, "FAIL");
  const codes = new Set(result.diagnostics.map((item) => item.code));
  assert.ok(codes.has("STATUS_TYPE_MISMATCH"));
  assert.ok(codes.has("DUPLICATE_UNIT_ID"));
  assert.ok(codes.has("GROUNDING_ROW_SCHEMA_FAILURE"));
});
