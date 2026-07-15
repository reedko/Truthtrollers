// backend/core/openAiLLM.js

import dotenv from "dotenv";
import https from "https";
import logger from "../utils/logger.js";
import { recordOpenAiUsage } from "./openAiUsageTelemetry.js";

dotenv.config();

// Read API key at call time, not import time (allows scripts to set env vars before importing)
const getOpenAiApiKey = () => process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;

// Create persistent HTTPS agent with connection pooling for OpenAI API
// This reuses TCP connections instead of creating new ones for each request
// Benefits: Faster requests (~500ms → ~200ms), reduced latency, fewer sockets
const httpsAgent = new https.Agent({
  keepAlive: true,           // Reuse connections
  keepAliveMsecs: 30000,     // Keep connections alive for 30s
  maxSockets: 50,            // Allow up to 50 concurrent connections
  maxFreeSockets: 10,        // Keep 10 idle connections in pool
  timeout: 60000,            // Socket timeout: 60s
});

export const openAiLLM = {
  /**
   * Test if OpenAI API is accessible (lightweight check)
   * Returns { accessible: true } or { accessible: false, error: string, userMessage: string }
   */
  async testConnection() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${getOpenAiApiKey()}`,
        },
        signal: controller.signal,
        agent: httpsAgent, // Use connection pool
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const text = await resp.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
        } catch {
          errorData = { error: { message: text } };
        }

        // Region/country block
        if (errorData.error?.code === "unsupported_country_region_territory") {
          return {
            accessible: false,
            error: errorData.error.message,
            userMessage: "Unfortunately, OpenAI's services are not available in your current region. The TruthTrollers AI analysis features require OpenAI API access, which is restricted in certain countries and territories.",
          };
        }

        // API key issue
        if (resp.status === 401 || resp.status === 403) {
          return {
            accessible: false,
            error: "Authentication failed",
            userMessage: "OpenAI API authentication failed. Please check your API key configuration.",
          };
        }

        // Other errors
        return {
          accessible: false,
          error: errorData.error?.message || "Unknown error",
          userMessage: "OpenAI API is currently unavailable. Please try again later.",
        };
      }

      return { accessible: true };
    } catch (error) {
      logger.error("[openAiLLM] Connection test failed:", error.message);
      return {
        accessible: false,
        error: error.message,
        userMessage: "Unable to reach OpenAI API. Please check your internet connection.",
      };
    }
  },

  /**
   * Unified JSON-mode OpenAI caller with timeout and retry.
   * Params:
   *  - system: system prompt
   *  - user: user prompt
   *  - schemaHint: string describing expected JSON shape
   *  - temperature: optional
   *  - maxRetries: optional (default 3)
   *  - timeout: optional in ms (default 30000)
   *  - model: optional (default preserves existing gpt-4o-mini behavior)
   *  - maxOutputTokens: optional provider output ceiling
   *  - returnMetadata: optional transport envelope for callers needing usage/model
   */
  async generate({
    system,
    user,
    schemaHint,
    temperature = 0.2,
    maxRetries = 3,
    timeout = 30000,
    model = "gpt-4o-mini",
    maxOutputTokens = null,
    returnMetadata = false,
    jsonSchema = null,
  }) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getOpenAiApiKey()}`,
          },
          body: JSON.stringify({
            model,
            temperature,
            response_format: jsonSchema
              ? { type: "json_schema", json_schema: jsonSchema }
              : { type: "json_object" },
            ...(Number.isInteger(maxOutputTokens) && maxOutputTokens > 0
              ? { max_tokens: maxOutputTokens } : {}),
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content: schemaHint && !jsonSchema
                  ? user +
                    "\n\nReturn ONLY valid JSON. JSON shape hint: " +
                    schemaHint
                  : user,
              },
            ],
          }),
          signal: controller.signal,
          agent: httpsAgent, // Use connection pool for faster requests
        });

        clearTimeout(timeoutId);

        const text = await resp.text();

        if (!resp.ok) {
          // Parse error response
          let errorData;
          try {
            errorData = JSON.parse(text);
          } catch {
            errorData = { error: { message: text } };
          }

          // Don't retry on 4xx errors (bad request, auth, region blocks, etc)
          if (resp.status >= 400 && resp.status < 500) {
            logger.error(
              `[openAiLLM] Client error ${resp.status}:`,
              text.slice(0, 500)
            );

            // Special handling for region blocks
            if (errorData.error?.code === "unsupported_country_region_territory") {
              const err = new Error("OpenAI services are not available in your region");
              err.code = "REGION_BLOCKED";
              err.userMessage = "Unfortunately, OpenAI's services are not available in your current region. The TruthTrollers AI analysis features require OpenAI API access, which is restricted in certain countries and territories.";
              throw err;
            }

            throw new Error(`OpenAI error ${resp.status}: ${text.slice(0, 200)}`);
          }

          // Retry on 5xx errors
          throw new Error(`OpenAI server error ${resp.status}`);
        }

        let parsed;
        let providerResponse;
        try {
          const json = JSON.parse(text);
          providerResponse = json;
          // Record provider-reported usage before parsing the assistant payload.
          // Malformed JSON content is still billable and may be retried.
          recordOpenAiUsage(json.usage, json.model || model);
          const content = json.choices?.[0]?.message?.content ?? "{}";
          const finishReason = json.choices?.[0]?.finish_reason;
          if (finishReason === "length") {
            const truncated = new Error("OpenAI structured output hit its token limit");
            truncated.code = "CF1_MODEL_OUTPUT_TRUNCATED";
            throw truncated;
          }
          if (content.length - content.trimEnd().length > 1_024) {
            const whitespace = new Error("OpenAI structured output ended with excessive whitespace");
            whitespace.code = "CF1_MODEL_EXCESSIVE_WHITESPACE";
            throw whitespace;
          }
          parsed = JSON.parse(content);
        } catch (e) {
          logger.error("[openAiLLM] failed to parse JSON-mode response:", text);
          const parseError = new Error("Failed to parse JSON from OpenAI: " + e.message);
          parseError.usage = providerResponse?.usage;
          parseError.model = providerResponse?.model || model;
          throw parseError;
        }

        return returnMetadata ? { output: parsed, usage: providerResponse.usage,
          model: providerResponse.model || model, rawResponse: providerResponse } : parsed;
      } catch (error) {
        lastError = error;

        const isTimeout = error.name === "AbortError";
        const isNetworkError =
          error.message?.includes("fetch failed") ||
          error.message?.includes("ECONNRESET") ||
          error.message?.includes("other side closed");

        logger.warn(
          `[openAiLLM] Attempt ${attempt}/${maxRetries} failed:`,
          isTimeout ? "Timeout" : isNetworkError ? "Network error" : error.message
        );

        // Don't retry on non-retryable errors
        if (!isTimeout && !isNetworkError && !error.message?.includes("server error")) {
          throw error;
        }

        // Don't sleep on last attempt
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
          logger.log(`[openAiLLM] Retrying in ${backoffMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries failed
    logger.error(
      `[openAiLLM] All ${maxRetries} attempts failed. Last error:`,
      lastError
    );
    throw lastError;
  },
};
