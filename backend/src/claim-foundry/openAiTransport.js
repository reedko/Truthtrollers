import { openAiLLM } from "../core/openAiLLM.js";

export function createOpenAiCf1Transport({ llm = openAiLLM } = {}) {
  if (typeof llm?.generate !== "function") {
    throw new TypeError("CF1 OpenAI transport requires the repository LLM generate() port");
  }
  return Object.freeze({
    invoke(request) {
      const schema = request.responseSchema?.schema ?? request.responseSchema;
      const strictSchemaSupported = !["gpt-4-turbo", "gpt-3.5-turbo"].includes(request.model);
      return llm.generate({
        system: request.system,
        user: request.user,
        schemaHint: JSON.stringify(schema),
        ...(strictSchemaSupported && request.responseSchema?.strict === true && request.responseSchema?.name
          && request.responseSchema?.schema
          ? { jsonSchema: request.responseSchema } : {}),
        temperature: request.temperature,
        model: request.model,
        maxOutputTokens: request.maxOutputTokens,
        timeout: request.timeoutMs,
        maxRetries: 1,
        returnMetadata: true,
      });
    },
  });
}
