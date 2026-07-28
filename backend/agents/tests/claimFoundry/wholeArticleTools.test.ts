import assert from "node:assert/strict";
import test from "node:test";
import { articleDocumentFromText } from "../../../src/claim-foundry/article-document/index.js";
import { deriveContentRegions } from "../../claimFoundry/claimFoundryCoverage.js";
import {
  hashValue,
  MemoryClaimFoundryPersistence,
} from "../../claimFoundry/claimFoundryPersistence.js";
import { createRunState } from "../../claimFoundry/claimFoundryState.js";
import {
  createWholeArticleClaimFoundryTools,
  wholeArticleToolSchemas,
} from "../../claimFoundry/claimFoundryWholeArticleTools.js";
import { claim, document } from "./fixtures.js";

async function setup(runId: string) {
  return setupDocument(runId, document);
}

async function setupDocument(runId: string, articleDocument: typeof document) {
  const persistence = new MemoryClaimFoundryPersistence();
  const sourceUnitManifestHash = hashValue(
    articleDocument.sourceUnits.map(unit => ({
      unitId: unit.unitId,
      text: unit.text,
      sourceOffsets: unit.sourceOffsets,
    })),
  );
  await persistence.create(createRunState({
    runId,
    contentId: "content-1",
    contentHash: articleDocument.contentHash,
    sourceUnitManifestHash,
    budgets: {
      maxToolCalls: 30,
      maxUnitsRead: 1,
      maxRepairRounds: 0,
      maxInputTokens: 100_000,
    },
    contentRegions: deriveContentRegions(articleDocument),
    traceId: null,
    versions: {
      instruction: "cf6.wholeArticle.instructions.v2.1",
      toolSchema: "cf6.wholeArticle.tools.v2.1",
      model: "none",
      code: "cf6.wholeArticle.v2.1",
    },
  }));
  const context = {
    runId,
    contentId: "content-1",
    articleDocument,
    persistence,
  };
  return {
    persistence,
    tools: createWholeArticleClaimFoundryTools(context),
  };
}

function fourRegionDocument() {
  return articleDocumentFromText({
    text: [
      "# First",
      "Claim-bearing text.",
      "## Second",
      "Explicitly dispositioned text.",
      "## Third",
      "Bulk-dispositioned text.",
      "## Fourth",
      "Exception text.",
    ].join("\n\n"),
    metadata: { title: "Four structural regions" },
  }) as typeof document;
}

function firstClaimUnit(articleDocument: typeof document) {
  const unit = articleDocument.sourceUnits.find(sourceUnit =>
    sourceUnit.text.includes("Claim-bearing text."));
  assert.ok(unit);
  return unit.unitId;
}

function fourRegionTheses(articleDocument: typeof document) {
  const unitId = firstClaimUnit(articleDocument);
  return [{
    thesisId: "T1",
    statement: "The first region contains the selected assertion.",
    groundingUnitIds: [unitId],
  }, {
    thesisId: "T2",
    statement: "A second declared thesis remains independently accountable.",
    groundingUnitIds: [unitId],
  }];
}

function fourRegionClaim(articleDocument: typeof document) {
  const unitId = firstClaimUnit(articleDocument);
  return {
    ...claim("C1", unitId),
    thesisIds: ["T1"],
    thesisEffect: "Represents the selected assertion from the first region.",
  };
}

function thesis() {
  return {
    thesisId: "T1",
    statement: "The article reports a quantified rainfall increase.",
    groundingUnitIds: [document.sourceUnits[1]!.unitId],
  };
}

function wholeClaim() {
  return {
    ...claim("C1", document.sourceUnits[1]!.unitId),
    thesisIds: ["T1"],
    thesisEffect: "Provides the central quantified representation.",
  };
}

