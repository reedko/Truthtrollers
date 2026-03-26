// Quick test to manually update evidence mode
import mysql from 'mysql2/promise';

const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'd1Mm0v3g!',
  database: 'truthtrollers',
});

console.log('Current value:');
const [before] = await connection.query(
  `SELECT config_id, config_key, config_value FROM evidence_search_config WHERE config_key = 'search_mode'`
);
console.log(before);

console.log('\nUpdating to balanced_all_claims...');
const [result] = await connection.query(
  `UPDATE evidence_search_config SET config_value = 'balanced_all_claims', updated_by = 1 WHERE config_key = 'search_mode'`
);
console.log('Update result:', result);

console.log('\nVerifying new value:');
const [after] = await connection.query(
  `SELECT config_id, config_key, config_value FROM evidence_search_config WHERE config_key = 'search_mode'`
);
console.log(after);

await connection.end();
