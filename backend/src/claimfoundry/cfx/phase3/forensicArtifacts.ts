import path from "node:path";
import {
  aggregateArtifactHash,
  createImmutableDirectory,
  freezeArtifactTree,
  hashArtifactTree,
  sha256,
  writeImmutableJson,
  writeImmutableText,
} from "../artifacts/immutableArtifacts.js";

export type CfxPhase3ForensicInput = {
  documentId: string;
  status: string;
  promptHash: string;
  schemaHash: string;
  targetInventoryHash: string;
  selectedTextVersionHash: string;
  forensicRequests: Array<Record<string, unknown>>;
  forensicResponses: Array<Record<string, unknown>>;
  acceptedTargets: unknown[];
  evidenceAssertions: unknown[];
  quarantinedRows: unknown[];
  diagnostics: unknown[];
  usage: Record<string, number>;
  latencyMs: number;
  providerCallCount: number;
};

/**
 * Provider evidence is written before judgments in each immutable request
 * directory. Validation changes publication eligibility, never evidence
 * retention.
 */
export async function writeCfxPhase3ForensicArtifacts(
  root: string,
  input: CfxPhase3ForensicInput,
): Promise<{ artifactAggregateSha256: string; files: Awaited<ReturnType<typeof hashArtifactTree>> }> {
  await createImmutableDirectory(root);
  for (let index = 0; index < input.forensicRequests.length; index += 1) {
    const request = input.forensicRequests[index];
    const response = input.forensicResponses.find(
      (row) => row.partId === request.partId,
    ) ?? null;
    const requestDirectory = path.join(root, `request-${String(index + 1).padStart(3, "0")}`);
    await createImmutableDirectory(requestDirectory);
    await writeImmutableJson(path.join(requestDirectory, "request.json"), request.request);
    await writeImmutableText(
      path.join(requestDirectory, "request_hash.txt"),
      `${String(request.requestHash)}\n`,
    );
    await writeImmutableJson(path.join(requestDirectory, "raw_response.json"), response?.rawResponse ?? null);
    await writeImmutableText(
      path.join(requestDirectory, "raw_response_hash.txt"),
      `${sha256(JSON.stringify(response?.rawResponse ?? null))}\n`,
    );
    await writeImmutableJson(path.join(requestDirectory, "response_metadata.json"), response ? {
      responseId: response.responseId,
      providerRequestId: response.providerRequestId,
      model: response.model,
      usage: response.usage,
      latencyMs: response.latencyMs,
      capturedBeforeValidation: response.capturedBeforeValidation,
    } : { providerFailure: true });
    await writeImmutableJson(path.join(requestDirectory, "validation.json"), {
      status: input.status,
      diagnostics: input.diagnostics,
    });
    await writeImmutableJson(path.join(requestDirectory, "accepted_rows.json"), input.acceptedTargets);
    await writeImmutableJson(path.join(requestDirectory, "rejected_rows.json"), input.quarantinedRows);
    await writeImmutableJson(path.join(requestDirectory, "diagnostics.json"), input.diagnostics);
  }
  await writeImmutableJson(path.join(root, "validated_evidence_assertions.json"), input.evidenceAssertions);
  await writeImmutableJson(path.join(root, "quarantined_rows.json"), input.quarantinedRows);
  await writeImmutableJson(path.join(root, "validation_summary.json"), {
    status: input.status,
    diagnostics: input.diagnostics,
  });
  await writeImmutableJson(path.join(root, "run_manifest.json"), {
    documentId: input.documentId,
    status: input.status,
    promptHash: input.promptHash,
    schemaHash: input.schemaHash,
    targetInventoryHash: input.targetInventoryHash,
    selectedTextVersionHash: input.selectedTextVersionHash,
    usage: input.usage,
    latencyMs: input.latencyMs,
    providerCallCount: input.providerCallCount,
  });
  const files = await hashArtifactTree(root);
  const artifactAggregateSha256 = aggregateArtifactHash(files);
  await writeImmutableJson(path.join(root, "artifact_hashes.json"), {
    files, artifactAggregateSha256,
  });
  await freezeArtifactTree(root);
  return { artifactAggregateSha256, files };
}
