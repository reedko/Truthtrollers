import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const outDir = path.resolve(process.argv[2]);
mkdirSync(outDir, { recursive: true });

const fixtureIds = process.argv.slice(3);
if (!fixtureIds.length) throw new Error("Pass one or more fixture IDs after the output directory");
for (const fixtureId of fixtureIds) {
  const articlePath = path.join(root, "backend/test/claim-foundry/fixtures",
    fixtureId, "article.json");
  const article = JSON.parse(readFileSync(articlePath, "utf8"));
  const document = articleDocumentFromText({
    text: article.text,
    metadata: { title: article.title, language: article.language },
  });
  const length = document.canonicalText.length;
  const units = document.sourceUnits.map((unit) => {
    const charStart = document.canonicalText.indexOf(unit.text);
    const safeStart = Math.max(0, charStart);
    return {
      unitId: unit.unitId,
      text: unit.text,
      charStart: safeStart,
      charEnd: safeStart + unit.text.length,
      quarter: `Q${Math.min(4, Math.floor((safeStart / Math.max(1, length)) * 4) + 1)}`,
    };
  });
  writeFileSync(path.join(outDir, `${fixtureId}.json`), `${JSON.stringify({
    schemaVersion: "cf4.s0Units.v1",
    fixtureId,
    article: {
      title: article.title,
      authors: article.authors,
      publisher: article.publisher ?? null,
      publishedAt: article.publishedAt ?? null,
      sourcePath: articlePath,
      contentHash: document.contentHash,
    },
    units,
  }, null, 2)}\n`);
  console.log(`${fixtureId}: ${units.length} units`);
}
