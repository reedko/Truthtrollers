import type { Cf7SourceUnit } from "../types/index.js";
import { Cf7Error } from "../../shared/errors/Cf7Error.js";
import type {
  Cf7S3GroundingCompletion,
  Cf7S3ParentRow,
} from "./types.js";

const INCOMPLETE_TERMINAL = new RegExp(
  String.raw`(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|U\.S)\.|[“‘"'(]|\b(?:and|or|but|nor|yet|so|because|although|while|whereas|that|which|who|whose|when|if|as)|\b(?:according to|said|says|wrote|stated|reported|asked|replied|argued|explained|noted|warned))\s*$`,
  "i",
);

const CONTEXT_DEPENDENT_START = new RegExp(
  String.raw`^(?:It|Its|They|Their|He|His|She|Her|This|That|These|Those|Such|The former|The latter)\b`,
  "i",
);

export function completeCf7S3Grounding(input: {
  parents: Cf7S3ParentRow[];
  units: Cf7SourceUnit[];
}): {
  parents: Cf7S3ParentRow[];
  completions: Cf7S3GroundingCompletion[];
} {
  const indexById = new Map(
    input.units.map((unit, index) => [unit.unitId, index]),
  );
  const completions: Cf7S3GroundingCompletion[] = [];
  const parents = input.parents.map((parent) => {
    const effective = new Set(parent.groundingUnitIds);
    const reasons: Cf7S3GroundingCompletion["reasons"] = [];
    for (const unitId of parent.groundingUnitIds) {
      const index = indexById.get(unitId);
      if (index === undefined) {
        throw new Cf7Error(
          "CF7_S3_UNKNOWN_GROUNDING_ID",
          `Unknown grounding unit ${unitId}`,
        );
      }
      const unit = input.units[index]!;
      if (INCOMPLETE_TERMINAL.test(unit.text)) {
        const next = input.units[index + 1];
        if (next && next.regionId === unit.regionId) {
          effective.add(next.unitId);
          reasons.push({
            unitId: next.unitId,
            reason: "incomplete_terminal_continuation",
          });
        }
      }
      for (const contextUnitId of unit.contextUnitIds ?? []) {
        if (!indexById.has(contextUnitId)) {
          throw new Cf7Error(
            "CF7_S3_UNKNOWN_CONTEXT_UNIT_ID",
            `Unknown context unit ${contextUnitId} declared by ${unitId}`,
          );
        }
        effective.add(contextUnitId);
        reasons.push({ unitId: contextUnitId, reason: "declared_context" });
      }
      if (CONTEXT_DEPENDENT_START.test(unit.text)) {
        const previous = input.units[index - 1];
        if (previous && previous.regionId === unit.regionId) {
          effective.add(previous.unitId);
          reasons.push({
            unitId: previous.unitId,
            reason: "antecedent_context",
          });
        }
      }
    }
    const effectiveGroundingUnitIds = [...effective].sort(
      (left, right) => indexById.get(left)! - indexById.get(right)!,
    );
    const addedContextUnitIds = effectiveGroundingUnitIds.filter(
      (unitId) => !parent.groundingUnitIds.includes(unitId),
    );
    completions.push({
      parentHarvestRowId: parent.harvestRowId,
      originalGroundingUnitIds: [...parent.groundingUnitIds],
      effectiveGroundingUnitIds,
      addedContextUnitIds,
      reasons: reasons.filter((reason, index, all) =>
        all.findIndex((candidate) =>
          candidate.unitId === reason.unitId
          && candidate.reason === reason.reason) === index),
    });
    return {
      ...parent,
      groundingUnitIds: effectiveGroundingUnitIds,
    };
  });
  return { parents, completions };
}
