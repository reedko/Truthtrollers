export function createProductionCfxStructuredProvider(llm?: any): any;
export function processCfxEvidenceBinding(input: Record<string, any>): Promise<Record<string, any>>;
export function processCfxDocumentEvidenceBinding(input: Record<string, any>): Promise<Record<string, any>>;
export function replayCfxDocumentBearingValidation(input: Record<string, any>): Promise<Record<string, any>>;
export function processCfxEvidenceOutboxOnce(input: Record<string, any>): Promise<Record<string, any>>;
export function kickCfxEvidenceOutboxConsumer(input: Record<string, any>): void;
export function startCfxEvidenceOutboxRecovery(input: Record<string, any>, intervalMs?: number): any;
