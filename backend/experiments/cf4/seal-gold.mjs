import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const goldDir = path.join(here, "gold");
const entries = readdirSync(goldDir).filter((name) => name.endsWith(".gold.json"))
  .sort().map((name) => {
  const file = path.join(goldDir, name);
  const bytes = readFileSync(file);
  const value = JSON.parse(bytes);
  const fixtureId = value.fixtureId;
  if (value.fixtureId !== fixtureId || value.assertions.length < 12
    || value.assertions.length > 15) throw new Error(`Invalid gold key ${fixtureId}`);
  return {
    fixtureId,
    path: file,
    assertions: value.assertions.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
writeFileSync(path.join(goldDir, "SEALED.json"), `${JSON.stringify({
  schemaVersion: "cf4.goldSeal.v2",
  sealedAt: new Date().toISOString(),
  keys: entries,
}, null, 2)}\n`);
console.log(entries);
