const IDENTIFIER_FIELDS = Object.freeze([
  "doi", "pmid", "titleExact", "authorYear", "quotedDocumentNames", "canonicalSourceIds",
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeDoi(value) {
  return clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
}

function normalizePmid(value) {
  return clean(value).replace(/^pmid:\s*/i, "");
}

export function normalizeIdentifierHints(hints = {}) {
  return Object.fromEntries(IDENTIFIER_FIELDS.map((field) => {
    const values = Array.isArray(hints[field]) ? hints[field] : [];
    const normalized = values
      .map(field === "doi" ? normalizeDoi : field === "pmid" ? normalizePmid : clean)
      .filter(Boolean);
    return [field, [...new Set(normalized)].slice(0, 12)];
  }));
}

export function identifierOccursInSource(identifier, field, sourceText) {
  const source = clean(sourceText).toLocaleLowerCase();
  const value = clean(identifier).toLocaleLowerCase();
  if (!value) return false;
  if (source.includes(value)) return true;
  if (field === "doi") {
    return source.includes(`doi:${value}`) || source.includes(`doi.org/${value}`);
  }
  if (field === "pmid") return source.includes(`pmid:${value}`) || source.includes(`pmid ${value}`);
  return false;
}

export function findUngroundedIdentifierHints(hints, sourceText) {
  const issues = [];
  for (const field of IDENTIFIER_FIELDS) {
    for (const value of hints?.[field] ?? []) {
      if (!identifierOccursInSource(value, field, sourceText)) issues.push({ field, value });
    }
  }
  return issues;
}

export function isIdentifierFormatValid(value, field) {
  if (field === "doi") return /^10\.\d{4,9}\/\S+$/i.test(value);
  if (field === "pmid") return /^\d{1,10}$/.test(value);
  return typeof value === "string" && value.length > 0 && value.length <= 500;
}
