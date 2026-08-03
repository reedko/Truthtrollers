import type { Cf7Chunk, Cf7SourceUnit } from "../types/index.js";

export const CF7_HARVEST_SYSTEM_PROMPT = `You extract assertions from a section of an article.

Use only the supplied text and its source-unit identifiers. Do not use outside knowledge.
Do not fact-check.

Preserve every assertion's original polarity. Never rewrite an assertion the text
disputes into the text's rebuttal of it.`;

export function renderChunkWithUnitIds(
  chunk: Cf7Chunk,
  units: Cf7SourceUnit[],
): string {
  const unitById = new Map(units.map((unit) => [unit.unitId, unit]));
  return chunk.unitIds.map((unitId) => {
    const unit = unitById.get(unitId);
    if (!unit) throw new Error(`Unknown CF7 source unit ${unitId}`);
    return `[${unit.unitId}] ${unit.text}`;
  }).join("\n");
}

export function buildCf7HarvestUserPrompt(
  chunk: Cf7Chunk,
  units: Cf7SourceUnit[],
): string {
  return `ARTICLE SECTION ${chunk.chunkIndex} OF ${chunk.chunkCount}

${renderChunkWithUnitIds(chunk, units)}

TASK

First, in disputedAssertions, return the assertions this section presents in order to
dispute — each stated as its original source made it. Return an empty array only if the
section disputes nothing.

Then, in assertions, return every other factual assertion in this section that external
evidence could verify — each worded so it can be checked as written, with the source
units that state it.`;
}
