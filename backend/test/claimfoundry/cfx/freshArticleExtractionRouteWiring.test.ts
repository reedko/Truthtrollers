import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import createContentScrapeRoutes from "../../../src/routes/content/content.scrape.routes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const routePath = path.join(repositoryRoot, "backend/src/routes/content/content.scrape.routes.js");
const pipelinePath = path.join(repositoryRoot, "backend/src/services/cfxProductionEvidencePipeline.js");

async function loadBranches() {
  const source = await readFile(routePath, "utf8");
  const ifIndex = source.indexOf("if (!legacyCaseAssertionExtractionEnabled) {");
  const elseIndex = source.indexOf("} else {", ifIndex);
  const anchorIndex = source.indexOf("usageBeforeEvidence = getOpenAiUsageCapture();", elseIndex);
  assert.ok(ifIndex >= 0, "CFX mode-switch branch must exist in the route");
  assert.ok(elseIndex > ifIndex, "legacy else-branch must exist after the CFX branch");
  assert.ok(anchorIndex > elseIndex, "the extraction if/else block must end before evidence-usage capture");
  return {
    source,
    cfxBranch: source.slice(ifIndex, elseIndex),
    legacyBranch: source.slice(elseIndex, anchorIndex),
  };
}

test("the extraction mode switch is CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED, and CFX is the default", async () => {
  const { source } = await loadBranches();
  assert.match(source, /CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED/u);
  assert.match(
    source,
    /legacyCaseAssertionExtractionEnabled = process\.env\.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED === "true"/u,
  );
  // The CFX path must be the `if (!legacyCaseAssertionExtractionEnabled)` branch,
  // i.e. selected when the flag is unset/false -- CFX is the default.
  assert.match(source, /if \(!legacyCaseAssertionExtractionEnabled\) \{/u);
});

test("CFX mode (the default) never calls processTaskClaims or mapArgumentFunctions", async () => {
  const { cfxBranch } = await loadBranches();
  assert.doesNotMatch(cfxBranch, /processTaskClaims/u);
  assert.doesNotMatch(cfxBranch, /mapArgumentFunctions/u);
  assert.match(cfxBranch, /runCfxCaseAssertionExtractionStage/u);
  assert.match(cfxBranch, /createOpenAiCf7StructuredProvider/u);
  assert.match(cfxBranch, /claimIds = extraction\.claimIds/u);
});

test("legacy rollback mode still calls both processTaskClaims and mapArgumentFunctions", async () => {
  const { legacyBranch } = await loadBranches();
  assert.match(legacyBranch, /processTaskClaims/u);
  assert.match(legacyBranch, /mapArgumentFunctions/u);
  assert.match(legacyBranch, /claimIds = mappedTaskClaims\.map/u);
});

test("no mappedTaskClaims fields (argumentFunction, speakerEntity, etc.) are required by the CFX branch", async () => {
  const { cfxBranch } = await loadBranches();
  for (const pattern of [/mappedTaskClaims/u, /argumentFunction/u, /speakerEntity/u, /objectClaim/u]) {
    assert.doesNotMatch(cfxBranch, pattern, `CFX branch must not reference ${pattern}`);
  }
});

test("CFX mode hard-fails with no local catch-and-fallback to legacy extraction", async () => {
  const { cfxBranch } = await loadBranches();
  assert.doesNotMatch(cfxBranch, /catch/u, "a local catch here would let a CFX failure silently fall back to legacy");
});

test("taskClaims/mappedTaskClaims are left undefined, not defaulted to an empty array, ahead of the mode switch", async () => {
  const { source } = await loadBranches();
  assert.match(source, /let taskClaims;/u);
  assert.match(source, /let mappedTaskClaims;/u);
  assert.doesNotMatch(source, /let taskClaims = \[\];/u);
  assert.doesNotMatch(source, /let mappedTaskClaims = \[\];/u);
});

test("both extraction modes feed claimIds unchanged into the existing runCfxProductionEvidencePipeline call", async () => {
  const { source } = await loadBranches();
  const pipelineCallIndex = source.indexOf("await runCfxProductionEvidencePipeline({");
  assert.ok(pipelineCallIndex >= 0);
  const pipelineCallSection = source.slice(pipelineCallIndex, pipelineCallIndex + 300);
  assert.match(pipelineCallSection, /claimIds,/u);
  assert.match(pipelineCallSection, /query,/u);
  assert.match(pipelineCallSection, /pool,/u);
});

test("the existing evidence pipeline function's exported call signature is unmodified", async () => {
  const pipelineSource = await readFile(pipelinePath, "utf8");
  assert.match(
    pipelineSource,
    /export async function runCfxProductionEvidencePipeline\(\{\s*\n\s*query,\s*\n\s*pool,\s*\n\s*taskContentId,\s*\n\s*claimIds,\s*\n\s*userId = null,/u,
  );
});

test("startup rejects CFX_LEGACY_EVIDENCE_ENABLED=true without CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED=true", () => {
  const savedLegacyEvidence = process.env.CFX_LEGACY_EVIDENCE_ENABLED;
  const savedLegacyExtraction = process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
  try {
    process.env.CFX_LEGACY_EVIDENCE_ENABLED = "true";
    delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    assert.throws(
      () => createContentScrapeRoutes({ query: async () => [], pool: null }),
      /Incompatible CFX flag combination/u,
      "the incompatible combination must be rejected before the router (and any DB-touching startup work) is created",
    );
  } finally {
    if (savedLegacyEvidence === undefined) delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    else process.env.CFX_LEGACY_EVIDENCE_ENABLED = savedLegacyEvidence;
    if (savedLegacyExtraction === undefined) delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    else process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = savedLegacyExtraction;
  }
});

test("startup does not reject when both flags are legacy, or when both are left at their CFX defaults", () => {
  const savedLegacyEvidence = process.env.CFX_LEGACY_EVIDENCE_ENABLED;
  const savedLegacyExtraction = process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
  try {
    delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    assert.doesNotThrow(() => createContentScrapeRoutes({ query: async () => [], pool: null }));

    process.env.CFX_LEGACY_EVIDENCE_ENABLED = "true";
    process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = "true";
    assert.doesNotThrow(() => createContentScrapeRoutes({ query: async () => [], pool: null }));
  } finally {
    if (savedLegacyEvidence === undefined) delete process.env.CFX_LEGACY_EVIDENCE_ENABLED;
    else process.env.CFX_LEGACY_EVIDENCE_ENABLED = savedLegacyEvidence;
    if (savedLegacyExtraction === undefined) delete process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED;
    else process.env.CFX_LEGACY_CASE_ASSERTION_EXTRACTION_ENABLED = savedLegacyExtraction;
  }
});
