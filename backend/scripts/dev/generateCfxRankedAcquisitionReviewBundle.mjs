import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceRun = process.argv[2];
const outputDirectory = process.argv[3];

if (!sourceRun || !outputDirectory) {
  throw new Error("Usage: node generateCfxRankedAcquisitionReviewBundle.mjs <source-run> <output-directory>");
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const write = async (name, value) => {
  await writeFile(path.join(outputDirectory, name), value, { encoding: "utf8", flag: "wx" });
};

const report = await readJson(path.join(sourceRun, "report.json"));
const selectedByDocument = new Map();
for (const selection of report.selection.perAssertion) {
  for (const document of selection.selected) {
    if (!selectedByDocument.has(document.documentKey)) {
      selectedByDocument.set(document.documentKey, {
        ...document,
        selectedFor: [],
      });
    }
    selectedByDocument.get(document.documentKey).selectedFor.push(selection.propositionId);
  }
}

const successful = report.documents.filter((document) => document.accessLevel !== "unavailable");
const failed = report.documents.filter((document) => document.accessLevel === "unavailable");
if (successful.length !== 8 || failed.length !== 2) {
  throw new Error(`Expected 8 successful and 2 failed documents; got ${successful.length} and ${failed.length}`);
}

const requestRecords = [];
const textSections = [];
const modelBlockSections = [];
let assertionInventory = new Map();

for (const [index, document] of successful.entries()) {
  const directory = path.join(sourceRun, "documents", document.documentKey);
  const cleanedText = await readFile(path.join(directory, "immutable-cleaned-text.txt"), "utf8");
  const request = await readJson(path.join(directory, "semantic-request.json"));
  const selection = selectedByDocument.get(document.documentKey);
  const documentMarker = "SUPPLIED_EVIDENCE_DOCUMENT:\n";
  const markerIndex = request.user.indexOf(documentMarker);
  if (markerIndex < 0) throw new Error(`Missing document marker for ${document.documentKey}`);
  const modelVisibleDocumentBlock = request.user.slice(markerIndex + documentMarker.length);

  const inventoryRegex = /propositionId: (P[0-9]+)\nclaimId: ([0-9]+)\ncaseAssertion: ([^\n]+)/g;
  for (const match of request.user.matchAll(inventoryRegex)) {
    assertionInventory.set(match[1], { claimId: Number(match[2]), assertion: match[3] });
  }

  const ordinal = String(index + 1).padStart(2, "0");
  const metadata = [
    `DOCUMENT_ORDINAL: ${ordinal}`,
    `DOCUMENT_KEY: ${document.documentKey}`,
    `TITLE: ${selection?.title ?? document.title}`,
    `ORIGINAL_URL: ${selection?.url ?? document.url}`,
    `ACQUIRED_URL: ${document.url}`,
    `ACCESS_LEVEL: ${document.accessLevel}`,
    `EXTRACTION_METHOD: ${document.extractionMethod}`,
    `EXTRACTED_TEXT_CHARACTERS: ${cleanedText.length}`,
    `SELECTED_FOR: ${(selection?.selectedFor ?? []).join(", ")}`,
  ].join("\n");

  textSections.push([
    `==================== BEGIN EXTRACTED DOCUMENT ${ordinal} ====================`,
    metadata,
    "-------------------- BEGIN EXACT IMMUTABLE CLEANED TEXT --------------------",
    cleanedText,
    "--------------------- END EXACT IMMUTABLE CLEANED TEXT ---------------------",
    `===================== END EXTRACTED DOCUMENT ${ordinal} =====================`,
  ].join("\n"));

  modelBlockSections.push([
    `==================== BEGIN MODEL-VISIBLE DOCUMENT BLOCK ${ordinal} ====================`,
    metadata,
    "MODEL_INPUT_FIELD: messages[1].content (artifact field: user)",
    "MODEL_INPUT_MARKER: SUPPLIED_EVIDENCE_DOCUMENT:",
    "-------------------- BEGIN EXACT MODEL-VISIBLE BLOCK VALUE --------------------",
    modelVisibleDocumentBlock,
    "--------------------- END EXACT MODEL-VISIBLE BLOCK VALUE ---------------------",
    `===================== END MODEL-VISIBLE DOCUMENT BLOCK ${ordinal} =====================`,
  ].join("\n"));

  requestRecords.push({
    documentOrdinal: Number(ordinal),
    documentKey: document.documentKey,
    title: selection?.title ?? document.title,
    originalUrl: selection?.url ?? document.url,
    semanticRequestArtifact: `documents/${document.documentKey}/semantic-request.json`,
    exactRequest: request,
  });
}

await mkdir(outputDirectory, { recursive: false });
await write("acquired_document_texts.txt", `${textSections.join("\n\n")}\n`);
await write("model_visible_document_blocks.txt", `${modelBlockSections.join("\n\n")}\n`);
await write("exact_model_requests.json", `${JSON.stringify({
  sourceRun,
  requestCount: requestRecords.length,
  requests: requestRecords,
}, null, 2)}\n`);

const links = [];
for (const document of report.documents) {
  const selection = selectedByDocument.get(document.documentKey);
  for (const target of document.acceptedTargets ?? []) {
    for (const assertion of target.assertions ?? []) {
      links.push({ document, selection, target, assertion });
    }
  }
}

const linksMarkdown = [
  "# CFX ranked-acquisition model-suggested evidence links",
  "",
  `Source run: \`${report.runId}\``,
  "",
  `The model suggested **${links.length}** evidence-assertion links. These are model outputs, not human-approved links.`,
  "",
  ...links.flatMap(({ document, selection, target, assertion }, index) => {
    const targetRecord = assertionInventory.get(target.propositionId);
    const location = assertion.sourceLocation ?? {};
    return [
      `## Link ${index + 1}: ${document.documentKey} → ${target.propositionId}`,
      "",
      `- Document title: ${selection?.title ?? document.title}`,
      `- Document label: \`${document.documentKey}\``,
      `- Document URL: ${selection?.url ?? document.url}`,
      `- Related case assertion: **${targetRecord?.assertion ?? "Unknown"}**`,
      `- Case proposition/claim: \`${target.propositionId}\` / \`${targetRecord?.claimId ?? target.claimId}\``,
      `- Suggested bearing: \`${assertion.bearingRelation}\``,
      `- Pair confidence: ${assertion.confidence}`,
      `- Pair quality: ${assertion.quality}`,
      `- Source location: block ${location.blockId ?? "null"}, section ${location.section ?? "null"}, paragraph ${location.paragraph ?? "null"}, chars ${location.charStart ?? "null"}–${location.charEnd ?? "null"}`,
      "",
      "**Evidence assertion**",
      "",
      assertion.evidenceAssertion,
      "",
      "**Exact excerpt**",
      "",
      `> ${assertion.exactExcerpt.replaceAll("\n", "\n> ")}`,
      "",
      "**Model explanation**",
      "",
      assertion.whyItBears,
      "",
      "**Text-visible limitations**",
      "",
      ...(assertion.limitationsVisibleInText?.length
        ? assertion.limitationsVisibleInText.map((limitation) => `- ${limitation}`)
        : ["- None returned"]),
      "",
    ];
  }),
].join("\n");
await write("suggested_evidence_links.md", `${linksMarkdown}\n`);

const failedMarkdown = [
  "# Failed document acquisitions",
  "",
  ...failed.flatMap((document) => {
    const selection = selectedByDocument.get(document.documentKey);
    return [
      `## ${selection?.title ?? document.title}`,
      "",
      `- Document key: \`${document.documentKey}\``,
      `- URL: ${selection?.url ?? document.url}`,
      `- Selected for: ${(selection?.selectedFor ?? []).join(", ")}`,
      "- Attempts:",
      ...document.attempts.map((attempt) =>
        `  - ${attempt.ordinal}. ${attempt.tier}/${attempt.method}: ${attempt.status}; ${attempt.diagnostic ?? "no diagnostic"}`),
      "",
    ];
  }),
].join("\n");
await write("failed_documents.md", `${failedMarkdown}\n`);

const firstRequest = requestRecords[0].exactRequest;
const instructionBoundary = firstRequest.user.indexOf("IMMUTABLE_DOCUMENT_ID:");
const exactInstructions = firstRequest.user.slice(0, instructionBoundary).trimEnd();
const modelCallsMarkdown = [
  "# Exact CFX ranked-acquisition model calls",
  "",
  "## Where the document text was ingested",
  "",
  "The provider transport was OpenAI Chat Completions. In the preserved request artifact, the complete model-visible user message is the field `user`. At transport time this becomes `messages[1].content`.",
  "",
  "The acquired document text is embedded inside that user-message string immediately after the literal marker:",
  "",
  "```text",
  "SUPPLIED_EVIDENCE_DOCUMENT:",
  "```",
  "",
  "The exact extracted source text is in `acquired_document_texts.txt`. The exact marker-prefixed value actually visible to the model is in `model_visible_document_blocks.txt`. Every complete request—including its full user message and strict schema—is in `exact_model_requests.json`.",
  "",
  "## Provider configuration",
  "",
  `- Model: \`${firstRequest.model}\``,
  `- Temperature: \`${firstRequest.temperature}\``,
  `- Store: \`${firstRequest.store}\``,
  `- Maximum output tokens: \`${firstRequest.maxOutputTokens}\``,
  `- Timeout: \`${firstRequest.timeoutMs}\` ms`,
  `- Retries: \`${firstRequest.retryCount}\``,
  `- Strict schema: \`${firstRequest.responseSchema.name}\``,
  `- System message: empty string`,
  "",
  "## Exact shared instruction text",
  "",
  "```text",
  exactInstructions,
  "```",
  "",
  "## Exact dynamic user-message layout",
  "",
  "```text",
  "<EXACT SHARED INSTRUCTION TEXT ABOVE>",
  "",
  "IMMUTABLE_DOCUMENT_ID:",
  "<documentKey>",
  "",
  "DOCUMENT_PART: 1/1",
  "TARGET_INVENTORY_SHA256: <inventory hash>",
  "SELECTED_TEXT_VERSION_SHA256: <text hash>",
  "",
  "ACCESS_LEVEL:",
  "<access level>",
  "",
  "COMPLETE_FIXED_CASE_ASSERTION_INVENTORY:",
  "<all 12 proposition IDs, claim IDs, and case assertions>",
  "",
  "SUPPLIED_EVIDENCE_DOCUMENT:",
  "<the model-visible document block from model_visible_document_blocks.txt>",
  "```",
  "",
  "## Calls made",
  "",
  "| # | Document key | Title | Text characters | Exact request |",
  "|---:|---|---|---:|---|",
  ...successful.map((document, index) => {
    const selection = selectedByDocument.get(document.documentKey);
    return `| ${index + 1} | \`${document.documentKey}\` | ${String(selection?.title ?? document.title).replaceAll("|", "\\|")} | ${document.textLength} | \`exact_model_requests.json → requests[${index}]\` |`;
  }),
  "",
  "## Strict response schema",
  "",
  "```json",
  JSON.stringify(firstRequest.responseSchema, null, 2),
  "```",
].join("\n");
await write("model_calls_and_prompt.md", `${modelCallsMarkdown}\n`);

const files = (await readdir(outputDirectory)).sort();
const manifestFiles = [];
for (const name of files) {
  const content = await readFile(path.join(outputDirectory, name));
  manifestFiles.push({ path: name, bytes: content.length, sha256: sha256(content) });
}
const aggregateSha256 = sha256(manifestFiles.map((file) => `${file.path}\0${file.sha256}`).join("\n"));
await write("artifact_hashes.json", `${JSON.stringify({ sourceRun, files: manifestFiles, aggregateSha256 }, null, 2)}\n`);

console.log(JSON.stringify({
  outputDirectory,
  successfulDocuments: successful.length,
  failedDocuments: failed.length,
  suggestedLinks: links.length,
  modelRequests: requestRecords.length,
  aggregateSha256,
}, null, 2));
