import assert from "node:assert/strict";
import test from "node:test";
import type {
  Cf7StructuredProvider,
} from "../../../src/claimfoundry/shared/provider/index.js";
import {
  WHOLE_ARTICLE_BURDEN_PROMPT,
  buildWholeArticleBurdenUserPrompt,
} from "../../../src/claimfoundry/cf7/experiments/wholeArticleBurden/prompt.js";
import {
  DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG,
  runWholeArticleBurdenExperiment,
} from "../../../src/claimfoundry/cf7/experiments/wholeArticleBurden/runExperiment.js";
import {
  WHOLE_ARTICLE_BURDEN_JSON_SCHEMA,
  wholeArticleBurdenOutputSchema,
} from "../../../src/claimfoundry/cf7/experiments/wholeArticleBurden/schema.js";
import type {
  WholeArticleBurdenFrozenInput,
} from "../../../src/claimfoundry/cf7/experiments/wholeArticleBurden/types.js";

const frozen: WholeArticleBurdenFrozenInput = {
  fixture: "CF1-F03",
  fixturePath: "/verified/CF1-F03/article.json",
  fixtureFileSha256: "fixture-hash",
  articleTextSha256: "article-text-hash",
  articleCharacterCount: 24,
  article: {
    title: "Frozen article",
    text: "Complete frozen article.",
  },
};

function output() {
  return {
    propositions: Array.from({ length: 12 }, (_, index) => ({
      assertion: `Assertion ${index + 1}.`,
      assertionSource: `Source ${index + 1}.`,
      whyItMattersToArticleThesis: `Reason ${index + 1}.`,
    })),
  };
}

test("simple prompt is verbatim and followed directly by the complete article", () => {
  assert.equal(
    WHOLE_ARTICLE_BURDEN_PROMPT,
    `Read the article.

Return the 12 propositions that carry the burden of proof for the article.

These are the assertions that, if shown false, would most undermine the article's overall argument.

For each provide:

- Assertion
- Assertion source
- Why it matters to the article's thesis`,
  );
  assert.equal(
    buildWholeArticleBurdenUserPrompt(frozen.article.text),
    `${WHOLE_ARTICLE_BURDEN_PROMPT}\n\n${frozen.article.text}`,
  );
});

test("strict schema requires exactly 12 rows and only three requested fields", () => {
  assert.equal(wholeArticleBurdenOutputSchema.safeParse(output()).success, true);
  assert.equal(wholeArticleBurdenOutputSchema.safeParse({
    propositions: output().propositions.slice(0, 11),
  }).success, false);
  assert.equal(wholeArticleBurdenOutputSchema.safeParse({
    propositions: output().propositions.map((row) => ({
      ...row,
      score: 1,
    })),
  }).success, false);
  assert.equal(
    WHOLE_ARTICLE_BURDEN_JSON_SCHEMA.name,
    "cf7_whole_article_burden_v1",
  );
});

test("runner makes one governed call and preserves response before validation", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const provider: Cf7StructuredProvider = {
    async invokeStructured(request) {
      requests.push(request as unknown as Record<string, unknown>);
      return {
        output: output(),
        rawResponse: { id: "response-1", output: output() },
        model: "gpt-4o-mini",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 100,
          totalTokens: 200,
        },
        responseId: "response-1",
        requestId: null,
      };
    },
  };
  const result = await runWholeArticleBurdenExperiment({
    frozen,
    provider,
    config: { ...DEFAULT_WHOLE_ARTICLE_BURDEN_CONFIG },
    async beforeInvoke() {
      events.push("request");
    },
    async afterResponse() {
      events.push("response-before-validation");
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.providerCallCount, 1);
  assert.equal(result.output?.propositions.length, 12);
  assert.deepEqual(events, ["request", "response-before-validation"]);
  assert.equal(requests.length, 1);
  assert.ok(requests.every((request) =>
    request.system === ""
    && request.model === "gpt-4o-mini"
    && request.temperature === 0.1
    && request.retryCount === 0
    && request.store === false
    && request.maxOutputTokens === 6_000
    && request.timeoutMs === 180_000
    && request.responseSchema === WHOLE_ARTICLE_BURDEN_JSON_SCHEMA));
});
