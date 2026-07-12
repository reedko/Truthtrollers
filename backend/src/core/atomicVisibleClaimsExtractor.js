/**
 * atomicVisibleClaimsExtractor.js
 *
 * Phase 1 local extraction: produce atomic visible claims with sourceSentenceIds.
 * No evidence. No final targets. No synthesis. No persistence.
 * Minimal metadata for deterministic Phase 3 targetization.
 */

import { openAiLLM } from "./openAiLLM.js";
import SectionSentenceIndexer from "./sectionSentenceIndexer.js";

export class AtomicVisibleClaimsExtractor {
  constructor(llmObject, options = {}) {
    this.llm = llmObject || openAiLLM;
    this.sentenceIndexer = new SectionSentenceIndexer(options);

    this.llmConfig = {
      model: options.model || "gpt-4o-mini",
      temperature: options.temperature ?? 0.1,  // Lower temp for atomic extraction
      timeoutMs: options.timeoutMs ?? 120000,
      maxRetries: options.maxRetries ?? 1,
      maxClaims: options.maxClaims ?? 7,
      // Optional raw-response capture hook (test/preview runs only).
      captureRaw: typeof options.captureRaw === "function" ? options.captureRaw : null,
    };

    // Article-level stance context, injected into every section prompt.
    // Configurable per article — callers pass the title and a frame hint
    // describing the article's rhetorical posture (e.g., "challenges
    // public-health messaging"). Empty strings omit the blocks entirely.
    this.articleContext = {
      articleTitle: options.articleTitle || "",
      articleFrameHint: options.articleFrameHint || "",
    };

    this.diagnostics = {
      sectionsProcessed: 0,
      totalVisibleClaims: 0,
      totalOpenAICalls: 0,
      sentenceIndexingFailures: [],
      canonicalExcerptRebuildRate: 0,
      sourceSentenceIdValidationRate: 0,
      completeSentenceRate: 0,
      atomicityPassRate: 0,
      attributionWrappedClaims: 0,
      embeddedSubstantiveClaimRate: 0,
      scoreTransformCounts: { normal: 0, invert: 0, none: 0, review: 0 },
      warrantHintRate: 0,
    };
  }

  /**
   * Extract atomic visible claims from a single section.
   */
  async extractFromSection(sectionIndex, sectionText, sectionHeading = "") {
    // Split section into numbered sentences
    const { numberedText, sentences } = this.sentenceIndexer.createNumberedText(sectionText);

    // Prepare LLM prompt
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.getUserPrompt(sectionHeading, numberedText);

    try {
      const llmResult = await this.llm.generate({
        system: systemPrompt,
        user: userPrompt,
        temperature: this.llmConfig.temperature,
        maxRetries: this.llmConfig.maxRetries,
        timeout: this.llmConfig.timeoutMs,
      });

      this.diagnostics.totalOpenAICalls++;
      // Optional raw-response capture (test/preview runs): records prompts and
      // the raw pre-parse response, plus parse/acceptance outcome, so parse
      // and validation failures are fully reconstructable.
      const capture = (outcome) => this.llmConfig.captureRaw?.("phase1_atomic_extraction", {
        sectionIndex,
        sectionHeading,
        model: this.llmConfig.model,
        temperature: this.llmConfig.temperature,
        systemPrompt,
        userPrompt,
        ...outcome,
      }, llmResult);

      // Parse result
      let parsed;
      try {
        parsed = typeof llmResult === "string" ? JSON.parse(llmResult) : llmResult;
      } catch (e) {
        capture({ parseStatus: "parse_failure", parseError: e.message });
        return {
          sectionIndex,
          sectionHeading,
          localTheme: { label: "", summary: "", signals: [] },
          visibleClaims: [],
          warnings: [`JSON parse error: ${e.message}`],
          diagnostics: { parseFailure: true },
        };
      }

      // Post-process: validate and rebuild excerpts
      const processedClaims = this.postProcessVisibleClaims(
        parsed.visibleClaims || [],
        sectionText,
        sentences
      );
      capture({
        parseStatus: "ok",
        acceptedClaimCount: processedClaims.length,
        rejectedClaimCount: Math.max(0, (parsed.visibleClaims || []).length - processedClaims.length),
      });

      return {
        sectionIndex,
        sectionHeading,
        localTheme: parsed.localTheme || { label: "", summary: "", signals: [] },
        visibleClaims: processedClaims,
        warnings: parsed.warnings || [],
        diagnostics: {
          sentenceCount: sentences.length,
          rawClaimsFromLLM: (parsed.visibleClaims || []).length,
          processedClaims: processedClaims.length,
          canonicalExcerptRebuildFailures: 0,
        },
      };
    } catch (err) {
      return {
        sectionIndex,
        sectionHeading,
        localTheme: { label: "", summary: "", signals: [] },
        visibleClaims: [],
        warnings: [`LLM error: ${err.message}`],
        diagnostics: { llmFailure: true },
      };
    }
  }

