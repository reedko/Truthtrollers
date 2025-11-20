// backend/src/adapters/llm-openai.ts
import type { LLMJson } from "../core/ports";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const OpenAiLLM: LLMJson = {
  async generate<T>({
    system,
    user,
    schemaHint,
    temperature = 0.2,
  }): Promise<T> {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // <-- 🏎💨 FAST
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

    const json = await resp.json();
    const txt = json.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(txt) as T;
  },
};
