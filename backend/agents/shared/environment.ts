import { AgentRuntimeError } from "./agentErrors.js";

export type SmokeEnvironment = {
  apiKey: string;
  model: string;
};

export function readSmokeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): SmokeEnvironment {
  const missing = ["OPENAI_API_KEY", "CF6_SMOKE_MODEL"].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new AgentRuntimeError(
      "configuration",
      `CF6 smoke configuration is missing: ${missing.join(", ")}`,
    );
  }
  return {
    apiKey: env.OPENAI_API_KEY!.trim(),
    model: env.CF6_SMOKE_MODEL!.trim(),
  };
}
