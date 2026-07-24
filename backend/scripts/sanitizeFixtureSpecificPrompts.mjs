#!/usr/bin/env node
// Versions active database prompts to remove fixture-specific examples.
// Dry-run by default. With --apply, writes a JSON backup before changing rows.
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
const repoRoot = path.resolve(backend, "..");
const { pool } = await import("../src/db/pool.js");

const CLEAN_PROMPTS = Object.freeze({
  evidence_query_generation_system: {
    promptType: "system",
    promptText: `You generate precise search queries for fact-checking.
Return strict JSON only.

Preserve the exact atomic assertion being checked. If the input includes both an original claim and a core factual assertion, optimize queries for the core factual assertion while retaining named people, institutions, works, dates, and identifiers from the supplied input when useful.

Do not broaden a narrow allegation into a generic topic claim. Queries must target the alleged action, event, condition, or relationship itself. Never add a person, institution, study, date, identifier, or allegation that is absent from the supplied claim and context.`,
  },
  evidence_query_generation_user_balanced: {
    promptType: "user",
    promptText: `CLAIM TO VERIFY:
{{claimText}}

CONTEXT:
{{context}}

TASK: Generate EXACTLY {{n}} diverse search queries for this exact claim.

BALANCED DISTRIBUTION REQUIRED:
- {{supportQueries}} queries designed to find sources that SUPPORT the exact claim
- {{refuteQueries}} queries designed to find sources that REFUTE the exact claim
- {{nuanceQueries}} queries designed to find sources that provide NUANCED perspective

QUERY DESIGN RULES:
- Preserve the core factual assertion. Do not broaden it.
- If the input distinguishes an original claim from a core factual assertion, optimize for the core assertion.
- Retain named actors, institutions, works, dates, and identifiers only when supplied in the claim or context.
- For an attribution wrapper, target the underlying substantive assertion; include a bounded attribution query only when whether the source made the statement is independently material.
- For a misconduct allegation, preserve the exact alleged action and its object. Do not replace it with a query about the broader topic.
- Do not invent names, studies, dates, identifiers, synonyms that strengthen the allegation, or answer-like search terms.

OUTPUT FORMAT:
Return JSON:
{"queries":[{"query":"...","intent":"support|refute|nuance|background|factbox"}]}`,
  },
  claim_extraction_stack_system: {
    promptType: "system",
    promptText: `You extract atomic claims from scraped content.

Return strict JSON only. Do not include markdown, commentary, explanations, or text outside the JSON.

Extract what the content claims, alleges, implies, or quotes. Do not fact-check it. Do not correct it using outside knowledge. Do not invent facts not present in the text.

Each claim must be atomic, self-contained, and specific enough to search.

Preserve names, dates, organizations, agencies, companies, journals, laws, study titles, datasets, numbers, quotations, and specific causal links that appear in the supplied content.

Classify each claim with one role:
thesis, pillar, pillar_support, evidence, or background.

Use background only for context. If a claim supports the thesis or supports a pillar, classify it as pillar_support or evidence.

A pillar is a major argument branch.
A pillar_support claim connects a pillar to evidence.
An evidence claim is a specific factual assertion offered as proof.
A background claim is contextual information that does not directly carry the argument.

Give high priority to claims involving:
fraud, cover-up, suppression, censorship, concealment, evidence destruction, data manipulation, institutional misconduct, causal harm, statistics, named studies, named whistleblowers, retractions, corrections, excluded data, changed methodology, or claims that would seriously weaken the article if false.

When a claim contains both attribution and a substantive allegation, keep the displayed claim faithful to the content. Make searchText a compact retrieval form using only names, institutions, works, dates, actions, outcomes, and distinctive terms present in that claim or its source text. Do not fuse separate propositions or introduce any new entity, work, date, action, or conclusion.

Return only valid JSON.`,
  },
  argument_mapping_user: {
    promptType: "user",
    promptText: `You are mapping article claims into evaluation targets for VeriStrata.

Analyze each visible article claim and return both the existing scalar mapping fields and an array of atomic evaluation targets. Do not remove or rename scalar fields.

Definitions:
- claimText: the visible claim extracted from the article.
- objectClaim: the main substantive proposition being evaluated, excluding an attribution wrapper when possible.
- attribution target: whether a named person, institution, document, or source made a statement or allegation.
- substantive target: whether the underlying factual event, condition, conduct, or relationship occurred.
- inference target: whether a stated conclusion follows from underlying facts.
- study_identity target: resolution of the exact study, dataset, document, population, subgroup, protocol, analysis, or source artifact involved.

Rules:
- Use only the supplied article excerpt, thesis, and claims. Do not use outside knowledge.
- Never allow attribution verification to prove a substantive allegation.
- When a claim contains an attribution wrapper, separate whether the source made the statement from whether the underlying statement is true.
- Source identity alone never determines article stance. Determine stance from how the article deploys the proposition.
- Preserve the exact alleged action in misconduct claims; do not broaden, strengthen, or normalize it into a different allegation.
- Create a study_identity target only when resolving a specific work or dataset is necessary for search or evaluation.
- If an identity or scope cannot be resolved from supplied context, mark it underspecified rather than inventing it.
- A target may be search-eligible without being verdict-eligible. Study identity is a search prerequisite, not substantive verdict evidence.
- Keep targets atomic. General topical evidence must not be treated as bearing on a different predicate.
- Preserve allegation strength: do not convert an allegation into an established fact.

Return valid JSON only in this shape:
{
  "items": [
    {
      "claimId": "<existing claim id if provided>",
      "claimText": "<original visible claim text>",
      "objectClaim": "<primary substantive proposition>",
      "isAttribution": true,
      "speakerEntity": "<attributed source or null>",
      "articleStance": "endorses|rejects|neutral|unclear",
      "argumentFunction": "thesis|supporting_premise|evidence|opposing_claim_to_refute|background|reported_neutral|unclear",
      "scoreTransform": "normal|invert|none|review",
      "accountabilityEligible": false,
      "confidence": 0.0,
      "rationale": "<brief rationale>",
      "targets": [
        {
          "targetType": "attribution|substantive|inference|study_identity",
          "targetText": "<atomic proposition or identity-resolution target>",
          "subjectEntity": "<main actor/entity or null>",
          "predicateText": "<specific predicate/action/relation>",
          "objectText": "<predicate object or null>",
          "allegedAction": "<specific alleged act or null>",
          "studyTitle": "<exact supplied title or null>",
          "studyAuthors": "<supplied authors or null>",
          "studyYear": "<supplied year or null>",
          "studyIdentifier": "<supplied identifier or null>",
          "populationScope": "<relevant scope or null>",
          "sourceExcerpt": "<short supporting article excerpt>",
          "articleStance": "endorses|rejects|neutral|unclear",
          "scoreTransform": "normal|invert|none|review",
          "searchEligible": true,
          "verdictEligible": true,
          "resolutionStatus": "mapped|underspecified|resolved|unresolved",
          "mappingConfidence": 0.0,
          "mappingRationale": "<brief reason for this target>"
        }
      ]
    }
  ]
}

ARTICLE EXCERPT:
{{articleExcerpt}}

EXTRACTED THESIS:
{{articleThesis}}

CLAIMS:
{{claimsJson}}`,
  },
});

