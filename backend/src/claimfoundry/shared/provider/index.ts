import { openAiLLM } from "../../../core/openAiLLM.js";

export type Cf7StructuredModelRequest = {
  system: string;
  user: string;
  responseSchema: {
    name: string;
    strict: true;
    schema: Record<string, unknown>;
  };
  model: string;
  temperature: number;
  retryCount: number;
  store: false;
  seed?: number;
  maxOutputTokens: number;
  timeoutMs: number;
};

export type Cf7StructuredModelResponse = {
  output: unknown;
  rawResponse?: unknown;
  model: string;
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  responseId: string | null;
  requestId: string | null;
};

export type Cf7StructuredProvider = {
  invokeStructured(
    request: Cf7StructuredModelRequest,
  ): Promise<Cf7StructuredModelResponse>;
};

type RepositoryLlm = {
  generate(input: Record<string, unknown>): Promise<{
    output: unknown;
    usage?: Record<string, unknown>;
    model?: string;
    rawResponse?: {
      id?: string;
      request_id?: string;
    };
  }>;
};

function normalizedUsage(raw: Record<string, unknown> = {}) {
  const inputTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0;
  const outputTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0;
  const details = (raw.prompt_tokens_details ?? raw.input_tokens_details ?? {}) as
    Record<string, unknown>;
  return {
    inputTokens,
    cachedInputTokens: Number(details.cached_tokens ?? 0) || 0,
    outputTokens,
    totalTokens: Number(raw.total_tokens ?? inputTokens + outputTokens)
      || inputTokens + outputTokens,
  };
}

export function createOpenAiCf7StructuredProvider(
  llm: RepositoryLlm = openAiLLM as unknown as RepositoryLlm,
): Cf7StructuredProvider {
  return {
    async invokeStructured(request) {
      const response = await llm.generate({
        system: request.system,
        user: request.user,
        jsonSchema: request.responseSchema,
        schemaHint: JSON.stringify(request.responseSchema.schema),
        temperature: request.temperature,
        store: request.store,
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        model: request.model,
        maxOutputTokens: request.maxOutputTokens,
        timeout: request.timeoutMs,
        maxRetries: request.retryCount + 1,
        returnMetadata: true,
      });
      return {
        output: response.output,
        rawResponse: response.rawResponse ?? {
          output: response.output,
          usage: response.usage ?? null,
          model: response.model ?? request.model,
        },
        model: response.model ?? request.model,
        usage: normalizedUsage(response.usage),
        responseId: response.rawResponse?.id ?? null,
        requestId: response.rawResponse?.request_id ?? null,
      };
    },
  };
}
