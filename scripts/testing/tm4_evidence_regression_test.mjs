#!/usr/bin/env node

/**
 * TM4 EVIDENCE REGRESSION HARNESS — deterministic, dry-run by default.
 *
 * Runs the SAME production evidence modules (createEvidenceRetrievalGateway,
 * EvidenceEngine, evidenceNeed/retrievalContext builders, bearing config) in
 * isolation, with:
 *   - a READ-ONLY DB wrapper (any non-SELECT throws — writes are structurally
 *     impossible; blocked write attempts are recorded and reported)
 *   - a dry fetcher (candidate snippets stand in for scraped documents; no
 *     reference content rows, no scraping persistence)
 *   - full provider fanout diagnostics (PubMed eSearch, Brave, SerpApi,
 *     Tavily, OpenAlex, Crossref, Semantic Scholar, Bing) — provider silence
 *     is reported as a failure with an exact reason, never silently skipped
 *   - stage-by-stage counts and failure classification
 *
 * No search logic is duplicated: providers are exercised through the real
 * gateway; the pipeline through the real EvidenceEngine class (the same one
 * runEvidenceEngine wraps). What the harness deliberately does NOT run:
 * studyIdentityDiscovery and reference persistence (those live in the
 * runEvidenceEngine wrapper and write to the DB).
 *
 * Usage:
 *   node scripts/testing/tm4_evidence_regression_test.mjs                    # latest preview sidecar, 3 claims
 *   node scripts/testing/tm4_evidence_regression_test.mjs --providers-only   # provider probes only (fast)
 *   node scripts/testing/tm4_evidence_regression_test.mjs --package <path>   # explicit sidecar/fixture json
 *   node scripts/testing/tm4_evidence_regression_test.mjs --limit 5          # claims cap for the engine stage
 *
 * Artifacts:
 *   artifacts/tm4_evidence_regression_<timestamp>.json
 *   artifacts/tm4_evidence_regression_<timestamp>.md
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const BACKEND = path.join(ROOT, "backend");
const RUNS_DIR = path.join(BACKEND, "logs/tm4_preview_runs");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TS = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);

dotenv.config({ path: path.join(BACKEND, ".env") });

const args = process.argv.slice(2);
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const PROVIDERS_ONLY = args.includes("--providers-only");
const LIMIT = Number(getArg("--limit")) || 3;
const PACKAGE_PATH = getArg("--package");

const REQUIRED_PROVIDERS = ["tavily", "brave", "serpapi", "pubmed", "openalex", "crossref", "semantic_scholar", "bing"];
const PROBE_QUERY = "thimerosal vaccines autism epidemiological study";

// ---------------------------------------------------------------------------
// Read-only DB wrapper: SELECT/SHOW/DESCRIBE pass through; anything else throws.
// ---------------------------------------------------------------------------
const blockedWrites = [];
async function makeReadOnlyQuery() {
  try {
    const { query } = await import(path.join(BACKEND, "src/db/pool.js"));
    const ro = async (sql, params) => {
      const head = String(sql).trim().slice(0, 12).toUpperCase();
      if (!/^(SELECT|SHOW|DESCRIBE|EXPLAIN)/.test(head)) {
        blockedWrites.push(String(sql).trim().slice(0, 120));
        throw new Error(`read-only harness blocked write: ${head}…`);
      }
      return query(sql, params);
    };
    await ro("SELECT 1");
    return ro;
  } catch (e) {
    console.warn(`⚠️ DB unavailable (${e.message}) — falling back to env-only config`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Package loading → engine-shaped claims
// ---------------------------------------------------------------------------
async function loadPackage() {
  let file = PACKAGE_PATH;
  if (!file) {
    const files = (await fs.readdir(RUNS_DIR).catch(() => []))
      .filter((f) => /^tm4prev-.*\.json$/.test(f) && !f.includes(".cleaned")).sort();
    if (!files.length) throw new Error(`No package given and no sidecars in ${RUNS_DIR}`);
    file = path.join(RUNS_DIR, files[files.length - 1]);
  }
  const pkg = JSON.parse(await fs.readFile(file, "utf-8"));
  // Accept either a preview sidecar (tm4.selectedEvaluationClaims + tm4.targets)
  // or a hand-written fixture ({ claims: [...], targets: [...] }).
  const selected = pkg.tm4?.selectedEvaluationClaims || pkg.claims || [];
  const targets = pkg.tm4?.targets || pkg.targets || [];
  if (!selected.length) throw new Error(`Package ${file} has no selected claims`);
  return { file, pkg, selected, targets, readableText: "" };
}

function buildEngineClaims(selected, targets, normalizeEvaluationTarget) {
  const targetsByOcc = new Map();
  for (const t of targets) {
    if (!targetsByOcc.has(t.sourceClaimId)) targetsByOcc.set(t.sourceClaimId, []);
    targetsByOcc.get(t.sourceClaimId).push(t);
  }
  return selected.slice(0, LIMIT).map((c, i) => {
    const occTargets = targetsByOcc.get(c.claimId) || [];
    const evaluationTargets = occTargets.map((t, order) => normalizeEvaluationTarget({
      targetType: ["attribution", "substantive", "inference", "study_identity"].includes(t.targetType) ? t.targetType : "substantive",
      targetText: t.targetText,
      objectText: t.targetText,
      sourceExcerpt: t.canonicalExcerpt || c.canonicalExcerpt || "",
      articleStance: c.articleUse === "used_as_opponent_claim" ? "opposes" : "endorses",
      scoreTransform: t.scoreTransform,
      searchEligible: t.searchEligible !== false,
      verdictEligible: t.verdictEligible !== false,
      mappingConfidence: t.mappingConfidence,
      targetOrder: order,
    }, { claimId: 100000 + i, contentId: 0 }));
    const primary = occTargets.find((t) => t.searchEligible)?.queryHints?.primaryQueryText || "";
    return {
      id: 100000 + i,
      text: c.visibleClaimText,
      originalText: c.visibleClaimText,
      promptText: c.visibleClaimText,
      role: "evidence",
      centrality: 0.5, verifiability: 0.7, priority: 0.5,
      searchText: primary || c.searchText || "",
      objectClaim: c.embeddedSubstantiveClaim || primary || "",
      isAttribution: ["quoted_claim", "attributed_assertion"].includes(c.claimForm),
      speakerEntity: c.speakerOrSource || "",
      articleStance: c.articleUse === "used_as_opponent_claim" ? "opposes" : "endorses",
      argumentFunction: c.claimForm || "",
      scoreTransform: c.scoreTransformHint || "",
      argumentMappingRationale: "",
      targetMappingUnresolved: false,
      claimKind: "", evidenceType: "",
      namedEntities: [...(c.namedActors || []), ...(c.namedOrganizations || [])],
      dates: [],
      studiesOrDocuments: c.namedStudiesOrDocuments || [],
      sourceCitedInArticle: "",
      isFallibilityCritical: false,
      searchAssertions: [],
      evaluationTargets,
      evaluationTargetId: evaluationTargets.find((t) => t.targetType === "substantive")?.evaluationTargetId || null,
      _tm4: { sourceClaimId: c.claimId, rank: c.selectionRank, queryHints: occTargets.map((t) => t.queryHints), bearingCriteria: occTargets.map((t) => t.bearingCriteria) },
    };
  });
}

// ---------------------------------------------------------------------------
// Gateway capture: parse [SEARCH_GATEWAY] JSON emitted by the real gateway.
// ---------------------------------------------------------------------------
function makeCaptureLog(store) {
  const parse = (line) => {
    const m = String(line).match(/\[SEARCH_GATEWAY\] (\{.*\})$/);
    if (m) { try { store.gatewayCalls.push(JSON.parse(m[1])); } catch { /* not json */ } }
    const p = String(line).match(/\[SEARCH_GATEWAY_PROVIDER\] (\{.*\})$/);
    if (p) { try { store.providerStats.push(JSON.parse(p[1])); } catch { /* not json */ } }
  };
  return {
    log: (...a) => parse(a.join(" ")),
    warn: (...a) => parse(a.join(" ")),
    error: (...a) => parse(a.join(" ")),
  };
}

