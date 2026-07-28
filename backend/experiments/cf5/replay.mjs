// CF5 minimal vertical slice — offline replay. Rebuilds parsed-claims/validation-report/
// final-claims from a previously-persisted run directory's saved raw model output,
// through the exact same pipeline.js code path the live runner uses, with no network
// call. Used to prove replay determinism.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { runGenerationPipeline } from "./pipeline.js";

export function replayRun(repeatDir) {
  const read = (name) => JSON.parse(readFileSync(path.join(repeatDir, name), "utf8"));
  // source-units.json is written once at the run level (shared across repeats), not
  // duplicated into each repeatN/ directory — look one level up if not found locally.
  const sourceUnitsPath = existsSync(path.join(repeatDir, "source-units.json"))
    ? path.join(repeatDir, "source-units.json")
    : path.join(path.dirname(repeatDir), "source-units.json");
  const sourceUnits = JSON.parse(readFileSync(sourceUnitsPath, "utf8"));
  const knownUnitIds = new Set(sourceUnits.map((unit) => unit.unitId));
  const rawResponse = read("raw-model-response.json");
  const rawClaims = extractClaimsFromRawResponse(rawResponse);

  const repairResponsePath = path.join(repeatDir, "raw-repair-response.json");
  const hasSavedRepair = existsSync(repairResponsePath);

  return runGenerationPipeline({
    rawClaims, knownUnitIds,
    repair: async () => {
      if (!hasSavedRepair) {
        throw new Error(
          `Replay requires a repair call but no raw-repair-response.json exists at ${repeatDir}`);
      }
      const repairRaw = read("raw-repair-response.json");
      return {
        repairedClaims: extractRepairedClaimsFromRawResponse(repairRaw),
        rawResponse: repairRaw, usage: null, model: null,
      };
    },
  });
}

function extractClaimsFromRawResponse(rawResponse) {
  const parsed = JSON.parse(rawResponse.output_text ?? "{}");
  return parsed.claims ?? [];
}

function extractRepairedClaimsFromRawResponse(rawResponse) {
  const parsed = JSON.parse(rawResponse.output_text ?? "{}");
  return parsed.repairedClaims ?? [];
}