test("four-tool state surface updates, mirrors, dispositions, and finalizes", async () => {
  const run = await setup("whole-tools-complete");
  const first = await run.tools.update_working_package({
    idempotencyKey: "whole-update-first",
    expectedPackageRevision: 0,
    setTheses: [thesis()],
    upsertClaims: [wholeClaim()],
  });
  assert.equal(first.result.packageRevision, 1);
  assert.equal(JSON.stringify(first.result).includes(document.sourceUnits[1]!.text), false);

  const inspection = await run.tools.inspect_working_package({
    idempotencyKey: "whole-inspect-first",
    expectedPackageRevision: 1,
  });
  assert.ok(inspection.result.coveredRegionIds.length > 0);
  assert.equal(inspection.result.linkedThesisIds.includes("T1"), true);
  assert.equal(JSON.stringify(inspection.result).includes(document.sourceUnits[1]!.text), false);

  const disposed = await run.tools.update_working_package({
    idempotencyKey: "whole-update-dispose",
    expectedPackageRevision: 1,
    ...(inspection.result.unaccountedRegionIds.length > 0
      ? {
          setRegionDispositions: inspection.result.unaccountedRegionIds.map(regionId => ({
            regionId,
            reasonCode: "NO_SELECTED_TARGET",
          })),
        }
      : {
          upsertClaims: [{
            ...wholeClaim(),
            selectionRationale: "Reaffirmed after inspecting the complete source.",
          }],
        }),
  });
  assert.equal(disposed.result.packageRevision, 2);

  const clean = await run.tools.inspect_working_package({
    idempotencyKey: "whole-inspect-clean",
    expectedPackageRevision: 2,
  });
  assert.equal(clean.result.deterministicClean, true);
  assert.deepEqual(clean.result.unaccountedRegionIds, []);
  assert.deepEqual(clean.result.unaccountedThesisIds, []);

  const final = await run.tools.finalize_working_package({
    idempotencyKey: "whole-finalize-clean",
    expectedPackageRevision: 2,
    expectedPackageHash: clean.result.packageHash,
    inspectionId: clean.result.inspectionId,
  });
  assert.equal(final.result.status, "completed");
  assert.equal(final.state.status, "completed");
  assert.equal(final.state.wholeArticleWorkingPackage?.status, "final");
  assert.equal(final.state.wholeArticleWorkingPackage?.finalPackageId,
    final.result.finalPackageId);
  const immutable = await run.persistence.loadWholeArticleFinalPackage(
    final.result.finalPackageId,
  );
  assert.equal(immutable?.packageHash, final.result.finalPackageHash);
  assert.equal(immutable?.status, "final");

  await assert.rejects(
    run.tools.inspect_working_package({
      idempotencyKey: "whole-after-terminal",
      expectedPackageRevision: 2,
    }),
    /TERMINAL_RUN/,
  );
});

test("update can finalize clean current state without a separate inspection", async () => {
  const articleDocument = fourRegionDocument();
  const run = await setupDocument(
    "whole-tools-atomic-finalize-clean",
    articleDocument,
  );
  const updated = await run.tools.update_working_package({
    idempotencyKey: "atomic-finalize-update",
    expectedPackageRevision: 0,
    setTheses: [fourRegionTheses(articleDocument)[0]!],
    upsertClaims: [fourRegionClaim(articleDocument)],
    dispositionRemainingRegions: {
      reasonCode: "NO_MATERIAL_ASSERTION",
    },
  });

  const finalized = await run.tools.finalize_working_package({
    idempotencyKey: "atomic-finalize-direct",
    expectedPackageRevision: updated.result.packageRevision,
    expectedPackageHash: updated.result.packageHash,
    inspectionId: "I-STALE-OPTIONAL-MIRROR",
  });

  assert.equal(finalized.result.status, "completed");
  assert.equal(finalized.state.status, "completed");
  const finalPackage = finalized.state.wholeArticleWorkingPackage;
  assert.equal(finalPackage?.status, "final");
  assert.equal(finalPackage?.latestInspection?.deterministicClean, true);
  assert.equal(
    finalPackage?.latestInspection?.packageRevision,
    updated.result.packageRevision,
  );
  assert.equal(
    finalPackage?.latestInspection?.packageHash,
    updated.result.packageHash,
  );
  const immutable = await run.persistence.loadWholeArticleFinalPackage(
    finalized.result.finalPackageId,
  );
  assert.deepEqual(immutable, finalPackage);
  await assert.rejects(
    run.tools.update_working_package({
      idempotencyKey: "atomic-finalize-immutable",
      expectedPackageRevision: updated.result.packageRevision,
      setTheses: [fourRegionTheses(articleDocument)[0]!],
    }),
    /TERMINAL_RUN/,
  );
  const events = await run.persistence.events(
    "whole-tools-atomic-finalize-clean",
  );
  assert.deepEqual(
    events.slice(0, 2).map(event => [event.toolName, event.status]),
    [
      ["update_working_package", "completed"],
      ["finalize_working_package", "completed"],
    ],
  );
  assert.equal(
    events.some(event => event.toolName === "inspect_working_package"),
    false,
  );
});

