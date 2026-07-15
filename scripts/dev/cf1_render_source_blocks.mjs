import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleDocumentFromPdf, articleDocumentFromText, buildArticleSourceBlocks,
  extractPdfLayout, verifyArticleSourceBlocks } from "../../backend/src/claim-foundry/article-document/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(root, "artifacts/claim-foundry/source-blocks/9a4");
const fixtureIds = ["CF1-F01", "CF1-F03", "CF1-F05", "CF1-F06"];

function summary(fixtureId, source, document, blocks) {
  const typeCounts = Object.fromEntries([...new Set(blocks.map((block) => block.structuralType))]
    .map((type) => [type, blocks.filter((block) => block.structuralType === type).length]));
  return { fixtureId, source, articleDocument: { schemaVersion: document.schemaVersion,
    sourceKind: document.sourceKind, sourceFamily: document.sourceFamily,
    adapterIdentity: document.adapterIdentity, structureProfile: document.structureProfile,
    contentHash: document.contentHash }, counts: { canonicalCharacters: document.canonicalText.length,
    atoms: document.atoms.length, sourceUnits: document.sourceUnits.length,
    links: document.links.length, blocks: blocks.length }, blockTypeCounts: typeCounts,
  blockSizeCharacters: { minimum: Math.min(...blocks.map((block) => block.text.length)),
    maximum: Math.max(...blocks.map((block) => block.text.length)),
    average: Math.round(blocks.reduce((total, block) => total + block.text.length, 0) / blocks.length) },
  diagnostics: document.diagnostics, verification: verifyArticleSourceBlocks(document, blocks) };
}

function markdown(title, report, blocks) {
  const lines = [`# ${report.fixtureId} — ${title}`, "", `Source: ${report.source}`,
    `Blocks: ${report.counts.blocks}; atoms: ${report.counts.atoms}; units: ${report.counts.sourceUnits}`,
    `Verification: ${report.verification.valid ? "valid" : "INVALID"}`, ""];
  for (const block of blocks) {
    lines.push(`## ${block.blockId} — ${block.structuralType}`, "",
      `Offsets: ${block.sourceOffsets.start}–${block.sourceOffsets.end}; boundary: ${block.boundaryReasons.join(", ")}`,
      `Atoms: ${block.atomIds.join(", ")}; units: ${block.sourceUnitIds.length}; links: ${block.linkIds.join(", ") || "none"}`,
      ...(block.heading ? [`Heading: ${block.heading.replace(/\n+/g, " / ")}`, ""] : [""]),
      block.text, "");
  }
  return `${lines.join("\n")}\n`;
}

async function writeArtifact(fixtureId, source, title, document) {
  const blocks = buildArticleSourceBlocks(document);
  const report = summary(fixtureId, source, document, blocks);
  if (!report.verification.valid) throw new Error(`${fixtureId} source blocks failed verification`);
  await Promise.all([
    fs.writeFile(path.join(outputRoot, `${fixtureId}.json`), `${JSON.stringify({ ...report, blocks }, null, 2)}\n`),
    fs.writeFile(path.join(outputRoot, `${fixtureId}.md`), markdown(title, report, blocks)),
  ]);
  return report;
}

await fs.mkdir(outputRoot, { recursive: true });
const reports = [];
for (const fixtureId of fixtureIds) {
  const fixturePath = path.join(root, `backend/test/claim-foundry/fixtures/${fixtureId}/article.json`);
  const article = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  const document = articleDocumentFromText({ text: article.text,
    metadata: { title: article.title, language: article.language },
    sourceDescriptor: { fixtureId, fixturePath, sourceNote: "approved frozen canonical text" } });
  reports.push(await writeArtifact(fixtureId, "approved frozen canonical text", article.title, document));
}

const pdfPath = path.join(root, "artifacts/evidence/mmRstudy.pdf");
const pdfLayout = await extractPdfLayout(await fs.readFile(pdfPath));
const pdfDocument = articleDocumentFromPdf({ ...pdfLayout, metadata: { title: "MMR study PDF" },
  sourceDescriptor: { path: pdfPath } });
reports.push(await writeArtifact("CF1-F01-PDF", "raw PDF supplemental rendering",
  "MMR study PDF", pdfDocument));

await fs.writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(reports, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(reports.map((report) => ({ fixtureId: report.fixtureId,
  counts: report.counts, blockTypeCounts: report.blockTypeCounts,
  blockSizeCharacters: report.blockSizeCharacters, verification: report.verification.valid })), null, 2)}\n`);
