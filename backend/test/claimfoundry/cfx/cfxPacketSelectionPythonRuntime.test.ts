import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CfxPythonRuntimeError,
  resolveCfxPacketSelectionPythonExecutable,
  validateCfxPacketSelectionPythonRuntime,
} from "../../../src/services/cfxPacketSelectionPythonRuntime.js";
import { selectCfxAssertionRelativePackets } from "../../../src/claimfoundry/cfx/retrieval/assertion_relative/packetSelectionBridge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const realLocalVenvExecutable = path.join(repoRoot, ".venv-cfx", "bin", "python3");
const realLocalVenvPresent = existsSync(realLocalVenvExecutable);

test("resolve: an explicitly configured executable always wins, even when a local venv also exists", () => {
  const resolved = resolveCfxPacketSelectionPythonExecutable(
    { CFX_PACKET_SELECTION_PYTHON_EXECUTABLE: "/opt/governed/bin/python3" },
    { localVenvExecutable: "/tmp/does-not-matter/python3" },
  );
  assert.deepEqual(resolved, { executable: "/opt/governed/bin/python3", source: "configured" });
});

test("resolve: falls back to the local governed venv only when it actually exists on disk", () => {
  const resolved = resolveCfxPacketSelectionPythonExecutable(
    {},
    { localVenvExecutable: realLocalVenvExecutable },
  );
  assert.equal(resolved.source, "local_venv");
  assert.equal(resolved.executable, realLocalVenvExecutable);
});

test("resolve: never silently falls back to an arbitrary PATH python3 -- fails closed instead", () => {
  assert.throws(
    () => resolveCfxPacketSelectionPythonExecutable(
      {},
      { localVenvExecutable: "/definitely/not/on/this/machine/python3" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof CfxPythonRuntimeError);
      assert.match((error as Error).message, /Refusing to fall back to an arbitrary PATH python3/);
      assert.doesNotMatch((error as Error).message.toLowerCase(), /\bresolved to python3\b/);
      return true;
    },
  );
});

test("validate: an invalid/nonexistent executable fails before any pipeline work -- no subprocess is spawned", async () => {
  await assert.rejects(
    validateCfxPacketSelectionPythonRuntime({ executable: "/definitely/not/on/this/machine/python3" }),
    (error: unknown) => {
      assert.ok(error instanceof CfxPythonRuntimeError);
      assert.match((error as Error).message, /does not exist or is not executable/);
      return true;
    },
  );
});

test("validate: a real python3 lacking CFX's pinned scientific-computing dependencies fails with the real import error, not a generic message", { skip: !existsSync("/usr/bin/python3") }, async () => {
  await assert.rejects(
    validateCfxPacketSelectionPythonRuntime({ executable: "/usr/bin/python3", timeoutMs: 30_000 }),
    (error: unknown) => {
      assert.ok(error instanceof CfxPythonRuntimeError);
      assert.match((error as Error).message, /CFX packet-selection CLI failed to start/);
      return true;
    },
  );
});

test("smoke: a real local .venv-cfx interpreter passes full validation (version + CLI start)", { skip: !realLocalVenvPresent }, async () => {
  const result = await validateCfxPacketSelectionPythonRuntime({ executable: realLocalVenvExecutable, timeoutMs: 30_000 });
  assert.equal(result.executable, realLocalVenvExecutable);
  assert.match(result.pythonVersion, /^Python 3\./);
});

test("smoke: the real packet-selection bridge, run under .venv-cfx with --lexical-only, produces a real selected packet end to end", { skip: !realLocalVenvPresent }, async () => {
  const result = await selectCfxAssertionRelativePackets(
    {
      assertion: { assertionId: "P01", text: "Vaccines are studied for safety.", aliases: [], requiredConceptGroups: [] },
      document: {
        documentId: "DOC-smoke-test",
        blocks: [{ blockId: "SOURCE-0001", text: "This is a test document about vaccine safety studies conducted over many years." }],
      },
    },
    { pythonExecutable: realLocalVenvExecutable, lexicalOnly: true, timeoutMs: 30_000 },
  );
  assert.equal(result.assertionId, "P01");
  assert.equal(result.documentId, "DOC-smoke-test");
  assert.ok(result.selectedPackets.length > 0, "the real retriever must select at least one packet from an on-topic document");
});
