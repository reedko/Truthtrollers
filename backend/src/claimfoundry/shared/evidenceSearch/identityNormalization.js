const TRACKING = /^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i;

export function normalizeLiteralText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeDoi(value) {
  return String(value || "").trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function normalizePmid(value) {
  const match = String(value || "").match(/\b(\d{4,12})\b/);
  return match?.[1] || null;
}

export function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "https:" && url.port === "443")
      || (url.protocol === "http:" && url.port === "80")
    ) {
      url.port = "";
    }
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}
