import {
  CF7_F03_S2_INVENTORY_COUNT,
  loadCf7F03S2Input,
} from "../../atomicity/loadFrozenS2.js";
import { canonicalHash } from "../../../shared/sourceUnits/index.js";
import type { SemanticGroupingAssertion } from "./types.js";

export async function loadFrozenSemanticGroupingAssertions(input: {
  repositoryRoot: string;
}): Promise<{
  parentRunId: string;
  frozenInventorySha256: string;
  assertionInventoryHash: string;
  assertions: SemanticGroupingAssertion[];
}> {
  const frozen = await loadCf7F03S2Input(input);
  const assertions = frozen.parents.map((parent) => ({
    assertionId: parent.harvestRowId,
    assertionText: parent.assertionText,
  }));
  if (
    assertions.length !== CF7_F03_S2_INVENTORY_COUNT
    || new Set(assertions.map((row) => row.assertionId)).size
      !== CF7_F03_S2_INVENTORY_COUNT
  ) {
    throw new Error("Frozen semantic-grouping assertion inventory is invalid");
  }
  return {
    parentRunId: frozen.runId,
    frozenInventorySha256: frozen.inventorySha256,
    assertionInventoryHash: canonicalHash(assertions),
    assertions,
  };
}
