import assert from "node:assert/strict";
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
import { canonicalHash } from "../../../src/claimfoundry/shared/sourceUnits/index.js";
import { GOnlyForensicWriter } from "../../../src/claimfoundry/cf7/experiments/gOnlySelector/artifacts.js";
import {
  buildGOnlySelectorUserPrompt,
  G_ONLY_SELECTOR_PROMPT,
} from "../../../src/claimfoundry/cf7/experiments/gOnlySelector/prompt.js";
import {
  DEFAULT_G_ONLY_SELECTOR_CONFIG,
  runGOnlySelectorExperiment,
} from "../../../src/claimfoundry/cf7/experiments/gOnlySelector/runExperiment.js";
import {
  G_ONLY_SELECTOR_JSON_SCHEMA,
  gOnlySelectorOutputSchema,
} from "../../../src/claimfoundry/cf7/experiments/gOnlySelector/schema.js";
import type {
  GOnlyFrozenInput,
  GOnlyGroup,
} from "../../../src/claimfoundry/cf7/experiments/gOnlySelector/types.js";
import { structuralObservations } from "../../../src/claimfoundry/cf7/experiments/gOnlySelector/comparison.js";

const groups: GOnlyGroup[] = Array.from({ length: 21 }, (_, index) => ({
  groupId: `G${index + 1}`,
  groupIndex: index + 1,
  assertionIds: [
    `H${String(index * 2 + 1).padStart(4, "0")}`,
    `H${String(index * 2 + 2).padStart(4, "0")}`,
  ],
  assertions: [
    {
      assertionId: `H${String(index * 2 + 1).padStart(4, "0")}`,
      assertionText: `First assertion in frozen group ${index + 1}.`,
    },
    {
      assertionId: `H${String(index * 2 + 2).padStart(4, "0")}`,
      assertionText: `Second assertion in frozen group ${index + 1}.`,
    },
  ],
}));

const frozen: GOnlyFrozenInput = {
  sourceGroupingRun: "cf7-semantic-grouping-cf1-f03-20260729005359",
  sourceGroupPath: "/verified/prompt_G_groups.json",
  sourceGroupSha256: "group-hash",
  sourceInventoryPath: "/verified/assertion_inventory.json",
  sourceInventorySha256: "inventory-hash",
  sourceArtifactAggregateSha256: "aggregate-hash",
  groupMembershipHash: canonicalHash(groups),
  groupCount: 21,
  assignedAssertionCount: 262,
  duplicateAssertionIds: [],
  missingAssertionIds: ["H0046", "H0047", "H0048", "H0049", "H0267"],
  groups,
  inventory: groups.flatMap((group) => group.assertions),
};

test("governed prompt is verbatim and payload contains only group ID and assertions", () => {
  assert.match(
    G_ONLY_SELECTOR_PROMPT,
    /rather than an introductory, rhetorical, contextual, transitional, or merely illustrative statement/,
  );
  assert.match(G_ONLY_SELECTOR_PROMPT, /Do not perform atomic decomposition/);
  const user = buildGOnlySelectorUserPrompt(groups[0]!);
  const payload = JSON.parse(user.slice(G_ONLY_SELECTOR_PROMPT.length + 2));
  assert.deepEqual(Object.keys(payload), ["groupId", "assertions"]);
  assert.deepEqual(payload.assertions, groups[0]!.assertions);
  assert.doesNotMatch(
    user,
    /semanticSubThesis|atomicAssertion|articleTitle|sourceUnit|gold/i,
  );
});

test("strict response schema permits only selectedAssertionId", () => {
  assert.equal(gOnlySelectorOutputSchema.safeParse({
    selectedAssertionId: "H0001",
  }).success, true);
  assert.equal(gOnlySelectorOutputSchema.safeParse({
    selectedAssertionId: "H0001",
    selectedAssertionText: "not permitted",
  }).success, false);
  assert.deepEqual(
    G_ONLY_SELECTOR_JSON_SCHEMA.schema.required,
    ["selectedAssertionId"],
  );
});

test("structural observations do not assign semantic verdicts", () => {
  assert.deepEqual(
    structuralObservations("These findings raise questions?"),
    [
      "begins with a potentially unresolved reference",
      "question form",
      "unusually short",
    ],
  );
  assert.deepEqual(
    structuralObservations("Vaccines work."),
    ["unusually short"],
  );
});

test("runner makes exactly 21 independent calls and rejects out-of-group IDs", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "cf7-g-only-selector-"),
  );
  try {
    const outputDirectory = path.join(temporaryRoot, "run");
    const writer = new GOnlyForensicWriter(outputDirectory);
    await writer.initialize();
    const requests: Array<Record<string, unknown>> = [];
    const provider: Cf7StructuredProvider = {
      async invokeStructured(request) {
        requests.push(request as unknown as Record<string, unknown>);
        const payload = JSON.parse(
          request.user.slice(request.user.lastIndexOf("\n\n") + 2),
        ) as {
          groupId: string;
          assertions: Array<{ assertionId: string }>;
        };
        const output = {
          selectedAssertionId: payload.groupId === "G21"
            ? "H9999"
            : payload.assertions[0]!.assertionId,
        };
        return {
          output,
          rawResponse: { id: `response-${requests.length}`, output },
          model: "gpt-4o-mini",
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            outputTokens: 10,
            totalTokens: 110,
          },
          responseId: `response-${requests.length}`,
          requestId: null,
        };
      },
    };
    const result = await runGOnlySelectorExperiment({
      frozen,
      provider,
      forensicWriter: writer,
      config: { ...DEFAULT_G_ONLY_SELECTOR_CONFIG },
    });
    assert.equal(result.status, "failed");
    assert.equal(result.providerCallCount, 21);
    assert.equal(requests.length, 21);
    assert.equal(result.selections[20]!.structurallyValid, false);
    assert.equal(result.selections[20]!.selectedAssertionId, null);
    assert.ok(requests.every((request) =>
      request.system === ""
      && request.model === "gpt-4o-mini"
      && request.temperature === 0.1
      && request.retryCount === 0
      && request.store === false
      && request.maxOutputTokens === 1_000
      && request.responseSchema === G_ONLY_SELECTOR_JSON_SCHEMA));
    for (const row of result.rows) {
      await access(path.join(
        outputDirectory,
        "requests",
        `${row.requestKey}.json`,
      ));
      await access(path.join(
        outputDirectory,
        "responses",
        `${row.requestKey}.json`,
      ));
      const metadata = JSON.parse(await readFile(
        path.join(
          outputDirectory,
          "responses",
          `${row.requestKey}.metadata.json`,
        ),
        "utf8",
      ));
      assert.equal(metadata.capturedBeforeValidation, true);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
