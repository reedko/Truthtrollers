import { buildP1aV7ChunkPrompt } from "./p1aV7ChunkAssertion.js";

function removePillarField(schema) {
  const item = schema.schema.properties.assertions.items;
  delete item.properties.relatedPillarLabels;
  item.required = item.required.filter((field) => field !== "relatedPillarLabels");
}

const pillarBullet = "- use relatedPillarLabels only from the frozen list and only when the assertion genuinely bears on that axis; an empty list is allowed;\n";

export function buildP1aV7ChunkOrientationLitePrompt(input) {
  const prompt = buildP1aV7ChunkPrompt(input);
  prompt.responseSchema.name = "p1a_v7_c_orientation_lite";
  removePillarField(prompt.responseSchema);
  prompt.system = prompt.system.replace(
    `The frozen whole-article orientation establishes consistent terminology and pillar labels. It is
not an inclusion filter.`,
    `The frozen whole-article theme and thesis provide global context. They are not an inclusion
filter.`);
  prompt.user = prompt.user.replace(pillarBullet, "")
    .replace(/pillars:\n[\s\S]*?\n\nCONTEXT BEFORE/, "pillars: (not supplied)\n\nCONTEXT BEFORE");
  return prompt;
}

export function buildP1aV7ChunkLocalOnlyPrompt(input) {
  const prompt = buildP1aV7ChunkPrompt(input);
  prompt.responseSchema.name = "p1a_v7_c_local_only";
  removePillarField(prompt.responseSchema);
  prompt.system = prompt.system.replace(
    `The frozen whole-article orientation establishes consistent terminology and pillar labels. It is
not an inclusion filter. Extract assertions whether they support, contradict, qualify, or merely
contextualize the thesis.`,
    `No global orientation is supplied. Extract every externally testable assertion in the owned
chunk without deciding its relationship to any whole-article thesis.`);
  prompt.user = prompt.user.replace(pillarBullet, "")
    .replace(/\nFROZEN ORIENTATION:\n[\s\S]*?\n\nCONTEXT BEFORE/, "\nCONTEXT BEFORE");
  return prompt;
}
