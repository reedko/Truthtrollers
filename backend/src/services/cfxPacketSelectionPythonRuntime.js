// Governed resolution and startup validation for the Python interpreter that
// runs the CFX assertion-relative packet-selection CLI
// (src/claimfoundry/cfx/retrieval/assertion_relative/cli.py). That CLI
// requires a pinned, heavier-than-stdlib dependency set (numpy, spacy,
// sentence-transformers, ...) -- an arbitrary PATH "python3" is not
// guaranteed to have any of it installed, so this module never falls back to
// one silently.

import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKET_SELECTION_CWD = path.join(
  repoRoot, "backend", "src", "claimfoundry", "cfx", "retrieval",
);
const LOCAL_VENV_EXECUTABLE = path.join(repoRoot, ".venv-cfx", "bin", "python3");

export class CfxPythonRuntimeError extends Error {
  constructor(message) {
    super(message);
    this.name = "CfxPythonRuntimeError";
  }
}

function isExecutableFile(candidate) {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Governed resolution order for the CFX packet-selection Python interpreter:
 *   1. CFX_PACKET_SELECTION_PYTHON_EXECUTABLE, if set -- always wins.
 *      Existence/capability is proven separately by
 *      validateCfxPacketSelectionPythonRuntime, not here.
 *   2. The repository's own .venv-cfx interpreter, but only when that path
 *      actually exists on this machine -- true for a local checkout that has
 *      provisioned it, false on a host that hasn't.
 * Never falls back to an arbitrary PATH "python3": that shim is not
 * guaranteed to carry CFX's pinned scientific-computing dependencies.
 */
export function resolveCfxPacketSelectionPythonExecutable(
  env = process.env,
  { localVenvExecutable = LOCAL_VENV_EXECUTABLE } = {},
) {
  const configured = (env.CFX_PACKET_SELECTION_PYTHON_EXECUTABLE || "").trim();
  if (configured) return Object.freeze({ executable: configured, source: "configured" });
  if (isExecutableFile(localVenvExecutable)) {
    return Object.freeze({ executable: localVenvExecutable, source: "local_venv" });
  }
  throw new CfxPythonRuntimeError(
    "No governed CFX packet-selection Python executable is available. Set "
    + "CFX_PACKET_SELECTION_PYTHON_EXECUTABLE explicitly, or provision the "
    + `repository's .venv-cfx interpreter (expected at ${localVenvExecutable}). `
    + "Refusing to fall back to an arbitrary PATH python3.",
  );
}

function runProbe(executable, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, args, { cwd });
    } catch (error) {
      resolve({ ok: false, exitCode: null, output: error.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, output: `${stdout}${stderr}`.trim() });
    });
  });
}

/**
 * Fail-closed check that the resolved executable exists, reports a Python
 * 3.x version, and can start the packet-selection CLI module. `--help` is
 * argparse's own zero-side-effect path -- it is only reached after the CLI
 * module's top-level imports (numpy, spacy, sentence-transformers, the
 * retriever itself) have already succeeded, so this proves every pinned
 * import works without requiring a populated embedding-model cache or an
 * --input/--output fixture.
 */
export async function validateCfxPacketSelectionPythonRuntime({
  executable,
  cwd = PACKET_SELECTION_CWD,
  timeoutMs = 20_000,
} = {}) {
  if (!executable) throw new CfxPythonRuntimeError("executable is required");
  if (!isExecutableFile(executable)) {
    throw new CfxPythonRuntimeError(
      `CFX packet-selection Python executable does not exist or is not executable: ${executable}`,
    );
  }
  const version = await runProbe(executable, ["--version"], { cwd, timeoutMs });
  if (!version.ok) {
    throw new CfxPythonRuntimeError(
      `CFX packet-selection Python executable failed to report its version `
      + `(exit ${version.exitCode}): ${version.output}`,
    );
  }
  if (!/^Python 3\./.test(version.output)) {
    throw new CfxPythonRuntimeError(
      `CFX packet-selection Python executable is not Python 3.x: ${version.output}`,
    );
  }
  const cliStart = await runProbe(executable, ["-m", "assertion_relative.cli", "--help"], { cwd, timeoutMs });
  if (!cliStart.ok) {
    throw new CfxPythonRuntimeError(
      `CFX packet-selection CLI failed to start under ${executable} `
      + `(exit ${cliStart.exitCode}): ${cliStart.output}`,
    );
  }
  return Object.freeze({ executable, pythonVersion: version.output });
}
