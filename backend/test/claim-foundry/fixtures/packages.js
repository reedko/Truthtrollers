import { validateArticleInput } from "../../../src/claim-foundry/validateArticleInput.js";
import { normalizeAgentDraft } from "../../../src/claim-foundry/normalizeAgentDraft.js";
import { assembleCf1Package, finalizeCf1Package } from "../../../src/claim-foundry/assemblePackage.js";
import { createPackageId, createRunId } from "../../../src/claim-foundry/ids.js";
import { verifyCf1Package } from "../../../src/claim-foundry/verifyPackage.js";
import { articleDocumentFromText, buildArticleSourceBlocks } from
  "../../../src/claim-foundry/article-document/index.js";

const FIRST = "A city audit found that bridge repairs were delayed for two years.";
const SECOND = "The audit, DOI:10.1234/Bridge.7, says procurement began nine months late.";
const TEXT = `${FIRST}\n\n${SECOND}`;

export function createArticleAndBlocks() {
  const article = validateArticleInput({ title: "Bridge repair audit", text: TEXT,
    authors: ["Alex Rivera"], publishedAt: "2024-04-12T00:00:00Z",
    url: "https://doi.org/10.1234/Bridge.7", metadataWarnings: [] });
  const articleDocument = articleDocumentFromText({ text: article.text,
    metadata: { title: article.title } });
  const structuralBlocks = buildArticleSourceBlocks(articleDocument);
  return { article, articleDocument, structuralBlocks };
}

export function createAgentDraft() {
  return {
    semanticBlockAnnotations: [
      { blockId: "B001", semanticFunction: "thesis_framing", articleStance: "endorses", speakerEntities: ["city audit"], relatedBlockIds: [], confidence: 0.95 },
    ],
    rawAssertions: [{
      rawAssertionId: "agent-raw-a", text: "Procurement for the bridge repairs began nine months late.",
      sourceUnitIds: ["U0002"], speakerEntity: null,
      assertionForm: "direct", articleUse: "endorsed", namedEntities: ["bridge repairs"],
      namedWorks: ["city audit"], numbersAndDates: ["nine months"],
      reconciliation: { canonicalRawAssertionId: "agent-raw-a", relationship: "unique", relatedRawAssertionIds: [], rationale: "Single occurrence." },
    }],
    articleMap: {
      theme: "Responsibility for delayed bridge repairs.",
      thesis: { text: "Management delay contributed to late repairs.", sourceBlockIds: ["B001"], rawAssertionIds: ["agent-raw-a"] },
      pillars: [{ pillarId: "agent-pillar-a", label: "Late procurement", text: "Procurement began nine months late.", sourceBlockIds: ["B001"], rawAssertionIds: ["agent-raw-a"], importance: "load_bearing" }],
      clusters: [{ clusterId: "agent-cluster-a", label: "Delay timing", rawAssertionIds: ["agent-raw-a"], relationship: "same_proposition_family" }],
      opponentPositions: [], qualifications: [], mapWarnings: [],
    },
    internalConsistencyFindings: [],
    selectedEvaluationClaims: [{
      selectedClaimId: "agent-selected-a", claimText: "Bridge-repair procurement began nine months late.",
      sourceRawAssertionIds: ["agent-raw-a"], articleRole: "pillar",
      relatedPillarIds: ["agent-pillar-a"], materiality: "high",
      counterfactualImpact: "If false, the article loses its clearest evidence of management delay.",
      selectionRationale: "The measurable timing claim bears directly on the thesis.",
      scoreTransform: "normal", searchEligible: true, verdictEligible: true, confidence: 0.95,
    }],
    phase3Targets: [{
      targetId: "agent-target-a", selectedClaimId: "agent-selected-a",
      targetText: "Bridge-repair procurement began nine months late.",
      targetType: "article_endorsed_substantive", scoreTransform: "normal",
      searchEligible: true, verdictEligible: true,
      sourceRawAssertionIds: ["agent-raw-a"],
      mappingStatus: "resolved", mappingRationale: "Direct measurable timing proposition.",
    }],
    evidenceNeedCards: [{
      targetId: "agent-target-a", evidenceRolesNeeded: ["primary-record"],
      bearingCriteria: { mustMatch: ["same bridge procurement"], shouldMatch: ["audit timeline"], rejectIfOnly: ["general procurement discussion"], weak: false },
      queryLaneSeeds: [{ laneType: "primary-record", query: "bridge audit procurement timing", purpose: "Find the audit timeline.", sourceFieldsUsed: ["targetText"] }],
      identifierHints: { doi: ["https://doi.org/10.1234/BRIDGE.7"], pmid: [], titleExact: [], authorYear: [], quotedDocumentNames: [], canonicalSourceIds: [] },
    }],
    selectionCountException: "Short unit fixture has one material claim.",
    agentWarnings: [],
  };
}

