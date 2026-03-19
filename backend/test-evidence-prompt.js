// Test loading evidence query prompts from database
import { query } from './src/db/pool.js';
import PromptManager from './src/core/promptManager.js';

const pm = new PromptManager(query);

(async () => {
  try {
    const systemPrompt = await pm.getPrompt('evidence_query_generation_system');
    const userPrompt = await pm.getPrompt('evidence_query_generation_user');

    console.log('✅ Successfully loaded evidence query prompts from database!');
    console.log('\n📋 System Prompt:');
    console.log(systemPrompt.system);
    console.log('\n📋 User Prompt Template:');
    console.log(userPrompt.user);
    console.log('\n📋 Parameters:', userPrompt.parameters);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
