// Log all LLM prompts and their sources
// This script identifies all LLM prompt usages in the codebase

console.log("📋 LLM PROMPT AUDIT\n");
console.log("=" .repeat(80));
console.log("\n");

const prompts = [
  {
    name: "Claim Extraction (Ranked with Topics)",
    location: "claimsEngine.js:121-127",
    source: "DATABASE",
    dbTable: "llm_prompts",
    promptNames: ["claim_extraction_ranked_system", "claim_extraction_ranked_with_topics"],
    notes: "Uses promptManager.getPrompt() - CORRECTLY USING DATABASE"
  },
  {
    name: "Claim Extraction (Ranked no Topics)",
    location: "claimsEngine.js:121-127",
    source: "DATABASE",
    dbTable: "llm_prompts",
    promptNames: ["claim_extraction_ranked_system", "claim_extraction_ranked_no_topics"],
    notes: "Uses promptManager.getPrompt() - CORRECTLY USING DATABASE"
  },
  {
    name: "Claim Extraction (Comprehensive with Topics)",
    location: "claimsEngine.js:121-127",
    source: "DATABASE",
    dbTable: "llm_prompts",
    promptNames: ["claim_extraction_ranked_system", "claim_extraction_comprehensive_with_topics"],
    notes: "Uses promptManager.getPrompt() - CORRECTLY USING DATABASE"
  },
  {
    name: "Claim Extraction (Comprehensive no Topics)",
    location: "claimsEngine.js:121-127",
    source: "DATABASE",
    dbTable: "llm_prompts",
    promptNames: ["claim_extraction_ranked_system", "claim_extraction_comprehensive_no_topics"],
    notes: "Uses promptManager.getPrompt() - CORRECTLY USING DATABASE"
  },
  {
    name: "Claim Filtering/Scoring",
    location: "claimsEngine.js:164-198",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'claim_filtering' prompt"
  },
  {
    name: "Evidence Engine - Query Generation",
    location: "evidenceEngine.js:36-72",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'evidence_query_generation' prompt"
  },
  {
    name: "Evidence Engine - Red Team Review",
    location: "evidenceEngine.js:344-412",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'evidence_red_team' prompt"
  },
  {
    name: "Extract Quote from Text",
    location: "extractQuote.js:29-42",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'extract_quote' prompt"
  },
  {
    name: "Assess Claim Relevance",
    location: "assessClaimRelevance.js:24-48",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'assess_claim_relevance' prompt"
  },
  {
    name: "Match Claims to Task Claims",
    location: "matchClaims.js:32-74",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'match_claims' prompt"
  },
  {
    name: "Search Analysis - Canonical Mapping",
    location: "search-analysis.routes.js:150-153",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'canonical_claim_mapping' prompt"
  },
  {
    name: "Snippet Analysis (Evidence Engine)",
    location: "runEvidenceEngine.js:614-617",
    source: "HARDCODED",
    dbTable: "N/A",
    promptNames: ["N/A"],
    notes: "❌ HARDCODED - Should be moved to database as 'snippet_analysis' prompt"
  }
];

console.log("SUMMARY:");
console.log("-".repeat(80));
const dbPrompts = prompts.filter(p => p.source === "DATABASE");
const hardcodedPrompts = prompts.filter(p => p.source === "HARDCODED");
console.log(`✅ Using Database: ${dbPrompts.length} prompts`);
console.log(`❌ Hardcoded: ${hardcodedPrompts.length} prompts`);
console.log("");

console.log("\n📊 USING DATABASE (CORRECT):");
console.log("-".repeat(80));
dbPrompts.forEach((p, i) => {
  console.log(`${i + 1}. ${p.name}`);
  console.log(`   Location: ${p.location}`);
  console.log(`   DB Prompts: ${p.promptNames.join(", ")}`);
  console.log(`   Notes: ${p.notes}`);
  console.log("");
});

console.log("\n❌ HARDCODED (NEED TO MIGRATE):");
console.log("-".repeat(80));
hardcodedPrompts.forEach((p, i) => {
  console.log(`${i + 1}. ${p.name}`);
  console.log(`   Location: ${p.location}`);
  console.log(`   Notes: ${p.notes}`);
  console.log("");
});

console.log("\n📝 RECOMMENDATIONS:");
console.log("-".repeat(80));
console.log("1. Create database migration to add missing prompts:");
console.log("   - evidence_query_generation");
console.log("   - evidence_red_team");
console.log("   - extract_quote");
console.log("   - assess_claim_relevance");
console.log("   - match_claims");
console.log("   - canonical_claim_mapping");
console.log("   - snippet_analysis");
console.log("");
console.log("2. Note: claim_filtering already exists in seed_claim_extraction_prompts.js");
console.log("   but is NOT being used by claimsEngine.js (it should be!)");
console.log("");
console.log("3. Update each file to use promptManager.getPrompt() instead of hardcoded prompts");
console.log("");

console.log("\n✨ YOUR RECENT EDIT:");
console.log("-".repeat(80));
console.log("You just edited evidenceEngine.js:36-72 (Query Generation)");
console.log("This prompt is HARDCODED and should be moved to the database.");
console.log("The edit will be lost if we don't migrate it properly!");
console.log("");
