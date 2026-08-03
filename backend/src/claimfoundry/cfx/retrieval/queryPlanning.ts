import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalHash,
} from "../../shared/sourceUnits/index.js";
import type {
  Cf7StructuredModelRequest,
  Cf7StructuredProvider,
} from "../../shared/provider/index.js";
import {
  loadCfxPrompt,
  type CfxGovernedPrompt,
} from "../prompts/loadPrompt.js";
import {
  CFX_QUERY_PLANNING_JSON_SCHEMA,
  cfxQueryPlanningOutputSchema,
  type CfxQueryPlanningOutput,
} from "./schema.js";
import {
  compileLiteralPubmedQuery,
} from "./pubmedQueryCompiler.js";
import {
  validateCfxQueryStrategy,
} from "./legacyQueryStrategyAdapter.js";
import type {
  CfxEvidenceInput,
  CfxPlannedQuery,
  CfxQueryId,
  CfxQueryIntent,
  CfxQueryLaneName,
  CfxQueryPlan,
} from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_HASH =
  "9ba360fbdabac58c936f71f7bd31452cf185762a49e0777bef30e4bc8c04b70c";
const GENERIC_SOURCE_RE =
  /\b(?:article|author|historical context|statistical data|general discussion|source material|not specified|unnamed|unknown)\b/iu;
const BIOMEDICAL_RE =
  /\b(?:adverse event|allerg|aluminum|asthma|autism|cancer|chronic disease|chronic illness|clinical|diagnos|disease|dose|drug|epidemiol|hospital|immun|infant|injur|mercur|mortality|neuro|patient|pharmacokinetic|public health|safety|thimerosal|toxic|vaccin)\b/iu;
const VERDICT_WORD_RE = /\b(?:debunked|false|refute|refuted|true)\b/iu;

export const DEFAULT_CFX_QUERY_PLANNING_CONFIG = Object.freeze({
  model: "gpt-4o-mini",
  temperature: 0.1,
  maximumConcurrency: 1,
  maxOutputTokens: 8_000,
  timeoutMs: 180_000,
  retryCount: 0 as const,
  store: false as const,
});

const laneById: Partial<Record<CfxQueryId, CfxQueryLaneName>> = {
  Q1: "canonical",
  Q2: "entity_predicate",
  Q3: "source_identity",
  Q4: "independent_evidence",
};

function laneFor(queryId: CfxQueryId, queryIntent: CfxQueryIntent): CfxQueryLaneName {
  return laneById[queryId] ?? queryIntent;
}

function clean(value: string, maximum = 300): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim()
    .replace(/[.!?]+$/u, "").slice(0, maximum).trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = clean(value).toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicatePreference(row: CfxPlannedQuery): number {
  if (row.origin === "deterministic") return 100;
  if (row.provider === "pubmed" && row.compiledFromLiteralComponents) {
    return {
      Q4: 30,
      Q5: 20,
      Q2: 10,
      Q1: 0,
      Q3: 0,
    }[row.queryId];
  }
  return 0;
}

function suppressDuplicate(row: CfxPlannedQuery): void {
  row.query = null;
  row.provider = null;
  row.missingReason = "DUPLICATE_QUERY_TEXT";
  row.rationale =
    "The proposed query duplicated a preferred lane and was not executed.";
}

export function pubmedApplicability(input: CfxEvidenceInput): {
  applies: boolean;
  reasons: string[];
} {
  const hints = input.lookupHints;
  const reasons: string[] = [];
  if (
    hints.populations.length > 0
    && (hints.interventions.length > 0 || hints.exposures.length > 0)
    && hints.outcomes.length > 0
  ) {
    reasons.push("literal_population_exposure_or_intervention_outcome");
  }
  if (hints.outcomes.some((value) => BIOMEDICAL_RE.test(value))) {
    reasons.push("literal_biomedical_outcome");
  }
  if (
    [...hints.interventions, ...hints.exposures].some(
      (value) => BIOMEDICAL_RE.test(value),
    )
  ) {
    reasons.push("literal_biomedical_intervention_or_exposure");
  }
  if (
    input.literalIdentifiers.studyTitles.length > 0
    && BIOMEDICAL_RE.test([
      input.substantiveAssertion,
      ...hints.topics,
    ].join(" "))
  ) {
    reasons.push("explicit_biomedical_study_title");
  }
  return { applies: reasons.length > 0, reasons: unique(reasons) };
}