export function createOneCallAgentOutput() {
  const work = { mentionText: "The audit", workType: "report", year: null,
    peopleOrOrganizations: ["city audit"], identifiers: ["10.1234/Bridge.7"] };
  const initialCandidates = [
    { claimText: "Bridge repairs were delayed for two years.", sourceUnitIds: ["U0001"] },
    { claimText: "Bridge-repair procurement began nine months late.", sourceUnitIds: ["U0002"] },
  ];
  const selectedClaims = [{
    claimText: "The city audit found that bridge-repair procurement began nine months late.",
    sourceUnitIds: ["U0002"], assertionSource: "city audit", articleUse: "endorsed",
    namedWorkHints: [work],
    articleRole: "thesis", relatedPillarLabels: ["Late procurement"],
    themeBearing: "If refuted, the article's management-delay thesis would lose its procurement-timing basis.",
    materiality: "high", claimMode: "factual",
    scope: "The bridge-repair procurement timeline examined by the city audit.",
    claimTrueIf: "The audit timeline dates procurement nine months after its required start.",
    claimFalseIf: "The audit timeline shows procurement began on time or less than nine months late.",
    claimQualifiedIf: "Only part of the procurement process was delayed by nine months.",
  }];
  return {
    orientation: { theme: "Management delays are central to the article's explanation for late bridge repairs.",
      thesis: "Management delay contributed to late repairs.",
      pillars: [{ label: "Late procurement", text: "Procurement began nine months late.",
        importance: "load_bearing" }] },
    initialCandidates,
    critic: { summary: "The procurement claim needs explicit audit attribution.",
      findings: [{ type: "missing_attribution", severity: "material",
        problem: "The procurement claim omits its source.",
        recommendedAction: "Name the city audit in the selected wording." }] },
    revisionTrace: [{ findingType: "missing_attribution",
      beforeClaimText: "Bridge-repair procurement began nine months late.",
      afterClaimText: null, action: "drop", explanation: "Dropped unattributed wording." },
    { findingType: "missing_attribution", beforeClaimText: null,
      afterClaimText: "The city audit found that bridge-repair procurement began nine months late.",
      action: "add", explanation: "Added audit-attributed wording." }],
    selectedClaims,
  };
}

export function createSemanticInventoryOutput() {
  const output = createOneCallAgentOutput();
  return {
    theme: { text: output.orientation.theme, sourceUnitIds: ["U0001", "U0002"] },
    thesis: { text: output.orientation.thesis, sourceUnitIds: ["U0002"] },
    pillars: output.orientation.pillars.map((pillar) => ({ ...pillar, sourceUnitIds: ["U0002"] })),
    namedWorks: [{ mentionText: "The audit", workType: "review_report", citationCallout: null,
      source: "text_mention", confidence: "high", sourceUnitIds: ["U0002"], linkResolved: false,
      year: null, peopleOrOrganizations: ["city audit"], identifiers: ["10.1234/Bridge.7"] }],
    candidateClaims: [{ claimText: output.initialCandidates[0].claimText,
      sourceUnitIds: ["U0001"], articleRole: "pillar_support", articleUse: "endorsed",
      assertionSource: "city audit", materiality: "medium", relatedPillarLabels: ["Late procurement"],
      namedWorkHints: [], scope: "The bridge repair delay reported in the city audit.",
      evidenceUsefulnessHint: "The city audit timeline can test the reported delay." },
    { claimText: output.initialCandidates[1].claimText,
      sourceUnitIds: ["U0002"], articleRole: "thesis", articleUse: "endorsed",
      assertionSource: "city audit", materiality: "high", relatedPillarLabels: ["Late procurement"],
      namedWorkHints: output.selectedClaims[0].namedWorkHints,
      scope: output.selectedClaims[0].scope,
      evidenceUsefulnessHint: "The audit's dated procurement record can directly test the timing." }],
  };
}

export function createSelectedEnrichmentOutput() {
  const claim = createOneCallAgentOutput().selectedClaims[0];
  const { claimText, claimTrueIf, claimFalseIf, claimQualifiedIf, themeBearing } = claim;
  return { enrichedClaims: [{ claimText, claimTrueIf, claimFalseIf, claimQualifiedIf,
    themeBearing, candidateId: "C02", relevantNamedWorkIds: ["NW001"],
    namedWorkRelevanceNote: "NW001 is the primary record for the timing claim.",
    verificationQuestion: "Did the city audit find that bridge-repair procurement began nine months late?",
    bestSourceTypes: ["city audit", "procurement timeline"],
    requiredEvidenceRoles: ["target-primary", "primary-record", "study-identity"],
    mustMatch: ["same bridge-repair procurement", "nine-month timing"],
    shouldMatch: ["city audit timeline"],
    rejectIfOnly: ["A source discusses bridge repairs without documenting procurement timing."],
    weakBearing: false, warnings: [],
    identifierHints: { doi: ["10.1234/Bridge.7"], pmid: [], canonicalSourceIds: [] },
    queryLaneSeeds: [{ laneType: "primary-record", query: "city audit bridge procurement nine months",
      purpose: "Locate the dated procurement timeline." }],
  }] };
}

export function createNormalizedDraft() {
  const source = createArticleAndBlocks();
  return { ...source, normalizedDraft: normalizeAgentDraft(createAgentDraft(), source) };
}

export function createPackageDraft(overrides = {}) {
  const { article, articleDocument, normalizedDraft } = createNormalizedDraft();
  const packageDraft = assembleCf1Package({ article, articleDocument, normalizedDraft, packageId: createPackageId(),
    runId: createRunId(), createdAt: "2026-07-13T10:00:00.000Z" });
  return Object.assign(packageDraft, structuredClone(overrides));
}

export function createValidPackage() {
  const draft = createPackageDraft();
  const verification = verifyCf1Package(draft, { clock: () => new Date("2026-07-13T10:00:01.000Z") });
  return finalizeCf1Package(draft, verification);
}
