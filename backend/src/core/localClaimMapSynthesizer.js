/**
 * localClaimMapSynthesizer.js
 *
 * Reusable module for Phase 2 article claim-map synthesis.
 *
 * Responsibilities:
 * - Accept local extraction results from semantic sections or fixed chunks
 * - Validate and normalize local claim records
 * - Build deterministic claim clusters for synthesis guidance
 * - Infer article theme from local claims and themes
 * - Group claims into article pillars
 * - Synthesize complex evaluation candidates from related claims
 * - Preserve source claim indexes and localSourceExcerpt values
 * - Track provenance warnings
 * - Return claim map without evidence, persistence, or reducer calls
 *
 * Usage:
 * const synthesizer = new LocalClaimMapSynthesizer(llm, options);
 * const result = await synthesizer.synthesize(articleTitle, compactClaims, fullClaimsForExcerpts);
 * // Returns: { articleTheme, pillars, claimAssignments, synthesizedClaims, diagnostics }
 */

import { buildDeterministicClaimClusters } from "./deterministicClaimClustering.js";

export class LocalClaimMapSynthesizer {
  constructor(llm, options = {}) {
    this.llm = llm;
    this.promptSource = options.promptSource || "hardcoded";
    this.promptManager = options.promptManager || null;
    this.fallbackOnError = options.fallbackOnError ?? true;

    this.llmConfig = {
      model: options.model || "gpt-4o-mini",
      temperature: options.temperature ?? 0.2,
      timeoutMs: options.timeoutMs ?? 90000,
      maxRetries: options.maxRetries ?? 1,
      // Optional raw-response capture hook (test/preview runs only).
      captureRaw: typeof options.captureRaw === "function" ? options.captureRaw : null,
    };

    this.systemPrompt = options.systemPrompt || this.getHardcodedSystemPrompt();
    this.userPromptTemplate = options.userPromptTemplate || this.getHardcodedUserPromptTemplate();

    this.diagnostics = {
      localClaimsProcessed: 0,
      totalOpenAICalls: 0,
      parseFailures: [],
      provenanceChecks: {
        exactMatches: 0,
        normalizedMatches: 0,
        entityMatches: 0,
        failures: 0,
      },
      promptSourceUsed: this.promptSource,
    };
  }

  /**
   * Synthesize article claim map from local extraction results.
   * Accepts compact claims for LLM and keeps full claims for excerpt reattachment.
   */
  async synthesize(articleTitle, compactClaims, fullClaimsForExcerpts = null) {
    // If we have full claims, create lookup map for excerpts and for validation
    const excerptLookup = {};
    let validationClaims = [];

    if (fullClaimsForExcerpts && Array.isArray(fullClaimsForExcerpts)) {
      for (const claim of fullClaimsForExcerpts) {
        excerptLookup[claim.claimIndex] = claim.localSourceExcerpt || "";
      }
      // Normalize full claims for validation
      validationClaims = this.normalizeLocalClaims(fullClaimsForExcerpts);
      this.diagnostics.localClaimsProcessed = validationClaims.length;
    } else {
      // Fallback if no full claims provided
      validationClaims = this.normalizeLocalClaims(compactClaims);
      this.diagnostics.localClaimsProcessed = validationClaims.length;
    }

    // Build deterministic clusters from compact claims
    const clusterResult = buildDeterministicClaimClusters(compactClaims);
    this.diagnostics.deterministicClusters = clusterResult.clusters;
    this.diagnostics.clusterDiagnostics = clusterResult.diagnostics;

    // Build LLM payload with claims and compacted clusters (for token efficiency)
    const llmClusters = clusterResult.clusters.map(c => ({
      clusterId: c.clusterId,
      clusterLabel: c.clusterLabel,
      anchors: c.anchors.slice(0, 3),  // Only top 3 anchors
      claimIndexes: c.claimIndexes,
      clusterScore: c.clusterScore,
    }));

    const llmPayload = {
      claims: compactClaims,
      deterministicClusters: llmClusters,
    };

    const localClaimsJson = JSON.stringify(llmPayload, null, 2);

    // Prepare prompt
    const user = this.userPromptTemplate
      .replace("{{articleTitle}}", articleTitle)
      .replace("{{localClaimsJson}}", localClaimsJson);

    try {
      // Run LLM call
      const out = await this.llm.generate({
        system: this.systemPrompt,
        user,
        schemaHint: '{"articleTheme":{},"pillars":[],"claimAssignments":[],"synthesizedClaims":[],"warnings":[]}',
        temperature: this.llmConfig.temperature,
        maxRetries: this.llmConfig.maxRetries,
        timeout: this.llmConfig.timeoutMs,
      });

      this.diagnostics.totalOpenAICalls++;
      // Optional raw-response capture (test/preview runs): records prompts and
      // the raw pre-parse response, plus parse outcome.
      const capture = (outcome) => this.llmConfig.captureRaw?.("phase2_claim_map_synthesis", {
        articleTitle,
        model: this.llmConfig.model,
        temperature: this.llmConfig.temperature,
        systemPrompt: this.systemPrompt,
        userPrompt: user,
        ...outcome,
      }, out);

      // Parse response
      let parsed = null;
      let parseFailed = null;
      try {
        parsed = typeof out === "string" ? JSON.parse(out) : out;
      } catch (parseErr) {
        parseFailed = parseErr;
        this.diagnostics.parseFailures.push({
          error: parseErr.message,
          rawSnippet: typeof out === "string" ? out.substring(0, 200) : String(out).substring(0, 200),
        });

        parsed = {
          articleTheme: { thesis: "", summary: "", dominantSignals: [] },
          pillars: [],
          claimAssignments: [],
          synthesizedClaims: [],
          warnings: [`Parse failure: ${parseErr.message}`],
        };
      }
      capture(parseFailed
        ? { parseStatus: "parse_failure", parseError: parseFailed.message }
        : { parseStatus: "ok", acceptedClaimCount: (parsed.claimAssignments || []).length });

      // Validate and reattach excerpts to synthesized claims
      let synthesizedClaims = parsed.synthesizedClaims || [];

      // Reattach full source excerpts from original claims using lookup
      for (const synth of synthesizedClaims) {
        const sourceIndexes = synth.sourceClaimIndexes || [];
        const reattachedExcerpts = sourceIndexes
          .filter(idx => idx >= 0 && idx in excerptLookup)
          .map(idx => excerptLookup[idx])
          .filter(e => e && e.length > 0);

        synth.sourceExcerpts = reattachedExcerpts;
      }

      const validatedSynthesized = this.validateSynthesizedClaims(
        synthesizedClaims,
        validationClaims
      );

      return {
        articleTheme: parsed.articleTheme || { thesis: "", summary: "", dominantSignals: [] },
        pillars: parsed.pillars || [],
        claimAssignments: parsed.claimAssignments || [],
        synthesizedClaims: validatedSynthesized,
        warnings: parsed.warnings || [],
        diagnostics: this.diagnostics,
      };
    } catch (err) {
      return {
        articleTheme: { thesis: "", summary: "", dominantSignals: [] },
        pillars: [],
        claimAssignments: [],
        synthesizedClaims: [],
        warnings: [`LLM error: ${err.message}`],
        diagnostics: this.diagnostics,
      };
    }
  }

