import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { acquireCfxDocumentAutomatically } from "../../src/services/cfxAutomaticAcquisition.js";
import { createProductionCfxStructuredProvider } from "../../src/services/cfxEvidenceCoordinator.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = path.resolve(backendRoot, "..");
const frozenRun = path.join(repositoryRoot, "artifacts/claim-foundry/cfx/production/18056/cfx-prod-18056-1785628610989-bde92c10");
const trialPropositionIds = ["P54895", "P54897"];
const semanticConfig = Object.freeze({
  model: "gpt-4o-mini", temperature: 0.1, maxOutputTokens: 8_000,
  timeoutMs: 180_000, retryCount: 0, store: false,
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const stamp = () => new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
const escape = (value) => String(value ?? "").replace(/&/gu,"&amp;").replace(/</gu,"&lt;").replace(/>/gu,"&gt;").replace(/"/gu,"&quot;");

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive:true });
  await writeFile(file, json(value));
}

function accessLevel(acquired) {
  if (!acquired.acquired) return "unavailable";
  if (acquired.completeness === "abstract") return "abstract";
  return acquired.cleanedText?.length >= 400 ? "full_text" : "snippet";
}

function assignment(document, propositionId) {
  return document.discoveryAssignments.filter((row) => row.propositionId === propositionId)
    .sort((left,right) => left.queryId.localeCompare(right.queryId)
      || Number(left.rank)-Number(right.rank)
      || String(left.candidateId).localeCompare(String(right.candidateId)))[0] || null;
}