test("blocked finalization persists the same current deterministic defects as inspection", async () => {
  const articleDocument = fourRegionDocument();
  const regions = deriveContentRegions(articleDocument);
  const exception = regions.at(-1)!.regionId;
  const updateArgs = {
    expectedPackageRevision: 0,
    setTheses: [fourRegionTheses(articleDocument)[0]!],
    upsertClaims: [fourRegionClaim(articleDocument)],
    dispositionRemainingRegions: {
      reasonCode: "NO_MATERIAL_ASSERTION",
      exceptions: [exception],
    },
  };
  const mirror = await setupDocument(
    "whole-tools-finalize-defect-mirror",
    articleDocument,
  );
  await mirror.tools.update_working_package({
    idempotencyKey: "defect-mirror-update",
    ...updateArgs,
  });
  const separateInspection = await mirror.tools.inspect_working_package({
    idempotencyKey: "defect-mirror-inspect",
    expectedPackageRevision: 1,
  });

  const direct = await setupDocument(
    "whole-tools-finalize-defect-direct",
    articleDocument,
  );
  const updated = await direct.tools.update_working_package({
    idempotencyKey: "defect-direct-update",
    ...updateArgs,
  });
  await assert.rejects(
    direct.tools.finalize_working_package({
      idempotencyKey: "defect-direct-finalize",
      expectedPackageRevision: updated.result.packageRevision,
      expectedPackageHash: updated.result.packageHash,
      inspectionId: "I-NO-PRIOR-INSPECTION",
    }),
    /DETERMINISTIC_DEFECTS_REMAIN/,
  );

  const persisted = await direct.persistence.load(
    "whole-tools-finalize-defect-direct",
  );
  const internalInspection =
    persisted?.wholeArticleWorkingPackage?.latestInspection;
  assert.ok(internalInspection);
  assert.equal(persisted.status, "validating");
  assert.equal(persisted.finalPackageId, null);
  assert.equal(internalInspection.packageRevision, updated.result.packageRevision);
  assert.equal(internalInspection.packageHash, updated.result.packageHash);
  assert.deepEqual(
    internalInspection.deterministicDiagnostics,
    separateInspection.result.deterministicDiagnostics,
  );
  assert.deepEqual(
    internalInspection.unaccountedRegionIds,
    separateInspection.result.unaccountedRegionIds,
  );
  assert.deepEqual(
    internalInspection.unaccountedThesisIds,
    separateInspection.result.unaccountedThesisIds,
  );
  assert.deepEqual(
    internalInspection.claimIdsWithoutThesis,
    separateInspection.result.claimIdsWithoutThesis,
  );
  const events = await direct.persistence.events(
    "whole-tools-finalize-defect-direct",
  );
  assert.deepEqual(
    events.map(event => [event.toolName, event.status]),
    [
      ["update_working_package", "completed"],
      ["finalize_working_package", "failed"],
    ],
  );
  assert.notEqual(events[1]?.beforeStateHash, events[1]?.afterStateHash);
});

