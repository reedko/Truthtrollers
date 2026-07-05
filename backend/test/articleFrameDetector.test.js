import test from "node:test";
import assert from "node:assert/strict";
import { detectArticleFrame, logArticleFrameSeeded } from "../src/core/articleFrameDetector.js";

// Mock LLM that returns a valid frame
const mockLLM = {
  async generate({ system, user, schemaHint, temperature }) {
    return {
      provisionalThesis: "The climate crisis is accelerating faster than predicted models.",
      provisionalStance: "endorses",
      likelyPillars: [
        "Recent temperature increases exceed 1.5°C threshold",
        "Ocean acidification is rising at unprecedented rates",
        "Arctic ice melt is accelerating"
      ],
      likelyOpposingClaims: [
        "Some argue natural cycles cause observed changes"
      ],
      namedAnchors: [
        { type: "organization", name: "IPCC" },
        { type: "person", name: "Dr. Michael Mann" },
        { type: "location", name: "Arctic" }
      ],
      openQuestions: [
        "What are the policy implications?",
        "How do we transition energy systems?"
      ],
      seedConfidence: 0.85
    };
  }
};

test("detectArticleFrame returns null for empty text", async () => {
  const result = await detectArticleFrame({
    llm: mockLLM,
    text: "",
  });
  assert.equal(result, null);
});

test("detectArticleFrame returns null when no LLM provided", async () => {
  const result = await detectArticleFrame({
    llm: null,
    text: "Some article text",
  });
  assert.equal(result, null);
});

test("detectArticleFrame returns validated frame with all fields", async () => {
  const sampleText = "The climate crisis is accelerating. Scientists warn that we have less than a decade to act. Recent data shows unprecedented warming across the globe.";

  const result = await detectArticleFrame({
    llm: mockLLM,
    text: sampleText,
    title: "Climate Crisis Accelerates",
    byline: "By Dr. Jane Smith",
    date: "2025-07-05",
    headings: ["Overview", "Causes", "Solutions"]
  });

  assert.ok(result, "Should return a frame object");
  assert.equal(typeof result.provisionalThesis, "string");
  assert.ok(result.provisionalThesis.length > 0);
  assert.ok(["endorses", "rejects", "mixed", "unclear"].includes(result.provisionalStance));
  assert.ok(Array.isArray(result.likelyPillars));
  assert.ok(Array.isArray(result.likelyOpposingClaims));
  assert.ok(Array.isArray(result.namedAnchors));
  assert.ok(Array.isArray(result.openQuestions));
  assert.equal(typeof result.seedConfidence, "number");
  assert.ok(result.seedConfidence >= 0 && result.seedConfidence <= 1);
});

test("detectArticleFrame validates stance values", async () => {
  const mockInvalidStanceLLM = {
    async generate() {
      return {
        provisionalThesis: "Test thesis",
        provisionalStance: "invalid_stance", // Should be normalized to "unclear"
        likelyPillars: [],
        likelyOpposingClaims: [],
        namedAnchors: [],
        openQuestions: [],
        seedConfidence: 0.5
      };
    }
  };

  const result = await detectArticleFrame({
    llm: mockInvalidStanceLLM,
    text: "Some article text here with enough content",
  });

  assert.equal(result.provisionalStance, "unclear");
});

test("detectArticleFrame normalizes array fields", async () => {
  const mockPartialLLM = {
    async generate() {
      return {
        provisionalThesis: "Test thesis",
        provisionalStance: "mixed",
        likelyPillars: "not an array", // Should be converted to []
        likelyOpposingClaims: null, // Should be converted to []
        namedAnchors: [{ type: "person", name: "John" }, null], // Should filter nulls
        openQuestions: ["Q1", "Q2"],
        seedConfidence: 0.7
      };
    }
  };

  const result = await detectArticleFrame({
    llm: mockPartialLLM,
    text: "Sample text",
  });

  assert.ok(Array.isArray(result.likelyPillars));
  assert.ok(Array.isArray(result.likelyOpposingClaims));
  assert.equal(result.namedAnchors.length, 1); // null filtered out
  assert.equal(result.namedAnchors[0].name, "John");
});

test("detectArticleFrame returns null when LLM returns invalid response", async () => {
  const mockFailLLM = {
    async generate() {
      return null; // Invalid: not an object
    }
  };

  const result = await detectArticleFrame({
    llm: mockFailLLM,
    text: "Some article text",
  });

  assert.equal(result, null);
});

test("detectArticleFrame enforces confidence bounds", async () => {
  const mockOutOfBoundsLLM = {
    async generate() {
      return {
        provisionalThesis: "Test thesis",
        provisionalStance: "endorses",
        likelyPillars: [],
        likelyOpposingClaims: [],
        namedAnchors: [],
        openQuestions: [],
        seedConfidence: 2.5 // Out of bounds, should be clamped to 1.0
      };
    }
  };

  const result = await detectArticleFrame({
    llm: mockOutOfBoundsLLM,
    text: "Sample text",
  });

  assert.equal(result.seedConfidence, 1.0);
});

test("logArticleFrameSeeded does not throw when frame is null", () => {
  assert.doesNotThrow(() => {
    logArticleFrameSeeded(null);
  });
});

test("logArticleFrameSeeded handles valid frame", () => {
  assert.doesNotThrow(() => {
    logArticleFrameSeeded({
      provisionalThesis: "Test thesis",
      provisionalStance: "endorses",
      likelyPillars: ["Pillar 1"],
      likelyOpposingClaims: [],
      namedAnchors: [],
      openQuestions: [],
      seedConfidence: 0.8
    });
  });
});
