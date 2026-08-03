import "dotenv/config";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAcademicApiContent } from "../../src/core/academicContentResolver.js";
import { acquireCfxDocumentAutomatically } from "../../src/services/cfxAutomaticAcquisition.js";
import { createProductionCfxStructuredProvider } from "../../src/services/cfxEvidenceCoordinator.js";
import { selectCfxTopRankedDocumentsPerAssertion } from "../../src/services/cfxProductionEvidencePipeline.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const sourceRun = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-acquisition-20260802040743");
const frozenRun = path.join(repositoryRoot,
  "artifacts/claim-foundry/cfx/production/18056/cfx-prod-18056-1785628610989-bde92c10");
const propositionIds = ["P54895", "P54897"];
const config = Object.freeze({
  model: "gpt-4o-mini", temperature: 0.1, maxOutputTokens: 8_000,
  timeoutMs: 180_000, retryCount: 0, store: false,
  maximumProviderCalls: 10, acquisitionConcurrency: 2,
});
export const AUTHORIZATION = "Authorized: Re-run the byte-verified frozen CF1-F03 CFX ranked-acquisition test with the unchanged top-five selections for P54895 and P54897; automatically acquire the canonical 10-document union through the repaired production acquisition ladder and send each successfully acquired eligible document, as stable evidence blocks, plus the complete immutable 12-assertion inventory to OpenAI through at most 10 Chat Completions API requests using the exact minimal assertion-extraction prompt and strict cfx_ranked_minimal_assertion_extraction_v1 schema, gpt-4o-mini, temperature 0.1, 8,000 output tokens, 180,000 ms timeout, zero retries, and store false; preserve every artifact, make no SourceCrest, scoring, repair, legacy semantic, Workspace, or production-mutation calls, and make no additional model calls.";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const stamp = () => new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
const escape = (value) => String(value ?? "").replace(/&/gu,"&amp;")
  .replace(/</gu,"&lt;").replace(/>/gu,"&gt;").replace(/"/gu,"&quot;");
const writeJson = async (file, value) => writeFile(file, json(value));

function accessLevel(acquired) {
  if (!acquired.acquired) return "unavailable";
  if (acquired.completeness === "abstract") return "abstract";
  return acquired.cleanedText?.length >= 400 ? "full_text" : "snippet";
}

function exactSelectionProjection(selection, documents, inputs) {
  const byKey = new Map(documents.map((document) => [document.documentKey, document]));
  return {
    policy: selection.policy,
    maximumPerAssertion: selection.maximumPerAssertion,
    perAssertion: selection.perAssertion.map((row) => ({
      propositionId: row.propositionId,
      assertion: inputs.find((input) => input.propositionId === row.propositionId).substantiveAssertion,
      selected: row.selected.map((selected) => {
        const document = byKey.get(selected.documentKey);
        return {
          ...selected,
          title: document.representative.title,
          url: document.canonicalUrl || document.representative.url,
        };
      }),
    })),
  };
}

function htmlReport(report) {
  const selection = report.selectedDocuments.perAssertion.map((target) => `
    <h2>${escape(target.propositionId)}</h2><p>${escape(target.assertion)}</p>
    <ol>${target.selected.map((row) => `<li><code>${escape(row.documentKey)}</code> — ${escape(row.title)} — ${escape(row.url)}</li>`).join("")}</ol>`).join("");
  const documents = report.documents.map((row) => `
    <details open><summary><code>${escape(row.documentId)}</code> — ${escape(row.title)} — ${escape(row.accessLevel)}</summary>
    <p><strong>Discovery:</strong> ${escape(row.discoveryLinkedAssertionIds.join(", "))}<br>
    <strong>Acquisition:</strong> ${escape(row.acquisitionMethod)}; ${row.textLength} characters<br>
    <strong>Model:</strong> ${escape(row.modelStatus)}; ${row.usage?.totalTokens || 0} tokens; ${row.latencyMs || 0} ms</p>
    <table><thead><tr><th>Target</th><th>Relation</th><th>Exact excerpt</th><th>Reason</th><th>Grounding</th></tr></thead><tbody>
    ${row.acceptedRows.map((item) => `<tr><td>${escape(item.targetAssertionId)}</td><td>${escape(item.relation)}</td><td>${escape(item.exactExcerpt)}</td><td>${escape(item.reason)}</td><td>${escape(item.blockId)} ${item.charStart}–${item.charEnd}</td></tr>`).join("") || "<tr><td colspan=\"5\">No accepted rows</td></tr>"}
    </tbody></table><h4>Rejected rows</h4><pre>${escape(JSON.stringify(row.rejectedRows,null,2))}</pre>
    <h4>Acquisition attempts</h4><pre>${escape(JSON.stringify(row.attempts,null,2))}</pre></details>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CFX minimal extraction rerun</title><style>body{font-family:system-ui;margin:2rem;line-height:1.4}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px;vertical-align:top}th{background:#eee}details{margin:1rem 0;padding:.7rem;border:1px solid #bbb}pre{white-space:pre-wrap}</style></head><body><h1>CFX ranked-acquisition minimal extraction rerun</h1><p>Run: <code>${escape(report.runId)}</code></p><pre>${escape(JSON.stringify(report.summary,null,2))}</pre>${selection}<h2>Documents</h2>${documents}<h2>Before/after</h2><pre>${escape(report.comparisonMarkdown)}</pre></body></html>`;
}

async function hashArtifacts(root) {
  const names = [
    "report.html", "run-summary.json", "selected-documents.json", "acquisition-results.json",
    "acquired-document-texts.txt", "model-visible-document-blocks.txt", "exact-model-requests.json",
    "raw-model-responses.json", "accepted-extraction-rows.json", "rejected-extraction-rows.json",
    "extraction-comparison.md", "token-usage.json",
  ];
  const files = [];
  for (const name of names) {
    const bytes = await readFile(path.join(root, name));
    files.push({ path:name, bytes:bytes.length, sha256:sha256(bytes) });
  }
  const aggregateSha256 = sha256(json(files));
  await writeJson(path.join(root, "artifact-hashes.json"), { files, aggregateSha256 });
  return aggregateSha256;
}

async function freezeTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await freezeTree(target);
    else if (entry.isFile()) await chmod(target, 0o444);
  }
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [documentsBytes, inputsBytes, oldSelectionBytes, oldReportBytes] = await Promise.all([
    readFile(path.join(frozenRun, "canonical_documents.json")),
    readFile(path.join(frozenRun, "evidence_inputs.json")),
    readFile(path.join(sourceRun, "ranked_selection.json")),
    readFile(path.join(sourceRun, "report.json")),
  ]);
  const documents = JSON.parse(documentsBytes);
  const inputs = JSON.parse(inputsBytes);
  const oldSelection = JSON.parse(oldSelectionBytes);
  const oldReport = JSON.parse(oldReportBytes);
  if (documents.length !== 169 || inputs.length !== 12) throw new Error("Frozen pool or 12-assertion inventory changed");
  const selectedInputs = propositionIds.map((id) => inputs.find((row) => row.propositionId === id));
  if (selectedInputs.some((row) => !row)) throw new Error("Frozen selection targets are missing");
  const selection = selectCfxTopRankedDocumentsPerAssertion(selectedInputs, documents, 5);
  const selectedDocuments = exactSelectionProjection(selection, documents, inputs);
  if (canonical(selectedDocuments) !== canonical(oldSelection)) throw new Error("Recomputed selection differs from frozen ranked_selection.json");
  if (selection.documents.length !== 10) throw new Error(`Expected exactly 10 selected documents; got ${selection.documents.length}`);

  const runtime = await import("../../dist/claimfoundry/cfx/experiments/minimalDocumentExtraction/extraction.js");
  const runId = `cfx-ranked-minimal-extraction-${stamp()}`;
  const root = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/CF1-F03", runId);
  await mkdir(root, { recursive: false });
  await writeJson(path.join(root, "preflight.json"), {
    runId, execute, sourceRun:path.relative(repositoryRoot,sourceRun),
    frozenRun:path.relative(repositoryRoot,frozenRun),
    sourceSelectionSha256:sha256(oldSelectionBytes), frozenPoolSha256:sha256(documentsBytes),
    evidenceInputsSha256:sha256(inputsBytes), selectedDocumentCount:10, config,
    promptHash:runtime.cfxMinimalExtractionPromptHash(),
    schemaHash:runtime.cfxMinimalExtractionSchemaHash(),
    productionMutation:false, sourceCrestEnabled:false,
  });
  await writeJson(path.join(root, "selected-documents.json"), selectedDocuments);
  if (!execute) {
    console.log(json({status:"preflight_only",runId,root,authorization:AUTHORIZATION}));
    return;
  }
  if (process.env.CFX_LIVE_AUTHORIZATION !== AUTHORIZATION) throw new Error("Exact CFX_LIVE_AUTHORIZATION is required for --execute");

  const discoveryByDocument = new Map();
  for (const row of selection.perAssertion) for (const selected of row.selected) {
    const values = discoveryByDocument.get(selected.documentKey) || [];
    values.push(row.propositionId);
    discoveryByDocument.set(selected.documentKey, [...new Set(values)]);
  }
  const acquisitionRows = Array(selection.documents.length);
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(config.acquisitionConcurrency,selection.documents.length)}, async () => {
    while (cursor < selection.documents.length) {
      const index = cursor++;
      const document = selection.documents[index];
      const candidate = document.representative;
      const documentRoot = path.join(root,"documents",document.documentKey);
      await mkdir(documentRoot,{recursive:true});
      let academic = null;
      try {
        academic = await fetchAcademicApiContent({
          url:candidate.canonicalUrl || candidate.resolvedUrl || candidate.url,
          title:candidate.title,snippet:candidate.abstractOrSnippet,
          academicMetadata:{pmid:candidate.pmid,doi:candidate.doi},
        },{disableCache:true});
      } catch (error) {
        await writeJson(path.join(documentRoot,"academic-resolver-failure.json"),{name:error?.name||"Error",message:error?.message||String(error)});
      }
      if (academic) await writeJson(path.join(documentRoot,"academic-resolver-result.json"),academic);
      const acquired = await acquireCfxDocumentAutomatically({candidate,academic});
      const safeAttempts=[];
      for (const attempt of acquired.attempts||[]) {
        const name=`attempt-${String(attempt.ordinal).padStart(3,"0")}`;
        if (attempt.rawResponse!=null) await writeFile(path.join(documentRoot,`${name}-raw-response.txt`),String(attempt.rawResponse));
        safeAttempts.push({...attempt,rawResponse:attempt.rawResponse==null?null:`${name}-raw-response.txt`,rawResponseSha256:attempt.rawResponse==null?null:sha256(String(attempt.rawResponse))});
      }
      if (acquired.cleanedText) await writeFile(path.join(documentRoot,"immutable-cleaned-text.txt"),acquired.cleanedText);
      const safeAcquired={...acquired,cleanedText:acquired.cleanedText?"immutable-cleaned-text.txt":null,attempts:safeAttempts};
      await writeJson(path.join(documentRoot,"acquisition.json"),safeAcquired);
      acquisitionRows[index]={document,documentRoot,acquired,safeAcquired,accessLevel:accessLevel(acquired),discoveryLinkedAssertionIds:discoveryByDocument.get(document.documentKey)||[]};
    }
  }));

  const targets = inputs.map((input) => ({propositionId:input.propositionId,assertion:input.substantiveAssertion}));
  const provider = createProductionCfxStructuredProvider();
  const exactRequests=[]; const rawResponses=[]; const acceptedRows=[]; const rejectedRows=[];
  const usageRows=[]; const textSections=[]; const blockSections=[];
  let providerCalls=0;
  for (const row of acquisitionRows) {
    if (!["full_text","substantial_excerpt","abstract"].includes(row.accessLevel)) continue;
    if (providerCalls >= config.maximumProviderCalls) throw new Error("Provider-call budget exhausted");
    const text=await readFile(path.join(row.documentRoot,"immutable-cleaned-text.txt"),"utf8");
    const built=runtime.buildCfxMinimalExtractionRequest({documentId:row.document.documentKey,accessLevel:row.accessLevel,text,targets,...config});
    if (built.request.user.length > 250_000) throw new Error(`${row.document.documentKey} exceeds one-call request bound`);
    const requestRecord={documentId:row.document.documentKey,request:built.request,requestHash:sha256(json(built.request))};
    exactRequests.push(requestRecord);
    await writeJson(path.join(row.documentRoot,"exact-model-request.json"),requestRecord);
    textSections.push(`===== ${row.document.documentKey} | ${row.document.representative.title} =====\n${text}\n===== END ${row.document.documentKey} =====`);
    const visibleBlocks=built.blocks.map((block)=>`[${block.blockId}]\n${block.text}`).join("\n\n");
    blockSections.push(`===== ${row.document.documentKey} =====\n${visibleBlocks}\n===== END ${row.document.documentKey} =====`);
    providerCalls+=1;
    const started=performance.now();
    try {
      const response=await provider.invokeStructured(built.request);
      const latencyMs=Math.round(performance.now()-started);
      const responseRecord={documentId:row.document.documentKey,rawResponse:response.rawResponse,parsedOutput:response.output,responseId:response.responseId,requestId:response.requestId,model:response.model,usage:response.usage,latencyMs,capturedBeforeValidation:true};
      rawResponses.push(responseRecord);
      await writeJson(path.join(row.documentRoot,"raw-model-response.json"),responseRecord);
      const validation=runtime.validateCfxMinimalExtraction({documentId:row.document.documentKey,targets,blocks:built.blocks,rawOutput:response.output});
      row.modelStatus="completed"; row.usage=response.usage; row.latencyMs=latencyMs; row.acceptedRows=validation.acceptedRows; row.rejectedRows=validation.rejectedRows;
      acceptedRows.push(...validation.acceptedRows); rejectedRows.push(...validation.rejectedRows);
      usageRows.push({documentId:row.document.documentKey,...response.usage,latencyMs,responseId:response.responseId,requestId:response.requestId});
      await writeJson(path.join(row.documentRoot,"validation.json"),validation);
    } catch (error) {
      const latencyMs=Math.round(performance.now()-started);
      row.modelStatus="provider_failed"; row.usage=null; row.latencyMs=latencyMs; row.acceptedRows=[];
      row.rejectedRows=[{documentId:row.document.documentKey,rowIndex:null,rawRow:null,reasons:[{code:"PROVIDER_FAILURE",message:error?.message||String(error)}]}];
      rejectedRows.push(...row.rejectedRows);
      usageRows.push({documentId:row.document.documentKey,inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,latencyMs,providerFailure:error?.message||String(error)});
      await writeJson(path.join(row.documentRoot,"provider-failure.json"),row.rejectedRows[0]);
    }
  }
  for (const row of acquisitionRows) {
    row.modelStatus ||= "not_run"; row.acceptedRows ||= []; row.rejectedRows ||= [];
  }

  const oldLinks=oldReport.documents.flatMap((document)=>(document.evidenceAssertions||[]).flatMap((assertion)=>(assertion.targetLinks||[]).map((link)=>({documentId:document.documentKey,targetAssertionId:link.propositionId,exactExcerpt:assertion.exactExcerpt,relation:link.bearingRelation}))));
  const linkedTargets=new Set(propositionIds);
  const newDiscoveryRows=acceptedRows.filter((row)=>linkedTargets.has(row.targetAssertionId));
  const otherRows=acceptedRows.filter((row)=>!linkedTargets.has(row.targetAssertionId));
  const whistleblower=acquisitionRows.find((row)=>row.document.documentKey==="DOC-543bc0ef88817a66db53");
  const comparisonMarkdown=[
    "# CFX ranked-acquisition extraction comparison","",
    `- Previous accepted evidence links: ${oldLinks.length}`,
    `- New accepted extraction rows: ${acceptedRows.length}`,
    `- Previous rows for discovery-linked targets (P54895/P54897): ${oldLinks.filter((row)=>linkedTargets.has(row.targetAssertionId)).length}`,
    `- New rows for discovery-linked targets: ${newDiscoveryRows.length}`,
    `- Previous cross-target rows: ${oldLinks.filter((row)=>!linkedTargets.has(row.targetAssertionId)).length}`,
    `- New rows for the other ten targets: ${otherRows.length}`,
    `- Previous whistleblower PDF result: 0`,
    `- New whistleblower PDF result: ${whistleblower?.acceptedRows.length||0}`,
    "","## Previous cross-target links", "", "```json", JSON.stringify(oldLinks.filter((row)=>!linkedTargets.has(row.targetAssertionId)),null,2), "```",
    "","## New cross-target rows", "", "```json", JSON.stringify(otherRows,null,2), "```",
    "","## New whistleblower PDF rows", "", "```json", JSON.stringify(whistleblower?.acceptedRows||[],null,2), "```","",
  ].join("\n");
  const totals=usageRows.reduce((sum,row)=>({inputTokens:sum.inputTokens+Number(row.inputTokens||0),cachedInputTokens:sum.cachedInputTokens+Number(row.cachedInputTokens||0),outputTokens:sum.outputTokens+Number(row.outputTokens||0),totalTokens:sum.totalTokens+Number(row.totalTokens||0),latencyMs:sum.latencyMs+Number(row.latencyMs||0)}),{inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,latencyMs:0});
  const summary={status:"completed",runId,selectedDocuments:10,acquiredDocuments:acquisitionRows.filter((row)=>row.acquired.acquired).length,failedAcquisitions:acquisitionRows.filter((row)=>!row.acquired.acquired).length,semanticModelCalls:providerCalls,totalAssertionsExtracted:acceptedRows.length,p54895Rows:acceptedRows.filter((row)=>row.targetAssertionId==="P54895").length,p54897Rows:acceptedRows.filter((row)=>row.targetAssertionId==="P54897").length,otherTargetRows:otherRows.length,documentsProducingZeroRows:acquisitionRows.filter((row)=>row.modelStatus==="completed"&&row.acceptedRows.length===0).map((row)=>row.document.documentKey),promptHash:runtime.cfxMinimalExtractionPromptHash(),schemaHash:runtime.cfxMinimalExtractionSchemaHash(),productionMutation:false,sourceCrestCalls:0,otherModelCalls:0,usage:totals};
  const acquisitionResults=acquisitionRows.map((row)=>({documentId:row.document.documentKey,title:row.acquired.extractedDocument?.title||row.document.representative.title,url:row.acquired.resolvedUrl||row.acquired.sourceUrl||row.document.canonicalUrl,discoveryLinkedAssertionIds:row.discoveryLinkedAssertionIds,acquired:row.acquired.acquired,accessLevel:row.accessLevel,acquisitionMethod:row.acquired.method,textLength:row.acquired.cleanedText?.length||0,attempts:row.safeAcquired.attempts}));
  const report={runId,summary,selectedDocuments,documents:acquisitionRows.map((row)=>({...acquisitionResults.find((item)=>item.documentId===row.document.documentKey),modelStatus:row.modelStatus,usage:row.usage,latencyMs:row.latencyMs,acceptedRows:row.acceptedRows,rejectedRows:row.rejectedRows})),comparisonMarkdown};
  await Promise.all([
    writeJson(path.join(root,"run-summary.json"),summary),writeJson(path.join(root,"acquisition-results.json"),acquisitionResults),
    writeFile(path.join(root,"acquired-document-texts.txt"),`${textSections.join("\n\n")}\n`),writeFile(path.join(root,"model-visible-document-blocks.txt"),`${blockSections.join("\n\n")}\n`),
    writeJson(path.join(root,"exact-model-requests.json"),exactRequests),writeJson(path.join(root,"raw-model-responses.json"),rawResponses),
    writeJson(path.join(root,"accepted-extraction-rows.json"),acceptedRows),writeJson(path.join(root,"rejected-extraction-rows.json"),rejectedRows),
    writeFile(path.join(root,"extraction-comparison.md"),comparisonMarkdown),writeJson(path.join(root,"token-usage.json"),{requests:usageRows,totals}),
    writeFile(path.join(root,"report.html"),htmlReport(report)),
  ]);
  const aggregateSha256=await hashArtifacts(root);
  await freezeTree(root);
  console.log(json({status:"completed",runId,root,report:path.join(root,"report.html"),providerCalls,summary,artifactAggregateSha256:aggregateSha256}));
}

function canonical(value) { return JSON.stringify(value); }
main().catch((error)=>{console.error(error);process.exitCode=1;});
