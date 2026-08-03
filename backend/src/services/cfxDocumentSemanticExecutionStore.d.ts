export type CfxDocumentSemanticExecutionIdentity = {
  runId: string;
  canonicalDocumentId: number;
  selectedTextVersionId: number;
  targetInventoryHash: string;
  promptHash: string;
  schemaHash: string;
};

export function claimCfxDocumentSemanticExecution(input: {
  pool: unknown;
  identity: CfxDocumentSemanticExecutionIdentity;
  staleAfterMinutes?: number;
}): Promise<{
  status: "claimed" | "in_progress" | "reused";
  executionId: number;
  processingToken: string | null;
  acceptedTargetedBearingRunId: number | null;
  attemptCount: number;
  identity: CfxDocumentSemanticExecutionIdentity;
}>;

export function finishCfxDocumentSemanticExecution(
  query: (sql: string, values?: unknown[]) => Promise<unknown>,
  input: {
    executionId: number;
    processingToken: string;
    status: "accepted" | "rejected" | "provider_failed";
    acceptedTargetedBearingRunId?: number | null;
    error?: string | null;
  },
): Promise<unknown>;
