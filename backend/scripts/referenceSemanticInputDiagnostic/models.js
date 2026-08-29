export const MODEL_TIMEOUT_MS = 180000;
export const MAX_OUTPUT_TOKENS = 3000;

// Edit model names and reasoning/thinking settings here.
// OpenAI: reasoning.effort. DeepSeek: thinking.type and reasoningEffort.
export const ALL_MODEL_CONFIGURATIONS = [
  {
    id: "gpt-4o-mini-responses",
    model: "gpt-4o-mini",
    api: "responses",
    reasoning: null,
  },
  {
    id: "deepseek-v4-flash",
    model: "deepseek-v4-flash",
    api: "deepseek_chat",
    thinking: { type: "disabled" },
    reasoningEffort: null,
  },
  {
    id: "gpt-5.4-mini-responses",
    model: "gpt-5.4-mini",
    api: "responses",
    reasoning: { effort: "low" },
    strictJsonSchema: true,
  },
  {
    id: "gpt-5-mini-responses",
    model: "gpt-5-mini",
    api: "responses",
    reasoning: { effort: "minimal" },
  },
  {
    id: "gpt-4o-mini-chat-completions",
    model: "gpt-4o-mini",
    api: "chat_completions",
    reasoning: null,
    strictJsonSchema: true,
  },
];
// Run only gpt-5.4-mini for the repeated failure diagnostic.
export const MODEL_CONFIGURATIONS = ALL_MODEL_CONFIGURATIONS.slice(2, 3);
class ProviderResponseError extends Error {
  constructor(message, providerResponse) {
    super(message);
    this.name = "ProviderResponseError";
    this.providerResponse = providerResponse;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAIResponses(
  configuration,
  userPrompt,
  resultSchema,
  maxOutputTokens,
  systemPrompt,
) {
  const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing REACT_APP_OPENAI_API_KEY");
  }

  const body = {
    model: configuration.model,
    input: systemPrompt
      ? [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]
      : userPrompt,
    max_output_tokens: maxOutputTokens,
    store: false,
    text: {
      format: configuration.strictJsonSchema
        ? {
            type: "json_schema",
            name: "reference_semantic_bearing_result",
            strict: true,
            schema: resultSchema,
          }
        : { type: "json_object" },
    },
  };
  if (configuration.reasoning) {
    body.reasoning = configuration.reasoning;
  }
  if (configuration.temperature !== undefined) {
    body.temperature = configuration.temperature;
  }

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new ProviderResponseError(
      `OpenAI error ${response.status}`,
      responseText,
    );
  }

  const responseJson = JSON.parse(responseText);
  const rawModelResult = (responseJson.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text || "")
    .join("");
  if (!rawModelResult.trim()) {
    throw new ProviderResponseError(
      "Responses API response contained no output_text",
      responseJson,
    );
  }

  return {
    rawModelResult,
    providerResponse: responseJson,
    responseId: responseJson.id || null,
    responseStatus: responseJson.status || null,
    incompleteDetails: responseJson.incomplete_details || null,
    usage: responseJson.usage || null,
    finishReason:
      responseJson.status === "incomplete"
        ? responseJson.incomplete_details?.reason || "incomplete"
        : responseJson.status || null,
    responseFormat: body.text.format,
  };
}

async function callDeepSeekChat(
  configuration,
  userPrompt,
  maxOutputTokens,
  systemPrompt,
) {
  const apiKey = process.env.REACT_APP_DEEP_SEEK;
  if (!apiKey) {
    throw new Error("Missing REACT_APP_DEEP_SEEK");
  }

  const response = await fetchWithTimeout(
    "https://api.deepseek.com/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: configuration.model,
        thinking: configuration.thinking,
        reasoning_effort: configuration.reasoningEffort || undefined,
        messages: [
          ...(systemPrompt
            ? [{ role: "system", content: systemPrompt }]
            : []),
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: maxOutputTokens,
        stream: false,
      }),
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new ProviderResponseError(
      `DeepSeek error ${response.status}`,
      responseText,
    );
  }

  const responseJson = JSON.parse(responseText);
  const rawModelResult = responseJson.choices?.[0]?.message?.content;
  if (typeof rawModelResult !== "string" || !rawModelResult.trim()) {
    throw new ProviderResponseError(
      "DeepSeek response contained no model text",
      responseJson,
    );
  }

  return {
    rawModelResult,
    providerResponse: responseJson,
    responseId: responseJson.id || null,
    responseStatus: null,
    incompleteDetails: null,
    usage: responseJson.usage || null,
    finishReason: responseJson.choices?.[0]?.finish_reason || null,
    responseFormat: { type: "json_object" },
  };
}

async function callOpenAIChatCompletions(
  configuration,
  userPrompt,
  resultSchema,
  maxOutputTokens,
  systemPrompt,
) {
  const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing REACT_APP_OPENAI_API_KEY");
  }

  const body = {
    model: configuration.model,
    messages: [
      ...(systemPrompt
        ? [{ role: "system", content: systemPrompt }]
        : []),
      { role: "user", content: userPrompt },
    ],
    response_format: configuration.strictJsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: "case_assertion_decomposition_result",
            strict: true,
            schema: resultSchema,
          },
        }
      : { type: "json_object" },
    max_tokens: maxOutputTokens,
  };
  if (configuration.temperature !== undefined) {
    body.temperature = configuration.temperature;
  }

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new ProviderResponseError(
      `OpenAI Chat Completions error ${response.status}`,
      responseText,
    );
  }

  const responseJson = JSON.parse(responseText);
  const rawModelResult = responseJson.choices?.[0]?.message?.content;
  if (typeof rawModelResult !== "string" || !rawModelResult.trim()) {
    throw new ProviderResponseError(
      "Chat Completions response contained no model text",
      responseJson,
    );
  }

  return {
    rawModelResult,
    providerResponse: responseJson,
    responseId: responseJson.id || null,
    responseStatus: null,
    incompleteDetails: null,
    usage: responseJson.usage || null,
    finishReason: responseJson.choices?.[0]?.finish_reason || null,
    responseFormat: body.response_format,
  };
}

export async function runConfiguredModel(
  configuration,
  userPrompt,
  resultSchema,
  { maxOutputTokens = MAX_OUTPUT_TOKENS, systemPrompt = null } = {},
) {
  if (configuration.api === "responses") {
    return callOpenAIResponses(
      configuration,
      userPrompt,
      resultSchema,
      maxOutputTokens,
      systemPrompt,
    );
  }
  if (configuration.api === "deepseek_chat") {
    return callDeepSeekChat(
      configuration,
      userPrompt,
      maxOutputTokens,
      systemPrompt,
    );
  }
  if (configuration.api === "chat_completions") {
    return callOpenAIChatCompletions(
      configuration,
      userPrompt,
      resultSchema,
      maxOutputTokens,
      systemPrompt,
    );
  }
  throw new Error(`Unsupported API configuration: ${configuration.api}`);
}
