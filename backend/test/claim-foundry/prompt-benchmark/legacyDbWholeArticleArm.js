// Read-only benchmark reconstruction of the task-article claim extraction path
// present at commit 4714383a (2026-07-01). This module deliberately does not
// import today's ClaimExtractor: its case-content branch changed after that
// commit. It performs no persistence and no evidence retrieval.
import { createHash } from "node:crypto";
import PromptManager from "../../../src/core/promptManager.js";
import {
  restoreCall1ClaimKeys,
  toAssertionLanguage,
} from "./legacyAssertionLanguage.js";

export const LEGACY_DB_WHOLE_ARTICLE_ARM = Object.freeze({
  id: "legacy-db-whole-article-4714383a",
  label: "Legacy DB whole-article extraction (4714383a)",
  sourceCommit: "4714383a",
  apiMode: "chat_completions",
  defaultModel: "gpt-4o-mini",
  defaultTemperature: 0.2,
});

const EXTRACTION_MODES = new Set(["edge", "ranked", "comprehensive"]);

const sha256 = (value) => createHash("sha256")
  .update(String(value ?? ""))
  .digest("hex");

function normalizeMode(value) {
  return EXTRACTION_MODES.has(value) ? value : "ranked";
}

export function legacyMinimumClaims(tokenLength) {
  if (tokenLength > 9_000) return 8;
  if (tokenLength > 5_000) return 6;
  return 5;
}

function replacePromptTokens(value, replacements) {
  return String(value ?? "")
    .replaceAll("{{minClaims}}", String(replacements.minClaims))
    .replaceAll("{{maxClaims}}", String(replacements.maxClaims))
    .replaceAll("{{extractionMode}}", replacements.extractionMode)
    .replaceAll("{{contentRole}}", replacements.contentRole);
}

function promptCandidates({ mode, contentRole, includeTopicsAndTestimonials }) {
  const source = contentRole === "source";
  const suffix = includeTopicsAndTestimonials ? "_with_topics" : "_no_topics";
  return {
    system: [
      "claim_extraction_stack_system",
      source && mode === "edge" ? "claim_extraction_edge_for_source_system" : null,
      mode === "edge" ? "claim_extraction_edge_system" : "claim_extraction_ranked_system",
    ].filter(Boolean),
    user: [
      `claim_extraction_stack${suffix}`,
      source && mode === "edge" ? `claim_extraction_edge_for_source${suffix}` : null,
      source && mode !== "edge" ? `claim_extraction_${mode}_for_source${suffix}` : null,
      mode === "edge" ? `claim_extraction_edge${suffix}` : `claim_extraction_${mode}${suffix}`,
      mode === "comprehensive" ? `claim_extraction_comprehensive${suffix}` : null,
    ].filter(Boolean),
  };
}

async function loadFirstAvailable(promptManager, names, label) {
  const attempts = [];
  let lastError = null;
  for (const name of names) {
    try {
      const prompt = await promptManager.getPrompt(name);
      attempts.push({ name, found: true });
      return { name, prompt, attempts };
    } catch (error) {
      lastError = error;
      attempts.push({ name, found: false, error: error.message });
    }
  }
  throw new Error(
    `Legacy DB arm could not load ${label}. Tried ${names.join(", ")}. `
      + `Last error: ${lastError?.message ?? "unknown"}`,
  );
}

async function loadPromptPair(promptManager, options) {
  const names = promptCandidates(options);
  const system = await loadFirstAvailable(promptManager, names.system, "system prompt");
  const user = await loadFirstAvailable(promptManager, names.user, "user prompt");
  return {
    system: system.prompt,
    user: user.prompt,
    selectedNames: { system: system.name, user: user.name },
    lookupAttempts: { system: system.attempts, user: user.attempts },
    parameters: {
      ...(system.prompt.parameters ?? {}),
      ...(user.prompt.parameters ?? {}),
    },
  };
}

