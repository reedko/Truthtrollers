import path from "node:path";
import { freezeCfxArticle } from "./freezeArticle.js";

export const CFX_F03_FIXTURE_SHA256 =
  "9d667e63112f1895129d5f1c21b17fa3d5aa7733b9b0b8f9e4a0501a95381e13";
export const CFX_F03_ARTICLE_TEXT_SHA256 =
  "3b99bfeb3f39e28142f3e22e12bc47bce6b893d08bcc0a03bfcb2b6a2c8d9022";

export function freezeCfxF03(repositoryRoot: string) {
  return freezeCfxArticle({
    fixtureId: "CF1-F03",
    fixturePath: path.join(
      repositoryRoot,
      "backend/test/claim-foundry/fixtures/CF1-F03/article.json",
    ),
    expectedFixtureFileSha256: CFX_F03_FIXTURE_SHA256,
    expectedArticleTextSha256: CFX_F03_ARTICLE_TEXT_SHA256,
  });
}
