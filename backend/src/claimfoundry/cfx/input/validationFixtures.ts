import path from "node:path";
import { freezeCfxArticle } from "./freezeArticle.js";

export const CFX_PIPE_VALIDATION_FIXTURES = {
  "CF1-F02": {
    role: "mixed_domain",
    fixtureFileSha256:
      "dc803a9853cc19234393e894ac389f038e83040fe0410f63380e379cea9044b6",
    articleTextSha256:
      "b6051678e1e05d5612bf671d1784860063ec888493f5bfcc5936bfb973ed6385",
  },
  "CF1-F03": {
    role: "biomedical_health",
    fixtureFileSha256:
      "9d667e63112f1895129d5f1c21b17fa3d5aa7733b9b0b8f9e4a0501a95381e13",
    articleTextSha256:
      "3b99bfeb3f39e28142f3e22e12bc47bce6b893d08bcc0a03bfcb2b6a2c8d9022",
  },
  "CF1-F06": {
    role: "mostly_non_biomedical",
    fixtureFileSha256:
      "1a35db1ffc743df3317e465d5cc1f11227f6b4d8a5d97474f6865f2f634b210c",
    articleTextSha256:
      "4f717303c83b2dc2007deb086ad165d80045cc4cba6ca8581720e379055e8e69",
  },
} as const;

export type CfxPipeValidationFixtureId =
  keyof typeof CFX_PIPE_VALIDATION_FIXTURES;

export function isCfxPipeValidationFixtureId(
  value: string,
): value is CfxPipeValidationFixtureId {
  return Object.hasOwn(CFX_PIPE_VALIDATION_FIXTURES, value);
}

export function freezeCfxPipeValidationFixture(
  repositoryRoot: string,
  fixtureId: CfxPipeValidationFixtureId,
) {
  const fixture = CFX_PIPE_VALIDATION_FIXTURES[fixtureId];
  return freezeCfxArticle({
    fixtureId,
    fixturePath: path.join(
      repositoryRoot,
      `backend/test/claim-foundry/fixtures/${fixtureId}/article.json`,
    ),
    expectedFixtureFileSha256: fixture.fixtureFileSha256,
    expectedArticleTextSha256: fixture.articleTextSha256,
  });
}
