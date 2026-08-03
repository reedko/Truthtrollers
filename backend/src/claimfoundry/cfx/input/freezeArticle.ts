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
  const document = normalizeArticleText(article);
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
    fixtureFileSha256,
    articleTextSha256,
    normalizedArticleHash: document.contentHash,
    sourceUnitManifestHash: sourceUnitManifestHash(sourceUnits),
    articleTitle: article.title,
    articleText: article.text,
    canonicalText: document.canonicalText,
    articleCharacterCount: article.text.length,
    sourceUnitCount: sourceUnits.length,
    sourceUnits,
    unitProjection,
    unitProjectionSha256: sha256(unitProjection),
  };
}