const apply = process.argv.includes("--apply");
const names = Object.keys(CLEAN_PROMPTS);
const placeholders = names.map(() => "?").join(", ");

function getConnection() {
  return new Promise((resolve, reject) => {
    pool.getConnection((error, connection) => error ? reject(error) : resolve(connection));
  });
}

const connection = await getConnection();
const query = promisify(connection.query).bind(connection);
const begin = promisify(connection.beginTransaction).bind(connection);
const commit = promisify(connection.commit).bind(connection);
const rollback = promisify(connection.rollback).bind(connection);

try {
  const rows = await query(
    `SELECT * FROM llm_prompts WHERE prompt_name IN (${placeholders}) ORDER BY prompt_name, version, prompt_id`,
    names,
  );
  const active = rows.filter((row) => Boolean(row.is_active));
  const latestByName = new Map();
  for (const row of rows) {
    const current = latestByName.get(row.prompt_name);
    if (!current || Number(row.version) > Number(current.version)
      || (Number(row.version) === Number(current.version) && row.prompt_id > current.prompt_id)) {
      latestByName.set(row.prompt_name, row);
    }
  }

  const plan = names.map((name) => {
    const prior = latestByName.get(name);
    if (!prior) throw new Error(`No database prompt exists for ${name}`);
    const activeForName = active.filter((row) => row.prompt_name === name);
    return {
      promptName: name,
      activeIds: activeForName.map((row) => row.prompt_id),
      priorVersion: Number(prior.version) || 0,
      newVersion: (Number(prior.version) || 0) + 1,
      promptType: CLEAN_PROMPTS[name].promptType,
      unchanged: activeForName.length === 1
        && String(activeForName[0].prompt_text) === CLEAN_PROMPTS[name].promptText,
    };
  });
  const pending = plan.filter((item) => !item.unchanged);

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", plan }, null, 2));
  if (!apply) process.exitCode = 0;
  else if (!pending.length) console.log("No changes: every active prompt already matches the clean version.");
  else {
    const generatedAt = new Date().toISOString();
    const stamp = generatedAt.replace(/[:.]/g, "-");
    const backupDir = path.join(repoRoot, "artifacts", "prompt-sanitization", stamp);
    mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, "llm_prompts-before.json");
    writeFileSync(backupPath, JSON.stringify({ generatedAt, rows }, null, 2));

    await begin();
    try {
      const idRows = await query("SELECT MAX(prompt_id) AS maxPromptId FROM llm_prompts FOR UPDATE");
      let nextPromptId = Number(idRows?.[0]?.maxPromptId || 0) + 1;
      for (const item of pending) {
        const prior = latestByName.get(item.promptName);
        await query("UPDATE llm_prompts SET is_active = 0 WHERE prompt_name = ?", [item.promptName]);
        await query(
          `INSERT INTO llm_prompts
            (prompt_id, prompt_name, prompt_type, prompt_text, parameters, version, is_active,
             min_sources, max_sources, max_claims)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [
            nextPromptId++,
            item.promptName,
            item.promptType,
            CLEAN_PROMPTS[item.promptName].promptText,
            typeof prior.parameters === "string"
              ? prior.parameters : JSON.stringify(prior.parameters ?? {}),
            item.newVersion,
            prior.min_sources ?? 2,
            prior.max_sources ?? 4,
            prior.max_claims ?? 12,
          ],
        );
      }
      await commit();
    } catch (error) {
      await rollback();
      throw error;
    }
    console.log(`Backup: ${backupPath}`);
  }
} finally {
  connection.release();
  await new Promise((resolve) => pool.end(resolve));
}
