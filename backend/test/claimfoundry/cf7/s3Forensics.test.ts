import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type {
  Cf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";
import {
  Cf7S3ForensicWriter,
} from "../../../src/claimfoundry/cf7/artifacts/S3ForensicWriter.js";
import {
  writeS3Artifacts,
  type Cf7S3RunManifest,
} from "../../../src/claimfoundry/cf7/artifacts/writeS3Artifacts.js";
import {
  runCf7S3Atomicity,
} from "../../../src/claimfoundry/cf7/atomicity/runAtomicity.js";
import type {
  Cf7S3ParentEvaluation,
  Cf7S3ParentRow,
} from "../../../src/claimfoundry/cf7/atomicity/types.js";
import type {
  Cf7SourceUnit,
} from "../../../src/claimfoundry/cf7/types/index.js";

const config = {
  model: "test-model",
  maximumConcurrency: 1,
  maxOutputTokens: 6_000,
  timeoutMs: 1_000,
  temperature: 0.1,
  retryCount: 0 as const,
  store: false as const,
};

test("failed split validation preserves raw evidence, successful parents, diagnostics, and complete accounting", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "cf7-s3-forensics-"),
  );
  try {
    const outputDirectory = path.join(temporaryRoot, "run");
    const writer = new Cf7S3ForensicWriter(outputDirectory);
    await writer.initialize();
    const unitTexts = [
      "The CDC reported the result and the board approved release.",
      "The study found no association and the agency rejected concerns.",
      "The report found no effect and the agency rejected action.",
    ];
    const units: Cf7SourceUnit[] = unitTexts.map((text, index) => ({
      unitId: `U${String(index + 1).padStart(4, "0")}`,
      text,
      charStart: index * 100,
      charEnd: index * 100 + text.length,
      regionId: "REGION-001",
      quarter: 1,
    }));
    const parents: Cf7S3ParentRow[] = units.map((unit, index) => ({
      harvestRowId: index === 1
        ? "H0216"
        : `H${String(index + 1).padStart(4, "0")}`,
      chunkId: "CHUNK-001",
      chunkIndex: 1,
      rowKind: "assertion",
      assertionText: unit.text,
      groundingUnitIds: [unit.unitId],
    }));
    const output = {
      results: [
        {
          parentHarvestRowId: parents[0]!.harvestRowId,
          action: "keep_verbatim",
        },
        {
          parentHarvestRowId: "H0216",
          action: "split",
          children: [
            {
              assertionText:
                "High exposure was associated with a 7.6-fold autism risk.",
              groundingUnitIds: ["U0002"],
            },
            {
              assertionText: "The agency rejected concerns.",
              groundingUnitIds: ["U0002"],
            },
          ],
        },
        {
          parentHarvestRowId: parents[2]!.harvestRowId,
          action: "keep_verbatim",
        },
      ],
    };
    const rawResponse = {
      id: "chatcmpl-forensic-test",
      object: "chat.completion",
      model: "test-model",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify(output),
        },
      }],
      usage: {
        prompt_tokens: 321,
        completion_tokens: 123,
        total_tokens: 444,
      },
    };
    let providerCalls = 0;
    const provider: Cf7StructuredProvider = {
      async invokeStructured() {
        providerCalls += 1;
        return {
          output,
          rawResponse,
          model: "test-model",
          usage: {
            inputTokens: 321,
            cachedInputTokens: 0,
            outputTokens: 123,
            totalTokens: 444,
          },
          responseId: "chatcmpl-forensic-test",
          requestId: "request-forensic-test",
        };
      },
    };
    const result = await runCf7S3Atomicity({
      parents,
      units,
      provider,
      config,
      forensicSink: writer,
    });

    assert.equal(providerCalls, 1);
    assert.equal(result.providerCallCount, 1);
    assert.equal(result.routedParentCount, 3);
    assert.equal(result.status, "failed");
    assert.equal(result.atomicInventory.length, 0);
    assert.deepEqual(
      result.validatedEvaluations.map((row) => row.parentHarvestRowId),
      ["H0001", "H0003"],
    );
    assert.equal(result.quarantinedRows.length, 1);
    assert.equal(result.quarantinedRows[0]!.parentHarvestRowId, "H0216");
    assert.equal(result.validatedAtomicInventory.length, 2);
    assert.equal(result.validationSummary.acceptedParentCount, 2);
    assert.equal(result.validationSummary.rejectedParentCount, 1);
    assert.equal(result.accounting.inputTokens, 321);
    assert.equal(result.accounting.outputTokens, 123);
    assert.equal(result.accounting.totalTokens, 444);
    assert.equal(result.accounting.requests[0]!.responseId, "chatcmpl-forensic-test");
    assert.equal(result.accounting.requests[0]!.requestId, "request-forensic-test");
    assert.equal(result.accounting.requests[0]!.failureStage, "validation");

    const requestDirectory = path.join(outputDirectory, "request-001");
    for (const name of [
      "request.json",
      "request_hash.txt",
      "raw_response.json",
      "raw_response_hash.txt",
      "response_metadata.json",
      "validation.json",
      "accepted_rows.json",
      "rejected_rows.json",
      "diagnostics.json",
    ]) {
      await access(path.join(requestDirectory, name));
    }
    assert.deepEqual(
      JSON.parse(await readFile(
        path.join(requestDirectory, "raw_response.json"),
        "utf8",
      )),
      rawResponse,
    );
    const rawResponseBytes = await readFile(
      path.join(requestDirectory, "raw_response.json"),
    );
    assert.equal(
      (await readFile(
        path.join(requestDirectory, "raw_response_hash.txt"),
        "utf8",
      )).trim(),
      createHash("sha256").update(rawResponseBytes).digest("hex"),
    );
    const metadata = JSON.parse(await readFile(
      path.join(requestDirectory, "response_metadata.json"),
      "utf8",
    ));
    assert.equal(metadata.capturedBeforeValidation, true);
    assert.equal(metadata.usage.inputTokens, 321);
    const accepted = JSON.parse(await readFile(
      path.join(requestDirectory, "accepted_rows.json"),
      "utf8",
    ));
    const rejected = JSON.parse(await readFile(
      path.join(requestDirectory, "rejected_rows.json"),
      "utf8",
    ));
    const diagnostics = JSON.parse(await readFile(
      path.join(requestDirectory, "diagnostics.json"),
      "utf8",
    ));
    assert.deepEqual(
      accepted.map((row: Cf7S3ParentEvaluation) => row.parentHarvestRowId),
      ["H0001", "H0003"],
    );
    assert.equal(rejected[0].parentHarvestRowId, "H0216");
    assert.ok(diagnostics.some((item: {
      rule: string;
      comparison: { introducedTokens?: Array<{ token: string }> };
    }) =>
      item.rule === "protectedContent"
      && item.comparison.introducedTokens?.some(
        (token) => token.token === "7.6",
      )));

    const { requests: _requests, ...accountingSummary } = result.accounting;
    const manifest: Cf7S3RunManifest = {
      schemaVersion: "cf7.s3RunManifest.v1",
      architecture: "CF7 Coverage-First Chunk Factory",
      stage: "S3",
      runId: "cf7-s3-forensic-test",
      parentRunId: "cf7-s2-test",
      fixture: "CF1-F03",
      status: result.status,
      model: config.model,
      frozenS2InventorySha256: "test-hash",
      frozenS2InventoryHashVerified: true,
      parentRowCount: parents.length,
      parentRowsEvaluatedExactlyOnce: false,
      routedParentCount: result.routedParentCount,
      bypassedParentCount: result.bypassedParentCount,
      routingManifestHash: result.routingManifest.routingManifestHash,
      groundingCompletedParentCount: result.groundingCompletions.filter(
        (row) => row.addedContextUnitIds.length > 0,
      ).length,
      expectedRequestCount: result.expectedRequestCount,
      providerCallCount: result.providerCallCount,
      requestDirectoryCount: 1,
      forensicEvidenceComplete: true,
      atomicInventoryCount: 0,
      validatedParentCount: result.validatedEvaluations.length,
      quarantinedParentCount: result.quarantinedRows.length,
      validatedAtomicInventoryCount: result.validatedAtomicInventory.length,
      actionCounts: { keep_verbatim: 2 },
      promptHash: result.promptHash,
      schemaHash: result.schemaHash,
      batchManifestHash: result.batchManifest.batchManifestHash,
      configuration: config,
      accounting: accountingSummary,
      sealedEvaluationKeyVisibleToModel: false,
      files: [],
    };
    await writeS3Artifacts({ outputDirectory, result, manifest });
    assert.equal(
      JSON.parse(await readFile(
        path.join(outputDirectory, "validated_parent_results.json"),
        "utf8",
      )).length,
      2,
    );
    assert.equal(
      JSON.parse(await readFile(
        path.join(outputDirectory, "quarantined_rows.json"),
        "utf8",
      )).length,
      1,
    );
    const routingManifest = JSON.parse(await readFile(
      path.join(outputDirectory, "routing_manifest.json"),
      "utf8",
    ));
    assert.equal(routingManifest.routedParentCount, 3);
    const artifactHashes = JSON.parse(await readFile(
      path.join(outputDirectory, "artifact_hashes.json"),
      "utf8",
    ));
    assert.ok(artifactHashes.files.some((file: { name: string }) =>
      file.name === "request-001/raw_response.json"));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
