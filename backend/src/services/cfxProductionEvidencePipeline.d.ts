export function loadProductionCfxEvidenceInputs(input: Record<string, any>): Promise<Array<Record<string, any>>>;
export class CfxQueryInputError extends Error {
  code: string;
  claimId: number;
  contentId: number;
  missingFields?: string[];
}
export function legacyDocumentQuality(candidate: Record<string, any>): number;
export function assertCfxProductionSchemaReady(
  query: (sql: string, values?: unknown[]) => Promise<any>,
): Promise<void>;
export function selectCfxCanonicalDocumentsForRun(
  documents: Array<Record<string, any>>,
  maximum?: number,
): Array<Record<string, any>>;
export function selectCfxTopRankedDocumentsPerAssertion(
  inputs: Array<Record<string, any>>,
  documents: Array<Record<string, any>>,
  maximum?: number,
): {
  policy: string;
  maximumPerAssertion: number;
  perAssertion: Array<Record<string, any>>;
  documents: Array<Record<string, any>>;
};
export function persistCfxAcquiredText(input: Record<string, any>): Promise<Record<string, any> | null>;
export function materializeCfxPhase2Documents(input: Record<string, any>): Promise<Record<string, any>>;
export function runCfxAssertionRelativePacketExtractionForPair(
  input: Record<string, any>,
): Promise<Record<string, any>>;
export function projectCfxAssertionRelativeSourceAssertions(
  input: Record<string, any>,
): Array<Record<string, any>>;
export function runCfxLinkSuggestionForCaseAssertion(
  input: Record<string, any>,
): Promise<Record<string, any>>;
export function runCfxProductionEvidencePipeline(input: Record<string, any>): Promise<Record<string, any>>;
export function runCfxPhase2Acquisition(input: Record<string, any>): Promise<Record<string, any>>;
export function defaultRuntime(): Promise<Record<string, any>>;