  /**
   * Normalize local claims with smart provenance handling.
   *
   * Phase 1 claims have full unit text and provenance data.
   * Phase 2 compact claims may not have unit text.
   *
   * Strategy:
   * - If Phase 1 provenance fields exist, preserve them (don't recompute)
   * - If unit text exists, recompute validation
   * - If no unit text, mark as not_revalidated
   */
  normalizeLocalClaims(localClaims) {
    const normalized = [];
    let claimIndex = 0;

    for (const claim of localClaims) {
      const provenanceWarnings = [];
      const unitText = claim.sectionText || claim.unitText || "";
      const excerpt = claim.localSourceExcerpt || "";

      let excerptExactMatch = false;
      let excerptNormalizedMatch = false;
      let provenanceStatus = "unknown";

      // Strategy 1: Preserve Phase 1 provenance if present
      if (claim.excerptExactMatch !== undefined || claim.excerptNormalizedMatch !== undefined || (claim.provenanceWarnings && claim.provenanceWarnings.length > 0)) {
        excerptExactMatch = claim.excerptExactMatch ?? false;
        excerptNormalizedMatch = claim.excerptNormalizedMatch ?? false;
        provenanceStatus = "inherited_from_phase1";
        provenanceWarnings.push(...(claim.provenanceWarnings || []));

        if (excerptExactMatch) this.diagnostics.provenanceChecks.exactMatches++;
        if (excerptNormalizedMatch && !excerptExactMatch) this.diagnostics.provenanceChecks.normalizedMatches++;
      }
      // Strategy 2: Recompute if unit text is available
      else if (unitText && excerpt) {
        if (unitText.includes(excerpt)) {
          excerptExactMatch = true;
          provenanceStatus = "revalidated_in_phase2";
          this.diagnostics.provenanceChecks.exactMatches++;
        } else {
          const normalizedExcerpt = excerpt.replace(/\s+/g, " ").trim();
          const normalizedText = unitText.replace(/\s+/g, " ");

          if (normalizedText.includes(normalizedExcerpt)) {
            excerptNormalizedMatch = true;
            provenanceStatus = "revalidated_in_phase2";
            this.diagnostics.provenanceChecks.normalizedMatches++;
            provenanceWarnings.push("excerpt_normalized_match");
          } else {
            const quoteFixes = normalizedExcerpt.replace(/[""]/g, '"').replace(/['']/g, "'");
            if (normalizedText.replace(/[""]/g, '"').replace(/['']/g, "'").includes(quoteFixes)) {
              excerptNormalizedMatch = true;
              provenanceStatus = "revalidated_in_phase2";
              this.diagnostics.provenanceChecks.entityMatches++;
              provenanceWarnings.push("excerpt_entity_normalized_match");
            } else {
              provenanceStatus = "revalidated_in_phase2";
              this.diagnostics.provenanceChecks.failures++;
              provenanceWarnings.push("excerpt_not_found_in_unit");
            }
          }
        }
      }
      // Strategy 3: No unit text, no Phase 1 provenance
      else if (!unitText) {
        provenanceStatus = "not_revalidated_in_phase2";
        if (excerpt) provenanceWarnings.push("phase2_missing_unit_text_for_excerpt_validation");
      }

      const normalized_claim = {
        claimIndex,
        unitType: claim.unitType || "semantic_section",
        unitIndex: claim.sectionIndex ?? claim.unitIndex ?? 0,
        unitCharCount: claim.sectionCharCount ?? claim.unitCharCount ?? 0,
        localThemeLabel: claim.localTheme?.label || claim.theme || "",
        localThemeSummary: claim.localTheme?.summary || "",
        claimText: claim.claimText || "",
        localSourceExcerpt: excerpt,
        searchText: claim.searchText || "",
        excerptExactMatch,
        excerptNormalizedMatch,
        provenanceWarnings,
        provenanceStatus,
      };

      normalized.push(normalized_claim);
      claimIndex++;
    }

    return normalized;
  }

