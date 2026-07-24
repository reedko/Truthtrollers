const normalizeClaimText = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLocaleLowerCase("en-US")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

// Incrementally recognizes completed JSON string values for one known key.
// It does not attempt to parse incomplete JSON objects, so it can observe
// claimText values long before the surrounding structured output is complete.
export function createStreamedClaimRepetitionMonitor({ fieldName = "claimText",
  repetitionThreshold = 3 } = {}) {
  if (!Number.isInteger(repetitionThreshold) || repetitionThreshold < 2) {
    throw new TypeError("repetitionThreshold must be an integer of at least 2");
  }
  const key = JSON.stringify(fieldName);
  const counts = new Map();
  const claims = [];
  let text = "";
  let cursor = 0;
  let loop = null;

  function add(fragment) {
    text += String(fragment ?? "");
    while (!loop) {
      const keyIndex = text.indexOf(key, cursor);
      if (keyIndex < 0) break;
      let index = keyIndex + key.length;
      while (/\s/.test(text[index] ?? "")) index += 1;
      if (index >= text.length) break;
      if (text[index] !== ":") {
        cursor = keyIndex + key.length;
        continue;
      }
      index += 1;
      while (/\s/.test(text[index] ?? "")) index += 1;
      if (index >= text.length) break;
      if (text[index] !== '"') {
        cursor = keyIndex + key.length;
        continue;
      }
      const stringStart = index;
      let escaped = false;
      let stringEnd = -1;
      for (index += 1; index < text.length; index += 1) {
        const char = text[index];
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') { stringEnd = index; break; }
      }
      if (stringEnd < 0) break;
      const claimText = JSON.parse(text.slice(stringStart, stringEnd + 1));
      const normalized = normalizeClaimText(claimText);
      const count = (counts.get(normalized) ?? 0) + 1;
      counts.set(normalized, count);
      const observation = { ordinal: claims.length + 1, claimText, normalized, count };
      claims.push(observation);
      if (normalized && count >= repetitionThreshold) {
        loop = { fieldName, repetitionThreshold, ...observation };
      }
      cursor = stringEnd + 1;
    }
    return { newClaims: claims.slice(), loop };
  }

  return Object.freeze({
    add,
    snapshot: () => ({ claims: structuredClone(claims), loop: structuredClone(loop),
      bufferedCharacters: text.length }),
  });
}
