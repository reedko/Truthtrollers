import { serializeStructuredArticle }
  from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

export const P1A_V7_CHUNK_ASSERTION = "P1aV7-C-assertion-chunk";

function chunkSchema(pillarLabels = []) {
  return {
    name: "p1a_v7_c_assertion_chunk",
    strict: true,
    schema: {
      type: "object", additionalProperties: false, required: ["assertions"],
      properties: {
        assertions: { type: "array", items: {
          type: "object", additionalProperties: false,
          required: ["assertionText", "sourceUnitIds", "materiality",
            "relatedPillarLabels", "scope", "evidenceUsefulnessHint"],
          properties: {
            assertionText: { type: "string", minLength: 1, maxLength: 500 },
            sourceUnitIds: { type: "array", maxItems: 12,
              items: { type: "string", minLength: 1, maxLength: 20 } },
            materiality: { type: "string", enum: ["high", "medium", "low"] },
            relatedPillarLabels: { type: "array", maxItems: 4,
              items: { type: "string", enum: pillarLabels } },
            scope: { type: "string", minLength: 1, maxLength: 400 },
            evidenceUsefulnessHint: { type: "string", minLength: 1, maxLength: 240 },
          },
        } },
      },
    },
  };
}

const orientationText = (orientation) => `theme: ${orientation.theme.text}
thesis: ${orientation.thesis.text}
thesisHinge: ${orientation.thesisHinge}
pillars:
${orientation.pillars.map((pillar) =>
    `- ${pillar.label}: ${pillar.text} (${pillar.importance})`).join("\n")}`;

function contextText(ids, unitsById) {
  return ids.map((id) => ({ unitId: id, text: unitsById.get(id)?.text ?? "" }));
}

export function buildP1aV7ChunkPrompt({ article, chunk, sourceUnits, orientation } = {}) {
  const unitsById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const pillarLabels = orientation.pillars.map((pillar) => pillar.label);
  return {
    system: `You are CF1's local assertion reader, stage P1aV7-C. Read the supplied article
chunk and return every distinct externally testable factual assertion grounded in its owned units.
Use only the supplied text.

The frozen whole-article orientation establishes consistent terminology and pillar labels. It is
not an inclusion filter. Extract assertions whether they support, contradict, qualify, or merely
contextualize the thesis. Preserve each assertion in its original polarity. Do not negate it,
correct it, characterize it as false or unsupported, or append the article's response.

Do not decide assertion source, posture, article deployment, article role, score transform, or
effect on the thesis. A later stage owns those decisions.`,
    user: `For each assertion:
- write assertionText as one atomic, externally testable factual assertion;
- an atomic assertion has one primary subject and one independently testable predicate or relationship;
- a comparison or correlation may name multiple entities only when that relationship is itself the single assertion;
- if the text asserts an additional event, outcome, statistic, classification, effect, or article response, emit it as a separate assertion;
- ground every sourceUnitId in the OWNED CHUNK only; context-only units may clarify a boundary but may not be cited;
- preserve only the names, numbers, dates, comparisons, and qualifications belonging to that assertion;
- treat direct quotations, attributed assertions, advertisement statements, and list items as assertions when their substantive content is externally testable;
- use relatedPillarLabels only from the frozen list and only when the assertion genuinely bears on that axis; an empty list is allowed;
- give one short evidenceUsefulnessHint describing evidence that could test the assertion.

Exclude navigation, trivia, pure rhetorical questions, and descriptions of presentation or intent
that contain no standalone factual assertion. Do not invent bibliographic details. Do not merge
distinct assertions merely because they occur in the same or nearby passages. Do not stop after
finding assertions near the beginning of the chunk; review every owned block before finalizing.

TITLE: ${article.title}
CHUNK: ${chunk.chunkId}
OWNED RANGE: ${chunk.firstUnitId} through ${chunk.lastUnitId}

FROZEN ORIENTATION:
${orientationText(orientation)}

CONTEXT BEFORE (NOT GROUNDING):
${JSON.stringify(contextText(chunk.contextBeforeUnitIds, unitsById), null, 2)}

OWNED CHUNK:
${serializeStructuredArticle(chunk.blocks, sourceUnits)}

CONTEXT AFTER (NOT GROUNDING):
${JSON.stringify(contextText(chunk.contextAfterUnitIds, unitsById), null, 2)}`,
    responseSchema: chunkSchema(pillarLabels),
  };
}

export function normalizeAndVerifyP1aV7ChunkOutput({ output, chunk, orientation }) {
  const owned = new Set(chunk.ownedUnitIds);
  const labels = new Set(orientation.pillars.map((pillar) => pillar.label));
  const seen = new Set();
  return (output?.assertions ?? []).map((assertion, index) => {
    const normalized = assertion.assertionText.replace(/\s+/g, " ").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      throw new Error(`${chunk.chunkId} emitted an empty or exactly duplicated assertion`);
    }
    seen.add(normalized);
    if (!(assertion.sourceUnitIds ?? []).length
      || assertion.sourceUnitIds.some((id) => !owned.has(id))) {
      throw new Error(`${chunk.chunkId} emitted grounding outside its owned units`);
    }
    if ((assertion.relatedPillarLabels ?? []).some((label) => !labels.has(label))) {
      throw new Error(`${chunk.chunkId} emitted an unknown pillar label`);
    }
    return {
      candidateId: `${chunk.chunkId}-A${String(index + 1).padStart(3, "0")}`,
      chunkId: chunk.chunkId,
      assertionText: assertion.assertionText,
      claimText: assertion.assertionText,
      sourceUnitIds: assertion.sourceUnitIds,
      materiality: assertion.materiality,
      relatedPillarLabels: assertion.relatedPillarLabels ?? [],
      scope: assertion.scope,
      evidenceUsefulnessHint: assertion.evidenceUsefulnessHint,
    };
  });
}
