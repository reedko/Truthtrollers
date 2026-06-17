#!/usr/bin/env node
// backend/scripts/testSourceProviders.js
//
// CLI diagnostic tool for source providers.
//
// Usage:
//   node backend/scripts/testSourceProviders.js --health
//   node backend/scripts/testSourceProviders.js --publisher "Scientific American" --domain scientificamerican.com
//   node backend/scripts/testSourceProviders.js --claim "5G causes brain damage"
//   node backend/scripts/testSourceProviders.js --url "https://www.scientificamerican.com/..."
//   node backend/scripts/testSourceProviders.js --full --url "..." --claim "..."

import { parseArgs } from "node:util";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

import {
  checkAllProviders,
  lookupPublisherAllProviders,
  lookupClaimAllProviders,
} from "../services/sourceProviders/sourceProviderRegistry.js";
import { evaluateAdmiraltyCode } from "../services/admiraltyEvaluator.js";

// ── ANSI color helpers ────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",  bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  cyan: "\x1b[36m",  grey: "\x1b[90m", blue: "\x1b[34m",
};

function col(color, text) { return `${C[color]}${text}${C.reset}`; }

function statusColor(status, ok) {
  if (ok) return col("green", status);
  if (["missing_config","not_implemented"].includes(status)) return col("yellow", status);
  return col("red", status);
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? "").length)));
  const hr = widths.map(w => "─".repeat(w + 2)).join("┼");
  const fmt = row => widths.map((w, i) => ` ${String(row[i] ?? "").padEnd(w)} `).join("│");
  console.log(`\n┌${widths.map(w => "─".repeat(w + 2)).join("┬")}┐`);
  console.log(`│${fmt(headers)}│`);
  console.log(`├${hr}┤`);
  rows.forEach(row => console.log(`│${fmt(row)}│`));
  console.log(`└${widths.map(w => "─".repeat(w + 2)).join("┴")}┘\n`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function runHealth() {
  console.log(col("bold", "\n🔬 Provider Health Check\n"));
  const results = await checkAllProviders();
  table(
    ["Provider", "Status", "OK", "Latency", "Message"],
    results.map(r => [
      r.providerName,
      statusColor(r.status, r.ok),
      r.ok ? col("green","✓") : col("red","✗"),
      `${r.latencyMs ?? 0}ms`,
      r.message ?? r.errorMessage ?? "",
    ])
  );
  const failing = results.filter(r => !r.ok);
  if (failing.length) {
    console.log(col("yellow", `⚠  ${failing.length} provider(s) not available: ${failing.map(r => r.providerName).join(", ")}`));
  } else {
    console.log(col("green", "✅ All providers healthy"));
  }
}

async function runPublisherLookup({ domain, publisherName, sourceUrl }) {
  console.log(col("bold", `\n🔍 Publisher Lookup: ${publisherName ?? domain ?? sourceUrl}\n`));
  const results = await lookupPublisherAllProviders({ domain, publisherName, sourceUrl });
  table(
    ["Provider", "Status", "Match", "Confidence", "Latency", "Publisher Name"],
    results.map(r => [
      r.providerName,
      statusColor(r.status, r.ok),
      r.matchFound ? col("green","✓") : col("grey","–"),
      r.confidence ?? "–",
      `${r.latencyMs ?? 0}ms`,
      r.normalized?.publisherName ?? r.errorMessage ?? "–",
    ])
  );
  const matched = results.filter(r => r.matchFound);
  if (matched.length) {
    console.log(col("cyan", "\n📊 Normalized data from matched providers:\n"));
    matched.forEach(r => {
      console.log(col("bold", `  ${r.providerName}:`));
      Object.entries(r.normalized ?? {}).forEach(([k,v]) => {
        if (v != null && v !== "") console.log(`    ${k}: ${v}`);
      });
    });
  }
}

async function runClaimLookup({ claimText, sourceUrl, publisherName }) {
  console.log(col("bold", `\n🔍 Claim Lookup: "${claimText?.slice(0, 80)}..."\n`));
  const results = await lookupClaimAllProviders({ claimText, sourceUrl, publisherName });
  table(
    ["Provider", "Status", "Match", "Confidence", "Latency", "Rating"],
    results.map(r => [
      r.providerName,
      statusColor(r.status, r.ok),
      r.matchFound ? col("green","✓") : col("grey","–"),
      r.confidence ?? "–",
      `${r.latencyMs ?? 0}ms`,
      r.normalized?.rating ?? r.errorMessage ?? "–",
    ])
  );
}

async function runFull({ sourceUrl, publisherName, domain, claimText }) {
  console.log(col("bold", `\n🧪 Full Admiralty Evaluation\n`));
  if (sourceUrl) console.log(`  URL:       ${col("cyan", sourceUrl)}`);
  if (publisherName) console.log(`  Publisher: ${col("cyan", publisherName)}`);
  if (domain) console.log(`  Domain:    ${col("cyan", domain)}`);
  if (claimText) console.log(`  Claim:     ${col("cyan", claimText?.slice(0, 100))}`);
  console.log();

  // Publisher lookup
  const providerResults = await lookupPublisherAllProviders({ domain, publisherName, sourceUrl });

  // Source identity
  let sourceIdentity = null;
  try {
    const { resolveSourceIdentity } = await import("../services/sourceIdentityResolver.js");
    sourceIdentity = await resolveSourceIdentity(sourceUrl ?? `https://${domain}`, { hintName: publisherName });
    console.log(`  ✓ Source identity: ${col("cyan", JSON.stringify({ sourceType: sourceIdentity?.sourceType, resolutionLevel: sourceIdentity?.resolutionLevel }))}`);
  } catch (err) {
    console.log(`  ${col("red","✗")} Source identity failed: ${err.message}`);
  }

  // Source lineage
  let sourceLineage = null;
  if (sourceUrl) {
    try {
      const { resolveSourceLineage } = await import("../services/sourceLineageResolver.js");
      sourceLineage = await resolveSourceLineage(sourceUrl);
      console.log(`  ✓ Source lineage:  ${col("cyan", JSON.stringify({ lineageType: sourceLineage?.lineageType, sourceDepth: sourceLineage?.sourceDepth }))}`);
    } catch (err) {
      console.log(`  ${col("red","✗")} Source lineage failed: ${err.message}`);
    }
  }

  // Claim providers
  let claimProviderResults = [];
  if (claimText) {
    claimProviderResults = await lookupClaimAllProviders({ claimText, sourceUrl, publisherName });
  }

  // Evaluate
  const evaluation = await evaluateAdmiraltyCode({
    sourceUrl, publisherName, sourceIdentity, sourceLineage, claimText,
    factCheckMatches: claimProviderResults.filter(r => r.matchFound).flatMap(r => r.allMatches ?? [r]),
    providerResults,
  }, { debug: true, runClaimLookup: false });

  const letter = evaluation.sourceReliabilityLetter;
  const number = evaluation.claimCredibilityNumber;
  const code   = evaluation.admiraltyCode;

  const letterColors = { A:"green", B:"green", C:"yellow", D:"yellow", E:"red", F:"grey" };
  console.log(`\n  ${col("bold", "ADMIRALTY CODE:")} ${col(letterColors[letter] ?? "grey", col("bold", code))}  (confidence: ${evaluation.confidence})`);
  console.log(`  ${col("bold","Letter")} ${letter}: ${evaluation.sourceReliabilityRationale}`);
  console.log(`  ${col("bold","Number")} ${number}: ${evaluation.claimCredibilityRationale}`);

  if (evaluation.warnings.length) {
    console.log(`\n  ${col("yellow","⚠  Warnings:")}`);
    evaluation.warnings.forEach(w => console.log(`     • ${w}`));
  }
  if (evaluation.recommendedActions.length) {
    console.log(`\n  ${col("cyan","→  Recommended actions:")}`);
    evaluation.recommendedActions.forEach(a => console.log(`     • [${a.action}] ${a.label}`));
  }
  console.log();

  // Provider table
  await runPublisherLookup({ domain, publisherName, sourceUrl });
  if (claimText) await runClaimLookup({ claimText, sourceUrl, publisherName });
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    health:    { type: "boolean", default: false },
    full:      { type: "boolean", default: false },
    publisher: { type: "string"  },
    domain:    { type: "string"  },
    claim:     { type: "string"  },
    url:       { type: "string"  },
  },
  strict: false,
});

if (values.health) {
  await runHealth();
} else if (values.full || (values.url && values.claim)) {
  await runFull({ sourceUrl: values.url, publisherName: values.publisher, domain: values.domain, claimText: values.claim });
} else if (values.publisher || values.domain) {
  await runPublisherLookup({ domain: values.domain, publisherName: values.publisher, sourceUrl: values.url });
} else if (values.claim) {
  await runClaimLookup({ claimText: values.claim, sourceUrl: values.url, publisherName: values.publisher });
} else if (values.url) {
  await runFull({ sourceUrl: values.url });
} else {
  console.log(`
Usage:
  node backend/scripts/testSourceProviders.js --health
  node backend/scripts/testSourceProviders.js --publisher "Scientific American" --domain scientificamerican.com
  node backend/scripts/testSourceProviders.js --claim "5G causes brain damage"
  node backend/scripts/testSourceProviders.js --url "https://..."
  node backend/scripts/testSourceProviders.js --full --url "https://..." --claim "..."
`);
}
