// Quick script to check content_relations records
import { query } from './src/db/pool.js';

async function checkContentRelations() {
  console.log('Checking content_relations records...\n');

  // Total count
  const [total] = await query(`SELECT COUNT(*) as total FROM content_relations`);
  console.log('Total content_relations:', total.total);

  // Count with is_system = 1 (should be AI-created)
  const [systemCount] = await query(`SELECT COUNT(*) as total FROM content_relations WHERE is_system = 1`);
  console.log('AI-created (is_system=1):', systemCount.total);

  // Count with is_system = NULL (legacy or stored procedure)
  const [nullCount] = await query(`SELECT COUNT(*) as total FROM content_relations WHERE is_system IS NULL`);
  console.log('Legacy/NULL is_system:', nullCount.total);

  // Sample records
  console.log('\nSample records:');
  const samples = await query(`SELECT * FROM content_relations LIMIT 5`);
  console.table(samples);

  process.exit(0);
}

checkContentRelations().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
