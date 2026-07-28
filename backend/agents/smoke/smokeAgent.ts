import { z } from "zod";
import type { AgentDefinition } from "../shared/agentRuntime.js";
import { smokeTool } from "./smokeTool.js";

export const smokeAgentOutputSchema = z.object({
  normalizedText: z.string(),
  characterCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  toolUsed: z.literal("normalize_whitespace"),
});

export type SmokeAgentOutput = z.infer<typeof smokeAgentOutputSchema>;

export const smokeAgentDefinition: AgentDefinition<SmokeAgentOutput> = {
  name: "CF6 harmless smoke agent",
  instructions: [
    "This is a non-production SDK smoke test.",
    "You must call normalize_whitespace exactly once using the user's text.",
    "Return the tool's normalizedText, characterCount, and wordCount unchanged.",
    'Set toolUsed to "normalize_whitespace".',
    "Do not answer without using the tool.",
  ].join(" "),
  outputType: smokeAgentOutputSchema,
  tools: [smokeTool],
};
