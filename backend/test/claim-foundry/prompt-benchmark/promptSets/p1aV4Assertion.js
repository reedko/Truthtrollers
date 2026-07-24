import { buildP1aAssertionPrompt } from "./p1aAssertionPrompt.js";

export const P1A_V4_ASSERTION = "P1aV4-assertion";
export const buildP1aV4AssertionPrompt = (input) => buildP1aAssertionPrompt({
  ...input, label: "p1a_v4_assertion", removeMateriality: false,
});
