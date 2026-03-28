#!/usr/bin/env node
// Verify all prompts are in database and no hardcoded prompts remain

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function verifyPrompts() {
  console.log('🔍 Verifying prompt migration...\n');

  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'd1Mm0v3g!',
    database: 'truthtrollers',
  });

  try {
    // Check all prompts in database
    const [prompts] = await connection.query(
      `SELECT prompt_id, prompt_name, prompt_type, version, is_active
       FROM llm_prompts
       ORDER BY prompt_id`
    );

    console.log('📊 Database Prompts:');
    console.log('━'.repeat(80));

    const categories = {
      'Claim Extraction': [],
      'Evidence Query Generation': [],
      'Source Quality Evaluation': [],
      'Claim Triage': [],
      'Claim Properties Evaluation': [],
      'Claim Matching': [],
      'Claim Relevance Assessment': [],
    };

    prompts.forEach(p => {
      if (p.prompt_name.includes('claim_extraction')) {
        categories['Claim Extraction'].push(p);
      } else if (p.prompt_name.includes('evidence_query')) {
        categories['Evidence Query Generation'].push(p);
      } else if (p.prompt_name.includes('source_quality')) {
        categories['Source Quality Evaluation'].push(p);
      } else if (p.prompt_name.includes('claim_triage')) {
        categories['Claim Triage'].push(p);
      } else if (p.prompt_name.includes('claim_properties')) {
        categories['Claim Properties Evaluation'].push(p);
      } else if (p.prompt_name.includes('claim_matching')) {
        categories['Claim Matching'].push(p);
      } else if (p.prompt_name.includes('claim_relevance')) {
        categories['Claim Relevance Assessment'].push(p);
      }
    });

    for (const [category, categoryPrompts] of Object.entries(categories)) {
      if (categoryPrompts.length > 0) {
        console.log(`\n${category}:`);
        categoryPrompts.forEach(p => {
          const status = p.is_active ? '✓ active' : '✗ inactive';
          console.log(`  [${p.prompt_id}] ${p.prompt_name} (${p.prompt_type}, v${p.version}) ${status}`);
        });
      }
    }

    console.log('\n' + '━'.repeat(80));
    console.log(`Total prompts in database: ${prompts.length}`);

    // Expected prompts that should be in database
    const expectedPrompts = [
      'evidence_query_generation_system',
      'evidence_query_generation_user',
      'evidence_query_generation_user_balanced',
      'source_quality_evaluation_system',
      'source_quality_evaluation_user',
      'claim_triage_system',
      'claim_triage_user',
      'claim_properties_evaluation_system',
      'claim_properties_evaluation_user',
      'claim_matching_system',
      'claim_matching_user',
      'claim_relevance_assessment_system',
      'claim_relevance_assessment_user',
    ];

    console.log('\n📋 Checking for expected prompts (newly migrated):');
    console.log('━'.repeat(80));

    let allFound = true;
    for (const expectedName of expectedPrompts) {
      const found = prompts.find(p => p.prompt_name === expectedName);
      if (found) {
        console.log(`  ✓ ${expectedName}`);
      } else {
        console.log(`  ✗ MISSING: ${expectedName}`);
        allFound = false;
      }
    }

    if (allFound) {
      console.log('\n✅ All expected prompts found in database!');
    } else {
      console.log('\n❌ Some prompts are missing from database');
    }

    // Check for hardcoded prompts in code
    console.log('\n🔎 Checking for hardcoded prompts in code:');
    console.log('━'.repeat(80));

    const filesToCheck = [
      '../src/core/sourceQualityScorer.js',
      '../src/core/claimTriageEngine.js',
      '../src/core/claimEvaluationClassifier.js',
      '../src/core/matchClaims.js',
      '../src/core/assessClaimRelevance.js',
    ];

    let hasHardcodedPrompts = false;
    for (const file of filesToCheck) {
      const filePath = path.join(__dirname, file);
      const content = fs.readFileSync(filePath, 'utf8');

      // Check if file has promptManager or fallback pattern
      const hasPromptManager = content.includes('promptManager');
      const hasFallback = content.includes('fallbackSystem') || content.includes('defaultSystem');

      if (hasPromptManager && hasFallback) {
        console.log(`  ✓ ${path.basename(file)} - Uses promptManager with fallback`);
      } else if (hasPromptManager) {
        console.log(`  ⚠️  ${path.basename(file)} - Has promptManager but no fallback`);
        hasHardcodedPrompts = true;
      } else {
        console.log(`  ✗ ${path.basename(file)} - Still using hardcoded prompts`);
        hasHardcodedPrompts = true;
      }
    }

    console.log('\n' + '━'.repeat(80));
    if (!hasHardcodedPrompts && allFound) {
      console.log('🎉 MIGRATION COMPLETE! All prompts are now database-driven.');
      console.log('\nNext steps:');
      console.log('1. Run COMPLETE_SESSION_MIGRATION.sql on production server');
      console.log('2. Deploy backend code changes');
      console.log('3. Verify prompts in production admin panel');
    } else if (!allFound) {
      console.log('⚠️  Database migration incomplete. Run COMPLETE_SESSION_MIGRATION.sql');
    } else {
      console.log('⚠️  Code changes incomplete. Some files still use hardcoded prompts.');
    }

  } catch (err) {
    console.error('❌ Verification failed:', err);
    throw err;
  } finally {
    await connection.end();
  }
}

verifyPrompts().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
