export const P1A_V13_LOCAL_QUESTIONS = "P1aV13-A-local-questions";

export const P1A_V13_LOCAL_SYSTEM = `Read each supplied structural block independently.
Identify locally stated factual questions that external evidence could resolve. Return an empty
questions array when a block contains only rhetoric, navigation, presentation, or background that
does not state an externally resolvable factual matter.

Each question must be specific and neutral. contestedSubject must name the exact actor, study,
event, number, mechanism, or relationship under dispute. disconfirmingFinding must state a concrete
finding that would resolve the question opposite to the passage's apparent assertion. Cite only
source units owned by that block.

Do not summarize or categorize the document. Do not merge material from different blocks. Do not
invent questions to fill a block, and do not repeat or paraphrase the same question twice.`;

function balancedBatchSizes(total, maximum = 7) {
  if (!Number.isInteger(total) || total < 1) throw new TypeError("At least one block is required");
  if (!Number.isInteger(maximum) || maximum < 1) throw new TypeError("maximum must be positive");
  const count = Math.ceil(total / maximum);
  const base = Math.floor(total / count);
  const larger = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < larger ? 1 : 0));
}

export function buildP1aV13BlockBatches({ structuralBlocks = [], maximumBlocks = 7 } = {}) {
  const sizes = balancedBatchSizes(structuralBlocks.length, maximumBlocks);
  let cursor = 0;
  return sizes.map((size, index) => {
    const blocks = structuralBlocks.slice(cursor, cursor + size);
    cursor += size;
    return {
      batchId: `P1aV13-A${String(index + 1).padStart(2, "0")}`,
      order: index,
      blocks,
      blockIds: blocks.map((block) => block.blockId),
      sourceUnitIds: blocks.flatMap((block) => block.sourceUnitIds ?? []),
    };
  });
}

export function buildP1aV13LocalQuestionsSchema(batch) {
  return {
    name: "p1a_v13_local_questions",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["blocks"],
      properties: {
        blocks: {
          type: "array",
          minItems: batch.blocks.length,
          maxItems: batch.blocks.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["blockId", "questions"],
            properties: {
              blockId: { type: "string", enum: batch.blockIds },
              questions: {
                type: "array",
                maxItems: 2,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["question", "contestedSubject", "disconfirmingFinding",
                    "sourceUnitIds"],
                  properties: {
                    question: { type: "string", minLength: 1, maxLength: 400 },
                    contestedSubject: { type: "string", minLength: 1, maxLength: 180 },
                    disconfirmingFinding: { type: "string", minLength: 1, maxLength: 400 },
                    sourceUnitIds: {
                      type: "array",
                      minItems: 1,
                      items: { type: "string", minLength: 1, maxLength: 20 },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function buildP1aV13LocalQuestionsPrompt({ batch, sourceUnits = [] } = {}) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const payload = batch.blocks.map((block) => ({ blockId: block.blockId,
    heading: block.heading ?? "", structuralType: block.structuralType ?? "",
    units: (block.sourceUnitIds ?? []).map((unitId) => ({ unitId,
      text: unitsById.get(unitId)?.text ?? "" })) }));
  return {
    system: P1A_V13_LOCAL_SYSTEM,
    user: `Return one result for every structural block below, in the supplied order.

STRUCTURAL BLOCKS:
${JSON.stringify(payload)}`,
    responseSchema: buildP1aV13LocalQuestionsSchema(batch),
  };
}

export function verifyP1aV13LocalQuestions(output, batch) {
  const issues = [];
  const returned = output?.blocks ?? [];
  const returnedIds = returned.map((item) => item.blockId);
  if (returnedIds.length !== batch.blockIds.length
    || new Set(returnedIds).size !== returnedIds.length
    || batch.blockIds.some((blockId) => !returnedIds.includes(blockId))) {
    issues.push("the batch must return every block exactly once");
  }
  const ownedUnits = new Map(batch.blocks.map((block) =>
    [block.blockId, new Set(block.sourceUnitIds ?? [])]));
  for (const item of returned) {
    const allowed = ownedUnits.get(item.blockId) ?? new Set();
    for (const question of item.questions ?? []) {
      if (!String(question.question ?? "").trim()
        || !String(question.contestedSubject ?? "").trim()
        || !String(question.disconfirmingFinding ?? "").trim()) {
        issues.push(`${item.blockId} contains an empty required question field`);
      }
      if (!(question.sourceUnitIds ?? []).length
        || question.sourceUnitIds.some((unitId) => !allowed.has(unitId))) {
        issues.push(`${item.blockId} cites a source unit outside its block`);
      }
    }
  }
  if (issues.length) throw new Error(`Invalid P1aV13 local questions: ${issues.join("; ")}`);
  const byBlock = new Map(returned.map((item) => [item.blockId, item]));
  return batch.blockIds.map((blockId) => structuredClone(byBlock.get(blockId)));
}

export function normalizeAndVerifyP1aV13LocalQuestions(output, batch) {
  const returned = output?.blocks ?? [];
  const returnedIds = returned.map((item) => item.blockId);
  if (returnedIds.length !== batch.blockIds.length
    || new Set(returnedIds).size !== returnedIds.length
    || batch.blockIds.some((blockId) => !returnedIds.includes(blockId))) {
    throw new Error("Invalid P1aV13 local questions: the batch must return every block exactly once");
  }
  const ownerByUnit = new Map(batch.blocks.flatMap((block) =>
    (block.sourceUnitIds ?? []).map((unitId) => [unitId, block.blockId])));
  const questionsByBlock = new Map(batch.blockIds.map((blockId) => [blockId, []]));
  const corrections = [];
  for (const item of returned) for (const question of item.questions ?? []) {
    if (!String(question.question ?? "").trim()
      || !String(question.contestedSubject ?? "").trim()
      || !String(question.disconfirmingFinding ?? "").trim()) {
      throw new Error(`Invalid P1aV13 local questions: ${item.blockId} has an empty field`);
    }
    const cited = question.sourceUnitIds ?? [];
    const owners = [...new Set(cited.map((unitId) => ownerByUnit.get(unitId)))];
    if (!cited.length || owners.includes(undefined) || owners.length !== 1) {
      throw new Error(`Invalid P1aV13 local questions: ${item.blockId} has unknown or cross-block grounding`);
    }
    const derivedBlockId = owners[0];
    if (derivedBlockId !== item.blockId) corrections.push({ fromBlockId: item.blockId,
      toBlockId: derivedBlockId, question: question.question, sourceUnitIds: [...cited] });
    questionsByBlock.get(derivedBlockId).push(structuredClone(question));
  }
  const blocks = batch.blockIds.map((blockId) => ({ blockId,
    questions: questionsByBlock.get(blockId) }));
  verifyP1aV13LocalQuestions({ blocks }, batch);
  return { blocks, corrections };
}

export function mergeP1aV13LocalQuestions(batchResults = []) {
  let index = 0;
  const blocks = batchResults.flatMap((result) => result.blocks).map((block) => ({
    ...structuredClone(block),
    questions: block.questions.map((question) => ({
      localQuestionId: `LQ${String(++index).padStart(3, "0")}`,
      blockId: block.blockId,
      ...structuredClone(question),
    })),
  }));
  return { blocks, questions: blocks.flatMap((block) => block.questions) };
}
