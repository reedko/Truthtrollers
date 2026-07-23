import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const fixturesRoot = path.join(repoRoot, "backend/test/claim-foundry/fixtures");
const keysRoot = path.join(repoRoot, "backend/test/claim-foundry/prompt-evaluation-keys");
const outputRoot = path.join(repoRoot, "ml/cf1-argument-model/data/annotation-forms");
const promptRoot = path.join(repoRoot, "ml/cf1-argument-model/data/annotation-prompts");
const force = process.argv.includes("--force");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function oldKeyTargets(key) {
  const targets = [];
  const add = (category, values, mapper = (value) => ({ description: value })) => {
    values.forEach((value, index) => {
      targets.push({
        targetId: `${key.fixtureId.toLowerCase()}-${category.replaceAll("_", "-")}-${String(index + 1).padStart(2, "0")}`,
        category,
        ...mapper(value),
        required: true,
      });
    });
  };
  add("required_concept", key.requiredConcepts ?? []);
  add("required_pillar", key.requiredPillars ?? []);
  add("required_source_region", key.requiredSourceRegions ?? [], (value) => ({
    description: value.label,
    excerpt: value.excerpt,
  }));
  return targets;
}

function loadFixture(fixtureId) {
  const fixtureRoot = path.join(fixturesRoot, fixtureId);
  const articlePath = path.join(fixtureRoot, "article.json");
  const metadataPath = path.join(fixtureRoot, "fixture-metadata.json");
  const proposedKeyPath = path.join(fixtureRoot, "expectations.proposed.json");
  const evaluationKeyPath = path.join(keysRoot, `${fixtureId}.json`);

  const article = readJson(articlePath);
  const metadata = fs.existsSync(metadataPath)
    ? readJson(metadataPath)
    : readJson(proposedKeyPath);
  const key = fs.existsSync(evaluationKeyPath)
    ? readJson(evaluationKeyPath)
    : readJson(proposedKeyPath);

  return {
    article,
    metadata,
    key,
    articlePath: path.relative(repoRoot, articlePath),
    keyPath: path.relative(repoRoot, fs.existsSync(evaluationKeyPath) ? evaluationKeyPath : proposedKeyPath),
  };
}

function buildForm(fixtureId) {
  const { article, metadata, key, articlePath, keyPath } = loadFixture(fixtureId);
  const targets = Array.isArray(key.targets) ? key.targets : oldKeyTargets(key);
  const reviewNotes = key.reviewNotes ?? key.humanReviewNotes ?? [];

  return {
    schemaVersion: "cf1.argumentAnnotation.v1",
    fixture: {
      fixtureId,
      fixtureRevision: metadata.fixtureRevision,
      fixtureClass: metadata.fixtureClass,
      title: article.title ?? null,
      articlePath,
      evaluatorKeyPath: keyPath,
      chatDraftPromptPath: `ml/cf1-argument-model/data/annotation-prompts/${fixtureId}.chat-prompt.md`,
    },
    adjudication: {
      status: "draft",
      primaryAnnotatorId: null,
      independentReviewerId: null,
      startedAt: null,
      approvedAt: null,
      notes: "",
    },
    orientation: {
      theme: null,
      thesis: null,
      thesisStatus: null,
      thesisHinge: {
        proposition: null,
        ifSupportedEffectOnThesis: null,
        ifRefutedEffectOnThesis: null,
      },
      basisSourceUnitIds: [],
      notes: "",
    },
    passageCoverage: [],
    argumentUnits: [],
    relations: [],
    consistencyFindings: [],
    rubricCoverage: {
      targets: targets.map((target) => ({
        ...target,
        adjudicatorStatus: "unreviewed",
        argumentUnitIds: [],
        relationIds: [],
        notes: "",
      })),
      prohibitedInterpretations: (key.prohibitedInterpretations ?? []).map((description, index) => ({
        prohibitionId: `${fixtureId.toLowerCase()}-prohibited-${String(index + 1).padStart(2, "0")}`,
        description,
        adjudicatorStatus: "unreviewed",
        notes: "",
      })),
      inheritedReviewNotes: reviewNotes,
    },
    finalChecks: {
      completeArticleReviewed: false,
      everyArgumentUnitGrounded: false,
      everyPropositionAtomic: false,
      attributionReviewedIndependentlyOfStance: false,
      opponentPolarityPreserved: false,
      relationsReviewed: false,
      evidenceTargetsReviewed: false,
      rubricCoverageReviewed: false,
      keyDisagreementsResolvedOrFlagged: false,
    },
  };
}