  /**
   * Post-process visible claims:
   * - Validate sourceSentenceIds
   * - Rebuild canonical excerpts
   * - Validate atomicity
   * - Track diagnostics
   */
  postProcessVisibleClaims(visibleClaims, sectionText, sentences) {
    const processed = [];

    // Enforce hard cap even if the LLM over-produces
    const capped = visibleClaims.slice(0, this.llmConfig.maxClaims);

    for (const claim of capped) {
      const validation = this.sentenceIndexer.validateSourceSentenceIds(
        claim.sourceSentenceIds,
        sentences
      );

      // Rebuild canonical excerpt
      const canonicalResult = this.sentenceIndexer.rebuildExcerptFromSentenceIds(
        sectionText,
        claim.sourceSentenceIds,
        sentences
      );

      // Validate atomicity (rough: complete sentence + single assertion)
      const isCompleteSentence = claim.visibleClaimText.match(/[.!?]$/) !== null;
      const atomicityPass =
        isCompleteSentence &&
        claim.atomicity?.isAtomic === true &&
        claim.atomicity?.splitRecommended !== true;

      // Track attribution wrapping: claimForm from the LLM is the primary
      // signal; the surface-pattern regex is a fallback for misclassified forms
      const isAttributionWrapped =
        claim.claimForm === "attributed_assertion" ||
        claim.claimForm === "quoted_claim" ||
        claim.visibleClaimText.match(/^(The |According to |[A-Z][a-z]+ )(article|ad|source|claims?|says?|stated?|reports?)/i) !== null;

      const processedClaim = {
        ...claim,
        localSourceExcerpt: canonicalResult.rebuiltFromIds ? canonicalResult.excerpt : (claim.localSourceExcerpt || ""),
        sourceExcerptCharStart: canonicalResult.charStart,
        sourceExcerptCharEnd: canonicalResult.charEnd,
        sourceSentenceIdValidation: {
          valid: validation.valid,
          warnings: validation.warnings,
        },
        canonicalExcerptRebuilt: canonicalResult.rebuiltFromIds,
        isCompleteSentence,
        atomicityPass,
        isAttributionWrapped,
      };

      // Track diagnostics
      if (canonicalResult.rebuiltFromIds) {
        this.diagnostics.canonicalExcerptRebuildRate++;
      }
      if (validation.valid) {
        this.diagnostics.sourceSentenceIdValidationRate++;
      }
      if (isCompleteSentence) {
        this.diagnostics.completeSentenceRate++;
      }
      if (atomicityPass) {
        this.diagnostics.atomicityPassRate++;
      }
      if (isAttributionWrapped) {
        this.diagnostics.attributionWrappedClaims++;
      }
      if (claim.embeddedSubstantiveClaim) {
        this.diagnostics.embeddedSubstantiveClaimRate++;
      }
      if (claim.targetHints?.likelyScoreTransform) {
        const transform = claim.targetHints.likelyScoreTransform;
        if (this.diagnostics.scoreTransformCounts[transform] !== undefined) {
          this.diagnostics.scoreTransformCounts[transform]++;
        }
      }
      if (claim.warrantHint && claim.warrantHint.length > 0) {
        this.diagnostics.warrantHintRate++;
      }

      processed.push(processedClaim);
    }

    // Diagnostics fields accumulate raw counts across sections;
    // the audit runner computes rates from per-claim flags.
    this.diagnostics.totalVisibleClaims += processed.length;

    return processed;
  }

