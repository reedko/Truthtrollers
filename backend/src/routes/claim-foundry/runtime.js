import { createCf1ModelRunner } from "../../claim-foundry/modelRunner.js";
import { createOpenAiCf1Transport } from "../../claim-foundry/openAiTransport.js";
import { parseCf1ConsumerKeys } from "./consumerAuth.js";

function positiveInteger(value, fallback, name) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${name} must be a positive integer`);
  return number;
}

export function createCf1Runtime({ query, pool, environment = process.env, llm }) {
  if (typeof query !== "function" || !pool) throw new TypeError("CF1 runtime requires database query and pool ports");
  const model = environment.CF1_MODEL;
  if (!model) throw new TypeError("CF1_MODEL is required when the public API is enabled");
  if (!llm && !(environment.OPENAI_API_KEY || environment.REACT_APP_OPENAI_API_KEY)) {
    throw new TypeError("OPENAI_API_KEY or REACT_APP_OPENAI_API_KEY is required when CF1 is enabled");
  }
  const transport = createOpenAiCf1Transport({ ...(llm ? { llm } : {}) });
  const consumerKeys = parseCf1ConsumerKeys(environment.CF1_CONSUMER_KEYS_JSON);
  if (Object.keys(consumerKeys).length === 0) throw new TypeError("At least one CF1 consumer key is required");
  return { query, pool, consumerKeys,
    internalConsumerKey: environment.CF1_VERISTRATA_CONSUMER_KEY || "veristrata",
    activationEnabled: String(environment.CF1_ACTIVATION_ENABLED).toLowerCase() === "true",
    defaultOptions: { model,
      modelContextTokens: positiveInteger(environment.CF1_MODEL_CONTEXT_TOKENS, 128_000, "CF1_MODEL_CONTEXT_TOKENS"),
      timeoutMs: positiveInteger(environment.CF1_MODEL_TIMEOUT_MS, 120_000, "CF1_MODEL_TIMEOUT_MS"),
      allowRepair: true, persist: true,
      budgetLimits: {
        maxTotalTokens: positiveInteger(environment.CF1_MAX_TOTAL_TOKENS, 30_000, "CF1_MAX_TOTAL_TOKENS"),
        maxOutputTokensPerCall: positiveInteger(environment.CF1_MAX_OUTPUT_TOKENS, 12_000, "CF1_MAX_OUTPUT_TOKENS"),
        maxDurationMs: positiveInteger(environment.CF1_MAX_DURATION_MS, 300_000, "CF1_MAX_DURATION_MS"),
      } }, runnerDependencies: { modelRunner: createCf1ModelRunner({ transport }) } };
}
