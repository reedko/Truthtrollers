const normalize = (value) => String(value ?? "").toLowerCase().normalize("NFKC")
  .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

export const P1A_V9_LOCAL_PILLARS = "P1aV9-local-pillars";

export function buildP1aV9ChunkPacket({ chunkId, blocks = [], assertions = [],
  orientation } = {}) {
  const blockByUnitId = new Map();
  for (const block of blocks) for (const unitId of block.sourceUnitIds ?? []) {
    blockByUnitId.set(unitId, block.blockId);
  }
  const assertionsByBlock = new Map(blocks.map((block) => [block.blockId, []]));
  const unmatchedAssertionIds = [];
  for (const assertion of assertions) {
    const blockIds = [...new Set((assertion.sourceUnitIds ?? [])
      .map((unitId) => blockByUnitId.get(unitId)).filter(Boolean))];
    if (!blockIds.length) unmatchedAssertionIds.push(assertion.candidateId);
    for (const blockId of blockIds) assertionsByBlock.get(blockId).push({
      assertionId: assertion.candidateId,
      assertionText: assertion.assertionText ?? assertion.claimText,
      sourceUnitIds: assertion.sourceUnitIds,
    });
  }
  return { chunkId, orientation: { theme: orientation?.theme?.text ?? "",
    thesis: orientation?.thesis?.text ?? "" }, blocks: blocks.map((block) => ({
    blockId: block.blockId, structuralType: block.structuralType,
    heading: block.heading, sourceUnitIds: block.sourceUnitIds,
    assertions: assertionsByBlock.get(block.blockId),
  })), unmatchedAssertionIds };
}

export function buildP1aV9LocalPillarSchema(packet) {
  const blockIds = packet.blocks.map((block) => block.blockId);
  const assertionIds = packet.blocks.flatMap((block) =>
    block.assertions.map((item) => item.assertionId));
  return { name: "p1a_v9_local_pillars", strict: true,
    schema: { type: "object", additionalProperties: false,
      required: ["blockAnalyses"], properties: {
        blockAnalyses: { type: "array", minItems: blockIds.length,
          maxItems: blockIds.length, items: { type: "object", additionalProperties: false,
            required: ["blockId", "localPillars", "unassignedAssertionIds"], properties: {
              blockId: { type: "string", enum: blockIds },
              localPillars: { type: "array", maxItems: Math.max(1, assertionIds.length),
                items: { type: "object", additionalProperties: false,
                  required: ["evidenceQuestion", "assertionIds"], properties: {
                    evidenceQuestion: { type: "string", minLength: 1, maxLength: 500 },
                    assertionIds: { type: "array", minItems: 1,
                      maxItems: Math.max(1, assertionIds.length),
                      items: { type: "string", enum: assertionIds } },
                  } } },
              unassignedAssertionIds: { type: "array",
                maxItems: Math.max(1, assertionIds.length),
                items: { type: "string", enum: assertionIds } },
            } } },
      } } };
}

export function buildP1aV9LocalPillarPrompt({ packet } = {}) {
  return { system: `You are CF1's local argument-axis mapper. Work independently within each
structural block. Starting from the supplied assertions, identify the distinct evidence questions
that the block raises in relation to the supplied article theme and thesis.

An evidence question is a neutral, externally resolvable question. Put multiple assertions under
one question only when the same body of evidence would resolve them. If assertions require
different evidence, concern different mechanisms, or could stand or fall independently, return
separate questions. Do not create broad subject labels, global pillars, chronology buckets, stance
labels, or new assertions. Do not merge questions across blocks.

Assign every assertionId in each block exactly once: either under one local evidence question or in
unassignedAssertionIds when it is merely contextual, biographical, presentational, or does not form
a useful evidence question. Empty localPillars is valid. Process every blockId exactly once.`,
    user: `Derive local evidence questions from these block-grouped assertions. Previous model
pillar labels have intentionally not been supplied.

LOCAL MAPPING PACKET:
${JSON.stringify(packet, null, 2)}`,
    responseSchema: buildP1aV9LocalPillarSchema(packet) };
}

