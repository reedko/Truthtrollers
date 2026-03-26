import mysql from 'mysql2/promise';

const conn = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'd1Mm0v3g!',
  database: 'truthtrollers'
});

console.log('\n=== Quality-related tables ===');
const [tables] = await conn.query("SHOW TABLES LIKE '%quality%'");
console.log(tables);

console.log('\n=== Content table columns ===');
const [contentCols] = await conn.query("DESCRIBE content");
const qualityCols = contentCols.filter(c => c.Field.includes('quality') || c.Field.includes('credibility'));
console.log(qualityCols.length > 0 ? qualityCols : 'No quality columns in content table');

console.log('\n=== Publishers table columns ===');
const [pubCols] = await conn.query("DESCRIBE publishers");
const pubQualityCols = pubCols.filter(c => c.Field.includes('quality') || c.Field.includes('credibility') || c.Field.includes('score'));
console.log(pubQualityCols.length > 0 ? pubQualityCols : 'No quality columns in publishers table');

console.log('\n=== content_source_quality table ===');
const [csqCols] = await conn.query("DESCRIBE content_source_quality");
console.log(csqCols);

console.log('\n=== source_quality_scores table ===');
const [sqsCols] = await conn.query("DESCRIBE source_quality_scores");
console.log(sqsCols);

await conn.end();
