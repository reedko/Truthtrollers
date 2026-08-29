#!/usr/bin/env node

import "dotenv/config";
import { runReferenceSemanticInputDiagnostic } from "./referenceSemanticInputDiagnostic/runner.js";

const result = await runReferenceSemanticInputDiagnostic();
if (!result.success) {
  process.exitCode = 1;
}