// ---------------------------------------------------------------------------
// Provider probes (Part 3): one isolated call per required provider.
// ---------------------------------------------------------------------------
async function probeProviders(gatewayFactory, probeQuery) {
  const rows = [];
  for (const provider of REQUIRED_PROVIDERS) {
    const store = { gatewayCalls: [], providerStats: [] };
    const gateway = gatewayFactory(makeCaptureLog(store));
    const status = gateway.status[provider] || {};
    const enabled = Boolean(gateway.config.providerEnabled?.[provider]);
    let results = [];
    let call = null;
    if (enabled) {
      results = await gateway.web({ query: probeQuery, topK: 5, onlyProviders: [provider] });
      call = store.gatewayCalls[0]?.providers?.find((p) => p.provider === provider) || null;
    }
    const raw = call?.raw_result_count ?? 0;
    let verdict, reason;
    if (!enabled) { verdict = "DISABLED"; reason = `provider_disabled_by_env/config (providerEnabled.${provider}=false — DB evidence_search_config overrides env)`; }
    else if (call?.skipped === "skipped_missing_api_key") { verdict = "NOT CONFIGURED"; reason = "provider_config_missing (API key env var empty)"; }
    else if (call?.skipped) { verdict = "SKIPPED"; reason = `provider_not_wired (${call.skipped})`; }
    else if (call?.error) { verdict = "ERROR"; reason = `provider_call_error: ${call.error}`; }
    else if (raw === 0) { verdict = "ZERO RESULTS"; reason = "provider_returned_zero (wired + configured, probe returned nothing)"; }
    else { verdict = "FIRING"; reason = null; }
    rows.push({
      provider, enabled,
      configured: Boolean(status.configured || status.keyOptional),
      keyOptional: Boolean(status.keyOptional),
      verdict, reason,
      probeQuery: enabled ? probeQuery : null,
      rawResults: raw,
      normalizedResults: call?.normalized_result_count ?? 0,
      topResults: results.slice(0, 3).map((r) => ({ title: String(r.title || "").slice(0, 90), url: r.url, source: r.source })),
    });
    console.log(`  ${verdict === "FIRING" ? "✅" : verdict === "DISABLED" ? "🚫" : "❌"} ${provider.padEnd(17)} ${verdict}${reason ? " — " + reason : ` — ${raw} raw results`}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`🧪 TM4 Evidence Regression Harness — ${TS} (dry-run, read-only DB)\n`);
  await fs.mkdir(ARTIFACTS, { recursive: true });

  const roQuery = await makeReadOnlyQuery();

  const { normalizeSearchGatewayConfig, loadSearchGatewayConfig } = await import(path.join(BACKEND, "src/core/searchGatewayConfig.js"));
  const { createEvidenceRetrievalGateway } = await import(path.join(BACKEND, "src/core/evidenceRetrievalGateway.js"));
  const gatewayConfig = roQuery
    ? await loadSearchGatewayConfig({ query: roQuery })
    : normalizeSearchGatewayConfig({}, process.env);

  console.log(`— Gateway config: mode=${gatewayConfig.mode}, strategy=${gatewayConfig.retrievalStrategy}, providers=[${gatewayConfig.providers}], maxProvidersPerTarget=${gatewayConfig.maxProvidersPerTarget}`);
  console.log(`  providerEnabled: ${JSON.stringify(gatewayConfig.providerEnabled)}\n`);

  // -------------------- Part 3: provider probes ----------------------------
  console.log("— Provider probes (isolated, one query each):");
  const gatewayFactory = (log) => createEvidenceRetrievalGateway({ config: gatewayConfig, log });
  const providerReport = await probeProviders(gatewayFactory, PROBE_QUERY);
  console.log();

  const report = {
    timestamp: TS,
    mode: PROVIDERS_ONLY ? "providers-only" : "full",
    gatewayConfig: { ...gatewayConfig },
    providerProbes: providerReport,
    blockedWrites,
    engine: null,
    classification: [],
  };

  // Provider-level classification
  for (const p of providerReport) {
    if (p.verdict !== "FIRING" && p.verdict !== "DISABLED") report.classification.push(`${p.provider}: ${p.reason}`);
    if (p.verdict === "DISABLED" && ["brave", "serpapi", "pubmed"].includes(p.provider)) report.classification.push(`${p.provider}: ${p.reason}`);
  }

  // -------------------- Engine stage (real pipeline, dry) ------------------
  if (!PROVIDERS_ONLY) {
    const { file, selected, targets } = await loadPackage();
    console.log(`— Package: ${path.basename(file)} (${selected.length} selected claims, ${targets.length} targets); engine cap --limit ${LIMIT}\n`);

    const { normalizeEvaluationTarget } = await import(path.join(BACKEND, "src/core/evaluationTargetStore.js"));
    const claims = buildEngineClaims(selected, targets, normalizeEvaluationTarget);

    // Per-claim/target diagnostic print (Part 3 requirement)
    for (const c of claims) {
      console.log(`  claim ${c._tm4.sourceClaimId} (rank ${c._tm4.rank}) — "${c.text.slice(0, 80)}"`);
      for (const t of c.evaluationTargets) {
        console.log(`    target[${t.targetType}] search=${t.searchEligible} verdict=${t.verdictEligible} — "${String(t.targetText).slice(0, 70)}"`);
      }
      console.log(`    primaryQuery: "${String(c.searchText).slice(0, 90)}"`);
    }
    console.log();

    const { loadBearingGatingConfig } = await import(path.join(BACKEND, "src/core/bearingConfig.js"));
    const bearingConfig = roQuery ? await loadBearingGatingConfig({ query: roQuery }) : await loadBearingGatingConfig({});
    const { buildEvidenceNeedV1, buildEvidenceNeedFromEvaluationTargets, buildEvidenceTargetQueries } = await import(path.join(BACKEND, "src/core/evidenceNeed.js"));
    const { buildRetrievalContextsForClaim } = await import(path.join(BACKEND, "src/core/retrievalContext.js"));
    const { buildSearchTargets, addEvidenceTargetProvenance, isEvidenceTargetRoutingEnabled, buildEvidenceQueryContexts } = await import(path.join(BACKEND, "src/core/runEvidenceEngine.js"));
    const { isBearingShadowEnabled } = await import(path.join(BACKEND, "src/core/snippetBearing.js"));
    const { EvidenceEngine } = await import(path.join(BACKEND, "src/core/evidenceEngine.js"));
    const { openAiLLM } = await import(path.join(BACKEND, "src/core/openAiLLM.js"));
    const { duckDuckGoSearch } = await import(path.join(BACKEND, "src/core/duckDuckGoSearch.js"));
    const PromptManager = roQuery ? (await import(path.join(BACKEND, "src/core/promptManager.js"))).default : null;

    // Same claim preparation glue as runEvidenceEngine (uses the exported builders).
    const targetRouting = isEvidenceTargetRoutingEnabled();
    const multiTarget = process.env.ENABLE_MULTI_TARGET_EVIDENCE === "true";
    for (const claim of claims) {
      const hasTargets = claim.evaluationTargets.some((t) => t.searchEligible !== false);
      if (targetRouting || isBearingShadowEnabled() || bearingConfig.enableBearingGating) {
        claim.evidenceNeed = (multiTarget && hasTargets)
          ? buildEvidenceNeedFromEvaluationTargets(claim, claim.evaluationTargets)
          : buildEvidenceNeedV1(claim);
      }
      claim.retrievalContexts = buildRetrievalContextsForClaim(claim, { articleText: "" });
      claim.retrievalContext = claim.retrievalContexts.find((r) => r.evaluationTargetType === "substantive") || claim.retrievalContexts[0] || null;
      const queryLimit = (multiTarget && hasTargets) ? 9 : 3;
      const assertionTargets = targetRouting
        ? buildEvidenceTargetQueries(claim.evidenceNeed, queryLimit).filter((t) => t.matchedPart === "search_assertion")
        : [];
      const legacy = buildSearchTargets(claim);
      claim.searchTargets = targetRouting ? assertionTargets : legacy;
      claim.fallbackSearchTargets = targetRouting ? addEvidenceTargetProvenance(legacy, claim.evidenceNeed) : [];
    }

    // Instrumented gateway shared by the engine run.
    const store = { gatewayCalls: [], providerStats: [] };
    const engineGateway = createEvidenceRetrievalGateway({ config: gatewayConfig, log: makeCaptureLog(store) });

    // Tee production logger to capture bearing/drop audit events.
    const { default: logger } = await import(path.join(BACKEND, "src/utils/logger.js"));
    const captured = [];
    const origLog = logger.log.bind(logger);
    logger.log = (...a) => { const line = a.map((x) => (typeof x === "string" ? x : "")).join(" "); if (/BEARING|CANDIDATE|SURVIV|QUERY|SNIPPET/i.test(line)) captured.push(line.slice(0, 400)); return origLog(...a); };

    const dryFetcher = {
      async getText(cand) {
        if (cand.text) return cand.text;
        const text = cand.rawContent || cand.searchSnippet || cand.snippet || "";
        if (!text.trim()) return null;
        return { cleanText: text, citationCount: 0, citationCandidates: [], retrievalMode: "dry_run_snippet", apiBacked: false, isProcessed: true };
      },
    };

    const engine = new EvidenceEngine({
      llm: openAiLLM,
      promptManager: PromptManager ? new PromptManager(roQuery) : null,
      search: {
        internal: engineGateway.internal,
        web: (opts) => engineGateway.web(opts),
        fringe: (opts) => duckDuckGoSearch.web(opts),
      },
      fetcher: dryFetcher,
    });

    const runOptions = {
      taskContentId: 0,
      enableBearingGating: bearingConfig.enableBearingGating,
      enableBearingPacket: bearingConfig.enableBearingPacket,
      enableBearingPacketLive: false,
      bearingConfig,
      maxSnippetCandidatesPerClaim: bearingConfig.maxSnippetCandidatesPerClaim,
      maxSourcesToScrapePerTarget: gatewayConfig.maxSourcesToScrapePerTarget,
      enableInternal: true, enableWeb: true, searchEngine: "hybrid",
      preferDomains: [], avoidDomains: [], maxCharsPerDoc: 8000, enableRedTeam: false,
      queriesPerClaim: bearingConfig.enableBearingGating ? 9 : 3,
      topKQueries: bearingConfig.enableBearingGating ? 9 : 3,
      topKCandidates: bearingConfig.enableBearingGating ? 12 : 9,
      maxEvidencePerDoc: 2, maxEvidenceCandidates: 9,
      maxSearchTargetsPerClaim: bearingConfig.enableBearingGating ? 9 : 3,
      maxSourcesComparedPerClaim: bearingConfig.enableBearingGating ? 20 : 9,
    };

    console.log(`— Running REAL EvidenceEngine (bearingGating=${runOptions.enableBearingGating}) on ${claims.length} claims (dry fetcher, read-only DB)…\n`);
    const t0 = Date.now();
    const results = await engine.run(claims, buildEvidenceQueryContexts(claims), runOptions);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    logger.log = origLog;

    // -------------------- Part 4: stage counts -----------------------------
    const providerAgg = {};
    let queriesToGateway = 0, rawTotal = 0, normalizedTotal = 0, mergedTotal = 0;
    for (const call of store.gatewayCalls) {
      queriesToGateway++;
      mergedTotal += call.merged_result_count || 0;
      for (const p of call.providers || []) {
        const a = providerAgg[p.provider] = providerAgg[p.provider] || { attempts: 0, succeeded: 0, raw: 0, normalized: 0, skipped: {}, errors: {} };
        a.attempts++;
        if (!p.skipped && !p.error) a.succeeded++;
        a.raw += p.raw_result_count || 0;
        a.normalized += p.normalized_result_count || 0;
        rawTotal += p.raw_result_count || 0;
        normalizedTotal += p.normalized_result_count || 0;
        if (p.skipped) a.skipped[p.skipped] = (a.skipped[p.skipped] || 0) + 1;
        if (p.error) a.errors[p.error.slice(0, 80)] = (a.errors[p.error.slice(0, 80)] || 0) + 1;
      }
    }
    const evidenceItems = results.flatMap((r) => r.evidence || []);
    const fringeItems = results.flatMap((r) => r.fringeEvidence || []);
    const distinctUrls = new Set(evidenceItems.map((e) => e.url).filter(Boolean));
    const bearingLines = captured.filter((l) => /BEARING/i.test(l)).length;
    const dropLines = captured.filter((l) => /CANDIDATE_DROP|SURVIV/i.test(l)).length;
    const dropReasons = {};
    for (const l of captured) {
      const m = l.match(/"droppedReason":"([^"]+)"/);
      if (m) { const key = m[1].split(":")[0]; dropReasons[key] = (dropReasons[key] || 0) + 1; }
    }
    const bearingScoresSeen = captured.some((l) => /scores: \w+:0?\.\d/.test(l));

    const counts = {
      selectedClaimsEnteringEvidence: claims.length,
      targetsEnteringEvidence: claims.reduce((s, c) => s + c.evaluationTargets.length, 0),
      searchTargetsBuilt: claims.reduce((s, c) => s + (c.searchTargets?.length || 0), 0),
      gatewayQueriesAttempted: queriesToGateway,
      providerAttempts: Object.values(providerAgg).reduce((s, a) => s + a.attempts, 0),
      providerSucceeded: Object.values(providerAgg).reduce((s, a) => s + a.succeeded, 0),
      rawProviderResults: rawTotal,
      normalizedCandidates: normalizedTotal,
      mergedCandidatesAfterUrlDedupe: mergedTotal,
      bearingLogEvents: bearingLines,
      candidateDropAuditEvents: dropLines,
      dropReasonDistribution: dropReasons,
      finalEvidenceItems: evidenceItems.length,
      finalFringeItems: fringeItems.length,
      wouldInsertReferences: distinctUrls.size,
      wouldInsertClaimLinks: evidenceItems.length,
      wouldBeVisibleEvidenceLinks: evidenceItems.filter((e) => e.url).length,
      blockedWriteAttempts: blockedWrites.length,
      elapsedSeconds: Number(elapsed),
    };

    report.engine = {
      package: path.basename(file),
      claims: claims.map((c) => ({ sourceClaimId: c._tm4.sourceClaimId, rank: c._tm4.rank, text: c.text.slice(0, 140), targets: c.evaluationTargets.length, searchText: c.searchText.slice(0, 140) })),
      counts,
      providerAgg,
      perClaimEvidence: results.map((r, i) => ({ claim: claims[i]?._tm4.sourceClaimId, evidence: (r.evidence || []).length, fringe: (r.fringeEvidence || []).length, topUrls: (r.evidence || []).slice(0, 3).map((e) => e.url) })),
      capturedEventSample: captured.slice(0, 40),
    };

    // Collapse classification (Part 5)
    if (counts.rawProviderResults === 0) report.classification.push("provider_returned_zero: engine run produced zero raw provider results");
    if (counts.gatewayQueriesAttempted === 0) report.classification.push("provider_not_wired: engine never called the search gateway");
    if (counts.searchTargetsBuilt === 0) report.classification.push("query_generation_bad: no search targets built from targets/claims");
    if (counts.rawProviderResults > 0 && counts.finalEvidenceItems === 0) {
      const capDrops = Object.keys(dropReasons).some((k) => /max_candidates|cap|budget/i.test(k));
      if (bearingScoresSeen && capDrops) {
        report.classification.push("dry_run_extraction_limit: retrieval, query lanes, and snippet bearing all healthy (bearing scores observed; drops are lane caps) — zero final evidence is expected in dry mode because the snippet fetcher cannot feed document extraction; validate extraction with a persisted run");
      } else {
        report.classification.push("bearing_rejected_all: candidates retrieved but none survived bearing");
      }
    }
    if (counts.mergedCandidatesAfterUrlDedupe > 0 && counts.mergedCandidatesAfterUrlDedupe < counts.normalizedCandidates * 0.3) report.classification.push("dedupe_overcollapsed: URL dedupe removed >70% of normalized candidates");

    console.log("=".repeat(72));
    console.log("Stage counts");
    console.log("=".repeat(72));
    Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(36)} ${v}`));
    console.log("\nPer-provider (engine run):");
    Object.entries(providerAgg).forEach(([p, a]) =>
      console.log(`  ${p.padEnd(17)} attempts=${a.attempts} ok=${a.succeeded} raw=${a.raw} normalized=${a.normalized} skipped=${JSON.stringify(a.skipped)} errors=${JSON.stringify(a.errors)}`));
  }

  if (!report.classification.length) report.classification.push("no_collapse_detected");

  // -------------------- artifacts ------------------------------------------
  const jsonPath = path.join(ARTIFACTS, `tm4_evidence_regression_${TS}.json`);
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const md = `# TM4 Evidence Regression — ${TS}

Mode: ${report.mode} · dry-run (read-only DB, snippet fetcher) · blocked write attempts: ${blockedWrites.length}

## Gateway config
mode=${report.gatewayConfig.mode} · strategy=${report.gatewayConfig.retrievalStrategy} · maxProvidersPerTarget=${report.gatewayConfig.maxProvidersPerTarget}
providerEnabled: \`${JSON.stringify(report.gatewayConfig.providerEnabled)}\`

## Provider probes
| provider | verdict | raw | reason |
|---|---|---|---|
${report.providerProbes.map((p) => `| ${p.provider} | ${p.verdict} | ${p.rawResults} | ${p.reason || "—"} |`).join("\n")}

${report.engine ? `## Engine run (${report.engine.package})
### Claims
${report.engine.claims.map((c) => `- **${c.sourceClaimId}** (rank ${c.rank}, ${c.targets} targets): "${c.text}"\n  - query: "${c.searchText}"`).join("\n")}

