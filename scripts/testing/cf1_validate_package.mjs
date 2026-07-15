#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyCf1Package } from "../../backend/src/claim-foundry/verifyPackage.js";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv.includes("--help")) {
  console.log("Usage: node scripts/testing/cf1_validate_package.mjs --package <claim-package.json>");
  process.exit(0);
}

const packagePath = argument("--package");
if (!packagePath) {
  console.error("Missing --package <path>");
  process.exit(2);
}

try {
  const packageValue = JSON.parse(await readFile(resolve(packagePath), "utf8"));
  const verification = verifyCf1Package(packageValue, { requireFinalHash: true });
  console.log(JSON.stringify(verification, null, 2));
  process.exitCode = verification.valid ? 0 : 1;
} catch (error) {
  console.error(JSON.stringify({ valid: false, error: { code: error.code ?? "CF1_VALIDATOR_FAILED", message: error.message } }, null, 2));
  process.exitCode = 2;
}
