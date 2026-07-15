export const CF1_REPAIR_RESPONSE_SCHEMA = Object.freeze({
  name: "cf1_repair_response_v1",
  strict: false,
  schema: {
    type: "object", additionalProperties: false, required: ["repairs", "cannotRepair"],
    properties: {
      repairs: { type: "array", maxItems: 30, items: {
        type: "object", additionalProperties: false,
        required: ["operation", "path", "value", "rationale", "sourceBlockIds"],
        properties: {
          operation: { type: "string", enum: ["add", "replace", "remove"] },
          path: { type: "string", maxLength: 500 }, value: {},
          rationale: { type: "string", maxLength: 1_000 },
          sourceBlockIds: { type: "array", minItems: 1, maxItems: 12, items: { type: "string" } },
        },
      } },
      cannotRepair: { type: "array", maxItems: 100, items: {
        type: "object", additionalProperties: false, required: ["code", "reason"],
        properties: { code: { type: "string", maxLength: 100 }, reason: { type: "string", maxLength: 1_000 } },
      } },
    },
  },
});

export function buildRepairPrompt(repairRequest) {
  const system = `You are performing the single permitted Claim Foundry CF1 repair pass.
Correct only the verifier errors using only supplied grounding blocks and affected fragments.
Do not browse, add outside facts, change deterministic identity, alter article text or offsets, or modify any path not explicitly allowed.
If a safe grounded repair is impossible, report it in cannotRepair instead of guessing.`;
  const user = `REPAIR ATTEMPT: 1

BLOCKING ERRORS
${JSON.stringify(repairRequest.blockingErrors)}

ALLOWED JSON POINTER PATHS
${JSON.stringify(repairRequest.allowedPaths)}

AFFECTED PACKAGE FRAGMENTS
${JSON.stringify(repairRequest.affectedPackageFragments)}

GROUNDING BLOCKS
${JSON.stringify(repairRequest.groundingBlocks)}

Return at most 30 atomic add, replace, or remove operations. Every operation path must exactly match an allowed path. Use sourceBlockIds to identify the grounding for each semantic change. A remove operation still includes value as null for structured-output consistency.`;
  return { system, user, responseSchema: CF1_REPAIR_RESPONSE_SCHEMA };
}
