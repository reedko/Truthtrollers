import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { WholeArticleBurdenFrozenInput } from "./types.js";

export const WHOLE_ARTICLE_FIXTURE_SHA256 =
  "9d667e63112f1895129d5f1c21b17fa3d5aa7733b9b0b8f9e4a0501a95381e13";
export const WHOLE_ARTICLE_TEXT_SHA256 =
  "3b99bfeb3f39e28142f3e22e12bc47bce6b893d08bcc0a03bfcb2b6a2c8d9022";

const fixtureSchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
}).passthrough();

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function loadFrozenWholeArticleFixture(input: {
  repositoryRoot: string;
}): Promise<WholeArticleBurdenFrozenInput> {
  const fixturePath = path.join(
    input.repositoryRoot,
    "backend/test/claim-foundry/fixtures/CF1-F03/article.json",
  );
  const fixtureBytes = await readFile(fixturePath);
  if (sha256(fixtureBytes) !== WHOLE_ARTICLE_FIXTURE_SHA256) {
    throw new Error("CF1-F03 fixture file hash changed");
  }
  const raw = JSON.parse(fixtureBytes.toString()) as Record<string, unknown>;
  const article = fixtureSchema.parse(raw.article ?? raw);
  if (
    createHash("sha256").update(article.text).digest("hex")
    !== WHOLE_ARTICLE_TEXT_SHA256
  ) {
    throw new Error("CF1-F03 article text hash changed");
  }
  return {
    fixture: "CF1-F03",
    fixturePath,
    fixtureFileSha256: WHOLE_ARTICLE_FIXTURE_SHA256,
    articleTextSha256: WHOLE_ARTICLE_TEXT_SHA256,
    articleCharacterCount: article.text.length,
    article: {
      title: article.title,
      text: article.text,
    },
  };
}
