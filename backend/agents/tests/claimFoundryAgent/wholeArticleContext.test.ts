import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { articleDocumentFromText } from "../../../src/claim-foundry/article-document/index.js";
import {
  assertWholeArticleContext,
  buildWholeArticleAgentInput,
  buildWholeArticleContext,
  supportsExplicitPromptCacheBreakpoint,
  CF6_ARTICLE_CONTEXT_CLOSE,
  CF6_ARTICLE_CONTEXT_OPEN,
} from "../../claimFoundry/claimFoundryArticleContext.js";
import { document } from "../claimFoundry/fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../../..");

test("whole-article context is lossless, ordered, stable, and structurally complete", () => {
  const first = buildWholeArticleContext({
    document,
    metadata: { title: "Fixture", url: "https://example.test/article" },
  });
  const second = buildWholeArticleContext({
    document,
    metadata: { title: "Fixture", url: "https://example.test/article" },
  });

  assertWholeArticleContext(first, document);
  assert.deepEqual(first, second);
  assert.equal(first.unitCount, document.sourceUnits.length);
  assert.equal(first.text.match(new RegExp(CF6_ARTICLE_CONTEXT_OPEN, "g"))?.length, 1);
  assert.equal(first.text.match(new RegExp(CF6_ARTICLE_CONTEXT_CLOSE, "g"))?.length, 1);
  assert.deepEqual(
    first.payload.sourceUnits.map(unit => unit.unitId),
    document.sourceUnits.map(unit => unit.unitId),
  );
  assert.deepEqual(
    first.payload.sourceUnits.map(unit => unit.text),
    document.sourceUnits.map(unit => unit.text),
  );
});

test("F03 whole-article context contains all 404 exact source units once", () => {
  const raw = JSON.parse(readFileSync(path.join(
    backendRoot,
    "test/claim-foundry/fixtures/CF1-F03/article.json",
  ), "utf8"));
  const source = raw.article ?? raw;
  const articleDocument = articleDocumentFromText({
    text: source.text,
    metadata: { title: source.title, language: source.language },
    sourceDescriptor: { url: source.url },
  }) as any;
  const context = buildWholeArticleContext({
    document: articleDocument,
    metadata: {
      title: source.title,
      url: source.url,
      language: source.language,
    },
  });

  assertWholeArticleContext(context, articleDocument);
  assert.equal(context.unitCount, 404);
  assert.equal(new Set(context.payload.sourceUnits.map(unit => unit.unitId)).size, 404);
  assert.equal(context.payload.sourceUnits[0]!.unitId, "U0001");
  assert.equal(context.payload.sourceUnits.at(-1)!.unitId, "U0404");
  for (const unit of articleDocument.sourceUnits) {
    const actual = context.payload.sourceUnits[unit.order];
    assert.equal(actual.unitId, unit.unitId);
    assert.equal(actual.text, unit.text);
    assert.equal(actual.sourceOffsets.start, unit.sourceOffsets.start);
    assert.equal(actual.sourceOffsets.end, unit.sourceOffsets.end);
  }
});

test("whole-article context rejects canonical-order and text corruption", () => {
  const wrongOrder = structuredClone(document);
  wrongOrder.sourceUnits[0]!.order = 1;
  assert.throws(() => buildWholeArticleContext({ document: wrongOrder }), /order/i);

  const wrongText = structuredClone(document);
  wrongText.sourceUnits[0]!.text += " altered";
  assert.throws(() => buildWholeArticleContext({ document: wrongText }), /canonical/i);
});

test("agent input places an explicit cache breakpoint immediately after the article", () => {
  const article = buildWholeArticleContext({ document });
  const input = buildWholeArticleAgentInput({
    article,
    trailingWorkbench: { runId: "run-dynamic", contentId: "content-dynamic" },
  });
  assert.equal(input.length, 1);
  const message = input[0] as any;
  assert.equal(message.type, "message");
  assert.equal(message.role, "user");
  assert.equal(message.content.length, 2);
  assert.equal(message.content[0].text, article.text);
  assert.deepEqual(message.content[0].promptCacheBreakpoint, { mode: "explicit" });
  assert.match(message.content[1].text, /run-dynamic/);
  assert.equal(message.content[0].text.includes("run-dynamic"), false);
});

test("explicit cache breakpoints are emitted only for supported model families", () => {
  assert.equal(supportsExplicitPromptCacheBreakpoint("gpt-4.1-mini"), false);
  assert.equal(supportsExplicitPromptCacheBreakpoint("gpt-5.6"), true);
  assert.equal(supportsExplicitPromptCacheBreakpoint("gpt-5.6-terra"), true);
});
