import { buildSplitCall1aClaimLanguagePrompt }
  from "./splitCall1aDiscoveryPromptClaimLanguageV3.js";
import { p1aVariantSchema } from "./p1aVariantSchema.js";

export const P1A_V5_XMAT = "P1aV5-xmat";
export function buildP1aV5NoMaterialityPrompt(input) {
  return { ...buildSplitCall1aClaimLanguagePrompt(input),
    responseSchema: p1aVariantSchema({ label: "p1a_v5_xmat",
      assertionTerminology: false, removeMateriality: true }) };
}
