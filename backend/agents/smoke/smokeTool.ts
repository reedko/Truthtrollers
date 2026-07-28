import { z } from "zod";
import type { RuntimeTool } from "../shared/agentRuntime.js";

export const smokeToolInputSchema = z.object({
  text: z.string().min(1).max(200),
});

export const smokeToolOutputSchema = z.object({
  originalText: z.string(),
  normalizedText: z.string(),
  characterCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
});

export type SmokeToolOutput = z.infer<typeof smokeToolOutputSchema>;

export const smokeTool: RuntimeTool<
  typeof smokeToolInputSchema.shape,
  SmokeToolOutput
> = {
  name: "normalize_whitespace",
  description:
    "Normalize whitespace in the supplied harmless text and return deterministic counts.",
  parameters: smokeToolInputSchema,
  execute({ text }) {
    const normalizedText = text.trim().replace(/\s+/gu, " ");
    return smokeToolOutputSchema.parse({
      originalText: text,
      normalizedText,
      characterCount: normalizedText.length,
      wordCount: normalizedText === "" ? 0 : normalizedText.split(" ").length,
    });
  },
};
