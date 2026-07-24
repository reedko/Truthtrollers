// Stable human-facing label for the current executable Simple V3 claim-language
// prompt. This wrapper deliberately changes no prompt byte or schema field.
export { buildSplitCall1aClaimLanguagePrompt as buildP1aV2BaselinePrompt }
  from "./splitCall1aDiscoveryPromptClaimLanguageV3.js";

export const P1A_V2_BASELINE = "P1aV2-baseline";
