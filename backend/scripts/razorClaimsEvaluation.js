#!/usr/bin/env node

import "dotenv/config";
import { runRazorClaimsEvaluation } from "./razorClaimsEvaluation/runner.js";

const result = await runRazorClaimsEvaluation();
if (!result.success) {
  process.exitCode = 1;
}