test("mutation is atomic and rejects stale revisions, foreign grounding, and references", async () => {
  const run = await setup("whole-tools-invalid");
  await assert.rejects(
    run.tools.update_working_package({
      idempotencyKey: "whole-invalid-ground",
      expectedPackageRevision: 0,
      setTheses: [{
        thesisId: "T1",
        statement: "Foreign",
        groundingUnitIds: ["U9999"],
      }],
    }),
    /INVALID_GROUNDING/,
  );
  assert.equal((await run.persistence.load("whole-tools-invalid"))
    ?.wholeArticleWorkingPackage, null);

  await run.tools.update_working_package({
    idempotencyKey: "whole-valid-first",
    expectedPackageRevision: 0,
    setTheses: [thesis()],
  });
  await assert.rejects(
    run.tools.update_working_package({
      idempotencyKey: "whole-stale-revision",
      expectedPackageRevision: 0,
      upsertClaims: [wholeClaim()],
    }),
    /STALE_PACKAGE_REVISION/,
  );
  await assert.rejects(
    run.tools.update_working_package({
      idempotencyKey: "whole-invalid-thesis",
      expectedPackageRevision: 1,
      upsertClaims: [{ ...wholeClaim(), thesisIds: ["T-UNKNOWN"] }],
    }),
    /INVALID_REFERENCE/,
  );
  const state = await run.persistence.load("whole-tools-invalid");
  assert.equal(state?.wholeArticleWorkingPackage?.packageRevision, 1);
  assert.deepEqual(state?.wholeArticleWorkingPackage?.claims, []);
});

test("terminal alternative persists compact abstention or review without package text", async () => {
  const abstain = await setup("whole-tools-abstain");
  const result = await abstain.tools.abstain_or_request_review({
    idempotencyKey: "whole-abstain-terminal",
    mode: "abstain",
    reasonCode: "INADEQUATE_SOURCE",
    reason: "The supplied content is inadequate for a grounded package.",
  });
  assert.deepEqual(result.result, {
    status: "abstained",
    reasonCode: "INADEQUATE_SOURCE",
  });
  assert.equal(result.state.status, "abstained");

  const review = await setup("whole-tools-review");
  const requested = await review.tools.abstain_or_request_review({
    idempotencyKey: "whole-review-terminal",
    mode: "request_review",
    reasonCode: "UNRESOLVED_AMBIGUITY",
    reason: "Supplier identity remains unresolved.",
  });
  assert.equal(requested.result.status, "awaiting_review");
  assert.equal(requested.state.status, "awaiting_review");
});