export function verifyP1aV9LocalPillars(output, packet) {
  const issues = [];
  const expectedBlockIds = packet.blocks.map((block) => block.blockId);
  const returned = output?.blockAnalyses ?? [];
  const returnedBlockIds = returned.map((item) => item.blockId);
  if (returned.length !== expectedBlockIds.length
    || new Set(returnedBlockIds).size !== returnedBlockIds.length
    || expectedBlockIds.some((id) => !returnedBlockIds.includes(id))) {
    issues.push("block analyses must cover every block exactly once");
  }
  const inputByBlock = new Map(packet.blocks.map((block) => [block.blockId,
    block.assertions.map((item) => item.assertionId)]));
  for (const analysis of returned) {
    const expected = inputByBlock.get(analysis.blockId) ?? [];
    const assigned = (analysis.localPillars ?? []).flatMap((item) => item.assertionIds ?? []);
    const unassigned = analysis.unassignedAssertionIds ?? [];
    const all = [...assigned, ...unassigned];
    if (all.length !== expected.length || new Set(all).size !== all.length
      || expected.some((id) => !all.includes(id))
      || all.some((id) => !expected.includes(id))) {
      issues.push(`${analysis.blockId} does not classify its assertions exactly once`);
    }
    const questions = (analysis.localPillars ?? []).map((item) =>
      normalize(item.evidenceQuestion));
    if (questions.some((item) => !item) || new Set(questions).size !== questions.length) {
      issues.push(`${analysis.blockId} has empty or duplicate local questions`);
    }
  }
  if (issues.length) throw new Error(`Invalid P1aV9 local pillar output: ${issues.join("; ")}`);
  return structuredClone(output);
}

export function mergeP1aV9LocalPillars(chunkResults = []) {
  const groups = new Map();
  const unassignedAssertionIds = [];
  for (const chunk of chunkResults) for (const analysis of chunk.output.blockAnalyses) {
    unassignedAssertionIds.push(...analysis.unassignedAssertionIds);
    for (const local of analysis.localPillars) {
      const key = normalize(local.evidenceQuestion);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ chunkId: chunk.chunkId, blockId: analysis.blockId,
        evidenceQuestion: local.evidenceQuestion, assertionIds: local.assertionIds });
    }
  }
  const pillars = [...groups.values()].map((members, index) => ({
    pillarId: `P1aV9-P${String(index + 1).padStart(3, "0")}`,
    evidenceQuestion: members[0].evidenceQuestion,
    sourceChunkIds: [...new Set(members.map((item) => item.chunkId))],
    sourceBlockIds: [...new Set(members.map((item) => item.blockId))],
    assertionIds: [...new Set(members.flatMap((item) => item.assertionIds))],
    mergedExactQuestionCount: members.length,
  }));
  const pillarIdsByAssertion = new Map();
  for (const pillar of pillars) for (const assertionId of pillar.assertionIds) {
    if (!pillarIdsByAssertion.has(assertionId)) pillarIdsByAssertion.set(assertionId, []);
    pillarIdsByAssertion.get(assertionId).push(pillar.pillarId);
  }
  return { pillars, unassignedAssertionIds: [...new Set(unassignedAssertionIds)],
    pillarIdsByAssertion: Object.fromEntries(pillarIdsByAssertion),
    summary: { localPillarCount: chunkResults.reduce((sum, chunk) => sum
      + chunk.output.blockAnalyses.reduce((inner, item) => inner + item.localPillars.length, 0), 0),
    exactMergedPillarCount: pillars.length,
    exactQuestionCollapses: chunkResults.reduce((sum, chunk) => sum
      + chunk.output.blockAnalyses.reduce((inner, item) => inner + item.localPillars.length, 0), 0)
      - pillars.length,
    unassignedAssertionCount: new Set(unassignedAssertionIds).size } };
}
