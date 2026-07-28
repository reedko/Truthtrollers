export type AgentErrorKind =
  | "configuration"
  | "budget"
  | "provider"
  | "model_behavior"
  | "runtime";

export class AgentRuntimeError extends Error {
  constructor(
    public readonly kind: AgentErrorKind,
    message: string,
    options?: ErrorOptions,
    public readonly telemetry?: {
      runId: string;
      traceId: string;
      model: string;
      toolEvents: Array<{ name: string; validatedArguments: unknown; output: unknown; durationMs: number }>;
      durationMs: number;
    },
  ) {
    super(message, options);
    this.name = "AgentRuntimeError";
  }
}

export function normalizeAgentError(error: unknown): AgentRuntimeError {
  if (error instanceof AgentRuntimeError) return error;
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : String(error);

  if (name.includes("MaxTurns") || name.includes("Abort") || name.includes("Timeout")) {
    return new AgentRuntimeError("budget", message, { cause: error });
  }
  if (name.includes("ModelBehavior") || name.includes("InvalidToolInput")) {
    return new AgentRuntimeError("model_behavior", message, { cause: error });
  }
  if (
    name.includes("API") ||
    name.includes("OpenAI") ||
    name.includes("RateLimit") ||
    name.includes("Authentication")
  ) {
    return new AgentRuntimeError("provider", message, { cause: error });
  }
  return new AgentRuntimeError("runtime", message, { cause: error });
}
