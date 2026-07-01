// Routes for search analysis and theme extraction
import { Router } from "express";
import logger from "../utils/logger.js";

export default function createSearchAnalysisRouter({ query, pool }) {
  const router = Router();

  /**
   * POST /api/search-analysis
   * Save a search query and analyze its results to extract themes
   * Body: { query: string, contentIds: number[], userId: number }
   */
  router.post("/api/search-analysis", async (req, res) => {
    const { query: searchQuery, contentIds, userId } = req.body;

    if (!searchQuery || !contentIds || !userId) {
      return res.status(400).json({ error: "query, contentIds, and userId are required" });
    }

    try {
      // 1. Save the search to search_history
      const insertResult = await query(
        `INSERT INTO search_history (user_id, query, result_count, result_content_ids, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [userId, searchQuery, contentIds.length, JSON.stringify(contentIds)]
      );

      const searchId = insertResult.insertId;

      // 2. Fetch all claims from the returned content
      if (contentIds.length === 0) {
        return res.json({
          searchId,
          themes: [],
          message: "No results to analyze"
        });
      }

      const placeholders = contentIds.map(() => '?').join(',');

      logger.log(`📋 Searching for claims in ${contentIds.length} content items: [${contentIds.slice(0, 10).join(', ')}${contentIds.length > 10 ? '...' : ''}]`);

      const claims = await query(
        `SELECT DISTINCT c.claim_id, c.claim_text, c.claim_type, cnt.content_name, cnt.content_type
         FROM claims c
         JOIN content_claims cc ON c.claim_id = cc.claim_id
         JOIN content cnt ON cc.content_id = cnt.content_id
         WHERE cc.content_id IN (${placeholders})
         ORDER BY c.claim_id DESC
         LIMIT 200`,
        contentIds
      );

      if (claims.length === 0) {
        // Check if these content items exist but just don't have claims yet
        const contentDetails = await query(
          `SELECT content_id, content_name, content_type
           FROM content
           WHERE content_id IN (${placeholders})
           LIMIT 10`,
          contentIds
        );

        logger.log(`⚠️  Found ${contentIds.length} search results but NONE have claims yet. Sample content:`);
        contentDetails.forEach(c => {
          logger.log(`   - [${c.content_id}] ${c.content_type}: "${c.content_name}"`);
        });

        return res.json({
          searchId,
          themes: [],
          message: `No claims found in search results. Found ${contentIds.length} matching items but they haven't been analyzed for claims yet.`,
          debug: {
            search_result_count: contentIds.length,
            sample_content: contentDetails
          }
        });
      }

      // 3. Check which claims are already mapped to canonical claims
      logger.log(`🔍 Analyzing ${claims.length} claims for search: "${searchQuery}"`);

      const claimIds = claims.map(c => c.claim_id);
      const placeholdersForMappings = claimIds.map(() => '?').join(',');

      const existingMappings = await query(
        `SELECT cv.claim_id, cv.canonical_claim_id, cv.similarity_score,
                cc.claim_text AS canonical_text, cc.controversy_score, cc.stakes_score,
                cc.canonical_priority, cc.claim_type
         FROM claim_variants cv
         JOIN canonical_claims cc ON cv.canonical_claim_id = cc.canonical_claim_id
         WHERE cv.claim_id IN (${placeholdersForMappings})`,
        claimIds
      );

      const mappedClaimIds = new Set(existingMappings.map(m => m.claim_id));
      const unmappedClaims = claims.filter(c => !mappedClaimIds.has(c.claim_id));

      logger.log(`📊 Found ${existingMappings.length} existing mappings, ${unmappedClaims.length} unmapped claims`);

      // 4. For unmapped claims, use AI to map them to canonical claims
      const { openAiLLM } = await import("../core/openAiLLM.js");

      if (unmappedClaims.length > 0) {
        logger.log(`🤖 Using AI to map ${unmappedClaims.length} unmapped claims...`);

        const unmappedClaimsText = unmappedClaims.map((c, i) =>
          `[${i + 1}] ID:${c.claim_id} - "${c.claim_text}" (${c.claim_type})`
        ).join('\n');

        // Fetch existing canonical claims to see if any match
        const existingCanonical = await query(
          `SELECT canonical_claim_id, claim_text, topic, controversy_score, stakes_score, canonical_priority, claim_type
           FROM canonical_claims
           ORDER BY canonical_priority DESC
           LIMIT 100`
        );

        const canonicalText = existingCanonical.length > 0
          ? existingCanonical.map((cc, i) =>
              `[C${i + 1}] ID:${cc.canonical_claim_id} - "${cc.claim_text}" (${cc.claim_type}, topic:${cc.topic || 'general'})`
            ).join('\n')
          : 'No existing canonical claims yet.';

        const systemPrompt = `You are mapping specific claims to canonical disputed claims. Create new canonical claims when needed.`;

        const userPrompt = `Search query: "${searchQuery}"

EXISTING CANONICAL CLAIMS:
${canonicalText}

UNMAPPED CLAIMS TO PROCESS:
${unmappedClaimsText}

For each unmapped claim:
1. If it matches an existing canonical claim, return the existing canonical_claim_id
2. If it's a new distinct assertion, create a new canonical claim with:
   - claim_text: normalized declarative statement
   - topic: main topic (e.g., "vaccines", "climate", "fluoride")
   - controversy_score: 0.0-1.0 (how disputed)
   - stakes_score: 0.0-1.0 (importance/impact)
   - canonical_priority: 1-100 (centrality to topic)
   - claim_type: "supporting" or "opposing"
   - similarity_score: 0.0-1.0 (how similar to canonical)

Return a JSON array of mappings.`;

        const schemaHint = `Return JSON array of objects with: claim_id (number), canonical_claim_id (number or null if new), new_canonical (object with claim_text, topic, controversy_score, stakes_score, canonical_priority, claim_type) or null if mapping to existing, similarity_score (0.0-1.0).`;

        const aiMappingResponse = await openAiLLM.generate({
          system: systemPrompt,
          user: userPrompt,
          schemaHint,
          temperature: 0.2,
          timeout: 90000
        });

        let mappings = [];
        if (aiMappingResponse && Array.isArray(aiMappingResponse)) {
          mappings = aiMappingResponse;
        } else if (aiMappingResponse?.mappings) {
          mappings = aiMappingResponse.mappings;
        }

        logger.log(`🔗 AI returned ${mappings.length} claim mappings`);

        // Process AI mappings: create new canonical claims and map claims
        for (const mapping of mappings) {
          try {
            let canonicalId = mapping.canonical_claim_id;

            // Create new canonical claim if needed
            if (!canonicalId && mapping.new_canonical) {
              const nc = mapping.new_canonical;
              const insertResult = await query(
                `INSERT INTO canonical_claims (claim_text, topic, controversy_score, stakes_score, canonical_priority, claim_type)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  nc.claim_text,
                  nc.topic || null,
                  nc.controversy_score || 0.5,
                  nc.stakes_score || 0.5,
                  nc.canonical_priority || 50,
                  nc.claim_type || 'neutral'
                ]
              );
              canonicalId = insertResult.insertId;
              logger.log(`✨ Created new canonical claim: "${nc.claim_text}" (ID:${canonicalId})`);
            }

            // Map the claim to the canonical claim
            if (canonicalId && mapping.claim_id) {
              await query(
                `INSERT INTO claim_variants (claim_id, canonical_claim_id, similarity_score, mapped_by)
                 VALUES (?, ?, ?, 'ai')
                 ON DUPLICATE KEY UPDATE similarity_score = VALUES(similarity_score), mapped_by = 'ai'`,
                [mapping.claim_id, canonicalId, mapping.similarity_score || 0.8]
              );
            }
          } catch (err) {
            logger.error(`❌ Failed to process mapping for claim ${mapping.claim_id}:`, err);
          }
        }
      }

      // 5. Re-fetch all mappings now that we've created new ones
      const allMappings = await query(
        `SELECT cv.claim_id, cv.canonical_claim_id, cv.similarity_score,
                cc.claim_text AS canonical_text, cc.controversy_score, cc.stakes_score,
                cc.canonical_priority, cc.claim_type, cc.topic
         FROM claim_variants cv
         JOIN canonical_claims cc ON cv.canonical_claim_id = cc.canonical_claim_id
         WHERE cv.claim_id IN (${placeholdersForMappings})`,
        claimIds
      );

      // 6. Group claims by canonical claim and compute ranking scores
      const canonicalGroups = {};

      for (const mapping of allMappings) {
        const canonicalId = mapping.canonical_claim_id;

        if (!canonicalGroups[canonicalId]) {
          canonicalGroups[canonicalId] = {
            canonical_claim_id: canonicalId,
            canonical_text: mapping.canonical_text,
            claim_type: mapping.claim_type,
            topic: mapping.topic,
            controversy_score: mapping.controversy_score,
            stakes_score: mapping.stakes_score,
            canonical_priority: mapping.canonical_priority,
            claim_count: 0,
            claim_ids: [],
            avg_similarity: 0
          };
        }

        canonicalGroups[canonicalId].claim_count++;
        canonicalGroups[canonicalId].claim_ids.push(mapping.claim_id);
        canonicalGroups[canonicalId].avg_similarity += mapping.similarity_score;
      }

      // Calculate average similarity and composite ranking score
      Object.values(canonicalGroups).forEach(group => {
        group.avg_similarity = group.avg_similarity / group.claim_count;

        // Composite ranking: relevance (similarity) + controversy + stakes + frequency
        const frequencyScore = Math.min(group.claim_count / claims.length, 1.0); // Normalize to 0-1
        group.ranking_score =
          (group.avg_similarity * 0.25) +         // 25% relevance to query
          (group.controversy_score * 0.30) +      // 30% controversy
          (group.stakes_score * 0.30) +           // 30% stakes
          (frequencyScore * 0.15);                // 15% frequency

        group.ranking_score = Math.round(group.ranking_score * 100) / 100; // Round to 2 decimals
      });

      // Sort by ranking score
      const rankedGroups = Object.values(canonicalGroups).sort((a, b) => b.ranking_score - a.ranking_score);

      logger.log(`✅ Grouped ${claims.length} claims into ${rankedGroups.length} canonical claim families`);

      // 7. Categorize into three buckets
      const commonThemes = rankedGroups.filter(g => g.claim_count >= 3); // Appears in 3+ claims
      const keyDisputed = rankedGroups.filter(g => g.controversy_score >= 0.7 && g.claim_count >= 1);
      const rareSignificant = rankedGroups.filter(g => g.claim_count < 3 && g.stakes_score >= 0.7);

      const themes = rankedGroups.slice(0, 10).map((group, idx) => ({
        rank: idx + 1,
        text: group.canonical_text,
        type: group.claim_type,
        confidence: group.ranking_score,
        claim_count: group.claim_count,
        controversy: group.controversy_score,
        stakes: group.stakes_score,
        canonical_claim_id: group.canonical_claim_id,
        bucket: group.claim_count >= 3 ? 'common' :
                group.controversy_score >= 0.7 ? 'disputed' :
                group.stakes_score >= 0.7 ? 'rare_significant' : 'other'
      }));

      // 8. Save themes to database
      const themeInserts = themes.map((theme, idx) => {
        return query(
          `INSERT INTO search_themes (search_id, theme_rank, theme_text, theme_type, confidence, supporting_claim_ids)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            searchId,
            theme.rank,
            theme.text,
            theme.type,
            theme.confidence,
            JSON.stringify(canonicalGroups[theme.canonical_claim_id]?.claim_ids || [])
          ]
        );
      });

      await Promise.all(themeInserts);

      logger.log(`✅ Saved ${themes.length} ranked canonical claims for search_id=${searchId}`);

      // 9. Return the themes with bucket categorization
      res.json({
        searchId,
        themes,
        buckets: {
          common: themes.filter(t => t.bucket === 'common'),
          disputed: themes.filter(t => t.bucket === 'disputed'),
          rare_significant: themes.filter(t => t.bucket === 'rare_significant')
        },
        stats: {
          total_claims: claims.length,
          canonical_families: rankedGroups.length,
          common_themes_count: commonThemes.length,
          key_disputed_count: keyDisputed.length,
          rare_significant_count: rareSignificant.length
        }
      });

    } catch (error) {
      logger.error("❌ Error analyzing search:", error);
      res.status(500).json({ error: "Failed to analyze search results" });
    }
  });

  /**
   * GET /api/search-analysis/:searchId
   * Get themes for a previous search
   */
  router.get("/api/search-analysis/:searchId", async (req, res) => {
    const { searchId } = req.params;

    try {
      const themes = await query(
        `SELECT theme_rank, theme_text, theme_type, confidence
         FROM search_themes
         WHERE search_id = ?
         ORDER BY theme_rank ASC`,
        [searchId]
      );

      res.json({ themes });
    } catch (error) {
      logger.error("❌ Error fetching themes:", error);
      res.status(500).json({ error: "Failed to fetch themes" });
    }
  });

  return router;
}
