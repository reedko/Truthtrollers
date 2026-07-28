#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rewrites = new Map(Object.entries({
  "CF1-F02:G08": "Rats exposed to glyphosate, 2,4-D and dicamba at accepted exposure levels developed severe gut damage.",
  "CF1-F02:G09": "Glyphosate is safe because its target pathway exists in plants but not humans.",
  "CF1-F02:G12": "Rats exposed at the currently accepted daily glyphosate intake developed cancers.",
  "CF1-F03:G01": "Half of American schoolchildren are not fully vaccinated and at least 1 in 88 toddlers are completely unvaccinated.",
  "CF1-F03:G02": "CDC data linking MMR vaccination to autism were manipulated.",
  "CF1-F03:G06": "Of 2,605 reported post-vaccination deaths, 78.3 percent occurred within seven days.",
  "CF1-F03:G10": "High first-month thimerosal exposure was associated with a 7.6-fold autism risk in a 1999 CDC-commissioned study.",
  "CF1-F03:G11": "Thimerosal did not cause autism or other neurodevelopmental problems.",
  "CF1-F06:G09": "Atmospheric carbon dioxide at 450 ppm would bring about the reef's demise.",
  "CF1-F06:G11": "Negative World Heritage comments harmed tourism.",
}));

for (const fixtureId of ["CF1-F02", "CF1-F03", "CF1-F06"]) {
  const file = path.join(here, "gold", `${fixtureId}.gold.json`);
  const old = JSON.parse(readFileSync(file, "utf8"));
  const assertions = old.assertions.map((row) => ({
    goldId: row.goldId,
    testableAssertion: rewrites.get(`${fixtureId}:${row.goldId}`) ?? row.assertionText,
    expectedSource: row.assertionSource,
    groundingUnitIds: row.groundingUnitIds,
    crux: row.crux,
    mustAppearOpponent: row.mustAppearOpponent,
  }));
  writeFileSync(file, `${JSON.stringify({
    schemaVersion: "cf4.sealedGold.v2",
    fixtureId,
    construction: `${old.construction} Existing judgments reformatted to separate attribution.`,
    assertions,
    justifiedOmissions: old.justifiedOmissions,
  }, null, 2)}\n`);
}