function q3IdentityQuery(input: CfxEvidenceInput): {
  query: string | null;
  provider: "web" | "pubmed" | null;
  reason: string;
} {
  const ids = input.literalIdentifiers;
  if (ids.pmid[0]) {
    return {
      query: `PMID ${ids.pmid[0]}`,
      provider: "pubmed",
      reason: "Exact literal PMID lookup.",
    };
  }
  if (ids.doi[0]) {
    return {
      query: ids.doi[0],
      provider: "web",
      reason: "Exact literal DOI lookup.",
    };
  }
  if (ids.urls[0]) {
    return {
      query: ids.urls[0],
      provider: "web",
      reason: "Exact literal URL lookup.",
    };
  }
  if (ids.studyTitles[0]) {
    return {
      query: clean([
        `"${ids.studyTitles[0]}"`,
        ids.people[0],
        ids.years[0],
        ids.journals[0],
      ].filter(Boolean).join(" ")),
      provider: "web",
      reason: "Literal named-work lookup.",
    };
  }
  if (ids.laws[0]) {
    return {
      query: clean([
        ids.laws[0],
        ids.organizations[0],
        input.lookupHints.topics[0],
      ].filter(Boolean).join(" ")),
      provider: "web",
      reason: "Literal law lookup.",
    };
  }
  const namedIdentity = ids.people.length > 0 || ids.organizations.length > 0;
  const sourceUseful = !GENERIC_SOURCE_RE.test(input.assertionSource);
  if (namedIdentity && sourceUseful) {
    const lookup = input.deterministicQueries.studyLookupQueries.find(
      (query) => ids.people.some((name) => query.includes(name))
        || ids.organizations.some((name) => query.includes(name)),
    );
    if (lookup) {
      return {
        query: clean(lookup),
        provider: "web",
        reason: "Literal person or institution lookup.",
      };
    }
  }
  return {
    query: null,
    provider: null,
    reason: "NO_USEFUL_LITERAL_SOURCE_IDENTITY",
  };
}

function deterministicQueries(input: CfxEvidenceInput): {
  q1: CfxPlannedQuery;
  q3: CfxPlannedQuery;
} {
  const applicability = pubmedApplicability(input);
  const canonical = clean(input.substantiveAssertion);
  const identity = q3IdentityQuery(input);
  return {
    q1: {
      propositionId: input.propositionId,
      queryId: "Q1",
      queryIntent: "canonical",
      query: canonical || null,
      quotedDiagnosticVariant: canonical ? `"${canonical}"` : null,
      lane: laneFor("Q1", "canonical"),
      provider: canonical ? "web" : null,
      rationale: "Canonical assertion with mechanical whitespace and terminal punctuation cleanup only.",
      origin: "deterministic",
      modelProposedQuery: null,
      compiledFromLiteralComponents: false,
      pubmedFallbacks: [],
      missingReason: canonical ? null : "EMPTY_CANONICAL_ASSERTION",
      pubmedApplicabilityReasons: applicability.reasons,
    },
    q3: {
      propositionId: input.propositionId,
      queryId: "Q3",
      queryIntent: "source_identity",
      query: identity.query,
      quotedDiagnosticVariant: null,
      lane: laneFor("Q3", "source_identity"),
      provider: identity.provider,
      rationale: identity.query
        ? identity.reason
        : "No generic source label was inserted into a retrieval query.",
      origin: "deterministic",
      modelProposedQuery: null,
      compiledFromLiteralComponents: false,
      pubmedFallbacks: [],
      missingReason: identity.query ? null : identity.reason,
      pubmedApplicabilityReasons: applicability.reasons,
    },
  };
}

export async function loadCfxQueryPlanningPrompt(): Promise<CfxGovernedPrompt> {
  return loadCfxPrompt({
    filePath: path.join(here, "query-planning-v1.json"),
    expectedPromptId: "cfx-initial-query-planning-v2",
    expectedPromptHash: PROMPT_HASH,
  });
}

export function buildCfxQueryPlanningRequest(input: {
  inputs: CfxEvidenceInput[];
  prompt: CfxGovernedPrompt;
}): Cf7StructuredModelRequest {
  const packets = input.inputs.map((item) => {
    const applicability = pubmedApplicability(item);
    return {
      propositionId: item.propositionId,
      immutableSubstantiveAssertion: item.substantiveAssertion,
      assertionSource: item.assertionSource,
      articleStance: item.articleStance,
      literalIdentifiers: item.literalIdentifiers,
      lookupHints: item.lookupHints,
      groundingText: item.groundingText,
      pubmedApplicable: applicability.applies,
      pubmedApplicabilityReasons: applicability.reasons,
    };
  });
  return {
    system: "",
    user: `${input.prompt.prompt}\n\nPROPOSITION_PACKETS:\n${JSON.stringify(packets, null, 2)}`,
    responseSchema: CFX_QUERY_PLANNING_JSON_SCHEMA,
    ...DEFAULT_CFX_QUERY_PLANNING_CONFIG,
  };
}

