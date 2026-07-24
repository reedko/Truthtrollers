import { P1A_V7_ORIENTATION_SCHEMA } from "./p1aV7Orientation.js";

export const P1A_V7_ORIENTATION_POST = "P1aV7-O-post";

export function buildP1aV7OrientationPostPacket({ preOrientation, orientationPacket,
  assertions = [] } = {}) {
  return {
    preOrientation,
    structuralSpine: orientationPacket,
    extractedAssertions: assertions.map((assertion) => ({
      candidateId: assertion.candidateId,
      assertionText: assertion.assertionText ?? assertion.claimText,
      sourceUnitIds: assertion.sourceUnitIds,
      sourceChunkIds: assertion.sourceChunkIds ?? [assertion.chunkId].filter(Boolean),
    })),
  };
}

export function buildP1aV7OrientationPostPrompt({ postPacket } = {}) {
  const schema = structuredClone(P1A_V7_ORIENTATION_SCHEMA);
  schema.name = "p1a_v7_o_post";
  const candidateIds = (postPacket?.extractedAssertions ?? [])
    .map((item) => item.candidateId);
  schema.schema.required.push("assertionPillarAssignments");
  schema.schema.properties.assertionPillarAssignments = {
    type: "array", minItems: candidateIds.length, maxItems: candidateIds.length,
    items: { type: "object", additionalProperties: false,
      required: ["candidateId", "relatedPillarLabels"], properties: {
        candidateId: { type: "string", enum: candidateIds },
        relatedPillarLabels: { type: "array", maxItems: 8,
          items: { type: "string" } },
      } },
  };
  return {
    system: `You are CF1's post-extraction orientation auditor, stage P1aV7-O-post. Review the
provisional orientation against a structural spine and assertions independently extracted across
the complete article. Return the most accurate global theme, thesis, thesisHinge, and pillars.

Theme is the broad argumentative position. Thesis is the specific central conclusion. They must
remain distinct. Pillars are the major article-specific disputed questions or argumentative axes,
not generic topics, audience descriptions, or section titles. After defining the final pillars,
classify every extracted assertion by candidateId. relatedPillarLabels must contain only exact final
pillar labels that the assertion substantively bears on. Use an empty array when an assertion is
important or evidence-testable but does not cleanly belong to a final pillar. Do not force-fit an
assertion merely to avoid an empty array.

thesisHinge is substance when truth of the underlying matters settles the thesis; attribution only
when proving who said, wrote, or published something itself settles the thesis; and mixed only when
both genuinely carry equal central weight. Quoting or criticizing named sources does not by itself
make the hinge attribution or mixed.

You may retain or revise the provisional orientation, but do not add, remove, select, combine, or
rewrite extracted assertions. Return every candidateId exactly once. Ground orientation only in
sourceUnitIds present in the packet.`,
    user: `Audit and return the final whole-article orientation.

POST-EXTRACTION PACKET:
${JSON.stringify(postPacket, null, 2)}`,
    responseSchema: schema,
  };
}

export function verifyP1aV7PostOrientation(output, postPacket) {
  const allowed = new Set([
    ...(postPacket?.structuralSpine?.excerpts ?? []).map((item) => item.unitId),
    ...(postPacket?.extractedAssertions ?? []).flatMap((item) => item.sourceUnitIds ?? []),
  ]);
  const labels = (output?.pillars ?? []).map((pillar) => pillar.label);
  const labelSet = new Set(labels);
  const expectedCandidateIds = (postPacket?.extractedAssertions ?? [])
    .map((item) => item.candidateId);
  const assignments = output?.assertionPillarAssignments ?? [];
  const returnedCandidateIds = assignments.map((item) => item.candidateId);
  const issues = [];
  if (!output?.theme?.text || !output?.thesis?.text || !(output?.pillars ?? []).length) {
    issues.push("post orientation is incomplete");
  }
  if (new Set(labels).size !== labels.length) issues.push("post pillar labels are not unique");
  if (assignments.length !== expectedCandidateIds.length
    || new Set(returnedCandidateIds).size !== returnedCandidateIds.length
    || expectedCandidateIds.some((id) => !returnedCandidateIds.includes(id))) {
    issues.push("post assertion assignments must cover every candidate exactly once");
  }
  if (assignments.some((item) => (item.relatedPillarLabels ?? [])
    .some((label) => !labelSet.has(label)))) {
    issues.push("post assertion assignment cites an unknown final pillar label");
  }
  for (const item of [output?.theme, output?.thesis, ...(output?.pillars ?? [])].filter(Boolean)) {
    if (!(item.sourceUnitIds ?? []).length
      || item.sourceUnitIds.some((id) => !allowed.has(id))) {
      issues.push("post orientation has missing or unavailable grounding");
    }
  }
  if (!P1A_V7_ORIENTATION_SCHEMA.schema.properties.thesisHinge.enum
    .includes(output?.thesisHinge)) issues.push("post thesisHinge is invalid");
  if (issues.length) throw new Error(`Invalid P1aV7 O-post: ${issues.join("; ")}`);
  return structuredClone(output);
}