test("bulk region disposition expands exact remaining regions atomically with audit identity", async () => {
  const articleDocument = fourRegionDocument();
  const regions = deriveContentRegions(articleDocument);
  assert.equal(regions.length, 4);
  const [covered, explicit, bulk, exception] = regions.map(region =>
    region.regionId);
  const run = await setupDocument("whole-tools-bulk-regions", articleDocument);

  const updated = await run.tools.update_working_package(
    {
      idempotencyKey: "bulk-regions-update-1",
      expectedPackageRevision: 0,
      setTheses: [fourRegionTheses(articleDocument)[0]!],
      upsertClaims: [fourRegionClaim(articleDocument)],
      setRegionDispositions: [{
        regionId: explicit!,
        reasonCode: "EXPLICIT_DISPOSITION",
        note: "The model chose an individual disposition.",
      }],
      dispositionRemainingRegions: {
        reasonCode: "NO_MATERIAL_ASSERTION",
        optionalNote: "Considered against the complete article.",
        exceptions: [exception!],
      },
    },
    { toolCallId: "call-bulk-regions-update-1" },
  );

  assert.equal(updated.result.packageRevision, 1);
  assert.equal(updated.result.bulkDispositionCount, 1);
  assert.deepEqual(updated.result.bulkDispositionRegionIds, [bulk]);
  assert.deepEqual(
    updated.result.changedRegionDispositionIds,
    [explicit, bulk],
  );
  assert.equal(JSON.stringify(updated.result).includes("Bulk-dispositioned text."), false);

  const state = await run.persistence.load("whole-tools-bulk-regions");
  const pkg = state?.wholeArticleWorkingPackage;
  assert.equal(pkg?.packageRevision, 1);
  assert.equal(pkg?.latestInspection, null);
  assert.equal(pkg?.regionDispositions.length, 2);
  assert.deepEqual(pkg?.regionDispositions.find(item =>
    item.regionId === explicit), {
    regionId: explicit,
    reasonCode: "EXPLICIT_DISPOSITION",
    note: "The model chose an individual disposition.",
  });
  assert.deepEqual(pkg?.regionDispositions.find(item =>
    item.regionId === bulk), {
    regionId: bulk,
    reasonCode: "NO_MATERIAL_ASSERTION",
    note: "Considered against the complete article.",
    dispositionMode: "bulk",
    originatingToolCallId: "call-bulk-regions-update-1",
  });
  assert.equal(pkg?.regionDispositions.some(item =>
    item.regionId === covered || item.regionId === exception), false);
  const replay = await run.tools.update_working_package(
    {
      idempotencyKey: "bulk-regions-update-1",
      expectedPackageRevision: 0,
      setTheses: [fourRegionTheses(articleDocument)[0]!],
      upsertClaims: [fourRegionClaim(articleDocument)],
      setRegionDispositions: [{
        regionId: explicit!,
        reasonCode: "EXPLICIT_DISPOSITION",
        note: "The model chose an individual disposition.",
      }],
      dispositionRemainingRegions: {
        reasonCode: "NO_MATERIAL_ASSERTION",
        optionalNote: "Considered against the complete article.",
        exceptions: [exception!],
      },
    },
    { toolCallId: "call-bulk-regions-update-1" },
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, updated.result);
  const events = await run.persistence.events("whole-tools-bulk-regions");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, "completed");
});

test("invalid bulk exceptions fail atomically before package mutation", async () => {
  const articleDocument = fourRegionDocument();
  const run = await setupDocument(
    "whole-tools-bulk-invalid-exception",
    articleDocument,
  );

  await assert.rejects(
    run.tools.update_working_package({
      idempotencyKey: "bulk-invalid-exception-1",
      expectedPackageRevision: 0,
      setTheses: [fourRegionTheses(articleDocument)[0]!],
      dispositionRemainingRegions: {
        reasonCode: "NO_MATERIAL_ASSERTION",
        exceptions: ["R-DOES-NOT-EXIST"],
      },
    }),
    /INVALID_REFERENCE/,
  );

  const state = await run.persistence.load("whole-tools-bulk-invalid-exception");
  assert.equal(state?.wholeArticleWorkingPackage, null);
  assert.equal(state?.counters.toolCalls, 0);
  const events = await run.persistence.events(
    "whole-tools-bulk-invalid-exception",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0]?.status, "failed");
});

