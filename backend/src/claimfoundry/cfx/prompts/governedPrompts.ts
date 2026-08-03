import { fileURLToPath } from "node:url";
import { loadCfxPrompt } from "./loadPrompt.js";

export const CFX_DISCOVERY_PROMPT_SHA256 =
  "288859047f85f65599bb20a69ad33eda0e754648a18b9c4a20b1f1cd3d7626d5";
export const CFX_EXACT_GROUNDING_PROMPT_SHA256 =
  "0076074fbdf87fad916be353ea1ae1888574a13550ef8003a5377abf0f7cc67f";
export const CFX_DISCOVERY_WITH_UNITS_PROMPT_SHA256 =
  "5878a225abf1d849885927ee99f0305fcf8925b15358e6b4cbc9c342e25d818e";
export const CFX_SUBSTANTIVE_REVIEW_PROMPT_SHA256 =
  "3b704a89248c720a9de58524463f7d28c22826b14295cefb1560474160e4833c";

export function loadCfxDiscoveryPrompt() {
  return loadCfxPrompt({
    filePath: fileURLToPath(
      new URL("./burden-of-proof-v1.json", import.meta.url),
    ),
    expectedPromptId: "burden-of-proof-v1",
    expectedPromptHash: CFX_DISCOVERY_PROMPT_SHA256,
  });
}

export function loadCfxExactGroundingPrompt() {
  return loadCfxPrompt({
    filePath: fileURLToPath(
      new URL("./exact-grounding-v1.json", import.meta.url),
    ),
    expectedPromptId: "exact-grounding-v1",
    expectedPromptHash: CFX_EXACT_GROUNDING_PROMPT_SHA256,
  });
}

export function loadCfxDiscoveryWithUnitsPrompt() {
  return loadCfxPrompt({
    filePath: fileURLToPath(
      new URL("./burden-of-proof-with-units-v1.json", import.meta.url),
    ),
    expectedPromptId: "burden-of-proof-with-units-v1",
    expectedPromptHash: CFX_DISCOVERY_WITH_UNITS_PROMPT_SHA256,
  });
}

export function loadCfxSubstantiveReviewPrompt() {
  return loadCfxPrompt({
    filePath: fileURLToPath(
      new URL("./substantive-review-v1.json", import.meta.url),
    ),
    expectedPromptId: "substantive-review-v1",
    expectedPromptHash: CFX_SUBSTANTIVE_REVIEW_PROMPT_SHA256,
  });
}
