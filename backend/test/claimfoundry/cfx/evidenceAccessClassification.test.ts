import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCfxEvidenceAccess,
  type CfxAcquiredDocument,
} from "../../../src/claimfoundry/cfx/evidenceBearing/classifyAccess.js";

function acquired(
  overrides: Partial<CfxAcquiredDocument> = {},
): CfxAcquiredDocument {
  return {
    candidateId: "C01",
    text: "Complete document text. ".repeat(100),
    textSource: "user_assisted_browser",
    documentKind: "document",
    completeness: "complete",
    lineageType: "original",
    requestedUrl: "https://agency.gov/document",
    sourceUrl: "https://agency.gov/document",
    canonicalUrl: "https://agency.gov/document",
    doi: null,
    pmid: null,
    retrievalAttempts: [],
    ...overrides,
  };
}

test("redirected summary and pointer pages cannot become full text", () => {
  for (const lineageType of ["excerpt", "pointer"] as const) {
    const access = classifyCfxEvidenceAccess(acquired({
      sourceUrl: "https://summary.test/landing",
      lineageType,
      completeness: "complete",
    }));
    assert.equal(access.accessLevel, "substantial_excerpt");
    assert.equal(access.requestedUrl, "https://agency.gov/document");
    assert.equal(access.sourceUrl, "https://summary.test/landing");
    assert.ok(access.accessDiagnostics.some((item) =>
      item.includes(`lineage ${lineageType}`)));
  }
});

test("a complete public archive or mirror retains actual and original URLs", () => {
  for (const lineageType of ["archive", "repost"] as const) {
    const access = classifyCfxEvidenceAccess(acquired({
      textSource: lineageType === "archive"
        ? "wayback"
        : "institutional_repository",
      sourceUrl: "https://public-preservation.test/copy",
      canonicalUrl: "https://agency.gov/document",
      lineageType,
    }));
    assert.equal(access.accessLevel, "full_text");
    assert.equal(access.sourceUrl, "https://public-preservation.test/copy");
    assert.equal(access.canonicalUrl, "https://agency.gov/document");
    assert.equal(access.lineageType, lineageType);
  }
});

test("unknown completeness is an excerpt even when the acquired text is long", () => {
  const access = classifyCfxEvidenceAccess(acquired({
    completeness: "unknown",
    lineageType: "unknown",
  }));
  assert.equal(access.accessLevel, "substantial_excerpt");
  assert.ok(access.accessDiagnostics.some((item) =>
    item.includes("completeness was not established")));
});

test("failed removed source with no fallback text is unavailable", () => {
  const access = classifyCfxEvidenceAccess(acquired({
    text: null,
    documentKind: "metadata",
    completeness: "unknown",
    lineageType: "unknown",
    retrievalAttempts: [{
      method: "publisher_html",
      status: "not_found",
      url: "https://agency.gov/document",
      httpStatus: 404,
      contentType: "text/html",
      characterCount: 0,
      diagnostic: "Removed",
    }],
  }));
  assert.equal(access.accessLevel, "unavailable");
  assert.equal(access.text, null);
});
