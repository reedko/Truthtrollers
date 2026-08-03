import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const promptFileSchema = z.object({
  schemaVersion: z.literal("cfx.prompt.v1"),
  promptId: z.string().min(1),
  prompt: z.string().min(1),
}).strict();

export type CfxGovernedPrompt = z.infer<typeof promptFileSchema> & {
  promptHash: string;
};

export async function loadCfxPrompt(input: {
  filePath: string;
  expectedPromptId: string;
  expectedPromptHash: string;
}): Promise<CfxGovernedPrompt> {
  const parsed = promptFileSchema.parse(
    JSON.parse(await readFile(input.filePath, "utf8")),
  );
  const promptHash = createHash("sha256").update(parsed.prompt).digest("hex");
  if (parsed.promptId !== input.expectedPromptId) {
    throw new Error(
      `CFX prompt ID mismatch: expected ${input.expectedPromptId}, got ${parsed.promptId}`,
    );
  }
  if (promptHash !== input.expectedPromptHash) {
    throw new Error(
      `CFX prompt hash mismatch for ${input.expectedPromptId}`,
    );
  }
  return { ...parsed, promptHash };
}