### Stage counts
${Object.entries(report.engine.counts).map(([k, v]) => `- ${k}: **${v}**`).join("\n")}

### Per-provider
${Object.entries(report.engine.providerAgg).map(([p, a]) => `- **${p}**: attempts ${a.attempts}, ok ${a.succeeded}, raw ${a.raw}, normalized ${a.normalized}${Object.keys(a.skipped).length ? `, skipped ${JSON.stringify(a.skipped)}` : ""}${Object.keys(a.errors).length ? `, errors ${JSON.stringify(a.errors)}` : ""}`).join("\n")}

### Per-claim evidence
${report.engine.perClaimEvidence.map((r) => `- ${r.claim}: ${r.evidence} evidence, ${r.fringe} fringe${r.topUrls.length ? ` — ${r.topUrls.join(", ")}` : ""}`).join("\n")}
` : ""}
## Failure classification
${report.classification.map((c) => `- \`${c}\``).join("\n")}
`;
  const mdPath = path.join(ARTIFACTS, `tm4_evidence_regression_${TS}.md`);
  await fs.writeFile(mdPath, md);

  console.log(`\n✅ Artifacts:\n   ${jsonPath}\n   ${mdPath}`);
  console.log(`\nClassification: ${report.classification.join(" | ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ FATAL:", e);
  process.exit(1);
});
