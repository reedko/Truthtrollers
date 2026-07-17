// Arbitrary-N seeded blinding (coder plan §10.4/§10.6). Labels are opaque
// profile names; the arm→label mapping is global per benchmark seed so a
// reviewer can score a profile consistently across fixtures without learning
// its identity; section order is re-randomized per packet. Never A/B/C.
import { createHash } from "node:crypto";

const LABEL_POOL = ["Profile J", "Profile Q", "Profile R", "Profile V", "Profile M",
  "Profile T", "Profile W", "Profile Z"];

const rank = (seed, value) => createHash("sha256").update(`${seed}:${value}`).digest("hex");

export function seededShuffle(items, seed) {
  return [...items].sort((left, right) => rank(seed, left).localeCompare(rank(seed, right)));
}

// Global mapping: sorted profile IDs → shuffled opaque labels.
export function assignOpaqueLabels(profileIds, seed) {
  if (profileIds.length > LABEL_POOL.length) throw new Error("Too many arms for the label pool");
  const orderedIds = [...profileIds].sort();
  const labels = seededShuffle(LABEL_POOL.slice(0, orderedIds.length), `${seed}:labels`);
  const byProfile = new Map(orderedIds.map((id, index) => [id, labels[index]]));
  return { byProfile, producerKey: Object.fromEntries(labels
    .map((label) => [label, orderedIds.find((id) => byProfile.get(id) === label)])) };
}

// One packet per (subject, repeat): outputs keyed by opaque label, section order
// seeded per packet, no producer identity, cost, latency, or trace fields.
export function buildBlindPackets({ runs, seed }) {
  const profileIds = [...new Set(runs.map((run) => run.pairProfileId))];
  const { byProfile, producerKey } = assignOpaqueLabels(profileIds, seed);
  const groups = new Map();
  for (const run of runs) {
    const subject = run.fixtureId ?? run.packetId;
    const key = `${subject}::${run.repeat}`;
    if (!groups.has(key)) groups.set(key, { subject, repeat: run.repeat, outputs: {} });
    groups.get(key).outputs[byProfile.get(run.pairProfileId)] = {
      status: run.status, output: run.blindOutput ?? null };
  }
  const packets = [...groups.values()].map((group) => ({ ...group,
    sectionOrder: seededShuffle(Object.keys(group.outputs),
      `${seed}:${group.subject}:${group.repeat}`) }));
  return { packets, producerKey };
}

export function assertNoIdentityLeak(packets) {
  const body = JSON.stringify(packets);
  for (const term of ["set-control", "set-a-", "set-b-", "set-c-", "call1Version",
    "call2Version", "totalTokens", "elapsedMs", "fingerprint"]) {
    if (body.includes(term)) {
      throw Object.assign(new Error(`Blind packets leak producer information: ${term}`),
        { code: "CF1_BLINDING_LEAK" });
    }
  }
  return true;
}
