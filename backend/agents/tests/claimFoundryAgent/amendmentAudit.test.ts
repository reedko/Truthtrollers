import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createWholeArticleClaimFoundryAgentDefinition,
  WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES,
} from "../../claimFoundry/claimFoundryWholeArticleAgent.js";
import {
  buildWholeArticleClaimFoundryInstructions,
} from "../../claimFoundry/claimFoundryInstructions.js";
import {
  MemoryClaimFoundryPersistence,
} from "../../claimFoundry/claimFoundryPersistence.js";
import { document } from "../claimFoundry/fixtures.js";

const repositoryRoot = fileURLToPath(
  new URL("../../../../", import.meta.url),
);
const failedRunInstructionPath = fileURLToPath(new URL(
  "../../../../artifacts/claim-foundry/cf6-agent/whole-article-v2.1/" +
    "cf1-f03-20260727233619/instruction.txt",
  import.meta.url,
));
const verifiedRuntimeHashes: Readonly<Record<string, string>> = Object.freeze({
  "backend/agents/claimFoundry/claimFoundryArticleContext.ts":
    "ddad9a546f41f505504927745649b7ee0d6118310c31e5c62baf3c97eceb4965",
  "backend/agents/claimFoundry/claimFoundryWholeArticleAgent.ts":
    "d6e3fe039cc3ba683f7565cf38d76e297f5109dc82d3b08721bdfa9f8191d2b5",
  "backend/agents/claimFoundry/claimFoundryWholeArticleRunner.ts":
    "26c7be46753615287bd179593c0238331ac6d3a07117a2e150258ba05079b10c",
  "backend/agents/claimFoundry/claimFoundryWholeArticleTools.ts":
    "259cc95b2db529dbbb0bcd0fa88cde147705ae58f45b99a1dd5ceaff4613189b",
  "backend/agents/claimFoundry/claimFoundryInspection.ts":
    "d01318fee104e90cca0ed93f2cfa1e5f88ec805e8d1ef55ad9365a5f4127a9db",
  "backend/agents/claimFoundry/claimFoundryWorkingPackage.ts":
    "2f2746d8b1908ca021cb59da3137d5427b2040407480e9a41824662d0cae9785",
  "backend/agents/claimFoundry/claimFoundryRequestAssertions.ts":
    "b1d587ea6bf68c30b1c6a5105bb2e4e0bc7ca8d7968b9e3b864260de9dc1a1f8",
  "backend/agents/claimFoundry/claimFoundryInputFilter.ts":
    "e9cc171eeb51e28ae2621922de4ec4fa34280d89a960716823e341c7c910f7cf",
  "backend/agents/claimFoundry/claimFoundryInstructions.ts":
    "46f86eb025fd4c9663a26a33543e0067f9dc247a17aaec0a35e5d26b35279dc4",
  "backend/agents/claimFoundry/claimFoundryCoverage.ts":
    "a042a3bb6ecc6c84fbcd4d9f739e867e3954bcf7616ceb783e856d78e9d47b72",
  "backend/agents/claimFoundry/claimFoundryPersistence.ts":
    "9f9f6d244006fdbba339d592e4f0875d94fd825e7d47804b2d61a43db0583b11",
  "backend/agents/claimFoundry/claimFoundryState.ts":
    "eab6c9ec110cd57caec5d32055f1e17b370513ecd6d34f112251fc47c9cbef4a",
  "backend/agents/claimFoundry/runWholeArticleFixture.ts":
    "5ff481087222d5abe155a32cebca8c27668a06ff2b631a23957cb38ede013f6c",
  "backend/agents/shared/agentRuntime.ts":
    "54048873c5b392a343d1d259892c54d1cff04d5cf8b00a2daf86c198ef028926",
});

const amendmentC = `Finishing requires a terminal action: finalize_working_package or
abstain_or_request_review. Every nonterminal turn must select one of the
available tools. Ordinary replies are not a completion path.

Unrepresented structural regions may be dispositioned in bulk only when, after
considering the complete article, they contain no material independently
investigable assertion.

Every declared thesis must be linked to a claim, revised or removed, or
explicitly dispositioned individually.`;

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function toolSchemas() {
  const definition = createWholeArticleClaimFoundryAgentDefinition({
    context: {
      runId: "amendment-audit",
      contentId: "content-1",
      articleDocument: document,
      persistence: new MemoryClaimFoundryPersistence(),
    },
    model: "gpt-4.1-mini",
  });
  return definition.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.parameters),
    strict: true,
  }));
}

