// Sealed evaluation-key loader + generation-integrity verification (coder plan
// §10.4/§10.7). Keys open ONLY after the generation artifacts they will judge
// are complete and hash-verified. This module must never be imported by
// generation code (enforced by the dependency-graph test).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function evaluationError(message) {
  return Object.assign(new Error(message), { code: "CF1_EVALUATION_INVALID" });
}

// Recompute every run directory's files.sha256 and the phase manifest hash.
export function verifyGenerationIntegrity({ benchmarkDir, phase }) {
  const manifestPath = path.join(benchmarkDir, `manifest-${phase}.json`);
  if (!existsSync(manifestPath)) throw evaluationError(`No manifest for phase ${phase}`);
  const manifestBody = readFileSync(manifestPath, "utf8");
  const recorded = readFileSync(`${manifestPath.replace(/\.json$/, "")}.sha256`, "utf8").trim();
  if (sha256(manifestBody) !== recorded) throw evaluationError("Manifest hash mismatch");
  const manifest = JSON.parse(manifestBody);
  for (const run of manifest.runs) {
    const subject = run.fixtureId ?? run.packetId;
    const dir = path.join(benchmarkDir, "raw", phase, subject, run.pairProfileId, String(run.repeat));
    const listed = readFileSync(path.join(dir, "files.sha256"), "utf8").trim().split("\n");
    for (const line of listed) {
      const [hash, name] = line.split(/\s{2}/);
      if (sha256(readFileSync(path.join(dir, name), "utf8")) !== hash) {
        throw evaluationError(`Artifact drifted: ${dir}/${name}`);
      }
    }
  }
  return manifest;
}

export function loadEvaluationKeys({ keysRoot, fixtureIds }) {
  return fixtureIds.map((fixtureId) => {
    const keyPath = path.join(keysRoot, `${fixtureId}.json`);
    if (!existsSync(keyPath)) return { fixtureId, targets: [], missing: true };
    const key = JSON.parse(readFileSync(keyPath, "utf8"));
    if (key.schemaVersion !== "cf1.promptEvaluationKey.v1") {
      throw evaluationError(`${fixtureId} evaluation key has an unknown schema`);
    }
    return key;
  });
}

// Score locking: scores are hashed and locked BEFORE any unblinding output.
export function lockScores({ benchmarkDir, phase }) {
  const scoresPath = path.join(benchmarkDir, "scores", `completed-${phase}.json`);
  if (!existsSync(scoresPath)) throw evaluationError(`No completed scores for phase ${phase}`);
  const lockPath = path.join(benchmarkDir, "scores", `scores-${phase}.lock.json`);
  if (existsSync(lockPath)) throw evaluationError("Scores are already locked");
  const lock = { phase, scoresSha256: sha256(readFileSync(scoresPath, "utf8")),
    lockedAt: new Date().toISOString() };
  return { lockPath, lock };
}

export function assertScoresLocked({ benchmarkDir, phase }) {
  const scoresPath = path.join(benchmarkDir, "scores", `completed-${phase}.json`);
  const lockPath = path.join(benchmarkDir, "scores", `scores-${phase}.lock.json`);
  if (!existsSync(lockPath)) throw evaluationError("Refusing to unblind: scores are not locked");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  if (sha256(readFileSync(scoresPath, "utf8")) !== lock.scoresSha256) {
    throw evaluationError("Refusing to unblind: scores changed after locking");
  }
  return lock;
}