// Policy checks here are advisory, not gating: a single malformed proposition
// or an over-tight heuristic (see the removed Q5 purpose-marker regex, which
// rejected a valid qualification query for having the "wrong" wording) used
// to throw and kill the entire multi-proposition run. Everything below now
// degrades a bad entry to a warning + best-effort fallback instead.
function validateModelPlans(
  raw: unknown,
  inputs: CfxEvidenceInput[],
): { output: CfxQueryPlanningOutput; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: CfxQueryPlanningOutput;
  try {
    parsed = cfxQueryPlanningOutputSchema.parse(raw);
  } catch (error) {
    warnings.push(
      `Query-plan schema parse failed, discarding model output: ${error instanceof Error ? error.message : String(error)}`,
    );
    parsed = { plans: [] };
  }
  const expected = new Set(inputs.map((input) => input.propositionId));
  const seen = new Set<string>();
  const plans: CfxQueryPlanningOutput["plans"] = [];
  for (const plan of parsed.plans) {
    if (!expected.has(plan.propositionId)) {
      warnings.push(`Unexpected query-plan proposition ${plan.propositionId} (dropped)`);
      continue;
    }
    if (seen.has(plan.propositionId)) {
      warnings.push(`Duplicate query-plan proposition ${plan.propositionId} (dropped)`);
      continue;
    }
    seen.add(plan.propositionId);
    const evidenceInput = inputs.find(
      (item) => item.propositionId === plan.propositionId,
    )!;
    const queries = plan.queries.filter((query) => {
      if (VERDICT_WORD_RE.test(query.query)) {
        warnings.push(
          `Prohibited verdict word in ${plan.propositionId}/${query.queryId} (kept)`,
        );
      }
      const validation = validateCfxQueryStrategy({
        queryId: query.queryId,
        queryIntent: query.queryIntent,
        query: query.query,
        evidenceInput,
      });
      if (!validation.valid) {
        warnings.push(
          `Query-policy warning in ${plan.propositionId}/${query.queryId}: ${validation.reasons.join(",")} (kept)`,
        );
      }
      return true;
    });
    plans.push({ ...plan, queries });
  }
  for (const propositionId of expected) {
    if (!seen.has(propositionId)) {
      warnings.push(`Query-plan missing proposition ${propositionId}; using empty plan`);
      plans.push({ propositionId, queries: [] });
    }
  }
  return { output: { plans }, warnings };
}

