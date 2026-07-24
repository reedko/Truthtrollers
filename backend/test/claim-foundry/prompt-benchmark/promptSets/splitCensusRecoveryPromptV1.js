import { CF1_SPLIT_CENSUS_RECOVERY_SCHEMA } from "./splitCensusRecoverySchemaV1.js";

const orientation = (inventory = {}) => ({
  theme: inventory.theme?.text ?? "",
  thesis: inventory.thesis?.text ?? "",
  pillars: (inventory.pillars ?? []).map(({ label, text }) => ({ label, text })),
});

const packetForModel = (packet) => ({
  censusId: packet.censusId,
  semanticChunkId: packet.semanticChunkId,
  heading: packet.heading ?? "",
  sourceUnitIds: packet.sourceUnitIds,
  signals: packet.signals,
  passage: packet.snippet,
  localContext: String(packet.contextText ?? "").slice(0, 600),
});

export function buildSplitCensusRecoveryPrompt({ inventory1a, selectedPackets = [] } = {}) {
  return {
    system: `You are CF1's narrow claim-recovery reader. Review only the supplied unmatched
diagnostic passages. Return each distinct atomic factual claim explicitly stated in them that
external evidence could support or refute. A passage may contain no valid claim.

Preserve each claim in its original polarity. Do not negate it, correct it, append the article's
response, decide who asserted it, or decide whether it supports the article. A claim is atomic when
it has one primary subject and one independently testable predicate or relationship. Separate
additional events, outcomes, statistics, classifications, and effects into separate claims.

Use only supplied census IDs and source-unit IDs. Census passages are diagnostic leads, not
authoritative claims. Exclude rhetorical questions, presentation descriptions, and statements of
intent that contain no independently testable factual claim. Do not repeat a claim already listed
in EXISTING CALL 1A CLAIMS.`,
    user: `ARTICLE ORIENTATION (context only):
${JSON.stringify(orientation(inventory1a), null, 2)}

EXISTING CALL 1A CLAIMS:
${JSON.stringify((inventory1a?.candidateClaims ?? []).map(({ claimText, sourceUnitIds }) =>
    ({ claimText, sourceUnitIds })), null, 2)}

UNMATCHED CENSUS PASSAGES:
${JSON.stringify(selectedPackets.map(packetForModel), null, 2)}`,
    responseSchema: structuredClone(CF1_SPLIT_CENSUS_RECOVERY_SCHEMA),
  };
}
