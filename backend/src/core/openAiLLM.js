// backend/core/openAiLLM.js

import dotenv from "dotenv";
import https from "https";
import logger from "../utils/logger.js";

dotenv.config();

const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

// Create persistent HTTPS agent with connection pooling for OpenAI API
// This reuses TCP connections instead of creating new ones for each request
// Benefits: Faster requests (~500ms → ~200ms), reduced latency, fewer sockets
const httpsAgent = new https.Agent({
  keepAlive: true, // Reuse connections
  keepAliveMsecs: 30000, // Keep connections alive for 30s
  maxSockets: 50, // Allow up to 50 concurrent connections
  maxFreeSockets: 10, // Keep 10 idle connections in pool
  timeout: 60000, // Socket timeout: 60s
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
          Authorization: `Bearer ${OPENAI_API_KEY}`,
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
            userMessage:
              "Unfortunately, OpenAI's services are not available in your current region. The TruthTrollers AI analysis features require OpenAI API access, which is restricted in certain countries and territories.",
          };
        }

        // API key issue
        if (resp.status === 401 || resp.status === 403) {
          return {
            accessible: false,
            error: "Authentication failed",
            userMessage:
              "OpenAI API authentication failed. Please check your API key configuration.",
          };
        }

        // Other errors
        return {
          accessible: false,
          error: errorData.error?.message || "Unknown error",
          userMessage:
            "OpenAI API is currently unavailable. Please try again later.",
        };
      }

      return { accessible: true };
    } catch (error) {
      logger.error("[openAiLLM] Connection test failed:", error.message);
      return {
        accessible: false,
        error: error.message,
        userMessage:
          "Unable to reach OpenAI API. Please check your internet connection.",
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
   */
  async generate({
    system,
    user,
    schemaHint,
    strictJsonSchema = false,
    reasoning,
    max_output_tokens,
    temperature = 0.2,
    maxRetries = 3,
    timeout = 30000,
    model = "gpt-4o-mini",
    api = "chat_completions",
  }) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let endpoint;
        let body;

        if (api === "responses") {
          endpoint = "https://api.openai.com/v1/responses";

          const schemaHintText =
            typeof schemaHint === "string"
              ? schemaHint
              : schemaHint
                ? JSON.stringify(schemaHint)
                : "";

          const input =
            schemaHintText && !strictJsonSchema
              ? user +
                "\n\nReturn ONLY valid JSON. JSON shape hint: " +
                schemaHintText
              : user;

          body = {
            model,
            input,
            max_output_tokens: max_output_tokens ?? 6000,
            store: false,
            text: strictJsonSchema
              ? {
                  format: {
                    type: "json_schema",
                    name: "reference_semantic_bearing_result",
                    strict: true,
                    schema: schemaHint,
                  },
                }
              : {
                  format: {
                    type: "json_object",
                  },
                },
          };

          if (reasoning) {
            body.reasoning = reasoning;
          }
        } else if (api === "chat_completions") {
          endpoint = "https://api.openai.com/v1/chat/completions";

          body = {
            model,
            temperature,
            response_format: { type: "json_object" },
            messages: [
              ...(system ? [{ role: "system", content: system }] : []),
              {
                role: "user",
                content: schemaHint
                  ? user +
                    "\n\nReturn ONLY valid JSON. JSON shape hint: " +
                    schemaHint
                  : user,
              },
            ],
          };
        } else {
          throw new Error(`Unsupported OpenAI API mode: ${api}`);
        }
        if (api === "responses" && strictJsonSchema) {
          logger.log("[openAiLLM] strict Responses request:", {
            model: body.model,
            max_output_tokens: body.max_output_tokens,
            reasoning: body.reasoning,
            formatType: body.text?.format?.type,
            formatName: body.text?.format?.name,
            strict: body.text?.format?.strict,
          });
        }
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
          agent: httpsAgent,
        });

        clearTimeout(timeoutId);

        const text = await resp.text();

        if (!resp.ok) {
          let errorData;
          try {
            errorData = JSON.parse(text);
          } catch {
            errorData = { error: { message: text } };
          }

          if (resp.status >= 400 && resp.status < 500) {
            logger.error(
              `[openAiLLM] Client error ${resp.status}:`,
              text.slice(0, 500),
            );

            if (
              errorData.error?.code === "unsupported_country_region_territory"
            ) {
              const err = new Error(
                "OpenAI services are not available in your region",
              );
              err.code = "REGION_BLOCKED";
              err.userMessage =
                "Unfortunately, OpenAI's services are not available in your current region.";
              throw err;
            }

            throw new Error(
              `OpenAI error ${resp.status}: ${text.slice(0, 200)}`,
            );
          }

          throw new Error(`OpenAI server error ${resp.status}`);
        }

        let parsed;

        try {
          const json = JSON.parse(text);

          if (api === "responses") {
            const content = (json.output || [])
              .flatMap((item) => item.content || [])
              .filter((item) => item.type === "output_text")
              .map((item) => item.text || "")
              .join("");

            if (!content.trim()) {
              throw new Error("Responses API returned no output_text");
            }

            parsed = JSON.parse(content);
          } else {
            const content = json.choices?.[0]?.message?.content ?? "{}";

            parsed = JSON.parse(content);
          }
        } catch (e) {
          logger.error("[openAiLLM] failed to parse JSON-mode response:", text);
          throw new Error("Failed to parse JSON from OpenAI: " + e.message);
        }

        return parsed;
      } catch (error) {
        lastError = error;

        const isTimeout = error.name === "AbortError";
        const isNetworkError =
          error.message?.includes("fetch failed") ||
          error.message?.includes("ECONNRESET") ||
          error.message?.includes("other side closed");

        logger.warn(
          `[openAiLLM] Attempt ${attempt}/${maxRetries} failed:`,
          isTimeout
            ? "Timeout"
            : isNetworkError
              ? "Network error"
              : error.message,
        );

        if (
          !isTimeout &&
          !isNetworkError &&
          !error.message?.includes("server error")
        ) {
          throw error;
        }

        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);

          logger.log(`[openAiLLM] Retrying in ${backoffMs}ms...`);

          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    logger.error(
      `[openAiLLM] All ${maxRetries} attempts failed. Last error:`,
      lastError,
    );

    throw lastError;
  },
};
