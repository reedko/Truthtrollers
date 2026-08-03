import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const backendRoot = path.resolve(".");
const productionRoots = [path.join(backendRoot, "src"), path.join(backendRoot, "services")];

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

const files = productionRoots.flatMap(javascriptFiles);
const persistenceFile = path.join(backendRoot, "src/storage/persistPublishers.js");
const pipelineFile = path.join(backendRoot, "src/services/publishingIdentityPipeline.js");
const mutationPattern = /(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+content_publishers/i;

const mutationBypasses = files
  .filter((file) => file !== persistenceFile)
  .filter((file) => mutationPattern.test(fs.readFileSync(file, "utf8")));
assert.deepEqual(mutationBypasses, [], `content_publishers mutations bypass persistence: ${mutationBypasses.join(", ")}`);

const adapterImportPattern = /from\s+["'][^"']*(?:extractPublisher|extractPdfPublishingIdentity|pdfIdentityExtractor)[.]js["']/;
const adapterBypasses = files
  .filter((file) => file !== pipelineFile)
  .filter((file) => {
    const relative = path.relative(backendRoot, file);
    if (["src/utils/extractPdfPublishingIdentity.js"].includes(relative)) return false;
    return adapterImportPattern.test(fs.readFileSync(file, "utf8"));
  });
assert.deepEqual(adapterBypasses, [], `identity adapters imported outside pipeline: ${adapterBypasses.join(", ")}`);

const facadeImportPattern = /from\s+["'][^"']*persistPublishers[.]js["']/;
const facadeBypasses = files
  .filter((file) => file !== pipelineFile && file !== persistenceFile)
  .filter((file) => facadeImportPattern.test(fs.readFileSync(file, "utf8")))
  .filter((file) => !fs.readFileSync(file, "utf8").includes("linkPublisherRole")
    && !fs.readFileSync(file, "utf8").includes("unlinkPublisherRole"));
assert.deepEqual(facadeBypasses, [], `scrape code imports persistence façade directly: ${facadeBypasses.join(", ")}`);

for (const relative of [
  "src/core/scrapeTask.js",
  "src/core/scrapeReference.js",
  "src/core/runEvidenceEngine.js",
  "src/routes/content/content.scrape.routes.js",
]) {
  const source = fs.readFileSync(path.join(backendRoot, relative), "utf8");
  assert(source.includes("processPublishingIdentity"), `${relative} does not use the canonical identity pipeline`);
}

const externalFetchFile = path.join(backendRoot, "src/utils/fetchExternalPageContent.js");
const productionExtractionFile = path.join(backendRoot, "src/core/productionDocumentExtraction.js");
const externalFetchSource = fs.readFileSync(externalFetchFile, "utf8");
const productionExtractionSource = fs.readFileSync(productionExtractionFile, "utf8");

assert.match(
  externalFetchSource,
  /import\s*\{\s*extractProductionPdfDocument\s*\}\s*from\s*["'][^"']*productionDocumentExtraction[.]js["']/,
  "fetchExternalPageContent must import the shared production PDF extraction seam",
);
assert.match(
  externalFetchSource,
  /await\s+extractProductionPdfDocument\s*\(/,
  "fetchExternalPageContent must execute the shared production PDF extraction seam",
);
assert.doesNotMatch(
  externalFetchSource,
  /from\s+["'][^"']*(?:pdf-parse|extractPdfPublishingIdentity|pdfIdentityExtractor)[^"']*["']/,
  "fetchExternalPageContent must not bypass the shared production PDF extraction seam",
);

assert.match(
  productionExtractionSource,
  /import\s*\{\s*processPublishingIdentity\s*\}\s*from\s*["'][^"']*publishingIdentityPipeline[.]js["']/,
  "the shared production-document extraction seam must own publishing-identity processing",
);
const pdfExtractionStart = productionExtractionSource.indexOf("export async function extractProductionPdfDocument");
assert.notEqual(pdfExtractionStart, -1, "the shared production PDF extraction function is missing");
const pdfExtractionSource = productionExtractionSource.slice(pdfExtractionStart);
assert.match(
  pdfExtractionSource,
  /await\s+processPublishingIdentity\s*\(/,
  "extractProductionPdfDocument must invoke processPublishingIdentity",
);

const productionExtractionDefinitions = files.filter((file) =>
  /export\s+async\s+function\s+extractProductionPdfDocument\s*\(/.test(fs.readFileSync(file, "utf8")),
);
assert.deepEqual(
  productionExtractionDefinitions,
  [productionExtractionFile],
  `alternate production PDF extraction seams detected: ${productionExtractionDefinitions.join(", ")}`,
);

assert(!fs.existsSync(path.join(backendRoot, "src/core/runEvidenceEngine 2.js")), "obsolete evidence engine duplicate still exists");

console.log("publishing identity architecture checks passed");