export async function buildLegacyDbWholeArticleRequest({
  query,
  articleText,
  extractionMode = "ranked",
  contentRole = "case",
  clearPromptCache = true,
  assertionLanguage = false,
}) {
  if (typeof query !== "function") throw new TypeError("query must be a function");
  const text = String(articleText ?? "").trim();
  if (!text) throw new TypeError("articleText must be non-empty");

  const mode = normalizeMode(extractionMode);
  const role = contentRole === "source" ? "source" : "case";
  const includeTopicsAndTestimonials = true;
  const promptManager = new PromptManager(query);
  if (clearPromptCache) promptManager.clearCache();

  // The legacy implementation first loaded the pair using temporary 5/12
  // values solely to obtain max_claims from the selected DB row.
  const preview = await loadPromptPair(promptManager, {
    mode,
    contentRole: role,
    includeTopicsAndTestimonials,
  });
  const maxClaims = Number(
    preview.parameters.max_claims ?? preview.parameters.maxClaims ?? 12,
  ) || 12;
  const tokenLength = Math.round(text.length / 4);
  const minClaims = legacyMinimumClaims(tokenLength);

  // PromptManager returns cached raw templates here, matching the live path;
  // token replacement occurs after retrieval on both passes.
  const selected = await loadPromptPair(promptManager, {
    mode,
    contentRole: role,
    includeTopicsAndTestimonials,
  });
  const replacements = {
    minClaims,
    maxClaims,
    extractionMode: mode,
    contentRole: role,
  };
  const systemTemplate = replacePromptTokens(selected.system.system, replacements);
  const taskTemplate = replacePromptTokens(selected.user.user, replacements);
  const system = assertionLanguage ? toAssertionLanguage(systemTemplate) : systemTemplate;
  const tasks = assertionLanguage ? toAssertionLanguage(taskTemplate) : taskTemplate;
  const user = `You are a fact-checking assistant.\n\n${tasks}\n\nTEXT:\n${text}`;

  return {
    request: { system, user, schemaHint: "", temperature: 0.2 },
    promptSelection: {
      extractionMode: mode,
      contentRole: role,
      includeTopicsAndTestimonials,
      selectedNames: selected.selectedNames,
      lookupAttempts: selected.lookupAttempts,
      minClaims,
      maxClaims,
      tokenLength,
      parameters: selected.parameters,
      terminology: assertionLanguage ? "assertion_only_v1" : "claim_baseline",
    },
    fingerprints: {
      systemSha256: sha256(system),
      userSha256: sha256(user),
      assembledSha256: sha256(`${system}\n${user}`),
    },
  };
}

function normalizeClaimKey(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function strings(value, limit = 12) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, limit)
    : [];
}

export function normalizeLegacySearchAssertions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((entry, index) => {
    if (!entry || typeof entry !== "object") return null;
    const assertion = String(entry.assertion ?? entry.text ?? entry.claim ?? "").trim();
    const searchQuery = String(entry.query ?? entry.searchQuery ?? entry.search_query ?? "").trim();
    if (!assertion && !searchQuery) return null;
    return {
      id: String(entry.id ?? entry.assertionId ?? entry.assertion_id
        ?? `search-assertion-${index + 1}`),
      assertion,
      query: searchQuery,
      derivedFromClaimText: String(
        entry.derivedFromClaimText ?? entry.derived_from_claim_text ?? "",
      ).trim(),
      searchIntent: String(entry.searchIntent ?? entry.search_intent ?? "both")
        .trim().toLowerCase(),
      priority: String(entry.priority ?? "medium").trim().toLowerCase(),
      mustIncludeTerms: strings(entry.mustIncludeTerms ?? entry.must_include_terms),
      optionalTerms: strings(entry.optionalTerms ?? entry.optional_terms),
      entityFocus: strings(entry.entityFocus ?? entry.entity_focus),
      dateFocus: strings(entry.dateFocus ?? entry.date_focus),
      reasonForSearch: String(
        entry.reasonForSearch ?? entry.reason_for_search ?? entry.reason ?? "",
      ).trim().slice(0, 500),
    };
  }).filter(Boolean);
}

