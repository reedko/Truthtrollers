import { CF1_SPLIT_ATOMIC_REPAIR_SCHEMA } from "./splitAtomicRepairSchemaV1.js";

const orientation = (inventory = {}) => ({
  theme: inventory.theme?.text ?? "", thesis: inventory.thesis?.text ?? "",
  pillars: (inventory.pillars ?? []).map(({ label, text, importance }) =>
    ({ label, text, importance })),
});

const packetForModel = (packet) => ({ repairId: packet.repairId,
  suspicionSignals: packet.signals,
  originalClaim: {
    claimText: packet.originalClaim.claimText,
    sourceUnitIds: packet.originalClaim.sourceUnitIds,
    materiality: packet.originalClaim.materiality,
    relatedPillarLabels: packet.originalClaim.relatedPillarLabels,
  },
  localUnits: packet.localUnits,
});

export function buildSplitAtomicRepairPrompt({ inventory1a, packets = [] } = {}) {
  const responseSchema = structuredClone(CF1_SPLIT_ATOMIC_REPAIR_SCHEMA);
  const repairs = responseSchema.schema.properties.candidateRepairs;
  repairs.minItems = packets.length;
  repairs.maxItems = packets.length;
  repairs.items.properties.repairId.enum = packets.map((packet) => packet.repairId);
  return {
    system: `You are CF1's atomic-claim repair editor. For every supplied candidate, return exactly
one repair judgment. Do not extract additional claims and do not rank alternatives.

An atomic claim contains one independently testable factual assertion. Repair the ORIGINAL CLAIM;
do not replace it with a different nearby assertion from the local units. If the original combines
assertions that could receive different support/refute verdicts, retain only the first material,
independently testable assertion stated within the original claim and rewrite that assertion as a
complete sentence. Use the local units only to verify and ground that repair. Preserve the original
subject, predicate, polarity, scope, comparison, population, and causal strength. If the original's
proposition cannot be preserved and grounded, use drop_not_grounded. Never choose a nearby claim.

Use keep when the claim already expresses one atomic assertion and is grounded. Do not use keep
when suspicionSignals contains possible_multiple_assertions; either replace it with the first atomic
assertion or drop it. Use
replace_with_first_atomic_assertion when a complete first assertion can be grounded in the supplied
local units. Use drop_not_material for audience characterization, presentation, intent, or other
background that does not materially bear on the supplied thesis or pillars. A description merely
characterizing an audience as educated, literate, informed, ignorant, or similar is background unless
it states a separate material consequence; drop such background rather than preserving adjectives.
Use drop_not_grounded
when no material assertion can be supported by the supplied units.

For keep, repeat the original claimText and sourceUnitIds exactly. For replace, return at most one
claim and only source-unit IDs supplied in that packet. For either drop action, return null claimText,
an empty sourceUnitIds array, and null evidenceUsefulnessHint. Do not determine assertion source,
article stance, article use, or thesis effect.`,
    user: `ARTICLE ORIENTATION (materiality context only):
${JSON.stringify(orientation(inventory1a), null, 2)}

FLAGGED CANDIDATES AND LOCAL UNITS:
${JSON.stringify(packets.map(packetForModel), null, 2)}`,
    responseSchema,
  };
}
