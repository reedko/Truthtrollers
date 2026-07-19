import OpenAI from "openai";
import { recordOpenAiUsage } from "../core/openAiUsageTelemetry.js";

const apiKey = () => process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;

function responseFormat(responseSchema = {}) {
  const schema = responseSchema.schema ?? responseSchema;
  return {
    type: "json_schema",
    name: responseSchema.name ?? "cf1_structured_response",
    strict: responseSchema.strict === true,
    schema,
  };
}

export function createOpenAiResponsesCf1Transport({ client = null } = {}) {
  return Object.freeze({
    async invoke(request) {
      const openai = client ?? new OpenAI({ apiKey: apiKey() });
      const raw = await openai.responses.create({
        model: request.model,
        instructions: request.system,
        input: request.user,
        store: request.store ?? false,
        ...(request.reasoningEffort && request.reasoningEffort !== "none"
          ? { reasoning: { effort: request.reasoningEffort } }
          : {}),
        text: { format: responseFormat(request.responseSchema) },
        ...(Number.isInteger(request.maxOutputTokens) && request.maxOutputTokens > 0
          ? { max_output_tokens: request.maxOutputTokens } : {}),
      }, request.signal ? { signal: request.signal } : undefined);

      recordOpenAiUsage(raw.usage, raw.model || request.model);
      if (raw.status === "incomplete") {
        const error = new Error(`OpenAI Responses output incomplete: ${raw.incomplete_details?.reason ?? "unknown"}`);
        error.code = "CF1_MODEL_OUTPUT_INCOMPLETE";
        error.usage = raw.usage;
        error.model = raw.model || request.model;
        throw error;
      }

      let output;
      try {
        output = JSON.parse(raw.output_text ?? "");
      } catch (cause) {
        const error = new Error(`Failed to parse JSON from OpenAI Responses: ${cause.message}`);
        error.usage = raw.usage;
        error.model = raw.model || request.model;
        throw error;
      }
      return { output, usage: raw.usage, model: raw.model || request.model, rawResponse: raw };
    },
  });
}
