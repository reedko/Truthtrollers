import test from "node:test";
import assert from "node:assert/strict";
import { identifyTraceSupport, TRACE_SUPPORT_PROMPT } from "../src/modules/provenance/traceSupport/traceSupportModel.js";

test("Trace Support runtime prompt remains a short contract prompt", () => {
  assert.match(TRACE_SUPPORT_PROMPT, /what source or sources does this document rely on/i);
  assert.match(TRACE_SUPPORT_PROMPT, /If the context does not show one/i);
  assert.ok(TRACE_SUPPORT_PROMPT.length < 500);
});

test("Trace Support preserves the model's cannot-determine result", async () => {
  const llm = { generate: async () => ({ determination: "cannot_determine", explanation: "No source is shown.", sources: [] }) };
  const query = async () => [];
  const result = await identifyTraceSupport({ query, assertion: "Assertion", context: {}, llm });
  assert.deepEqual(result, { determination: "cannot_determine", explanation: "No source is shown.", sources: [] });
});

test("Trace Support accepts an identifier without forcing a display label", async () => {
  const llm = { generate: async () => ({
    determination: "identified", explanation: "A DOI is shown.",
    sources: [{ label: "", url: null, doi: "10.5555/abc", pmid: null, citationText: null, explanation: "Cited inline." }],
  }) };
  const result = await identifyTraceSupport({ query: async () => [], assertion: "Assertion", context: {}, llm });
  assert.equal(result.sources[0].label, "10.5555/abc");
});