  /**
   * Validate synthesized claims.
   */
  validateSynthesizedClaims(synthesized, normalizedClaims) {
    const validated = [];

    for (const claim of synthesized) {
      if (!claim.synthesizedClaimText) continue;

      // Validate source claim indexes
      const sourceIndexes = (claim.sourceClaimIndexes || [])
        .filter(idx => idx >= 0 && idx < normalizedClaims.length);

      // Collect source excerpts
      const sourceExcerpts = sourceIndexes.map(idx => normalizedClaims[idx].localSourceExcerpt);

      // Collect provenance warnings from source claims
      const sourceWarnings = sourceIndexes.flatMap(idx =>
        normalizedClaims[idx].provenanceWarnings || []
      );

      const validatedClaim = {
        synthesizedClaimText: String(claim.synthesizedClaimText).trim(),
        sourceClaimIndexes: sourceIndexes,
        sourceExcerpts: sourceExcerpts.filter(e => e && e.length > 0),
        searchText: String(claim.searchText || claim.synthesizedClaimText).substring(0, 200),
        synthesisType: String(claim.synthesisType || "other"),
        reasonForSynthesis: String(claim.reasonForSynthesis || ""),
        provenanceWarnings: sourceWarnings,
      };

      validated.push(validatedClaim);
    }

    return validated;
  }

  /**
   * Get hardcoded system prompt (fallback).
   */
  getHardcodedSystemPrompt() {
    return `Build article-level claim map from locally extracted claims and their deterministic clusters.

Tasks:
1. Infer central theme and 4+ pillars
2. Assign every claim to pillar + role (use background/unclear for non-pillar claims)
3. Synthesize 8-24 evaluation candidates, primarily from deterministic clusters

Synthesis strategy - PRIMARY FOCUS ON CLUSTERS:
- deterministicClusters are pre-built from shared anchor terms (names, orgs, studies, substances, years).
- For each cluster with 2+ claims and specific anchors, CREATE 1-2 synthesized evaluation candidates.
- If cluster has 3+ claims, prefer creating 2 synthesized claims with different angles.
- Synthesized claim must cite all or most claims in the cluster.
- Preserve all anchor terms from the cluster in the synthesized text.
- You MUST synthesize from clusters to reach 8-24 candidates.

Do not fact-check, score reliability, output verdicts, search for evidence. Use only supplied claims.
Return strict JSON only.`;
  }

  /**
   * Get hardcoded user prompt template (fallback).
   */
  getHardcodedUserPromptTemplate() {
    return `TITLE: {{articleTitle}}

DATA: {{localClaimsJson}}

BUILD: theme + 4+ pillars + 8-24 synthesized + assign ALL claims.

PRIMARY SYNTHESIS FROM CLUSTERS:
- Review deterministicClusters in data (top clusters sorted by score).
- For each cluster with 2+ claims:
  * If 2 claims: synthesize 1 evaluation candidate combining both
  * If 3+ claims: synthesize 1-2 evaluation candidates with different angles
- Include ALL anchor terms from cluster in synthesized text.
- Each sourceClaimIndexes must include 2+ claims from the cluster.
- Reach 8-24 total synthesized claims by covering 8+ clusters.

ASSIGNMENT:
- Assign every claim to pillar + role (pillar|support|background|unclear).

Return: {
  "articleTheme": {"thesis": "", "summary": "", "dominantSignals": []},
  "pillars": [{"pillarId": "P1", "pillarText": "", "pillarSummary": "", "supportingClaimIndexes": [0], "themeSignals": []}],
  "claimAssignments": [{"claimIndex": 0, "pillarId": "P1", "articleRole": "pillar", "reason": ""}],
  "synthesizedClaims": [{"synthesizedClaimText": "", "sourceClaimIndexes": [1, 2], "sourceExcerpts": [], "searchText": "", "synthesisType": "cluster_based|other", "reasonForSynthesis": "", "provenanceWarnings": []}],
  "warnings": []
}

MUST: 8-24 synthesized claims primarily from clusters, all claims assigned, 4+ pillars.

JSON.`;
  }
}

export default LocalClaimMapSynthesizer;
