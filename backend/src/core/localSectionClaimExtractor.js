/**
 * localSectionClaimExtractor.js
 *
 * Audit-only module for extracting local claims from semantic sections.
 *
 * Responsibilities:
 * - Load extraction prompts (from DB via PromptManager or hardcoded fallback)
 * - Run LLM extraction on article sections
 * - Return local extraction records without Phase 2, evidence, or persistence
 * - Track diagnostics: parse failures, timeouts, prompt source
 *
 * Usage:
 * const extractor = new LocalSectionClaimExtractor(llm, options);
 * const result = await extractor.extractFromSections(articleTitle, sections);
 * // Returns: { sectionResults, diagnostics }
 *
 * Design: PromptManager-compatible but gracefully falls back to hardcoded prompts.
 */

export class LocalSectionClaimExtractor {
  constructor(llm, options = {}) {
    this.llm = llm;
    this.promptSource = options.promptSource || "hardcoded"; // "hardcoded" or "db"
    this.promptManager = options.promptManager || null;
    this.fallbackOnError = options.fallbackOnError ?? true;

    this.llmConfig = {
      model: options.model || "gpt-4o-mini",
      temperature: options.temperature ?? 0.3,
      timeoutMs: options.timeoutMs ?? 60000,
      maxRetries: options.maxRetries ?? 1,
      maxClaims: options.maxClaims ?? 12,
    };

    this.systemPrompt = options.systemPrompt || this.getHardcodedSystemPrompt();
    this.userPromptTemplate = options.userPromptTemplate || this.getHardcodedUserPromptTemplate();

    this.diagnostics = {
      sectionsProcessed: 0,
      totalOpenAICalls: 0,
      parseFailures: [],
      timeouts: [],
      promptSourceUsed: this.promptSource,
    };
  }

  /**
   * Extract claims from all sections.
   */
  async extractFromSections(articleTitle, sections, provisionalFrame = "") {
    const sectionResults = [];

    for (const section of sections) {
      const result = await this.extractFromSection(
        articleTitle,
        section,
        sections.length,
        provisionalFrame
      );
      sectionResults.push(result);
    }

    this.diagnostics.sectionsProcessed = sections.length;

    return {
      sectionResults,
      diagnostics: this.diagnostics,
    };
  }

  /**
   * Extract claims from a single section.
   */
  async extractFromSection(articleTitle, section, totalSections, provisionalFrame = "") {
    const user = this.userPromptTemplate
      .replace("{{articleTitle}}", articleTitle)
      .replace("{{provisionalFrame}}", provisionalFrame)
      .replace("{{sectionIndex}}", String(section.sectionIndex + 1))
      .replace("{{sectionCount}}", String(totalSections))
      .replace("{{sectionText}}", section.fullText);

    try {
      // Run LLM call
      const out = await this.llm.generate({
        system: this.systemPrompt,
        user,
        schemaHint: '{"localTheme":{},"claims":[],"warnings":[]}',
        temperature: this.llmConfig.temperature,
        maxRetries: this.llmConfig.maxRetries,
        timeout: this.llmConfig.timeoutMs,
      });

      this.diagnostics.totalOpenAICalls++;

      // Parse response
      let parsed = null;
      try {
        parsed = typeof out === "string" ? JSON.parse(out) : out;
      } catch (parseErr) {
        this.diagnostics.parseFailures.push({
          sectionIndex: section.sectionIndex,
          error: parseErr.message,
          rawSnippet: typeof out === "string" ? out.substring(0, 200) : String(out).substring(0, 200),
        });

        parsed = {
          localTheme: { label: "parse_failure", signals: [] },
          claims: [],
          warnings: [`Parse failure: ${parseErr.message}`],
        };
      }

      // Normalize result
      const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
      const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];

      return {
        sectionIndex: section.sectionIndex,
        sectionCharCount: section.charCount,
        sectionText: section.fullText.substring(0, 500),
        localTheme: parsed.localTheme || { label: "", summary: "", signals: [] },
        claims: claims.slice(0, this.llmConfig.maxClaims).map((c) => ({
          claimText: String(c.claimText || "").trim(),
          localSourceExcerpt: String(c.localSourceExcerpt || "").trim(),
          searchText: String(c.searchText || "").trim(),
        })),
        warnings,
        rawResponseDiagnostics: {
          parseSuccess: parsed !== null,
          claimCount: claims.length,
        },
      };
    } catch (err) {
      // Timeout or other error
      if (err.message.includes("timeout") || err.message.includes("Timeout")) {
        this.diagnostics.timeouts.push({
          sectionIndex: section.sectionIndex,
          error: err.message,
        });
      }

      return {
        sectionIndex: section.sectionIndex,
        sectionCharCount: section.charCount,
        sectionText: section.fullText.substring(0, 500),
        localTheme: { label: "error", signals: [] },
        claims: [],
        warnings: [`LLM error: ${err.message}`],
        rawResponseDiagnostics: {
          parseSuccess: false,
          error: err.message,
        },
      };
    }
  }

  /**
   * Get hardcoded system prompt (fallback).
   */
  getHardcodedSystemPrompt() {
    return `Extract local theme signals and checkable claims from one article section.

Use only the supplied section. Do not fact-check. Do not use outside knowledge. Do not rank claims. Do not decide final article importance.

The local theme is metadata only. It must not filter claim extraction.

Extract every clear, checkable claim in the section, up to {{maxClaims}}.

Important:
When a section tells a compact story across nearby sentences, preserve the story as a searchable claim if the pieces share the same actor, institution, study, event, or allegation.

Do not reduce a multi-sentence allegation to a minor fragment.

Bad:
"X saved documents."

Better:
"X saved documents after allegedly being ordered to destroy evidence from a study about Y."

Return strict JSON only.`;
  }

  /**
   * Get hardcoded user prompt template (fallback).
   */
  getHardcodedUserPromptTemplate() {
    return `ARTICLE TITLE:
{{articleTitle}}

PROVISIONAL ARTICLE FRAME:
{{provisionalFrame}}

SECTION INDEX:
{{sectionIndex}} / {{sectionCount}}

SECTION TEXT:
{{sectionText}}

Return exactly:

{
  "localTheme": {
    "label": "",
    "summary": "",
    "signals": []
  },
  "claims": [
    {
      "claimText": "",
      "localSourceExcerpt": "",
      "searchText": ""
    }
  ],
  "warnings": []
}

Rules:

* localSourceExcerpt must be exact text copied from the section.
* claimText must be self-contained and searchable.
* If attribution matters, include who made the claim or disclosure.
* If the claim involves an alleged institutional action, include the actor, action, object acted on, and study/data/document clues.
* searchText should preserve names, organizations, studies, dates, actions, outcomes, and distinctive terms.
* signals should list local repeated ideas, named anchors, disputed concepts, or institutional patterns.
* Do not output more than {{maxClaims}} claims.
* Return only valid JSON.`;
  }
}

export default LocalSectionClaimExtractor;
