import { timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCf1ConsumerKeys(serialized = process.env.CF1_CONSUMER_KEYS_JSON) {
  if (!serialized) return {};
  const parsed = JSON.parse(serialized);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError("CF1_CONSUMER_KEYS_JSON must be an API-key to consumer-key object");
  }
  for (const [apiKey, consumerKey] of Object.entries(parsed)) {
    if (!apiKey || typeof consumerKey !== "string" || !consumerKey || consumerKey.length > 64) {
      throw new TypeError("CF1 consumer credentials are invalid");
    }
  }
  return parsed;
}

export function createCf1ConsumerAuth({ consumerKeys = parseCf1ConsumerKeys() } = {}) {
  const credentials = Object.entries(consumerKeys);
  return (request, response, next) => {
    const authorization = request.get("authorization") ?? "";
    const supplied = request.get("x-api-key") ?? (/^Bearer\s+(.+)$/i.exec(authorization)?.[1]);
    if (!supplied) return response.status(401).json({ ok: false, error: { code: "CF1_AUTH_REQUIRED", message: "Consumer API key is required" } });
    const match = credentials.find(([apiKey]) => safeEqual(apiKey, supplied));
    if (!match) return response.status(403).json({ ok: false, error: { code: "CF1_AUTH_FORBIDDEN", message: "Consumer API key is invalid" } });
    request.cf1Consumer = { consumerKey: match[1] };
    next();
  };
}
