import { openAiLLM } from "../../../core/openAiLLM.js";
import PromptManager from "../../../core/promptManager.js";

export const TRACE_SUPPORT_PROMPT = `Based on the document context, what source or sources does this document rely on as evidence for the assertion below?

Identify them and briefly explain the link. Treat direct PDF links in assertion-relevant citation text as source candidates even when the link does not expose a DOI or journal landing page. Do not assume that a hosted PDF is the canonical scholarly record. If the context does not show one, say so.

ASSERTION:
{{assertion}}

DOCUMENT CONTEXT:
{{documentContext}}`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["determination", "explanation", "sources"],
  properties: {
    determination: { type: "string", enum: ["identified", "cannot_determine"] },
    explanation: { type: "string" },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "url", "doi", "pmid", "citationText", "explanation"],
        properties: {
          label: { type: "string" },
          url: { anyOf: [{ type: "string" }, { type: "null" }] },
          doi: { anyOf: [{ type: "string" }, { type: "null" }] },
          pmid: { anyOf: [{ type: "string" }, { type: "null" }] },
          citationText: { anyOf: [{ type: "string" }, { type: "null" }] },
          explanation: { type: "string" },
        },
      },
    },
  },
};

function render(template, assertion, context) {
  return template
    .replace("{{assertion}}", assertion)
    .replace("{{documentContext}}", JSON.stringify(context, null, 2));
}

export async function identifyTraceSupport({ query, assertion, context, llm = openAiLLM }) {
  const promptManager = new PromptManager(query);
  const prompt = await promptManager.getPrompt("evidence_assertion_trace_support_user", {
    system: "",
    user: TRACE_SUPPORT_PROMPT,
    parameters: {},
  });
  const result = await llm.generate({
    user: render(prompt.user || TRACE_SUPPORT_PROMPT, assertion, context),
    schemaHint: RESPONSE_SCHEMA,
    strictJsonSchema: true,
    model: "gpt-5.4-mini",
    reasoning: { effort: "low" },
    max_output_tokens: 3000,
    api: "responses",
    timeout: 180000,
  });

  const sources = Array.isArray(result?.sources)
    ? result.sources
        .filter((source) => source && [source.label, source.url, source.doi, source.pmid].some((value) => String(value || "").trim()))
        .map((source) => ({ ...source, label: String(source.label || source.doi || source.pmid || source.url).trim() }))
        .slice(0, 6)
    : [];
  if (result?.determination !== "identified" || !sources.length) {
    return {
      determination: "cannot_determine",
      explanation: String(result?.explanation || "No supporting source could be confidently identified from the document."),
      sources: [],
    };
  }
  return {
    determination: "identified",
    explanation: String(result.explanation || ""),
    sources,
  };
}
