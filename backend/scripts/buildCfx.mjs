import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const compiled = spawnSync(
  path.resolve("node_modules/.bin/tsc"),
  ["-p", "tsconfig.cfx.build.json"],
  { stdio: "inherit" },
);
if (compiled.status !== 0) process.exit(compiled.status ?? 1);

async function copyJsonTree(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyJsonTree(from, to);
    else if (entry.name.endsWith(".json")) await cp(from, to);
  }
}

await copyJsonTree("src/claimfoundry/cfx", "dist/claimfoundry/cfx");
