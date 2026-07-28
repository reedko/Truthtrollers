#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const python = path.join(here, ".venv/bin/python");
const result = spawnSync(python, [
  path.join(here, "score_phase1.py"),
  "--run-dir", path.resolve(process.argv[2]),
  "--gold-dir", path.resolve(process.argv[3]),
], { stdio: "inherit", cwd: path.resolve(here, "../../..") });
process.exit(result.status ?? 1);
