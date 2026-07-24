const stringArray = (maxItems = 12) => ({ type: "array", maxItems,
  items: { type: "string", minLength: 1, maxLength: 160 } });

export const P1A_V8_PILLAR_MAP = "P1aV8-pillar-map";

export function buildP1aV8PillarMapSchema(blockIds = []) {
  return {
    name: "p1a_v8_pillar_map",
    strict: true,
    schema: { type: "object", additionalProperties: false,
      required: ["theme", "thesis", "thesisHinge", "pillars", "blockPillarAssignments"],
      properties: {
        theme: { type: "object", additionalProperties: false,
          required: ["text", "sourceUnitIds"], properties: {
            text: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: stringArray(),
          } },
        thesis: { type: "object", additionalProperties: false,
          required: ["text", "sourceUnitIds"], properties: {
            text: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: stringArray(),
          } },
        thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
        pillars: { type: "array", minItems: 1, maxItems: 12, items: {
          type: "object", additionalProperties: false,
          required: ["label", "text", "importance", "sourceUnitIds"],
          properties: {
            label: { type: "string", minLength: 1, maxLength: 140 },
            text: { type: "string", minLength: 1, maxLength: 500 },
            importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
            sourceUnitIds: stringArray(),
          },
        } },
        blockPillarAssignments: { type: "array", minItems: blockIds.length,
          maxItems: blockIds.length, items: { type: "object", additionalProperties: false,
            required: ["blockId", "relatedPillarLabels"], properties: {
              blockId: { type: "string", enum: blockIds },
              relatedPillarLabels: { type: "array", maxItems: 12,
                items: { type: "string", minLength: 1, maxLength: 140 } },
            } } },
      } },
  };
}

const SYSTEM = `You are CF1's article-argument mapper. Determine the article's global theme,
specific thesis, thesisHinge, and final argumentative pillars, then map every supplied structural
block to zero or more pillars.

Theme is the broad argumentative position. Thesis is the specific central conclusion. A pillar is
a distinct article-specific disputed question or argumentative axis that materially organizes the
thesis. Do not use generic subjects, audience descriptions, section titles, or mere chronology as
pillars. Keep axes separate when they require different evidence, concern different mechanisms, or
could stand or fall independently. Do not merge them merely because they share a broad subject.

thesisHinge is substance when truth of the underlying matters settles the thesis; attribution only
when who said, wrote, or published something settles it; and mixed only when both genuinely carry
equal central weight. Quoting or criticizing sources does not by itself make the hinge attribution.

Map a block to a pillar only when its substantive content bears on that pillar. Multiple labels and
an empty array are both valid. Return every blockId exactly once. Pillar sourceUnitIds must identify
supplied text or assertions that substantively support that pillar. Do not extract, select, rewrite,
classify the stance of, or add factual assertions.`;

function articleBlocks(structuralBlocks = []) {
  return structuralBlocks.map((block) => ({ blockId: block.blockId,
    structuralType: block.structuralType, heading: block.heading,
    sourceUnitIds: block.sourceUnitIds, text: block.text }));
}

export function buildP1aV8WholeArticlePrompt({ article, structuralBlocks = [] } = {}) {
  return { system: SYSTEM,
    user: `Build the final pillar map from the complete article, presented in deterministic
structural blocks. The block markers are metadata, not article content.

ARTICLE IDENTITY:
${JSON.stringify({ title: article?.title ?? "", authors: article?.authors ?? [] }, null, 2)}

COMPLETE ARTICLE BLOCKS:
${JSON.stringify(articleBlocks(structuralBlocks), null, 2)}`,
    responseSchema: buildP1aV8PillarMapSchema(structuralBlocks.map((item) => item.blockId)) };
}

