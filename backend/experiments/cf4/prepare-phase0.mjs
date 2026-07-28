import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleDocumentFromText } from "../../src/claim-foundry/article-document/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const evaluationPath = path.resolve(process.argv[3]);
const evaluation = JSON.parse(readFileSync(evaluationPath, "utf8"));
const articlePath = path.join(root, evaluation.articlePath);
const inventoryPath = path.join(root, evaluation.inventoryPath);
const article = JSON.parse(readFileSync(articlePath, "utf8"));
const document = articleDocumentFromText({
  text: article.text,
  metadata: { title: article.title, language: article.language },
});
const unitsById = new Map(document.sourceUnits.map((unit) => [unit.unitId, unit]));
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8")).inventory;
const reporting = /\b(?:said|says|told|claimed|revealed|reported|found|showed|argued|alleged|stated|testified|announced|concluded|warned|admitted|denied|insisted|maintained|noted|wrote)\b/i;
const framedInventory = inventory.filter((row) => reporting.test(row.assertionText));

const output = {
  schemaVersion: "cf4.phase0Input.v1",
  fixtureId: evaluation.fixtureId,
  article: {
    title: article.title,
    authors: article.authors,
    sourcePath: articlePath,
    sourceUnitCount: document.sourceUnits.length,
  },
  targetCluster: evaluation.targetUnitIds.map((unitId) => ({
    unitId,
    text: unitsById.get(unitId)?.text ?? null,
  })),
  attributionFrameInventory: framedInventory.map((row) => ({
    itemId: row.assertionId,
    text: row.assertionText,
    groundingUnitIds: row.groundingUnitIds,
  })),
  evaluationSource: {
    path: inventoryPath,
    role: "evaluation material only; not design authority",
  },
  requiredReceipt: evaluation.requiredReceipt,
};
writeFileSync(process.argv[2], `${JSON.stringify(output, null, 2)}\n`);
console.log(`${output.targetCluster.length} target units; `
  + `${output.attributionFrameInventory.length} attribution-framed inventory items`);
