import { hashOptions, sha256Hex } from "../claim-foundry/canonicalJson.js";

const SEMANTIC_OPTION_KEYS = Object.freeze([
  "model", "temperature", "modelContextTokens", "blockOptions", "budgetLimits", "allowRepair",
]);

export function semanticCf1Options(options = {}) {
  return Object.fromEntries(SEMANTIC_OPTION_KEYS.filter((key) => options[key] !== undefined)
    .map((key) => [key, structuredClone(options[key])]));
}

export function createCf1OptionsHash(options = {}) {
  return hashOptions(semanticCf1Options(options));
}

export function deriveCf1IdempotencyKey({ consumerKey, consumerContentRef = "",
  inputHash, optionsHash, pipelineVersion }) {
  for (const [name, value] of Object.entries({ consumerKey, inputHash, optionsHash, pipelineVersion })) {
    if (typeof value !== "string" || !value) throw new TypeError(`${name} is required`);
  }
  return sha256Hex([consumerKey, consumerContentRef ?? "", inputHash, optionsHash, pipelineVersion].join("|"));
}
