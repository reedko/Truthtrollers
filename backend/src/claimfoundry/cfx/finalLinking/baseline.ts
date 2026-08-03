import {
  stableCfxSourceAssertionId,
  type CfxPersistableSourceAssertion,
} from "./linkSuggestion.js";

type AcceptedBaselineRow = {
  assertionId: string;
  documentId: string;
  sourceAssertion: string;
  exactExcerpt: string;
  packetIds: string[];
  blockIds: string[];
  grounding: {
    documentCharStart: number;
    documentCharEnd: number;
  };
};

type ExactExtractionRequest = {
  callId: string;
  assertionId: string;
  assertionText: string;
  documentId: string;
};

type SelectedDocumentArtifact = {
  perAssertion?: Array<{
    propositionId: string;
    assertion: string;
    selected: Array<{
      documentKey: string;
      title: string;
      url: string;
    }>;
  }>;
};

export type CfxSourceDocument = {
  documentId: string;
  title: string;
  url: string;
};

export function prepareCfxFinalLinkingBaseline(input: {
  extractionRunId: string;
  acceptedRows: unknown;
  exactExtractionRequests: unknown;
  extractionPromptHash: string;
  extractionSchemaHash: string;
  selectedDocuments: unknown;
}): {
  rows: CfxPersistableSourceAssertion[];
  documents: CfxSourceDocument[];
  caseAssertions: Array<{ caseAssertionId: string; caseAssertionText: string }>;
} {
  if (!Array.isArray(input.acceptedRows) || input.acceptedRows.length !== 14) {
    throw new Error("authoritative source inventory must contain exactly 14 accepted rows");
  }
  if (!Array.isArray(input.exactExtractionRequests) || input.exactExtractionRequests.length !== 9) {
    throw new Error("authoritative extraction run must contain exactly nine requests");
  }
  const requests = input.exactExtractionRequests as ExactExtractionRequest[];
  const requestByPair = new Map(requests.map((request) => [
    `${request.assertionId}\u0000${request.documentId}`,
    request,
  ]));
  if (requestByPair.size !== requests.length) throw new Error("extraction request pairs must be unique");

  const selected = input.selectedDocuments as SelectedDocumentArtifact;
  const documentById = new Map<string, CfxSourceDocument>();
  for (const assertion of selected?.perAssertion ?? []) {
    for (const document of assertion.selected ?? []) {
      const value = {
        documentId: String(document.documentKey),
        title: String(document.title),
        url: String(document.url),
      };
      const prior = documentById.get(value.documentId);
      if (prior && JSON.stringify(prior) !== JSON.stringify(value)) {
        throw new Error(`document metadata collision for ${value.documentId}`);
      }
      documentById.set(value.documentId, value);
    }
  }

  const rows = (input.acceptedRows as AcceptedBaselineRow[]).map((row) => {
    const request = requestByPair.get(`${row.assertionId}\u0000${row.documentId}`);
    if (!request) throw new Error(`accepted row lacks extraction request: ${row.assertionId} ${row.documentId}`);
    const document = documentById.get(row.documentId);
    if (!document) throw new Error(`accepted row lacks document metadata: ${row.documentId}`);
    const sourceAssertionId = stableCfxSourceAssertionId({
      caseAssertionId: row.assertionId,
      documentId: row.documentId,
      exactExcerpt: row.exactExcerpt,
      sourceAssertion: row.sourceAssertion,
    });
    return {
      sourceAssertionId,
      caseAssertionId: row.assertionId,
      caseAssertionText: request.assertionText,
      documentId: row.documentId,
      documentTitle: document.title,
      documentUrl: document.url,
      sourceAssertion: row.sourceAssertion,
      exactExcerpt: row.exactExcerpt,
      documentCharStart: Number(row.grounding.documentCharStart),
      documentCharEnd: Number(row.grounding.documentCharEnd),
      sourceBlockIds: [...row.blockIds],
      sourcePacketIds: [...row.packetIds],
      extractionRunId: input.extractionRunId,
      extractionModelCallId: request.callId,
      extractionPromptHash: input.extractionPromptHash,
      extractionSchemaHash: input.extractionSchemaHash,
    };
  });
  if (new Set(rows.map((row) => row.sourceAssertionId)).size !== rows.length) {
    throw new Error("stable sourceAssertionId values must be unique across the 14-row inventory");
  }
  const caseAssertions = [...new Map(rows.map((row) => [row.caseAssertionId, {
    caseAssertionId: row.caseAssertionId,
    caseAssertionText: row.caseAssertionText,
  }])).values()];
  if (caseAssertions.length !== 2
    || !caseAssertions.some((row) => row.caseAssertionId === "P54895")
    || !caseAssertions.some((row) => row.caseAssertionId === "P54897")) {
    throw new Error("authoritative inventory must contain only P54895 and P54897");
  }
  return {
    rows,
    documents: [...new Set(rows.map((row) => row.documentId))].map((id) => documentById.get(id)!),
    caseAssertions,
  };
}
