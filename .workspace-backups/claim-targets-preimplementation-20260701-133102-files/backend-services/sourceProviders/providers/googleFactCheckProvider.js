// backend/services/sourceProviders/providers/googleFactCheckProvider.js
// Google Fact Check Tools API — claim-level fact-check lookups.
// Requires: GOOGLE_FACT_CHECK_API_KEY env var

import { disabledProviderResult, publisherProviderFlags } from "../providerFeatureFlags.js";

const API_BASE = "https://factchecktools.googleapis.com/v1alpha1/claims:search";
const TIMEOUT_MS = 8000;

function getApiKey() { return process.env.GOOGLE_FACT_CHECK_API_KEY; }

async function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeGoogleFactCheckVerdict(value) {
  const rating = String(value || "").trim().toLowerCase();
  if (!rating) return "unrated";
  if (/\b(mixture|mixed|partly|partially|half true|mostly false|mostly true|misleading|needs context)\b/.test(rating)) return "mixed";
  if (/\b(false|incorrect|fabricated|fake|pants on fire|scam|hoax)\b/.test(rating)) return "false";
  if (/\b(true|correct|accurate)\b/.test(rating)) return "true";
  return "unrated";
}

export function normalizeRating(raw = {}) {
  const rating = raw.claimReview?.[0]?.textualRating ?? raw.claimReview?.[0]?.reviewRating?.alternateName ?? null;
  return {
    claimReviewed:  raw.text ?? null,
    rating,
    verdict:        normalizeGoogleFactCheckVerdict(rating),
    textualRating:  raw.claimReview?.[0]?.reviewRating?.ratingValue?.toString() ?? null,
    reviewPublisher: raw.claimReview?.[0]?.publisher?.name ?? null,
    reviewUrl:      raw.claimReview?.[0]?.url ?? null,
    reviewDate:     raw.claimReview?.[0]?.reviewDate ?? null,
    claimant:       raw.claimant ?? null,
    languageCode:   raw.claimReview?.[0]?.languageCode ?? "en",
  };
}

export const googleFactCheckProvider = {
  providerName: "google_fact_check",
  description: "Google Fact Check Tools API — fact-check search for claim text",

  async healthCheck() {
    const t0 = Date.now();
    if (!publisherProviderFlags().googleFactCheck) return { ...disabledProviderResult("google_fact_check", "Google Fact Check disabled by GOOGLE_FACT_CHECK_ENABLED"), checkedAt: new Date().toISOString() };
    const key = getApiKey();
    if (!key) return { providerName: "google_fact_check", ok: false, status: "missing_config", message: "GOOGLE_FACT_CHECK_API_KEY not set", latencyMs: 0, checkedAt: new Date().toISOString() };

    try {
      const url = `${API_BASE}?key=${key}&query=test&languageCode=en&pageSize=1`;
      const res = await fetchWithTimeout(url);
      if ([401, 403].includes(res.status)) return { providerName: "google_fact_check", ok: false, status: "bad_credentials", message: "API key rejected", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      if (res.status === 429) return { providerName: "google_fact_check", ok: false, status: "rate_limited", message: "Rate limited (429)", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      if (res.status >= 500) return { providerName: "google_fact_check", ok: false, status: "unavailable", message: "Google Fact Check is temporarily unavailable", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      if (!res.ok) return { providerName: "google_fact_check", ok: false, status: "unexpected_response", message: `HTTP ${res.status}`, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
      return { providerName: "google_fact_check", ok: true, status: "ok", message: "Google Fact Check API reachable", latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    } catch (err) {
      return { providerName: "google_fact_check", ok: false, status: err.name === "AbortError" ? "unavailable" : "error", message: err.message, latencyMs: Date.now() - t0, checkedAt: new Date().toISOString() };
    }
  },

  async lookupPublisher() {
    if (!publisherProviderFlags().googleFactCheck) return disabledProviderResult("google_fact_check", "Google Fact Check disabled by GOOGLE_FACT_CHECK_ENABLED");
    return { providerName: "google_fact_check", ok: false, matchFound: false, status: "not_implemented", errorMessage: "Google Fact Check does not support publisher lookup", latencyMs: 0 };
  },

  async lookupClaim({ claimText, languageCode = "en" } = {}) {
    const t0 = Date.now();
    if (!publisherProviderFlags().googleFactCheck) return disabledProviderResult("google_fact_check", "Google Fact Check disabled by GOOGLE_FACT_CHECK_ENABLED");
    const key = getApiKey();
    if (!key) return { providerName: "google_fact_check", ok: false, matchFound: false, status: "missing_config", errorMessage: "GOOGLE_FACT_CHECK_API_KEY not set", latencyMs: 0 };
    if (!claimText?.trim()) return { providerName: "google_fact_check", ok: false, matchFound: false, status: "no_match", errorMessage: "No claim text provided", latencyMs: 0 };

    try {
      const url = `${API_BASE}?key=${key}&query=${encodeURIComponent(claimText.slice(0, 500))}&languageCode=${languageCode}&pageSize=5`;
      const res = await fetchWithTimeout(url);

      if ([401, 403].includes(res.status)) return { providerName: "google_fact_check", ok: false, matchFound: false, status: "bad_credentials", errorMessage: "API key rejected", latencyMs: Date.now() - t0 };
      if (res.status === 429) return { providerName: "google_fact_check", ok: false, matchFound: false, status: "rate_limited", errorMessage: "Rate limited", latencyMs: Date.now() - t0 };
      if (res.status >= 500) return { providerName: "google_fact_check", ok: false, matchFound: false, status: "unavailable", errorMessage: "Google Fact Check is temporarily unavailable", latencyMs: Date.now() - t0 };
      if (!res.ok) return { providerName: "google_fact_check", ok: false, matchFound: false, status: "unexpected_response", errorMessage: `HTTP ${res.status}`, latencyMs: Date.now() - t0 };

      const data = await res.json();
      const claims = data?.claims ?? [];

      if (!claims.length) return { providerName: "google_fact_check", ok: true, matchFound: false, status: "no_match", latencyMs: Date.now() - t0 };

      const normalized = claims.map(normalizeRating);

      return {
        providerName: "google_fact_check",
        ok: true,
        matchFound: true,
        confidence: claims.length >= 2 ? "high" : "medium",
        normalized: normalized[0],
        allMatches: normalized,
        raw: data,
        status: "ok",
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      return { providerName: "google_fact_check", ok: false, matchFound: false, status: err.name === "AbortError" ? "unavailable" : "error", errorMessage: err.message, latencyMs: Date.now() - t0 };
    }
  },

  normalizeResponse: normalizeRating,
};
