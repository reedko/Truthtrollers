const strings = (maxItems, maxLength) => ({ type: "array", maxItems,
  items: { type: "string", minLength: 1, maxLength } });

export const P1A_V7_ORIENTATION = "P1aV7-O-orientation";

export const P1A_V7_ORIENTATION_SCHEMA = Object.freeze({
  name: "p1a_v7_o_orientation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["theme", "thesis", "thesisHinge", "pillars"],
    properties: {
      theme: { type: "object", additionalProperties: false,
        required: ["text", "sourceUnitIds"], properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
        } },
      thesis: { type: "object", additionalProperties: false,
        required: ["text", "sourceUnitIds"], properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
        } },
      thesisHinge: { type: "string", enum: ["substance", "attribution", "mixed"] },
      pillars: { type: "array", minItems: 1, maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["label", "text", "importance", "sourceUnitIds"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 140 },
          text: { type: "string", minLength: 1, maxLength: 500 },
          importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
          sourceUnitIds: strings(12, 20),
        },
      } },
    },
  },
});

export function buildP1aV7OrientationPrompt({ orientationPacket } = {}) {
  return {
    system: `You are CF1's whole-article orientation reader, stage P1aV7-O. Determine the
article's global argument map from a compact structural spine sampled across the complete article.
Use only the supplied packet. Do not extract, select, rewrite, or evaluate factual assertions.

Theme is the article's broad argumentative position, stated as a complete proposition. Thesis is
the specific central conclusion the article argues. They must be distinct. Pillars are the major
article-specific disputed questions or argumentative axes needed to organize that thesis, not
generic topics and not section titles.

thesisHinge identifies what kind of evidence would settle the article's central argument:
- substance: whether the underlying factual matters are true settles the thesis;
- attribution: whether a person or institution actually said, wrote, or published something
  settles the thesis;
- mixed: both attribution and substance genuinely carry equal central weight.
Do not choose attribution merely because the article quotes or criticizes named sources.

Ground theme, thesis, and pillars only in sourceUnitIds present in the packet. Preserve the
article's actual direction even when it is contrarian. The packet is an excerpted structural spine,
so do not treat an omitted passage as evidence that something did not occur.`,
    user: `Return the global orientation for this article.

ORIENTATION PACKET:
${JSON.stringify(orientationPacket, null, 2)}`,
    responseSchema: structuredClone(P1A_V7_ORIENTATION_SCHEMA),
  };
}

export function verifyP1aV7Orientation(output, orientationPacket) {
  const allowed = new Set((orientationPacket?.excerpts ?? []).map((item) => item.unitId));
  const issues = [];
  const labels = (output?.pillars ?? []).map((pillar) => pillar.label);
  if (!output?.theme?.text || !output?.thesis?.text || !Array.isArray(output?.pillars)
    || !output.pillars.length) issues.push("orientation shape is incomplete");
  if (new Set(labels).size !== labels.length) issues.push("pillar labels are not unique");
  for (const item of [output?.theme, output?.thesis, ...(output?.pillars ?? [])].filter(Boolean)) {
    if (!(item.sourceUnitIds ?? []).length) issues.push("an orientation item has no grounding");
    if ((item.sourceUnitIds ?? []).some((id) => !allowed.has(id))) {
      issues.push("orientation cites a unit outside its packet");
    }
  }
  if (!P1A_V7_ORIENTATION_SCHEMA.schema.properties.thesisHinge.enum
    .includes(output?.thesisHinge)) issues.push("thesisHinge is invalid");
  if (issues.length) throw new Error(`Invalid P1aV7 orientation: ${issues.join("; ")}`);
  return structuredClone(output);
}
