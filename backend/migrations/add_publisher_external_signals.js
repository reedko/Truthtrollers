import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config({ path: "../.env" });
dotenv.config({ path: ".env" });

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
};

const publisherColumns = [
  ["identity_confidence", "DECIMAL(5,4) NULL"],
  ["source_type", "VARCHAR(64) NULL"],
  ["source_type_confidence", "DECIMAL(5,4) NULL"],
  ["independent_footprint_score", "DECIMAL(6,2) NULL"],
  ["conflict_of_interest_score", "DECIMAL(6,2) NULL"],
  ["reliability_signal_present", "TINYINT(1) NULL"],
  ["direct_reliability_score", "DECIMAL(6,2) NULL"],
  ["contextual_credibility_score", "DECIMAL(6,2) NULL"],
  ["provenance_score", "DECIMAL(6,2) NULL"],
  ["publication_legitimacy_score", "DECIMAL(6,2) NULL"],
  ["reliability_cap", "VARCHAR(4) NULL"],
  ["reliability_cap_reason", "TEXT NULL"],
  ["reliability_signal_sources", "JSON NULL"],
  ["last_enriched_at", "DATETIME NULL"],
];

async function ensureColumn(conn, table, field, definition) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM ${table} LIKE ?`, [field]);
  if (rows.length) {
    console.log(`✓ ${table}.${field} already exists`);
    return;
  }
  await conn.query(`ALTER TABLE ${table} ADD COLUMN ${field} ${definition}`);
  console.log(`+ Added ${table}.${field}`);
}

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS publisher_external_signals (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        publisher_id INT NULL,
        domain VARCHAR(255) NULL,
        entity_name VARCHAR(255) NULL,
        provider VARCHAR(80) NOT NULL,
        signal_type VARCHAR(80) NOT NULL,
        admiralty_effect_type VARCHAR(32) NOT NULL,
        normalized_score DECIMAL(6,2) NULL,
        reliability_bucket VARCHAR(32) NULL,
        confidence_delta DECIMAL(6,4) NULL,
        reliability_delta DECIMAL(6,2) NULL,
        cap VARCHAR(4) NULL,
        cap_reason TEXT NULL,
        flags JSON NULL,
        raw_value JSON NULL,
        matched_name VARCHAR(255) NULL,
        matched_domain VARCHAR(255) NULL,
        match_confidence DECIMAL(6,4) NULL,
        evidence_url TEXT NULL,
        explanation TEXT NULL,
        retrieved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NULL,
        error_status VARCHAR(80) NULL,
        INDEX idx_publisher_provider (publisher_id, provider),
        INDEX idx_domain_provider (domain, provider),
        INDEX idx_effect (admiralty_effect_type),
        INDEX idx_retrieved (retrieved_at)
      )
    `);
    console.log("+ Ensured publisher_external_signals");

    await conn.query(`
      CREATE TABLE IF NOT EXISTS publisher_relationships (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        publisher_id INT NOT NULL,
        related_entity_name VARCHAR(255) NOT NULL,
        related_entity_id VARCHAR(255) NULL,
        relationship_type VARCHAR(64) NOT NULL,
        provider VARCHAR(80) NOT NULL,
        evidence_url TEXT NULL,
        confidence DECIMAL(6,4) NULL,
        raw_value JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_publisher_rel (publisher_id, relationship_type),
        INDEX idx_provider (provider)
      )
    `);
    console.log("+ Ensured publisher_relationships");

    for (const [field, definition] of publisherColumns) {
      await ensureColumn(conn, "publishers", field, definition);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
