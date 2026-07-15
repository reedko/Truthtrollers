import { createHash } from "node:crypto";

function labelOrder(seed, fixtureId, repeat) {
  const digest = createHash("sha256").update(`${seed}:${fixtureId}:${repeat}`).digest();
  return digest[0] % 2 === 0 ? ["cf1", "baseline"] : ["baseline", "cf1"];
}

function reviewOutput(run) {
  if (run.status !== "completed") return { status: "failed", error: run.error };
  return { status: "completed", claims: run.output?.claims ?? run.output?.selectedClaims ?? [],
    theme: run.output?.articleMap?.theme ?? null,
    pillars: run.output?.articleMap?.themePillars ?? [],
    internalConsistencyFindings: run.output?.internalConsistencyFindings ?? [] };
}

export function buildBlindReviewArtifacts(runs, seed) {
  const packets = [];
  const key = [];
  const pairs = new Map();
  for (const run of runs) {
    const pairId = `${run.fixtureId}:${run.repeat}`;
    if (!pairs.has(pairId)) pairs.set(pairId, {});
    pairs.get(pairId)[run.producer] = run;
  }
  for (const [pairId, pair] of pairs) {
    if (!pair.cf1 || !pair.baseline) continue;
    const [fixtureId, repeatText] = pairId.split(":");
    const repeat = Number(repeatText);
    const order = labelOrder(seed, fixtureId, repeat);
    const outputs = Object.fromEntries(order.map((producer, index) =>
      [index === 0 ? "A" : "B", reviewOutput(pair[producer])]));
    packets.push({ fixtureId, repeat, outputs, scores: { reviewer1: null, reviewer2: null } });
    key.push({ fixtureId, repeat, A: order[0], B: order[1] });
  }
  return { packets, key };
}