export function buildP1aV8GroupedAssertionPacket({ article, structuralBlocks = [],
  assertions = [] } = {}) {
  const blockByUnitId = new Map();
  for (const block of structuralBlocks) {
    for (const unitId of block.sourceUnitIds ?? []) blockByUnitId.set(unitId, block.blockId);
  }
  const grouped = new Map(structuralBlocks.map((block) => [block.blockId, []]));
  const unmatchedAssertions = [];
  for (const assertion of assertions) {
    const blockIds = [...new Set((assertion.sourceUnitIds ?? [])
      .map((unitId) => blockByUnitId.get(unitId)).filter(Boolean))];
    if (!blockIds.length) unmatchedAssertions.push(assertion.candidateId);
    for (const blockId of blockIds) grouped.get(blockId).push({
      candidateId: assertion.candidateId,
      assertionText: assertion.assertionText ?? assertion.claimText,
      sourceUnitIds: assertion.sourceUnitIds,
    });
  }
  return { articleIdentity: { title: article?.title ?? "", authors: article?.authors ?? [] },
    blocks: structuralBlocks.map((block) => ({ blockId: block.blockId,
      structuralType: block.structuralType, heading: block.heading,
      sourceUnitIds: block.sourceUnitIds,
      extractedAssertions: grouped.get(block.blockId) })), unmatchedAssertions };
}

export function buildP1aV8GroupedAssertionPrompt({ packet } = {}) {
  const blockIds = (packet?.blocks ?? []).map((item) => item.blockId);
  return { system: SYSTEM,
    user: `Build the final pillar map from assertions already extracted across the complete
article and grouped under their deterministic structural blocks. The assertion inventory is
descriptive input, not a provisional pillar map. Do not infer that an empty block lacks content;
it only means this extractor emitted no assertion from that block.

BLOCK-GROUPED ASSERTION PACKET:
${JSON.stringify(packet, null, 2)}`,
    responseSchema: buildP1aV8PillarMapSchema(blockIds) };
}

export function verifyP1aV8PillarMap(output, { structuralBlocks = [],
  allowedSourceUnitIds = [] } = {}) {
  const issues = [];
  const blockIds = structuralBlocks.map((item) => item.blockId);
  const returnedBlockIds = (output?.blockPillarAssignments ?? []).map((item) => item.blockId);
  const labels = (output?.pillars ?? []).map((item) => item.label);
  const labelSet = new Set(labels);
  const allowedUnits = new Set(allowedSourceUnitIds);
  if (!output?.theme?.text || !output?.thesis?.text || !(output?.pillars ?? []).length) {
    issues.push("pillar map is incomplete");
  }
  if (new Set(labels).size !== labels.length) issues.push("pillar labels are not unique");
  if (returnedBlockIds.length !== blockIds.length
    || new Set(returnedBlockIds).size !== returnedBlockIds.length
    || blockIds.some((id) => !returnedBlockIds.includes(id))) {
    issues.push("block assignments must cover every block exactly once");
  }
  if ((output?.blockPillarAssignments ?? []).some((item) =>
    (item.relatedPillarLabels ?? []).some((label) => !labelSet.has(label)))) {
    issues.push("a block assignment cites an unknown pillar");
  }
  for (const item of [output?.theme, output?.thesis, ...(output?.pillars ?? [])]
    .filter(Boolean)) {
    if (!(item.sourceUnitIds ?? []).length
      || item.sourceUnitIds.some((id) => !allowedUnits.has(id))) {
      issues.push("orientation grounding is missing or unavailable");
    }
  }
  if (!buildP1aV8PillarMapSchema(blockIds).schema.properties.thesisHinge.enum
    .includes(output?.thesisHinge)) issues.push("thesisHinge is invalid");
  if (issues.length) throw new Error(`Invalid P1aV8 pillar map: ${issues.join("; ")}`);
  return structuredClone(output);
}

export function mapAssertionsThroughBlocks({ assertions = [], structuralBlocks = [],
  pillarMap } = {}) {
  const blockByUnitId = new Map();
  for (const block of structuralBlocks) {
    for (const unitId of block.sourceUnitIds ?? []) blockByUnitId.set(unitId, block.blockId);
  }
  const labelsByBlockId = new Map((pillarMap?.blockPillarAssignments ?? [])
    .map((item) => [item.blockId, item.relatedPillarLabels ?? []]));
  return assertions.map((assertion) => {
    const blockIds = [...new Set((assertion.sourceUnitIds ?? [])
      .map((id) => blockByUnitId.get(id)).filter(Boolean))];
    const derivedPillarLabels = [...new Set(blockIds.flatMap((id) =>
      labelsByBlockId.get(id) ?? []))];
    return { ...assertion, mappedBlockIds: blockIds, derivedPillarLabels };
  });
}
