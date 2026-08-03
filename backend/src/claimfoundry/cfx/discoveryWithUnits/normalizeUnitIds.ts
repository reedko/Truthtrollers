export type CfxUnitIdNormalization =
  | {
      status: "accepted";
      originalUnitId: string;
      canonicalUnitId: string;
      configuredUnitWidth: number;
      normalizationOccurred: boolean;
      resolutionCount: 1;
    }
  | {
      status: "rejected";
      originalUnitId: unknown;
      canonicalUnitId: string | null;
      configuredUnitWidth: number;
      normalizationOccurred: false;
      resolutionCount: number;
      reason:
        | "MALFORMED_UNIT_ID"
        | "NONEXISTENT_UNIT_ID"
        | "NONUNIQUE_UNIT_ID";
    };

export function configuredUnitWidth(
  authoritativeUnitIds: readonly string[],
): number {
  if (authoritativeUnitIds.length === 0) {
    throw new Error("Cannot configure unit-ID normalization without S0 units");
  }
  const widths = new Set(authoritativeUnitIds.map((unitId) => {
    const match = /^U([0-9]+)$/u.exec(unitId);
    if (!match) {
      throw new Error(`Authoritative S0 unit ID is malformed: ${unitId}`);
    }
    return match[1]!.length;
  }));
  if (widths.size !== 1) {
    throw new Error("Authoritative S0 unit IDs do not have one configured width");
  }
  return [...widths][0]!;
}

function canonicalDigits(digits: string, width: number): string {
  const withoutLeadingZeroes = digits.replace(/^0+(?=[0-9])/u, "");
  return withoutLeadingZeroes.padStart(width, "0");
}

export function normalizeCfxUnitId(input: {
  returnedUnitId: unknown;
  authoritativeUnitIds: readonly string[];
  unitWidth?: number;
}): CfxUnitIdNormalization {
  const width = input.unitWidth
    ?? configuredUnitWidth(input.authoritativeUnitIds);
  if (
    typeof input.returnedUnitId !== "string"
    || !/^U[0-9]+$/u.test(input.returnedUnitId)
  ) {
    return {
      status: "rejected",
      originalUnitId: input.returnedUnitId,
      canonicalUnitId: null,
      configuredUnitWidth: width,
      normalizationOccurred: false,
      resolutionCount: 0,
      reason: "MALFORMED_UNIT_ID",
    };
  }
  const canonicalUnitId = `U${canonicalDigits(
    input.returnedUnitId.slice(1),
    width,
  )}`;
  const resolutionCount = input.authoritativeUnitIds.filter(
    (unitId) => unitId === canonicalUnitId,
  ).length;
  if (resolutionCount === 0) {
    return {
      status: "rejected",
      originalUnitId: input.returnedUnitId,
      canonicalUnitId,
      configuredUnitWidth: width,
      normalizationOccurred: false,
      resolutionCount,
      reason: "NONEXISTENT_UNIT_ID",
    };
  }
  if (resolutionCount !== 1) {
    return {
      status: "rejected",
      originalUnitId: input.returnedUnitId,
      canonicalUnitId,
      configuredUnitWidth: width,
      normalizationOccurred: false,
      resolutionCount,
      reason: "NONUNIQUE_UNIT_ID",
    };
  }
  return {
    status: "accepted",
    originalUnitId: input.returnedUnitId,
    canonicalUnitId,
    configuredUnitWidth: width,
    normalizationOccurred: input.returnedUnitId !== canonicalUnitId,
    resolutionCount: 1,
  };
}