function reportHtml(report) {
  const trial = report.trials.map((row) => `<h2>${escape(row.propositionId)}</h2><p>${escape(row.assertion)}</p><table><thead><tr><th>Document</th><th>Title</th><th>Baseline</th><th>Scorer</th><th>Score</th><th>Acquisition</th><th>Bearing</th></tr></thead><tbody>${row.candidates.map((candidate) => `<tr><td>${escape(candidate.documentKey)}</td><td>${escape(candidate.title)}</td><td>${candidate.baselineRank ?? ""}</td><td>${candidate.preBearingRank ?? ""}</td><td>${candidate.snippetPreBearingLikelihood}</td><td>${escape(candidate.acquisitionResult || "not selected")}</td><td>${escape(candidate.actualOutcome || "not assessed")}</td></tr>`).join("")}</tbody></table>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CFX snippet pre-bearing A/B</title><style>body{font-family:system-ui;margin:2rem;line-height:1.4}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:5px;vertical-align:top}th{position:sticky;top:0;background:#eee}code{font-size:12px}</style></head><body><h1>CFX deterministic snippet pre-bearing A/B</h1><p>Run: <code>${escape(report.runId)}</code></p><pre>${escape(JSON.stringify(report.summary,null,2))}</pre>${trial}</body></html>`;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const [documentsRaw, inputsRaw] = await Promise.all([
    readFile(path.join(frozenRun,"canonical_documents.json")),
    readFile(path.join(frozenRun,"evidence_inputs.json")),
  ]);
  const documents = JSON.parse(documentsRaw);
  const inputs = JSON.parse(inputsRaw);
  if (documents.length !== 169) throw new Error(`Frozen pool must contain 169 documents, got ${documents.length}`);
  const selectedInputs = trialPropositionIds.map((id) => inputs.find((row) => row.propositionId === id));
  if (selectedInputs.some((row) => !row)) throw new Error("Trial proposition inputs are missing");

  const runtime = await import("../../dist/claimfoundry/cfx/retrieval/snippetPreBearingLikelihood.js");
  const bearing = await import("../../dist/claimfoundry/cfx/evidenceBearing/documentExtraction.js");
  const prompt = await bearing.loadCfxDocumentBearingPrompt();
  const runId = `cfx-prebearing-ab-${stamp()}`;
  const root = path.join(repositoryRoot,"artifacts/claim-foundry/cfx/CF1-F03",runId);
  await mkdir(root,{recursive:false});

  const selections = [];
  const trialInventories = [];
  for (const input of selectedInputs) {
    const baseline = runtime.selectCfxFormerSearchRankBaseline(input,documents,5);
    const scored = runtime.selectCfxSnippetPreBearing(input,documents,5);
    const baselineRank = new Map(baseline.map((row,index)=>[row.documentKey,index+1]));
    const scoredRank = new Map(scored.map((row,index)=>[row.documentKey,index+1]));
    const candidateRows = documents.map((document) => ({
      documentKey:document.documentKey,
      title:document.representative.title,
      url:document.canonicalUrl || document.representative.url,
      assignment:assignment(document,input.propositionId),
      baselineRank:baselineRank.get(document.documentKey) || null,
      preBearingRank:scoredRank.get(document.documentKey) || null,
      ...runtime.scoreCfxSnippetPreBearing(input,document),
    }));
    trialInventories.push({propositionId:input.propositionId,assertion:input.substantiveAssertion,candidates:candidateRows});
    for (const document of [...baseline,...scored]) {
      const key = document.documentKey;
      let selection = selections.find((row)=>row.document.documentKey===key);
      if (!selection) {
        selection={document,selectedFor:[]};
        selections.push(selection);
      }
      const prior=selection.selectedFor.find((row)=>row.propositionId===input.propositionId);
      if (prior) {
        prior.baseline ||= baselineRank.has(key);
        prior.scorer ||= scoredRank.has(key);
      } else {
        selection.selectedFor.push({
          propositionId:input.propositionId,
          baseline:baselineRank.has(key),
          scorer:scoredRank.has(key),
        });
      }
    }
  }
  if (selections.length > 20) throw new Error(`Selection union exceeds 20 documents: ${selections.length}`);
  await writeJson(path.join(root,"preflight.json"),{
    runId,execute,frozenPoolPath:path.relative(repositoryRoot,frozenRun),
    frozenPoolSha256:sha256(documentsRaw),evidenceInputsSha256:sha256(inputsRaw),
    frozenCanonicalDocumentCount:documents.length,trialPropositionIds,
    semanticConfig,promptHash:prompt.promptHash,schemaHash:bearing.cfxDocumentBearingSchemaHash(),
    selectionCount:selections.reduce((sum,row)=>sum+row.selectedFor.length,0),
    uniqueAcquisitionCount:selections.length,productionMutation:false,
  });
  await writeJson(path.join(root,"complete_169_document_inventory.json"),trialInventories);
  await writeJson(path.join(root,"selections.json"),selections.map((row)=>({documentKey:row.document.documentKey,selectedFor:row.selectedFor,representative:row.document.representative})));

  if (!execute) {
    console.log(json({status:"preflight_only",runId,root,uniqueAcquisitionCount:selections.length}));
    return;
  }

  const acquisitionResults = [];
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(2,selections.length)},async()=>{
    while (cursor < selections.length) {
      const index=cursor++;
      const selection=selections[index];
      const acquired=await acquireCfxDocumentAutomatically({candidate:selection.document.representative});
      const documentRoot=path.join(root,"documents",selection.document.documentKey);
      await mkdir(documentRoot,{recursive:true});
      const safeAttempts=[];
      for (const attempt of acquired.attempts || []) {
        const attemptName=`attempt-${String(attempt.ordinal).padStart(3,"0")}`;
        const raw=attempt.rawResponse;
        if (raw != null) await writeFile(path.join(documentRoot,`${attemptName}-raw-response.txt`),String(raw));
        safeAttempts.push({...attempt,rawResponse:raw==null?null:`${attemptName}-raw-response.txt`,rawResponseSha256:raw==null?null:sha256(String(raw))});
      }
      if (acquired.cleanedText) await writeFile(path.join(documentRoot,"immutable-cleaned-text.txt"),acquired.cleanedText);
      const row={selection,index,acquired:{...acquired,cleanedText:acquired.cleanedText?"immutable-cleaned-text.txt":null,attempts:safeAttempts},accessLevel:accessLevel(acquired),semantic:null};
      await writeJson(path.join(documentRoot,"acquisition.json"),row.acquired);
      acquisitionResults[index]=row;
    }
  }));

  const provider=createProductionCfxStructuredProvider();
  const targets=inputs.map((input,index)=>({propositionId:input.propositionId,claimId:Number(input.claimId)||index+1,assertion:input.substantiveAssertion}));
  let providerCalls=0;
  for (const row of acquisitionResults) {
    if (!["full_text","substantial_excerpt","abstract"].includes(row.accessLevel)) continue;
    const text=await readFile(path.join(root,"documents",row.selection.document.documentKey,"immutable-cleaned-text.txt"),"utf8");
    const access={candidateId:row.selection.document.documentKey,accessLevel:row.accessLevel,textSource:row.acquired.method,text,characterCount:text.length,wordCount:text.trim().split(/\s+/u).length,sourceUrl:row.acquired.sourceUrl,canonicalUrl:row.acquired.resolvedUrl,doi:row.selection.document.doi||null,pmid:row.selection.document.pmid||null,retrievalAttempts:row.acquired.attempts,accessDiagnostics:[]};
    const planned=bearing.buildCfxDocumentBearingRequests({documentId:row.selection.document.documentKey,targets,access,prompt,...semanticConfig,maximumDocumentCharactersPerRequest:180_000});
    if (providerCalls+planned.length>20) {
      row.semantic={status:"semantic_budget_exhausted",plannedCalls:planned.length};
      continue;
    }
    const documentRoot=path.join(root,"documents",row.selection.document.documentKey);
    const result=await bearing.runCfxDocumentBearingExtraction({
      documentId:row.selection.document.documentKey,targets,access,prompt,provider,
      ...semanticConfig,maximumDocumentCharactersPerRequest:180_000,
      async beforeInvoke(request,part){providerCalls+=1;await writeJson(path.join(documentRoot,`semantic-request-${String(part.partIndex).padStart(3,"0")}.json`),request);},
      async afterResponse(value,part){await writeJson(path.join(documentRoot,`semantic-raw-response-${String(part.partIndex).padStart(3,"0")}.json`),value.rawResponse);await writeJson(path.join(documentRoot,`semantic-response-metadata-${String(part.partIndex).padStart(3,"0")}.json`),value.metadata);},
    });
    row.semantic=result;
    await writeJson(path.join(documentRoot,"semantic-result.json"),result);
  }

  for (const trial of trialInventories) {
    for (const candidate of trial.candidates) {
      const acquired=acquisitionResults.find((row)=>row.selection.document.documentKey===candidate.documentKey);
      if (!acquired) continue;
      candidate.acquisitionResult=acquired.accessLevel;
      candidate.acquisitionTiers=acquired.acquired.attempts.map((attempt)=>`${attempt.method}:${attempt.status}`);
      candidate.acquiredTextLength=acquired.acquired.cleanedText ? (await readFile(path.join(root,"documents",candidate.documentKey,"immutable-cleaned-text.txt"),"utf8")).length : 0;
      const target=acquired.semantic?.merged?.acceptedTargets?.find((value)=>value.propositionId===trial.propositionId)
        || acquired.semantic?.acceptedTargets?.find((value)=>value.propositionId===trial.propositionId);
      const relations=[...new Set((target?.assertions||[]).map((value)=>value.bearingRelation))];
      candidate.actualOutcome=relations.length?relations.join(", "):acquired.semantic?"no_bearing":"not_assessed";
      candidate.evidenceAssertions=target?.assertions||[];
    }
  }
  const selectorMetrics=(kind)=>{
    const chosen=trialInventories.flatMap((trial)=>trial.candidates.filter((row)=>kind==="baseline"?row.baselineRank:row.preBearingRank));
    return {selections:chosen.length,acquired:chosen.filter((row)=>["full_text","substantial_excerpt","abstract"].includes(row.acquisitionResult)).length,actualBearing:chosen.filter((row)=>!["not_assessed","no_bearing",undefined].includes(row.actualOutcome)).length,noBearing:chosen.filter((row)=>row.actualOutcome==="no_bearing").length};
  };
  const report={runId,status:"completed",summary:{frozenPool:169,trialAssertions:2,uniqueAcquisitions:selections.length,providerCalls,baseline:selectorMetrics("baseline"),scorer:selectorMetrics("scorer")},trials:trialInventories};
  await writeJson(path.join(root,"comparison_report.json"),report);
  await writeFile(path.join(root,"report.html"),reportHtml(report));
  console.log(json({status:"completed",runId,root,providerCalls,report:path.join(root,"report.html")}));
}

main().catch((error)=>{console.error(error);process.exitCode=1;});
