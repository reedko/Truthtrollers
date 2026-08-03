export function upsertCfxCanonicalDocument(query: Function, input: Record<string, any>): Promise<number>;
export function persistCfxDiscoveryAssignments(query: Function, input: Record<string, any>): Promise<{assignmentCount:number;insertedCount:number}>;
export function ensureCfxCanonicalAcquisition(input: Record<string, any>): Promise<any>;
export function retryCfxCanonicalAcquisition(input: Record<string, any>): Promise<any>;
export function phase2IdentityHash(kind: string, value: string): string;
export function serializeDiscoveryAssignments(assignments: unknown[]): string;
