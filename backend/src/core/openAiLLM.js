// backend/core/openAiLLM.js

import dotenv from "dotenv";

dotenv.config();

const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

export const openAiLLM = {
  /**
   * Unified JSON-mode OpenAI caller.
   * Params:
   *  - system: system prompt
   *  - user: user prompt
   *  - schemaHint: string describing expected JSON shape
   *  - temperature: optional
   */
  async generate({ system, user, schemaHint, temperature = 0.2 }) {
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
    });

    const text = await resp.text();

    if (!resp.ok) {
      console.error("[openAiLLM] error:", resp.status, text.slice(0, 500));
      throw new Error(`OpenAI error ${resp.status}`);
    }

    let parsed;
    try {
      const json = JSON.parse(text);
      const content = json.choices?.[0]?.message?.content ?? "{}";
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("[openAiLLM] failed to parse JSON-mode response:", text);
      throw new Error("Failed to parse JSON from OpenAI: " + e.message);
    }

    return parsed;
  },
};
