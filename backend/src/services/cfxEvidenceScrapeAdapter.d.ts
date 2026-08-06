export type CfxAcquisitionOutcome =
  | "acquired" | "blocked" | "failed" | "unavailable" | "snippet_only" | "metadata_only";
export type EvidenceScrapeBinding = {
  bindingId: number | null;
  scrapeJobId: number | null;
  canonicalDocumentId: number | null;
  taskContentId: number;
  targetClaimId: number;
  referenceContentId: number | null;
  runId: string;
  propositionId: string;
  candidateId: string;
  acquisitionArtifactId: string;
  s2ArtifactPath: string;
  s2ArtifactSha256: string;
  groundingUnitIds: string[];
  requestedUrl: string;
  openedTabId: number | null;
  extensionInstanceId: string | null;
};
export function normalizeEvidenceScrapeContext(raw: unknown, fallback?: Record<string, unknown>): Readonly<EvidenceScrapeBinding>;
export function insertEvidenceScrapeBinding(query: Function, input: {scrapeJobId?: number | null; context: unknown}): Promise<Readonly<EvidenceScrapeBinding>>;
export function getEvidenceScrapeBinding(query: Function, scrapeJobId: number): Promise<Readonly<EvidenceScrapeBinding> | null>;
export function persistEvidenceAcquisitionAttempt(query: Function, input: Record<string, any> & {outcome?: CfxAcquisitionOutcome}): Promise<Readonly<{acquisitionAttemptId:number|null;rawResponseSha256:string|null}>>;
export function findReusableEvidenceTextVersion(query: Function, input?: Record<string, any>): Promise<Readonly<Record<string, any>> | null>;
export function persistEvidenceTextVersion(query: Function, input: Record<string, any>): Promise<Readonly<{acquiredTextVersionId:number|null;supersedesTextVersionId:number|null;created:boolean;cleanedTextSha256:string;characterCount:number;wordCount:number}>>;
export function persistRawEvidenceScrapeReceipt(query: Function, input: Record<string, any>): Promise<any>;
export function persistEvidenceScrapeCapture(query: Function, input: Record<string, any>): Promise<any>;
export function publishEvidenceScrapeTerminal(query: Function, input: Record<string, any>): Promise<any>;
