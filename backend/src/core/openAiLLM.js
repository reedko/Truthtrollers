// backend/core/openAiLLM.js

import dotenv from "dotenv";
import logger from "../utils/logger.js";

dotenv.config();

const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

export const openAiLLM = {
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
    temperature = 0.2,
    maxRetries = 3,
    timeout = 30000,
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
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini", // 🏎 faster than gpt-4-turbo
            temperature,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              {
                role: "user",
                content:
                  user +
                  "\n\nReturn ONLY valid JSON. JSON shape hint: " +
                  schemaHint,
              },
            ],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const text = await resp.text();

        if (!resp.ok) {
          // Don't retry on 4xx errors (bad request, auth, etc)
          if (resp.status >= 400 && resp.status < 500) {
            logger.error(
              `[openAiLLM] Client error ${resp.status}:`,
              text.slice(0, 500)
            );
            throw new Error(`OpenAI error ${resp.status}: ${text.slice(0, 200)}`);
          }

          // Retry on 5xx errors
          throw new Error(`OpenAI server error ${resp.status}`);
        }

        let parsed;
        try {
          const json = JSON.parse(text);
          const content = json.choices?.[0]?.message?.content ?? "{}";
          parsed = JSON.parse(content);
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
