export const P1A_V13_AXIS_SYNTHESIS = "P1aV13-B-axis-synthesis";

export const P1A_V13_AXIS_SYSTEM = `Synthesize an article's argument using only the supplied local
factual questions. You do not have the article.

First consolidate the local questions into evidence axes. Combine questions only when substantially
the same body of evidence would resolve them. Keep questions separate when they concern different
mechanisms, sources, populations, events, or could stand or fall independently. Every evidence axis
must have a neutral question and one directional proposition that answers it. Classify how support
for that proposition and refutation of it would affect the article's thesis. Put questions that do
not contribute to a coherent evidence axis in unassignedLocalQuestionIds.

Only after forming the evidence axes, infer the article's specific central thesis from their combined
direction. Then state the broader theme. Finally classify thesisHinge as substance when underlying
facts settle the thesis, attribution when who said or published something settles it, or mixed only
when both genuinely carry equal central weight.

Use each local question exactly once, either in one evidence axis or as unassigned. Do not invent
facts, broaden a local question, or merge distinct evidence bodies.`;

const effects = ["strengthens_thesis", "weakens_thesis", "neutral"];

export function buildP1aV13AxisSynthesisSchema(localQuestions = []) {
  const ids = localQuestions.map((item) => item.localQuestionId);
  const idItems = { type: "string", enum: ids };
  return {
    name: "p1a_v13_axis_synthesis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["evidenceAxes", "unassignedLocalQuestionIds", "thesis", "theme",
        "thesisHinge"],
      properties: {
        evidenceAxes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "question", "proposition", "localQuestionIds",
              "ifSupported", "ifRefuted"],
            properties: {
              label: { type: "string", minLength: 1, maxLength: 160 },
              question: { type: "string", minLength: 1, maxLength: 500 },
              proposition: { type: "string", minLength: 1, maxLength: 500 },
              localQuestionIds: { type: "array", minItems: 1, items: idItems },
              ifSupported: { type: "string", enum: effects },
              ifRefuted: { type: "string", enum: effects },
            },
          },
        },
        unassignedLocalQuestionIds: { type: "array", items: idItems },
        thesis: {
          type: "object",
          additionalProperties: false,
          required: ["text", "sourceLocalQuestionIds"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 600 },
            sourceLocalQuestionIds: { type: "array", minItems: 1, items: idItems },
          },
        },
        theme: {
          type: "object",
          additionalProperties: false,
          required: ["text", "sourceLocalQuestionIds"],
          properties: {
            text: { type: "string", minLength: 1, maxLength: 600 },
            sourceLocalQuestionIds: { type: "array", minItems: 1, items: idItems },
          },
        },
        thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
      },
    },
  };
}

export function buildP1aV13AxisSynthesisPrompt({ localQuestions = [] } = {}) {
  const payload = localQuestions.map(({ localQuestionId, blockId, question, contestedSubject,
    disconfirmingFinding, sourceUnitIds }) => ({ localQuestionId, blockId, question,
    contestedSubject, disconfirmingFinding, sourceUnitIds }));
  return {
    system: P1A_V13_AXIS_SYSTEM,
    user: `Build the evidence axes and overall orientation from this complete list of local factual
questions. The list is the only source material available to you.

LOCAL FACTUAL QUESTIONS:
${JSON.stringify(payload, null, 2)}`,
    responseSchema: buildP1aV13AxisSynthesisSchema(localQuestions),
  };
}

const normalized = (value) => String(value ?? "").toLowerCase().normalize("NFKC")
  .replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

export function verifyAndEnrichP1aV13AxisSynthesis(output, localQuestions = []) {
  const issues = [];
  const byId = new Map(localQuestions.map((item) => [item.localQuestionId, item]));
  const expected = [...byId.keys()];
  const axes = output?.evidenceAxes ?? [];
  const labels = axes.map((axis) => normalized(axis.label));
  if (!axes.length || labels.some((label) => !label)
    || new Set(labels).size !== labels.length) issues.push("axis labels must be nonempty and unique");
  const assigned = axes.flatMap((axis) => axis.localQuestionIds ?? []);
  const unassigned = output?.unassignedLocalQuestionIds ?? [];
  const classified = [...assigned, ...unassigned];
  if (classified.length !== expected.length || new Set(classified).size !== classified.length
    || expected.some((id) => !classified.includes(id))) {
    issues.push("every local question must be classified exactly once");
  }
  if (classified.some((id) => !byId.has(id))) issues.push("unknown local question ID");
  for (const axis of axes) {
    if (!(axis.localQuestionIds ?? []).length) issues.push(`${axis.label} has no local questions`);
  }
  for (const item of [output?.thesis, output?.theme]) {
    if (!item?.text || !(item.sourceLocalQuestionIds ?? []).length
      || item.sourceLocalQuestionIds.some((id) => !byId.has(id))) {
      issues.push("thesis or theme grounding is invalid");
    }
  }
  if (!buildP1aV13AxisSynthesisSchema(localQuestions).schema.properties.thesisHinge.enum
    .includes(output?.thesisHinge)) issues.push("thesisHinge is invalid");
  if (issues.length) throw new Error(`Invalid P1aV13 synthesis: ${issues.join("; ")}`);

  return {
    ...structuredClone(output),
    evidenceAxes: axes.map((axis, index) => {
      const members = axis.localQuestionIds.map((id) => byId.get(id));
      return {
        axisId: `AX${String(index + 1).padStart(3, "0")}`,
        ...structuredClone(axis),
        sourceBlockIds: [...new Set(members.map((item) => item.blockId))],
        sourceUnitIds: [...new Set(members.flatMap((item) => item.sourceUnitIds))],
      };
    }),
  };
}