test("Amendment C is the exact and only byte-level instruction append", () => {
  const priorFile = readFileSync(failedRunInstructionPath, "utf8");
  assert.equal(priorFile.endsWith("\n"), true);
  const priorInstruction = priorFile.slice(0, -1);
  const amendedInstruction = buildWholeArticleClaimFoundryInstructions();
  assert.equal(amendedInstruction, `${priorInstruction}\n\n${amendmentC}`);

  assert.equal(
    sha256(priorInstruction),
    "aba3862ffe45fb40418930faee0d1355a37412f26f470e32565da977150f9099",
  );
  assert.equal(
    sha256(priorFile),
    "3e9621859f8fe596dddfe2d9509b0ca4a28eb67e64ee5bbd8d4ea393e06a8ee7",
  );
  assert.equal(
    sha256(amendedInstruction),
    "2f0edb861c65c0341f3438371540d93eced8adcacbe3528af6dff34f25cbbd82",
  );
  assert.equal(
    Buffer.byteLength(amendedInstruction) - Buffer.byteLength(priorInstruction),
    Buffer.byteLength(`\n\n${amendmentC}`),
  );
});

test("tool schema keeps four stable ordered tools and appends only the bulk-region field", () => {
  const schemas = toolSchemas();
  assert.deepEqual(
    schemas.map(schema => schema.name),
    [...WHOLE_ARTICLE_CLAIM_FOUNDRY_TOOL_NAMES],
  );
  const updateProperties = (schemas[0]?.parameters as {
    properties?: Record<string, unknown>;
  }).properties;
  assert.ok(updateProperties);
  assert.deepEqual(Object.keys(updateProperties), [
    "idempotencyKey",
    "expectedPackageRevision",
    "setTheses",
    "upsertClaims",
    "removeClaimIds",
    "setRegionDispositions",
    "setThesisDispositions",
    "acknowledgeDiagnosticIds",
    "dispositionRemainingRegions",
  ]);
  assert.equal("dispositionRemainingTheses" in updateProperties, false);

  assert.equal(
    sha256(JSON.stringify(schemas)),
    "22625bb754ec7d9401eeb46f66fad2317b9dbcaf60b469c0a1625a3d4b6c6920",
  );
});

test("runtime drift is confined to the authorized control-flow repair surface", () => {
  const currentHashes = Object.fromEntries(
    Object.keys(verifiedRuntimeHashes).map(relative => [
      relative,
      sha256(readFileSync(`${repositoryRoot}${relative}`)),
    ]),
  );
  const drift = Object.keys(currentHashes)
    .filter(relative =>
      currentHashes[relative] !== verifiedRuntimeHashes[relative])
    .sort();
  assert.deepEqual(drift, [
    "backend/agents/claimFoundry/claimFoundryPersistence.ts",
    "backend/agents/claimFoundry/claimFoundryWholeArticleAgent.ts",
    "backend/agents/claimFoundry/claimFoundryWholeArticleRunner.ts",
    "backend/agents/claimFoundry/claimFoundryWholeArticleTools.ts",
    "backend/agents/shared/agentRuntime.ts",
  ]);
});

test("unchanged runtime surfaces retain their verified pre-repair hashes", () => {
  const unchanged = [
    "backend/agents/claimFoundry/claimFoundryArticleContext.ts",
    "backend/agents/claimFoundry/claimFoundryCoverage.ts",
    "backend/agents/claimFoundry/claimFoundryInputFilter.ts",
    "backend/agents/claimFoundry/claimFoundryInspection.ts",
    "backend/agents/claimFoundry/claimFoundryInstructions.ts",
    "backend/agents/claimFoundry/claimFoundryRequestAssertions.ts",
    "backend/agents/claimFoundry/claimFoundryState.ts",
    "backend/agents/claimFoundry/claimFoundryWorkingPackage.ts",
    "backend/agents/claimFoundry/runWholeArticleFixture.ts",
  ];
  for (const relative of unchanged) {
    assert.equal(
      sha256(readFileSync(`${repositoryRoot}${relative}`)),
      verifiedRuntimeHashes[relative],
      relative,
    );
  }
});
