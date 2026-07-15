import { createHash } from "node:crypto";

function normalize(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON requires finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError(`unsupported canonical JSON type: ${typeof value}`);
  if (seen.has(value)) throw new TypeError("canonical JSON cannot contain cycles");

  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry) => normalize(entry, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON accepts only arrays and plain objects");
    }
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`undefined value at key ${key}`);
      result[key] = normalize(value[key], seen);
    }
  }
  seen.delete(value);
  return result;
}

export function canonicalizeCf1(value) {
  return JSON.stringify(normalize(value, new Set()));
}

export function sha256Hex(value) {
  const input = typeof value === "string" ? value : canonicalizeCf1(value);
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function hashArticleInput(article) {
  return sha256Hex({ title: article.title, text: article.text });
}

export function hashOptions(options = {}) {
  return sha256Hex(options);
}

export function hashPackage(packageValue) {
  const { packageHash: _hash, diagnostics: _diagnostics, createdAt: _created, ...stable } = packageValue;
  if (stable.verification && typeof stable.verification === "object") {
    const { verifiedAt: _verified, ...verification } = stable.verification;
    stable.verification = verification;
  }
  return sha256Hex(stable);
}
