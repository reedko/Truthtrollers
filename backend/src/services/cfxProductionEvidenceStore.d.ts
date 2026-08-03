export function findOrCreateCanonicalClaim(query: Function, input: Record<string, unknown>): Promise<number>;
export function findOrCreateReferenceContent(query: Function, input: Record<string, unknown>): Promise<number>;
export function ensureContentClaim(query: Function, input: Record<string, unknown>): Promise<number>;
export function ensureClaimSource(query: Function, input: Record<string, unknown>): Promise<number>;
export function ensureContentRelation(query: Function, input: Record<string, unknown>): Promise<number>;
export function ensureCfxDocumentDiscoveryLink(query: Function, input: Record<string, any>): Promise<number>;
export function projectCfxBearingMetrics(row: Record<string, any>): {
  stance: "support" | "refute" | "nuance";
  confidence: number;
  quality: number;
  score: number;
  supportLevel: number;
};
export function adjudicateLegacyEvidence(items: Array<Record<string, any>>, now?: number): Record<string, any>;
export function persistCfxAssessedDocumentRelation(query: Function, input: Record<string, any>): Promise<Record<string, any> | null>;
export function persistTargetedBearingRun(query: Function, input: Record<string, any>): Promise<number>;
export function persistAcceptedBearingAssertions(query: Function, input: Record<string, any>): Promise<Array<Record<string, any>>>;
export function persistCanonicalCfxTarget(query: Function, input: Record<string, unknown>): Promise<number>;
