import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  normalizeArticleText,
} from "../../shared/articleNormalization/index.js";
import {
  sourceUnitManifestHash,
} from "../../shared/sourceUnits/index.js";
import type {
  CfxFrozenArticle,
  CfxSourceUnit,
} from "../types/index.js";

const fixtureSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
}).passthrough();

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function buildCfxUnitProjection(units: CfxSourceUnit[]): string {
  return units.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n\n");
}

export async function freezeCfxArticle(input: {
  fixtureId: string;
  fixturePath: string;
  expectedFixtureFileSha256?: string;
  expectedArticleTextSha256?: string;
}): Promise<CfxFrozenArticle> {
  const fixtureBytes = await readFile(input.fixturePath);
  const fixtureFileSha256 = sha256(fixtureBytes);
  if (
    input.expectedFixtureFileSha256
    && fixtureFileSha256 !== input.expectedFixtureFileSha256
  ) {
    throw new Error(`CFX fixture hash mismatch for ${input.fixtureId}`);
  }
  const raw = JSON.parse(fixtureBytes.toString()) as Record<string, unknown>;
  const article = fixtureSchema.parse(raw.article ?? raw);
  const articleTextSha256 = sha256(article.text);
  if (
    input.expectedArticleTextSha256
    && articleTextSha256 !== input.expectedArticleTextSha256
  ) {
    throw new Error(`CFX article text hash mismatch for ${input.fixtureId}`);
  }
  return freezeCfxArticleFromRecord({
    fixtureId: input.fixtureId,
    fixturePath: input.fixturePath,
    fixtureFileSha256,
    article,
    articleTextSha256,
  });
}

function freezeCfxArticleFromRecord(input: {
  fixtureId: string;
  fixturePath: string;
  fixtureFileSha256: string;
  article: { title: string; text: string };
  articleTextSha256: string;
}): CfxFrozenArticle {
  const document = normalizeArticleText(input.article);
  const sourceUnits: CfxSourceUnit[] = document.sourceUnits.map((unit) => ({
    unitId: unit.unitId,
    text: unit.text,
    charStart: unit.sourceOffsets.start,
    charEnd: unit.sourceOffsets.end,
  }));
  const unitProjection = buildCfxUnitProjection(sourceUnits);
  return {
    fixtureId: input.fixtureId,
    fixturePath: input.fixturePath,
    fixtureFileSha256: input.fixtureFileSha256,
    articleTextSha256: input.articleTextSha256,
    normalizedArticleHash: document.contentHash,
    sourceUnitManifestHash: sourceUnitManifestHash(sourceUnits),
    articleTitle: input.article.title,
    articleText: input.article.text,
    canonicalText: document.canonicalText,
    articleCharacterCount: input.article.text.length,
    sourceUnitCount: sourceUnits.length,
    sourceUnits,
    unitProjection,
    unitProjectionSha256: sha256(unitProjection),
  };
}

/**
 * Freezes (hashes + normalizes into grounded source units) an article that
 * was just produced by a live scrape, rather than read from a fixture file
 * on disk. There is no "expected" hash to verify against here -- provenance
 * is recorded (articleTextSha256), not checked, since a fresh scrape's text
 * is whatever the live page actually contained. No DB writes, no model calls.
 */
export function freezeCfxArticleFromText(input: {
  title: string;
  text: string;
  sourceUrl?: string;
  contentId?: number;
}): CfxFrozenArticle {
  const article = { title: input.title, text: input.text };
  const articleTextSha256 = sha256(article.text);
  const fixtureId = input.contentId !== undefined
    ? `content-${input.contentId}`
    : "live-scrape";
  return freezeCfxArticleFromRecord({
    fixtureId,
    fixturePath: input.sourceUrl ?? fixtureId,
    fixtureFileSha256: articleTextSha256,
    article,
    articleTextSha256,
  });
}