export function mergeCfxQueryPlan(input: {
  inputs: CfxEvidenceInput[];
  sourceEvidenceInputHash: string;
  modelOutput: unknown;
}): CfxQueryPlan {
  const { output: parsed, warnings } = validateModelPlans(input.modelOutput, input.inputs);
  const modelByProposition = new Map(
    parsed.plans.map((plan) => [plan.propositionId, plan]),
  );
  return {
    schemaVersion: "cfx.initialQueryPlan.v3",
    sourceEvidenceInputHash: input.sourceEvidenceInputHash,
    warnings,
    propositions: input.inputs.map((evidenceInput) => {
      const deterministic = deterministicQueries(evidenceInput);
      const applicability = pubmedApplicability(evidenceInput);
      const modelPlan = modelByProposition.get(evidenceInput.propositionId)
        ?? { propositionId: evidenceInput.propositionId, queries: [] };
      const byId = new Map(
        modelPlan.queries.map((query) => [query.queryId, query]),
      );
      const pubmedPriority = ["Q4", "Q5", "Q2"] as const;
      let pubmedSlots = deterministic.q3.provider === "pubmed" ? 1 : 0;
      const permittedPubmed = new Set<CfxQueryId>();
      if (applicability.applies) {
        for (const queryId of pubmedPriority) {
          if (
            pubmedSlots < 2
            && byId.get(queryId)?.provider === "pubmed"
          ) {
            permittedPubmed.add(queryId);
            pubmedSlots += 1;
          }
        }
      }
      const fallbackIntent: Record<"Q2" | "Q4" | "Q5", CfxQueryIntent> = {
        Q2: "entity_predicate",
        Q4: "independent_evidence",
        Q5: "qualification",
      };
      const modelRows = (["Q2", "Q4", "Q5"] as const).map(
        (queryId): CfxPlannedQuery => {
          const proposed = byId.get(queryId);
          if (!proposed) {
            return {
              propositionId: evidenceInput.propositionId,
              queryId,
              queryIntent: fallbackIntent[queryId],
              query: null,
              quotedDiagnosticVariant: null,
              lane: laneFor(queryId, fallbackIntent[queryId]),
              provider: null,
              rationale: "Model did not provide a usable query for this lane.",
              origin: "model",
              modelProposedQuery: null,
              compiledFromLiteralComponents: false,
              pubmedFallbacks: [],
              missingReason: "MODEL_QUERY_MISSING",
              pubmedApplicabilityReasons: applicability.reasons,
            };
          }
          const modelProposedQuery = clean(proposed.query);
          const permittedProvider = proposed.provider === "pubmed"
            && permittedPubmed.has(queryId)
            ? "pubmed"
            : "web";
          const compiled = permittedProvider === "pubmed"
            ? compileLiteralPubmedQuery({
                evidenceInput,
                queryId,
                queryIntent: proposed.queryIntent,
              })
            : null;
          const provider = permittedProvider === "pubmed" && !compiled
            ? "web"
            : permittedProvider;
          const query = compiled?.query ?? modelProposedQuery;
          return {
            propositionId: evidenceInput.propositionId,
            queryId,
            queryIntent: proposed.queryIntent,
            query,
            quotedDiagnosticVariant: null,
            lane: laneFor(queryId, proposed.queryIntent),
            provider,
            rationale: provider === "pubmed" && compiled
              ? `${proposed.rationale} PubMed syntax was compiled deterministically from literal biomedical components.`
              : permittedProvider === "pubmed" && !compiled
                ? `${proposed.rationale} Host routed to web because fewer than two literal biomedical component groups were available for PubMed compilation.`
              : provider === proposed.provider
                ? proposed.rationale
                : `${proposed.rationale} Host routed to web because PubMed was inapplicable or its two-query cap was reached.`,
            origin: "model",
            modelProposedQuery,
            compiledFromLiteralComponents: Boolean(compiled),
            pubmedFallbacks: compiled?.fallbacks ?? [],
            missingReason: null,
            pubmedApplicabilityReasons: applicability.reasons,
          };
        },
      );
      const rows = [
        deterministic.q1,
        modelRows[0]!,
        deterministic.q3,
        modelRows[1]!,
        modelRows[2]!,
      ];
      const seenQueries = new Map<string, CfxPlannedQuery>();
      for (const row of rows) {
        if (!row.query) continue;
        const key = row.query.toLocaleLowerCase();
        const prior = seenQueries.get(key);
        if (!prior) {
          seenQueries.set(key, row);
        } else if (
          duplicatePreference(row) > duplicatePreference(prior)
        ) {
          suppressDuplicate(prior);
          seenQueries.set(key, row);
        } else {
          suppressDuplicate(row);
        }
      }
      return {
        propositionId: evidenceInput.propositionId,
        canonicalAssertion: evidenceInput.substantiveAssertion,
        pubmedApplicable: applicability.applies,
        pubmedApplicabilityReasons: applicability.reasons,
        queries: rows,
      };
    }),
  };
}

export async function runCfxQueryPlanning(input: {
  inputs: CfxEvidenceInput[];
  sourceEvidenceInputHash: string;
  provider: Cf7StructuredProvider;
  prompt: CfxGovernedPrompt;
  beforeInvoke?: (request: Cf7StructuredModelRequest) => Promise<void>;
  afterResponse?: (response: {
    rawResponse: unknown;
    parsedOutput: unknown;
    responseId: string | null;
    requestId: string | null;
    usage: {
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
    latencyMs: number;
  }) => Promise<void>;
}) {
  const request = buildCfxQueryPlanningRequest(input);
  await input.beforeInvoke?.(request);
  const startedAt = Date.now();
  const response = await input.provider.invokeStructured(request);
  const latencyMs = Date.now() - startedAt;
  await input.afterResponse?.({
    rawResponse: response.rawResponse ?? response.output,
    parsedOutput: response.output,
    responseId: response.responseId,
    requestId: response.requestId,
    usage: response.usage,
    latencyMs,
  });
  const plan = mergeCfxQueryPlan({
    inputs: input.inputs,
    sourceEvidenceInputHash: input.sourceEvidenceInputHash,
    modelOutput: response.output,
  });
  return {
    plan,
    request,
    requestHash: canonicalHash(request),
    promptHash: input.prompt.promptHash,
    schemaHash: canonicalHash(CFX_QUERY_PLANNING_JSON_SCHEMA),
    providerCallCount: 1 as const,
    model: response.model,
    responseId: response.responseId,
    requestId: response.requestId,
    usage: response.usage,
    latencyMs,
  };
}

export function deterministicQuerySlots(
  inputs: CfxEvidenceInput[],
): Array<{ propositionId: string; q1: CfxPlannedQuery; q3: CfxPlannedQuery }> {
  return inputs.map((input) => ({
    propositionId: input.propositionId,
    ...deterministicQueries(input),
  }));
}
