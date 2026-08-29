#!/usr/bin/env node

import "dotenv/config";
import { runCaseAssertionDecompositionDiagnostic } from "./razorClaimsEvaluation/decompositionRunner.js";

const result = await runCaseAssertionDecompositionDiagnostic();
if (!result.success) {
  process.exitCode = 1;
}
