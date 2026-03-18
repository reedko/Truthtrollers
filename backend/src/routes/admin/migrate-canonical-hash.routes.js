// Admin-only migration endpoint
// Can be called while server is running
import { Router } from "express";
import logger from "../../utils/logger.js";
import { canonicalizeAndHash } from "../../utils/canonicalizeUrl.js";

export default function createMigrateCanonicalHashRouter({ query }) {
  const router = Router();

  /**
   * POST /api/admin/migrate-canonical-hash
   * Run the canonical URL hash migration
   * Super admin only
   */
  router.post("/api/admin/migrate-canonical-hash", async (req, res) => {
    // Check if user is super admin
    if (!req.user || req.user.role !== 'super_admin') {
      return res.status(403).json({ error: "Forbidden: Super admin only" });
    }

    try {
      logger.log('🔧 Starting canonical URL hash migration...');

      // Step 1: Add columns if they don't exist
      try {
        await query(`
          ALTER TABLE content
          ADD COLUMN canonical_url_hash VARCHAR(64) NULL
          COMMENT 'SHA-256 hash of canonical URL for privacy-preserving lookups'
        `);
        logger.log('✅ Added canonical_url_hash column');
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          logger.log('⚠️  canonical_url_hash column already exists');
        } else {
          throw err;
        }
      }

      try {
        await query(`
          ALTER TABLE content
          ADD COLUMN canonical_url VARCHAR(2048) NULL
          COMMENT 'Canonicalized version of URL (normalized, tracking params removed)'
        `);
        logger.log('✅ Added canonical_url column');
      } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
          logger.log('⚠️  canonical_url column already exists');
        } else {
          throw err;
        }
      }

      // Step 2: Add indexes if they don't exist
      try {
        await query(`
          CREATE INDEX idx_content_canonical_url_hash
          ON content(canonical_url_hash)
        `);
        logger.log('✅ Added index on canonical_url_hash');
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME') {
          logger.log('⚠️  Index on canonical_url_hash already exists');
        } else {
          throw err;
        }
      }

      try {
        await query(`
          CREATE INDEX idx_content_canonical_url
          ON content(canonical_url(255))
        `);
        logger.log('✅ Added index on canonical_url');
      } catch (err) {
        if (err.code === 'ER_DUP_KEYNAME') {
          logger.log('⚠️  Index on canonical_url already exists');
        } else {
          throw err;
        }
      }

      // Step 3: Backfill existing content (limit to avoid timeout)
      const rows = await query(`
        SELECT content_id, url
        FROM content
        WHERE url IS NOT NULL
          AND url != ''
          AND canonical_url_hash IS NULL
        LIMIT 1000
      `);

      let updated = 0;
      let skipped = 0;

      for (const row of rows) {
        const { canonical, hash } = canonicalizeAndHash(row.url);

        if (canonical && hash) {
          await query(
            `UPDATE content
             SET canonical_url = ?,
                 canonical_url_hash = ?
             WHERE content_id = ?`,
            [canonical, hash, row.content_id]
          );
          updated++;
        } else {
          skipped++;
        }
      }

      logger.log(`✅ Migration complete! Updated: ${updated}, Skipped: ${skipped}`);

      return res.json({
        success: true,
        message: 'Migration completed successfully',
        stats: {
          processed: rows.length,
          updated,
          skipped,
          remaining: rows.length === 1000 ? 'More rows to process - run again' : 0
        }
      });

    } catch (error) {
      logger.error('❌ Migration failed:', error);
      return res.status(500).json({
        error: 'Migration failed',
        message: error.message
      });
    }
  });

  return router;
}