function searchAssertionsForClaim(searchAssertions, claim) {
  const keys = new Set([claim?.id, claim?.text].map(normalizeClaimKey).filter(Boolean));
  return searchAssertions.filter((assertion) => {
    const derived = normalizeClaimKey(assertion.derivedFromClaimText);
    const text = normalizeClaimKey(assertion.assertion);
    return (derived && keys.has(derived)) || (text && keys.has(text));
  });
}

function flattenClaimEntries(entries, fallbackRole = null) {
  if (!Array.isArray(entries)) return [];
  const flattened = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (typeof entry === "string") {
      flattened.push({ text: entry, role: fallbackRole });
      continue;
    }
    const text = entry.text ?? entry.claim ?? entry.statement ?? "";
    if (!String(text).trim()) continue;
    flattened.push({
      id: entry.id ?? entry.claimId ?? entry.claim_id ?? null,
      text: String(text).trim(),
      role: entry.role ?? fallbackRole,
      parentId: entry.parentId ?? entry.parent_id ?? null,
      centrality: entry.centrality ?? null,
      verifiability: entry.verifiability ?? null,
      priority: entry.priority ?? null,
      searchText: entry.searchText ?? entry.search_text ?? "",
      claimKind: entry.claimKind ?? entry.claim_kind ?? null,
      evidenceType: entry.evidenceType ?? entry.evidence_type ?? null,
      articleStance: entry.articleStance ?? entry.article_stance ?? null,
      namedEntities: strings(entry.namedEntities ?? entry.named_entities),
      dates: strings(entry.dates ?? entry.dateFocus ?? entry.date_focus),
      studiesOrDocuments: strings(entry.studiesOrDocuments ?? entry.studies_or_documents),
      sourceCitedInArticle: String(
        entry.sourceCitedInArticle ?? entry.source_cited_in_article ?? "",
      ).trim(),
      isFallibilityCritical: Boolean(
        entry.isFallibilityCritical ?? entry.is_fallibility_critical,
      ),
      whyCritical: String(entry.whyCritical ?? entry.why_critical ?? "").trim().slice(0, 500),
    });
  }
  return flattened;
}