  /**
   * System prompt - extract atomic visible claims.
   */
  getSystemPrompt() {
    return `Extract atomic visible claims from the numbered section text.

A visible claim is what the article explicitly says.
- Must be a complete sentence.
- Must be understandable without the full article.
- Must be one factual assertion (prefer splitting over vague compounds).
- Preserve attribution if it matters (e.g., "X claims Y" vs "Y").

Extract ONLY high-value claims. A claim qualifies only if it is:
1. central to the article's thesis or a pillar of its argument
2. likely to become an evidence target
3. needed to understand an opponent/ad/source claim the article rejects
4. a named allegation, named study/document/law, statistic, causal/safety claim, legal/policy claim, data-integrity claim, or institutional-action claim
5. essential background for a later target

Do NOT extract:
- Transitions or article previews
- Rhetorical framing
- Repeated restatements of earlier claims
- Vague topic claims or summaries ("The article discusses vaccine safety")
- Descriptive setup unless it bears on the argument
- Attribution-only claims, unless the speaker/source identity matters or there is an embedded substantive claim
- Final editorial conclusions, broad topic labels, evidence, verdicts, or scoring

Prefer 3-5 strong atomic visible claims per section. HARD CAP: 7 claims.
Extract fewer if the section has fewer argument-bearing claims. Quality over coverage.

ARTICLE STANCE RULES:
- The user message begins with an ARTICLE TITLE and ARTICLE FRAME HINT describing the article's overall rhetorical posture. Use them to decide articleUse — the section alone is often misleading.
- When a section contains a public-health assurance, advertisement claim, official reassurance, or safety slogan that the article is examining critically, classify it as articleUse: used_as_opponent_claim with likelyScoreTransform: invert. Use review if unsure.
- Do NOT mark such claims endorsed_by_article merely because they appear in the section. A quoted section heading stating an official position is usually an opponent claim, not the article's own view.
- Claims the article presents as its OWN evidence or allegation remain endorsed_by_article with likelyScoreTransform: normal (e.g., the article alleging a law removed liability from drug companies, a whistleblower revealed data manipulation, or injected aluminum bypasses digestive protections).
- review is allowed: use it whenever the section plus the frame hint is still insufficient to decide.

ATTRIBUTION/SUBSTANCE RULES:
- NEVER rewrite visibleClaimText to add attribution. Keep it close to the article's explicit text. Attribution lives in the metadata fields.
- If the sentence explicitly says "X says Y" ("the ad says Y", "the CDC claims Y", "the study claims Y", etc.):
  - Set claimForm to attributed_assertion or quoted_claim.
  - Put Y in embeddedSubstantiveClaim.
  - Set speakerOrSource to identify X.
  - Set needsAttributionTarget true if verifying that X said Y may matter.
  - Set needsSubstantiveTarget true if Y is the article-relevant proposition.
- QUOTED SLOGANS WITH IMPLIED SOURCES: if a claim appears as a quoted slogan, section heading, ad/public-health reassurance, CDC reassurance, or official messaging claim that the article is examining critically — even when the sentence is a bare assertion with no "X says" — the attribution still belongs in metadata:
  - Keep visibleClaimText as the article's explicit text; do NOT rewrite it as "X claims Y".
  - Set claimForm to quoted_claim (or attributed_assertion).
  - Set articleUse to used_as_opponent_claim.
  - Set speakerOrSource to the implied source, e.g. "public health messaging", "JCPH ad", "CDC/public health authorities", "official vaccine-safety messaging".
  - Set embeddedSubstantiveClaim to the underlying proposition Y.
  - Set needsAttributionTarget true if verifying the source/speaker matters.
  - Set needsSubstantiveTarget true.
  - Set likelyScoreTransform to invert.
- EXAMPLE (quoted slogan, correct output):
  Source sentence: "The type of mercury in vaccines – ethylmercury – is NOT harmful to us."
  {
    "visibleClaimText": "The type of mercury in vaccines – ethylmercury – is NOT harmful to us.",
    "claimForm": "quoted_claim",
    "articleUse": "used_as_opponent_claim",
    "speakerOrSource": "public health messaging",
    "embeddedSubstantiveClaim": "The type of mercury in vaccines, ethylmercury, is not harmful to humans.",
    "targetHints": { "needsAttributionTarget": true, "needsSubstantiveTarget": true, "likelyScoreTransform": "invert" }
  }
  The same pattern applies to slogans like:
  - "So far, there have been no credible studies that link vaccination to chronic disease." → embeddedSubstantiveClaim: "There are no credible studies linking vaccination to chronic disease."
  - "Vaccines are tested more than any other medicine you could give your kid." → embeddedSubstantiveClaim: "Vaccines are tested more than any other medicine given to children."
- Direct claims the article asserts as its OWN (e.g., "Aluminum can cross the blood-brain barrier") are NOT attribution-wrapped: use direct_assertion (or causal/statistical/etc.) and leave embeddedSubstantiveClaim empty.

SCORE TRANSFORM HINT (targetHints.likelyScoreTransform):
- normal: evidence supporting the object/substantive claim would STRENGTHEN the article's argument.
- invert: the article presents the object/substantive claim as an opponent/ad/source claim to criticize or refute; evidence supporting that object claim would WEAKEN the article.
- none: use ONLY when evidence about the claim should not directly affect the article score: attribution-only provenance, neutral background, article structure/setup, claim existence without substantive argument role, or source description that does not carry the argument.
- review: the local section is insufficient to decide.

IMPORTANT: Do NOT use "none" merely because a claim is lower priority.
If needsSubstantiveTarget is true, likelyScoreTransform should usually be normal, invert, or review — not none — unless articleUse is clearly neutral/background.

EVALUATION LANE HINT (evaluationLaneHint):
- candidate: may become a later evidence/evaluation target
- context: useful background, not likely a final evidence target
- ignore: extracted only for local structure/provenance; should not continue unless needed
Most extracted claims should be candidate — if a claim would be ignore, usually just don't extract it.

WARRANT HINTS:
- DO write a brief warrantHint for: opponent claims (used_as_opponent_claim), thesis/pillar claims, misconduct claims, causal claims, study claims, legal/policy claims, and safety claims.
- Do NOT write warrantHint for neutral context/background claims — leave it "".

Keep all string fields brief. Return valid JSON only.`;
  }

