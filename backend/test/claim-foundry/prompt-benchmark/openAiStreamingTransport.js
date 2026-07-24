import { createStreamedClaimRepetitionMonitor }
  from "./streamedClaimRepetitionMonitor.js";

const getApiKeyFromEnvironment = () =>
  process.env.OPENAI_API_KEY || process.env.REACT_APP_OPENAI_API_KEY;

function providerMetadata({ provider, response, finishReason, usage, diagnostics }) {
  return {
    responseId: provider?.responseId ?? null,
    requestId: response?.headers?.get?.("x-request-id") ?? null,
    systemFingerprint: provider?.systemFingerprint ?? null,
    finishReason: finishReason ?? null,
    model: provider?.model ?? null,
    serviceTier: provider?.serviceTier ?? null,
    processingMs: response?.headers?.get?.("openai-processing-ms") ?? null,
    usage: usage ?? null,
    streamingDiagnostics: diagnostics,
  };
}

function failure(code, message, metadata) {
  const error = new Error(message);
  error.code = code;
  error.model = metadata.model;
  error.usage = metadata.usage;
  error.providerMetadata = metadata;
  return error;
}

async function readSse(response, { controller, fieldName, repetitionThreshold, onClaim, now,
  startedAt }) {
  const monitor = createStreamedClaimRepetitionMonitor({ fieldName, repetitionThreshold });
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error("Streaming Chat Completions response has no readable body");
  const decoder = new TextDecoder();
  const claimEvents = [];
  let sseBuffer = "";
  let output = "";
  let finishReason = null;
  let refusal = "";
  let usage = null;
  let provider = null;
  let repetition = null;

  const acceptData = (data) => {
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data);
    provider ??= {
      responseId: chunk.id ?? null,
      model: chunk.model ?? null,
      systemFingerprint: chunk.system_fingerprint ?? null,
      serviceTier: chunk.service_tier ?? null,
      created: chunk.created ?? null,
    };
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    finishReason = choice?.finish_reason ?? finishReason;
    if (typeof choice?.delta?.refusal === "string") refusal += choice.delta.refusal;
    const delta = choice?.delta?.content;
    if (typeof delta !== "string" || !delta) return;
    output += delta;
    const before = monitor.snapshot().claims.length;
    const state = monitor.add(delta);
    for (const claim of state.newClaims.slice(before)) {
      const event = { ...claim, observedAtMs: now() - startedAt };
      claimEvents.push(event);
      onClaim(event);
    }
    if (state.loop) {
      repetition = { ...state.loop, observedAtMs: now() - startedAt };
      controller.abort();
    }
  };

  try {
    while (!repetition) {
      const { value, done } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while (!repetition && (boundary = sseBuffer.indexOf("\n\n")) >= 0) {
        const block = sseBuffer.slice(0, boundary);
        sseBuffer = sseBuffer.slice(boundary + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        acceptData(data);
      }
    }
  } catch (error) {
    if (!repetition) throw error;
  } finally {
    if (repetition) await reader.cancel().catch(() => {});
  }

  const diagnostics = {
    enabled: true,
    repetitionThreshold,
    claimsObserved: claimEvents,
    repetition,
    outputCharacters: output.length,
    elapsedMs: now() - startedAt,
  };
  const metadata = providerMetadata({ provider, response, finishReason, usage, diagnostics });
  if (repetition) throw failure("CF1_MODEL_REPETITION_LOOP",
    `Streaming Call 1A repeated one claim ${repetition.count} times`, metadata);
  if (finishReason === "length") throw failure("CF1_MODEL_OUTPUT_TRUNCATED",
    "OpenAI structured output hit its token limit", metadata);
  if (refusal) throw failure("CF1_MODEL_REFUSAL", refusal, metadata);
  let parsed;
  try { parsed = JSON.parse(output); } catch (cause) {
    const error = failure("CF1_MALFORMED_MODEL_JSON",
      `Failed to parse streamed JSON from OpenAI: ${cause.message}`, metadata);
    error.cause = cause;
    throw error;
  }
  return { parsed, provider, finishReason, usage, diagnostics, metadata };
}

// Benchmark-only transport: same strict Chat Completions request as the normal
// CF1 port, but streamed so an exact repeated claim can abort generation early.
export function createOpenAiStreamingCf1Transport({ fetchImpl = globalThis.fetch,
  getApiKey = getApiKeyFromEnvironment, fieldName = "claimText", repetitionThreshold = 3,
  onClaim = () => {}, now = Date.now } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  return Object.freeze({
    async invoke(request) {
      const apiKey = getApiKey();
      if (!apiKey) throw new Error("OPENAI_API_KEY is required");
      if (!request.responseSchema?.strict || !request.responseSchema?.name
        || !request.responseSchema?.schema) {
        throw new TypeError("Streaming CF1 transport requires a named strict response schema");
      }
      const controller = new AbortController();
      const parentAbort = () => controller.abort(request.signal?.reason);
      request.signal?.addEventListener?.("abort", parentAbort, { once: true });
      const startedAt = now();
      let response;
      try {
        response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: request.model,
            temperature: request.temperature,
            ...(Number.isInteger(request.seed) ? { seed: request.seed } : {}),
            response_format: { type: "json_schema", json_schema: request.responseSchema },
            ...(Number.isInteger(request.maxOutputTokens) && request.maxOutputTokens > 0
              ? { max_tokens: request.maxOutputTokens } : {}),
            stream: true,
            stream_options: { include_usage: true },
            messages: [{ role: "system", content: request.system },
              { role: "user", content: request.user }],
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`OpenAI error ${response.status}: ${text.slice(0, 500)}`);
        }
        const streamed = await readSse(response, { controller, fieldName, repetitionThreshold,
          onClaim, now, startedAt });
        return {
          output: streamed.parsed,
          usage: streamed.usage,
          model: streamed.provider?.model ?? request.model,
          rawResponse: {
            id: streamed.provider?.responseId ?? null,
            model: streamed.provider?.model ?? request.model,
            system_fingerprint: streamed.provider?.systemFingerprint ?? null,
            service_tier: streamed.provider?.serviceTier ?? null,
            created: streamed.provider?.created ?? null,
            request_id: streamed.metadata.requestId,
            choices: [{ finish_reason: streamed.finishReason }],
            usage: streamed.usage,
            streamingDiagnostics: streamed.diagnostics,
          },
        };
      } finally {
        request.signal?.removeEventListener?.("abort", parentAbort);
      }
    },
  });
}