export function adaptLegacyDbWholeArticleOutput(rawOutput, { maxClaims = 12 } = {}) {
  const output = rawOutput && typeof rawOutput === "object" ? rawOutput : {};
  const rawStack = output.reasoningStack ?? {
    thesis: output.thesis ?? "",
    pillars: Array.isArray(output.pillars) ? output.pillars : [],
    evidenceClaims: Array.isArray(output.evidenceClaims) ? output.evidenceClaims : [],
    backgroundClaims: Array.isArray(output.backgroundClaims) ? output.backgroundClaims : [],
  };
  const searchAssertions = normalizeLegacySearchAssertions(
    rawStack.searchAssertions ?? output.searchAssertions,
  );
  const reasoningStack = {
    ...rawStack,
    pillars: Array.isArray(rawStack.pillars) ? rawStack.pillars : [],
    evidenceClaims: Array.isArray(rawStack.evidenceClaims) ? rawStack.evidenceClaims : [],
    backgroundClaims: Array.isArray(rawStack.backgroundClaims) ? rawStack.backgroundClaims : [],
    fallibilityCriticalClaims: Array.isArray(rawStack.fallibilityCriticalClaims)
      ? rawStack.fallibilityCriticalClaims : [],
    searchAssertions,
  };

  const thesisClaims = reasoningStack.thesis
    ? [{ id: "thesis", text: reasoningStack.thesis, role: "thesis",
      parentId: null, centrality: null, verifiability: null }]
    : [];
  const pillarClaims = reasoningStack.pillars.flatMap((pillar, index) => {
    const pillarId = pillar?.id ?? `P${index + 1}`;
    const summary = pillar?.summary ?? pillar?.label ?? pillar?.text ?? "";
    const header = summary ? [{ id: pillarId, text: summary, role: "pillar",
      parentId: "thesis", centrality: pillar?.centrality ?? null,
      verifiability: pillar?.verifiability ?? null }] : [];
    const children = flattenClaimEntries(pillar?.claims, "pillar_support")
      .map((entry) => ({ ...entry, parentId: entry.parentId ?? pillarId }));
    return [...header, ...children];
  });
  const rawClaims = [
    ...thesisClaims,
    ...pillarClaims,
    ...flattenClaimEntries(reasoningStack.evidenceClaims, "evidence"),
    ...flattenClaimEntries(reasoningStack.fallibilityCriticalClaims, "evidence")
      .map((entry) => ({ ...entry, isFallibilityCritical: true })),
    ...flattenClaimEntries(reasoningStack.backgroundClaims, "background"),
    ...flattenClaimEntries(output.claims, null),
  ];
  const allowedRoles = new Set(["thesis", "pillar", "pillar_support", "evidence", "background"]);
  const seen = new Map();
  const claims = [];
  for (const candidate of rawClaims) {
    const text = String(candidate?.text ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = text.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, claims.length);
      claims.push({
        ...candidate,
        text,
        role: !candidate.role || allowedRoles.has(candidate.role)
          ? candidate.role : "evidence",
        searchAssertions: searchAssertionsForClaim(searchAssertions, { ...candidate, text }),
      });
      continue;
    }
    const index = seen.get(key);
    const existing = claims[index];
    claims[index] = {
      ...candidate,
      ...existing,
      isFallibilityCritical: Boolean(
        existing.isFallibilityCritical || candidate.isFallibilityCritical,
      ),
      whyCritical: existing.whyCritical || candidate.whyCritical || "",
      claimKind: existing.claimKind || candidate.claimKind || null,
      evidenceType: existing.evidenceType || candidate.evidenceType || null,
      namedEntities: [...new Set([
        ...(existing.namedEntities ?? []), ...(candidate.namedEntities ?? []),
      ])].slice(0, 12),
      dates: [...new Set([...(existing.dates ?? []), ...(candidate.dates ?? [])])].slice(0, 12),
      searchAssertions: searchAssertionsForClaim(searchAssertions, existing),
    };
  }

  return {
    generalTopic: output.generalTopic ?? "",
    specificTopics: Array.isArray(output.specificTopics)
      ? output.specificTopics.slice(0, 5) : [],
    reasoningStack,
    claimsDetailed: claims.slice(0, maxClaims),
    testimonials: Array.isArray(output.testimonials) ? output.testimonials.slice(0, 20) : [],
  };
}

export async function runLegacyDbWholeArticleArm({
  query,
  llm,
  articleText,
  extractionMode = "ranked",
  assertionLanguage = false,
}) {
  if (!llm || typeof llm.generate !== "function") {
    throw new TypeError("llm.generate must be a function");
  }
  const assembled = await buildLegacyDbWholeArticleRequest({
    query,
    articleText,
    extractionMode,
    assertionLanguage,
  });
  const response = await llm.generate(assembled.request);
  const modelOutput = response?.output ?? response;
  const rawOutput = assertionLanguage ? restoreCall1ClaimKeys(modelOutput) : modelOutput;
  return {
    ...assembled,
    rawOutput,
    modelRawOutput: modelOutput,
    provider: response?.output ? {
      model: response.model ?? null,
      usage: response.usage ?? null,
      responseId: response.rawResponse?.id ?? null,
      systemFingerprint: response.rawResponse?.system_fingerprint ?? null,
      finishReason: response.rawResponse?.choices?.[0]?.finish_reason ?? null,
    } : null,
    extraction: adaptLegacyDbWholeArticleOutput(rawOutput, {
      maxClaims: assembled.promptSelection.maxClaims,
    }),
  };
}
