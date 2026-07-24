import { createHash } from "node:crypto";

const sha256 = (value) => createHash("sha256").update(String(value ?? "")).digest("hex");

export function buildModelCallProvenance({ prompt = {}, response = {}, request = {} } = {}) {
  const raw = response?.rawResponse ?? {};
  const responseSchema = prompt.responseSchema ?? null;
  const requestIdentity = {
    model: request.model ?? response.model ?? raw.model ?? null,
    temperature: request.temperature ?? null,
    seed: request.seed ?? null,
    maxOutputTokens: request.maxOutputTokens ?? null,
    system: prompt.system ?? "",
    user: prompt.user ?? "",
    responseSchema,
    ...(request.apiMode ? { apiMode: request.apiMode } : {}),
    ...(typeof request.stream === "boolean" ? { stream: request.stream } : {}),
    ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
    ...(typeof request.store === "boolean" ? { store: request.store } : {}),
  };
  return {
    request: {
      model: requestIdentity.model,
      temperature: requestIdentity.temperature,
      seed: requestIdentity.seed,
      maxOutputTokens: requestIdentity.maxOutputTokens,
      apiMode: requestIdentity.apiMode ?? "chat",
      stream: requestIdentity.stream ?? false,
      reasoningEffort: requestIdentity.reasoningEffort ?? null,
      store: requestIdentity.store ?? null,
      systemSha256: sha256(requestIdentity.system),
      userSha256: sha256(requestIdentity.user),
      schemaSha256: sha256(JSON.stringify(responseSchema)),
      requestSha256: sha256(JSON.stringify(requestIdentity)),
    },
    response: {
      responseId: raw.id ?? null,
      requestId: raw.request_id ?? null,
      systemFingerprint: raw.system_fingerprint ?? null,
      model: raw.model ?? response.model ?? requestIdentity.model,
      serviceTier: raw.service_tier ?? null,
      created: raw.created ?? raw.created_at ?? null,
      returnedSeed: raw.seed ?? null,
      finishReason: raw.choices?.[0]?.finish_reason
        ?? raw.incomplete_details?.reason ?? raw.status ?? null,
      cachedInputTokens: response.usage?.cachedInputTokens ?? null,
      streamingDiagnostics: raw.streamingDiagnostics ?? null,
    },
  };
}