  /**
   * User prompt template.
   */
  getUserPrompt(sectionHeading, numberedText) {
    const contextBlocks = [];
    if (this.articleContext.articleTitle) {
      contextBlocks.push(`ARTICLE TITLE:\n${this.articleContext.articleTitle}`);
    }
    if (this.articleContext.articleFrameHint) {
      contextBlocks.push(`ARTICLE FRAME HINT:\n${this.articleContext.articleFrameHint}`);
    }
    const contextPrefix = contextBlocks.length > 0 ? contextBlocks.join("\n\n") + "\n\n" : "";

    return `${contextPrefix}Section: ${sectionHeading || "(no heading)"}

Numbered sentences:
${numberedText}

Extract only checkable, argument-relevant atomic visible claims. Return:
{
  "localTheme": {
    "label": "inferred section theme",
    "summary": "one-sentence summary",
    "signals": ["repeated term", "key allegation", "named entity"]
  },
  "visibleClaims": [
    {
      "visibleClaimText": "complete sentence",
      "sourceSentenceIds": [1, 2],
      "claimForm": "direct_assertion|attributed_assertion|quoted_claim|statistical_claim|study_claim|legal_policy_claim|causal_claim|comparison_claim|background_claim",
      "articleUse": "endorsed_by_article|rejected_by_article|reported_neutrally|used_as_opponent_claim|used_as_background|unclear",
      "atomicity": {
        "isAtomic": true,
        "splitRecommended": false,
        "splitReason": ""
      },
      "embeddedSubstantiveClaim": "",
      "speakerOrSource": "",
      "namedActors": [],
      "namedOrganizations": [],
      "namedStudiesOrDocuments": [],
      "namedLawsOrPolicies": [],
      "namedSubstancesOrProducts": [],
      "numbersOrStatistics": [],
      "searchText": "searchable terms",
      "targetHints": {
        "needsAttributionTarget": false,
        "needsSubstantiveTarget": false,
        "needsStudyIdentityTarget": false,
        "needsInferenceTarget": false,
        "likelyScoreTransform": "normal|invert|none|review",
        "why": "brief"
      },
      "evaluationLaneHint": "candidate|context|ignore",
      "warrantHint": "",
      "confidence": 0.95
    }
  ],
  "warnings": []
}

Extract at most ${this.llmConfig.maxClaims} claims (prefer 3-5 strong ones; fewer is fine if the section has fewer argument-bearing claims). Maximize atomicity.`;
  }
}

export default AtomicVisibleClaimsExtractor;