async function buildChatPrompt(fixtureId) {
  const { article, metadata } = loadFixture(fixtureId);
  const { articleDocumentFromText } = await import(path.join(repoRoot,
    "backend/src/claim-foundry/article-document/fromText.js"));
  const document = articleDocumentFromText({
    text: article.text,
    metadata: {
      title: article.title,
      authors: article.authors ?? [],
      language: article.language ?? "en",
    },
    sourceDescriptor: { fixtureId },
  });
  const sourceUnits = document.sourceUnits
    .map((unit) => `[${unit.unitId}] ${unit.text}`)
    .join("\n");

  return `# ${fixtureId} first-draft argument annotation

Paste this entire document into a chat model. The response is a draft for human adjudication, not authoritative training data.

## Instructions

Read every numbered source unit in order. Create a complete, source-grounded draft argument annotation.

Do not evaluate whether the article is factually true. Describe what it argues, reports, endorses, opposes, rebuts, or qualifies.

1. Cover every source unit in passageCoverage. Consecutive context-only units may be grouped. Use narrow groups around material assertions.
2. Extract every distinct material, externally testable factual assertion. Do not stop after finding a representative portfolio.
3. Make each canonical proposition atomic. If a passage supplies multiple independently testable propositions, create separate argument units.
4. Preserve an opponent proposition in its original polarity. Do not rewrite it into the article's preferred conclusion.
5. Determine assertion source independently of stance. Evidence cited for a proposition is not automatically the proposition's supplier.
6. Use article_voice only when the article's author or narrative voice supplies the complete proposition. Use unknown only when the supplied text genuinely does not resolve the supplier.
7. Record article deployment and rhetorical role independently of the proposition's real-world plausibility.
8. Link propositions that support, rebut, qualify, contradict, elaborate, or provide evidence for one another.
9. Do not invent propositions from absent images, missing links, outside knowledge, or an anticipated answer key.
10. Return valid JSON only, with no Markdown fence and no commentary.

Allowed passageCoverage.classification values:
material_assertion_present, no_material_assertion, mixed, duplicate_expression, uncertain.

Allowed assertionSource.kind values:
article_voice, person, institution, document, study, legal_party, unknown.

Allowed contentStance values:
supports_thesis, contradicts_thesis, neutral, unclear.

Allowed deployment values:
endorsed, opponent_to_rebut, rebutted, qualified, reported_neutral, unclear.

Allowed role values:
pillar, pillar_support, opponent_claim, rebuttal, qualification, context, unclear.

Allowed relation types:
supports, rebuts, qualifies, contradicts, elaborates, provides_evidence_for, attributed_to.

## Required response shape

{
  "schemaVersion": "cf1.argumentDraft.v1",
  "fixtureId": "${fixtureId}",
  "orientation": {
    "theme": "string or null",
    "thesis": "string or null",
    "thesisStatus": "clear, mixed, weak, absent, or unclear",
    "thesisHinge": {
      "proposition": "string or null",
      "ifSupportedEffectOnThesis": "strengthens, weakens, neutral, or unclear",
      "ifRefutedEffectOnThesis": "strengthens, weakens, neutral, or unclear"
    },
    "basisSourceUnitIds": ["U####"],
    "notes": ""
  },
  "passageCoverage": [
    {
      "coverageId": "COV001",
      "sourceUnitIds": ["U####"],
      "classification": "material_assertion_present",
      "argumentUnitIds": ["AU001"],
      "basis": ""
    }
  ],
  "argumentUnits": [
    {
      "argumentUnitId": "AU001",
      "grounding": {
        "sourceUnitIds": ["U####"],
        "verbatimExcerpt": ""
      },
      "canonicalAtomicProposition": "",
      "scopeQualifiers": [],
      "assertionSource": {
        "kind": "unknown",
        "name": "unknown",
        "sourceUnitIds": [],
        "basis": ""
      },
      "articleTreatment": {
        "contentStance": "unclear",
        "deployment": "unclear",
        "role": "unclear",
        "basis": ""
      },
      "evidenceTarget": {
        "disputedProposition": "",
        "verificationQuestion": "",
        "supportWouldRequire": [],
        "refuteWouldRequire": [],
        "qualifyWouldRequire": [],
        "warrant": ""
      },
      "portfolio": {
        "include": true,
        "basis": ""
      },
      "notes": ""
    }
  ],
  "relations": [
    {
      "relationId": "REL001",
      "fromArgumentUnitId": "AU002",
      "type": "rebuts",
      "toArgumentUnitId": "AU001",
      "sourceUnitIds": ["U####"],
      "basis": ""
    }
  ],
  "consistencyFindings": [
    {
      "findingId": "CON001",
      "argumentUnitIds": ["AU001", "AU002"],
      "type": "contradiction, tension, qualification, or not_contradiction",
      "basis": ""
    }
  ]
}

## Article metadata

Title: ${article.title}
Authors: ${(article.authors ?? []).join(", ") || "not supplied"}
Fixture class (administrative; do not force the article to exhibit it): ${metadata.fixtureClass}

## Numbered source units

${sourceUnits}
`;
}

fs.mkdirSync(outputRoot, { recursive: true });
fs.mkdirSync(promptRoot, { recursive: true });

for (let number = 1; number <= 9; number += 1) {
  const fixtureId = `CF1-F${String(number).padStart(2, "0")}`;
  const outputPath = path.join(outputRoot, `${fixtureId}.annotation.json`);
  const promptPath = path.join(promptRoot, `${fixtureId}.chat-prompt.md`);
  if (fs.existsSync(outputPath) && !force) {
    console.log(`skip ${path.relative(repoRoot, outputPath)} (already exists)`);
  } else {
    fs.writeFileSync(outputPath, `${JSON.stringify(buildForm(fixtureId), null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, outputPath)}`);
  }
  if (fs.existsSync(promptPath) && !force) {
    console.log(`skip ${path.relative(repoRoot, promptPath)} (already exists)`);
  } else {
    fs.writeFileSync(promptPath, await buildChatPrompt(fixtureId));
    console.log(`wrote ${path.relative(repoRoot, promptPath)}`);
  }
}
