export function createGatewaySearchAdapter(gateway) {
  if (!gateway || typeof gateway.web !== "function") {
    throw new TypeError("ER1 retrieval adapter requires gateway.web");
  }
  const diagnostics = [];
  return Object.freeze({
    kind: "existing_evidence_retrieval_gateway",
    async search(request) {
      const enabledExactProviders = (request.onlyProviders || []).filter((provider) =>
        gateway.status?.[provider]?.enabled && gateway.status?.[provider]?.configured);
      const output = await gateway.web({
        query: request.query,
        topK: request.maxCandidates,
        includeAcademic: request.identityPriority,
        returnDiagnostics: true,
        ...(enabledExactProviders.length ? { onlyProviders: enabledExactProviders } : {}),
      });
      if (Array.isArray(output)) return output;
      if (output?.diagnostics) diagnostics.push({
        providerQueryId: request.providerQueryId,
        targetId: request.targetId || null,
        identityPriority: request.identityPriority,
        ...output.diagnostics,
      });
      return Array.isArray(output?.results) ? output.results : [];
    },
    getDiagnostics() { return diagnostics.map((item) => structuredClone(item)); },
  });
}

export function createMockSearchAdapter(handler) {
  return Object.freeze({
    kind: "mock_providers",
    async search(request) {
      const value = await handler(request);
      return Array.isArray(value) ? value : [];
    },
    getDiagnostics() { return []; },
  });
}
