import { runCf2V6 } from "../v6/pipeline.js";
import { buildCf2V7DiscoveryPrompt } from "./prompts.js";

export async function runCf2V7(args) {
  const result = await runCf2V6({
    ...args,
    callAPromptBuilder: buildCf2V7DiscoveryPrompt,
  });
  return {
    ...result,
    architecture: `CF2_V7_EXPLICIT_ATTRIBUTION_ONLY_C${result.budgets.candidateMaximum}`
      + `_P${result.budgets.portfolioMaximum}`,
    promptAblation: {
      parentArchitecture: result.architecture,
      changedCall: "callA",
      changedField: "user",
      purpose: "Forbid synthesized attribution frames while retaining grounded frames",
    },
  };
}