test("inspection and finalization retain region and thesis accounting gates without host auto-disposition", async () => {
  const articleDocument = fourRegionDocument();
  const regions = deriveContentRegions(articleDocument);
  const [, explicit, bulk, exception] = regions.map(region => region.regionId);
  const run = await setupDocument("whole-tools-accounting-gates", articleDocument);

  await run.tools.update_working_package({
    idempotencyKey: "accounting-update-1",
    expectedPackageRevision: 0,
    setTheses: [fourRegionTheses(articleDocument)[0]!],
    upsertClaims: [fourRegionClaim(articleDocument)],
    setRegionDispositions: [{
      regionId: explicit!,
      reasonCode: "INDIVIDUAL_EXCLUSION",
    }],
    dispositionRemainingRegions: {
      reasonCode: "NO_MATERIAL_ASSERTION",
      exceptions: [exception!],
    },
  });
  const inspected = await run.tools.inspect_working_package({
    idempotencyKey: "accounting-inspect-1",
    expectedPackageRevision: 1,
  });
  assert.deepEqual(inspected.result.unaccountedRegionIds, [exception]);
  assert.deepEqual(inspected.result.unaccountedThesisIds, []);
  assert.equal(inspected.result.dispositionedRegionIds.includes(bulk!), true);

  const beforeFailedFinalize = structuredClone(
    inspected.state.wholeArticleWorkingPackage?.regionDispositions,
  );
  await assert.rejects(
    run.tools.finalize_working_package({
      idempotencyKey: "accounting-finalize-blocked",
      expectedPackageRevision: 1,
      expectedPackageHash: inspected.result.packageHash,
      inspectionId: inspected.result.inspectionId,
    }),
    /DETERMINISTIC_DEFECTS_REMAIN/,
  );
  const afterFailedFinalize = await run.persistence.load(
    "whole-tools-accounting-gates",
  );
  assert.deepEqual(
    afterFailedFinalize?.wholeArticleWorkingPackage?.regionDispositions,
    beforeFailedFinalize,
  );

  await run.tools.update_working_package({
    idempotencyKey: "accounting-update-2",
    expectedPackageRevision: 1,
    setTheses: fourRegionTheses(articleDocument),
    setRegionDispositions: [{
      regionId: exception!,
      reasonCode: "INDIVIDUAL_EXCLUSION",
    }],
    setThesisDispositions: [{
      thesisId: "T2",
      reasonCode: "DUPLICATIVE_THESIS",
    }],
  });
  const clean = await run.tools.inspect_working_package({
    idempotencyKey: "accounting-inspect-2",
    expectedPackageRevision: 2,
  });
  assert.equal(clean.result.deterministicClean, true);
  assert.deepEqual(clean.result.unaccountedRegionIds, []);
  assert.deepEqual(clean.result.unaccountedThesisIds, []);
  const final = await run.tools.finalize_working_package({
    idempotencyKey: "accounting-finalize-clean",
    expectedPackageRevision: 2,
    expectedPackageHash: clean.result.packageHash,
    inspectionId: clean.result.inspectionId,
  });
  assert.equal(final.result.status, "completed");
});

test("bulk region action has no thesis counterpart and cannot satisfy thesis accounting", async () => {
  const schemaResult = wholeArticleToolSchemas.updateWorkingPackage.safeParse({
    idempotencyKey: "schema-no-bulk-theses",
    expectedPackageRevision: 0,
    dispositionRemainingTheses: {
      reasonCode: "NO_MATERIAL_ASSERTION",
    },
  });
  assert.equal(schemaResult.success, false);

  const articleDocument = fourRegionDocument();
  const run = await setupDocument("whole-tools-no-bulk-theses", articleDocument);
  await run.tools.update_working_package({
    idempotencyKey: "bulk-regions-not-theses",
    expectedPackageRevision: 0,
    setTheses: fourRegionTheses(articleDocument),
    upsertClaims: [fourRegionClaim(articleDocument)],
    dispositionRemainingRegions: {
      reasonCode: "NO_MATERIAL_ASSERTION",
    },
  });
  const inspected = await run.tools.inspect_working_package({
    idempotencyKey: "bulk-regions-inspect",
    expectedPackageRevision: 1,
  });
  assert.deepEqual(inspected.result.unaccountedRegionIds, []);
  assert.deepEqual(inspected.result.unaccountedThesisIds, ["T2"]);
  await assert.rejects(
    run.tools.finalize_working_package({
      idempotencyKey: "bulk-regions-thesis-blocked",
      expectedPackageRevision: 1,
      expectedPackageHash: inspected.result.packageHash,
      inspectionId: inspected.result.inspectionId,
    }),
    /DETERMINISTIC_DEFECTS_REMAIN/,
  );
});
