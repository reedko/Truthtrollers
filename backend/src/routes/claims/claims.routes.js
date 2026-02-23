// /backend/src/routes/claims/claims.routes.js
import { Router } from "express";

const okVerdict = new Set(["true", "false", "uncertain"]);

function badReq(res, msg) {
  return res.status(400).json({ error: msg });
}

export default function createClaimsRoutes({ query, pool }) {
  const router = Router();

  // -------------------- CLAIM VERIFICATIONS API -------------------- //

  router.post("/api/claim-verifications", async (req, res) => {
    try {
      const {
        claim_id,
        user_id,
        verdict,
        confidence,
        notes = "",
      } = req.body || {};

      if (!Number.isInteger(claim_id))
        return badReq(res, "claim_id required (int)");
      if (user_id != null && !Number.isInteger(user_id))
        return badReq(res, "user_id must be int or null");
      if (!okVerdict.has(verdict))
        return badReq(res, "verdict must be 'true' | 'false' | 'uncertain'");

      const confNum = Number(confidence);
      if (!Number.isFinite(confNum) || confNum < 0 || confNum > 1)
        return badReq(res, "confidence must be between 0 and 1");

      // If your users table requires a user_id, you can enforce here:
      // if (user_id == null) return badReq(res, "user_id required");

      const sql = `
      INSERT INTO claim_verifications
        (claim_id, user_id, verdict, confidence, notes, created_at, updated_at)
      VALUES
        (:claim_id, :user_id, :verdict, :confidence, :notes, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        verdict = VALUES(verdict),
        confidence = VALUES(confidence),
        notes = VALUES(notes),
        updated_at = NOW()
    `;

      const [result] = await pool.execute(sql, {
        claim_id,
        user_id, // can be null if FK allows it
        verdict,
        confidence: confNum,
        notes,
      });

      // Fetch the current record to return a clean object
      const [rows] = await pool.execute(
        `SELECT claim_verifications_id, claim_id, user_id, verdict, confidence, notes, created_at, updated_at
       FROM claim_verifications
       WHERE claim_id = :claim_id AND <%= user_id_cond %>`,
        user_id == null
          ? { claim_id } // if you allowed null user_id and there's only one per claim
          : { claim_id, user_id },
      );

      // If you allow NULL user_id for multiple rows per claim, adjust the SELECT accordingly.
      return res.json({ ok: true, verification: rows?.[0] ?? null });
    } catch (err) {
      console.error("POST /api/claim-verifications error:", err);
      // Common FK issues:
      // - claim_id not in claims
      // - user_id not in users (if NOT NULL FK)
      if (String(err?.message || "").includes("foreign key")) {
        return res.status(409).json({
          error: "Foreign key violation (claim_id or user_id not found)",
        });
      }
      return res.status(500).json({ error: "Server error" });
    }
  });

  // Get one verification for (claim_id, user_id)
  router.get("/api/claim-verifications", async (req, res) => {
    try {
      const claim_id = Number(req.query.claim_id);
      const user_id =
        req.query.user_id == null ? null : Number(req.query.user_id);

      if (!Number.isInteger(claim_id))
        return badReq(res, "claim_id required (int)");

      let rows;
      if (user_id == null) {
        // If you don't support null user_id, you can 400 here instead
        [rows] = await pool.execute(
          `SELECT * FROM claim_verifications WHERE claim_id = :claim_id`,
          { claim_id },
        );
      } else {
        [rows] = await pool.execute(
          `SELECT * FROM claim_verifications WHERE claim_id = :claim_id AND user_id = :user_id`,
          { claim_id, user_id },
        );
      }
      res.json({ ok: true, verifications: rows });
    } catch (err) {
      console.error("GET /api/claim-verifications error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // All verifications for a claim (for admin/aggregation views)
  router.get("/api/claims/:claimId/verifications", async (req, res) => {
    try {
      const claimId = Number(req.params.claimId);
      if (!Number.isInteger(claimId)) return badReq(res, "claimId must be int");
      const [rows] = await pool.execute(
        `SELECT * FROM claim_verifications WHERE claim_id = :claimId ORDER BY updated_at DESC`,
        { claimId },
      );
      res.json({ ok: true, verifications: rows });
    } catch (err) {
      console.error("GET /api/claims/:claimId/verifications error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // (Optional) delete a verification
  router.delete("/api/claim-verifications", async (req, res) => {
    try {
      const claim_id = Number(req.query.claim_id);
      const user_id = Number(req.query.user_id);
      if (!Number.isInteger(claim_id) || !Number.isInteger(user_id))
        return badReq(res, "claim_id and user_id required (int)");

      const [result] = await pool.execute(
        `DELETE FROM claim_verifications WHERE claim_id = :claim_id AND user_id = :user_id`,
        { claim_id, user_id },
      );
      res.json({ ok: true, deleted: result.affectedRows });
    } catch (err) {
      console.error("DELETE /api/claim-verifications error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // -------------------- CLAIMS API -------------------- //

  router.get("/api/claim/:claimId", async (req, res) => {
    const { claimId } = req.params;

    try {
      const SQL = `
    SELECT
      claim_id,
      claim_text,
      veracity_score,
      confidence_level,
      last_verified

    FROM claims
    WHERE claim_id=?
    `;

      const params = [claimId];
      const claim = await query(SQL, params);
      res.json(claim);
    } catch (err) {
      console.error("Error fetching references with claims:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  router.get("/api/claims/:content_id", async (req, res) => {
    const { content_id } = req.params;
    const viewerId = req.query.viewerId;

    const sql = `
    SELECT
      c.claim_id,
      c.claim_text,
      c.veracity_score,
      c.confidence_level,
      c.last_verified,
      COALESCE(GROUP_CONCAT(DISTINCT cc.relationship_type ORDER BY cc.relationship_type SEPARATOR ', '), '') AS relationship_type,
      COALESCE(
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'reference_content_id', cr.reference_content_id,
            'content_name', ref.content_name,
            'url', ref.url,
            'support_level', IFNULL(cr.support_level, 0)
          )
        ),
        JSON_ARRAY()
      ) AS reference_list
    FROM claims c
    LEFT JOIN content_claims cc ON c.claim_id = cc.claim_id
    LEFT JOIN claims_references cr ON c.claim_id = cr.claim_id
    LEFT JOIN content ref ON cr.reference_content_id = ref.content_id
    WHERE cc.content_id = ?
      ${
        viewerId
          ? "AND (cc.user_id IS NULL OR cc.user_id = ?)"
          : "AND cc.user_id IS NULL"
      }
    GROUP BY c.claim_id;
  `;

    const params = viewerId ? [content_id, viewerId] : [content_id];

    pool.query(sql, params, async (err, results) => {
      if (err) {
        console.error("❌ Error fetching claims:", err);
        return res.status(500).json({ error: "Database query failed" });
      }

      res.json(results);
    });
  });

  //add a full new claim
  router.post("/api/claims", async (req, res) => {
    const {
      claim_text,
      veracity_score = 0,
      confidence_level = 0,
      last_verified = new Date(),
      content_id,
      relationship_type = "task",
    } = req.body;
    const formattedDate = new Date(last_verified)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    if (!claim_text || !content_id) {
      return res
        .status(400)
        .json({ error: "claim_text and content_id are required" });
    }

    try {
      const insertResult = await query(
        "INSERT INTO claims (claim_text, veracity_score, confidence_level, last_verified) VALUES (?, ?, ?, ?)",
        [claim_text, veracity_score, confidence_level, formattedDate],
      );

      const claimId = insertResult.insertId;

      await query(
        "INSERT INTO content_claims (content_id, claim_id, relationship_type) VALUES (?, ?, ?)",
        [content_id, claimId, relationship_type],
      );

      res.json({ success: true, claimId });
    } catch (error) {
      console.error("❌ Error creating claim:", error);
      res.status(500).json({ error: "Failed to insert claim" });
    }
  });

  //edit a full new claim
  router.put("/api/claims/:claim_id", async (req, res) => {
    const claimId = req.params.claim_id;
    const {
      claim_text,
      veracity_score = 0,
      confidence_level = 0,
      last_verified = new Date(),
    } = req.body;
    const formattedDate = new Date(last_verified)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    console.log(claimId, "To edit");
    if (!claim_text || !claimId) {
      return res
        .status(400)
        .json({ error: "claim_text and claim_id required" });
    }

    try {
      await query(
        "UPDATE claims SET claim_text = ?, veracity_score = ?, confidence_level = ?, last_verified = ? WHERE claim_id = ?",
        [claim_text, veracity_score, confidence_level, formattedDate, claimId],
      );

      res.json({ success: true, claimId });
    } catch (error) {
      console.error("❌ Error updating claim:", error);
      res.status(500).json({ error: "Failed to update claim" });
    }
  });

  //save or edit a claim link
  router.post("/api/claim-links", async (req, res) => {
    const {
      source_claim_id,
      target_claim_id,
      user_id,
      support_level,
      relationship = "related", // fallback
      notes,
      points_earned = 0, // 🎮 GameSpace scoring
    } = req.body;

    if (!source_claim_id || !target_claim_id || !user_id) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
      const sql = `
      INSERT INTO claim_links
        (source_claim_id, target_claim_id, relationship, user_id, support_level, notes, points_earned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
      const params = [
        source_claim_id,
        target_claim_id,
        relationship,
        user_id,
        support_level,
        notes,
        points_earned,
      ];

      await query(sql, params);
      res.status(201).json({ message: "Claim link created", points_earned });
    } catch (err) {
      console.error("❌ Error inserting claim link:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // GET /api/claim-links/score/:contentId?userId=123
  // Get total GameSpace score for a user on a specific content/task
  router.get("/api/claim-links/score/:contentId", async (req, res) => {
    const contentId = parseInt(req.params.contentId, 10);
    const userId = parseInt(req.query.userId, 10);

    if (!contentId || !userId) {
      return res.status(400).json({ error: "Missing contentId or userId" });
    }

    try {
      // Sum all points_earned for links where target claims belong to this content
      const sql = `
        SELECT COALESCE(SUM(cl.points_earned), 0) as total_score
        FROM claim_links cl
        JOIN content_claims cc ON cl.target_claim_id = cc.claim_id
        WHERE cc.content_id = ? AND cl.user_id = ?
      `;

      const result = await query(sql, [contentId, userId]);
      const totalScore = result[0]?.total_score || 0;

      res.json({ contentId, userId, totalScore });
    } catch (err) {
      console.error("❌ Error fetching claim link score:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // GET /api/linked-claims-for-task/:contentId?viewerId=123
  // api/linked-claims-for-claim/:claimId
  router.get("/api/linked-claims-for-claim/:claimId", async (req, res) => {
    const claimId = req.params.claimId;
    const viewerId = req.query.viewerId ? req.query.viewerId : null;

    const sql = `

      SELECT
  cl.claim_link_id,
  cl.target_claim_id,
  cl.source_claim_id,

  cl.relationship,
  cl.support_level,
  cl.notes,
  c.veracity_score AS verimeter_score,

  c.claim_id AS source_claim_id,
  c.claim_text AS source_claim_text,
  c.veracity_score AS source_veracity,
  c.confidence_level AS source_confidence,
  c.last_verified AS source_last_verified,

  cc.content_id AS reference_content_id

    FROM claim_links cl
    JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
    JOIN claims c ON cc.claim_id = c.claim_id
    WHERE cl.target_claim_id = ?
      AND cl.disabled = 0
      ${viewerId ? "AND cl.user_id = ?" : ""}
  `;

    const params = viewerId ? [claimId, viewerId] : [claimId];

    try {
      const rows = await query(sql, params);
      console.log(rows, ":::ROWOS");
      const formatted = rows.map((row) => ({
        claim_link_id: row.claim_link_id,
        claimId: row.target_claim_id,
        referenceId: row.reference_content_id,
        sourceClaimId: row.source_claim_id,
        relation:
          row.relationship === "supports"
            ? "support"
            : row.relationship === "refutes"
              ? "refute"
              : "support", // fallback
        confidence: row.confidence,
        notes: row.notes,
        verimeter_score: row.verimeter_score ?? null,
        sourceClaim: {
          claim_id: row.source_claim_id,
          claim_text: row.source_claim_text,
          veracity_score: row.source_veracity,
          confidence_level: row.source_confidence,
          last_verified: row.source_last_verified,
        },
      }));

      res.json(formatted);
    } catch (err) {
      console.error("Error fetching linked claims for claim:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/live-verimeter-score/:claimId", async (req, res) => {
    const claimId = parseInt(req.params.claimId);
    const viewerId = req.query.viewerId ? parseInt(req.query.viewerId) : null;
    console.log(claimId, "::::DKCJKDS", viewerId, "::::DJFHFG");

    if (isNaN(claimId)) {
      console.warn("Invalid claimId received:", req.params.claimId);
      return res.status(400).json({ error: "Invalid claim ID" });
    }

    const sql = viewerId
      ? "CALL compute_and_store_verimeter_score_for_claim(?, ?);"
      : "CALL compute_and_store_verimeter_score_for_claim(?, NULL);";

    const params = viewerId ? [claimId, viewerId] : [claimId];

    try {
      const rows = await query(sql, params); // rows[0] is the SELECT at the end of SP
      res.json(rows[0]); // Return just the final SELECT output
    } catch (err) {
      console.error("Error computing Verimeter score:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/linked-claims-for-task/:contentId", async (req, res) => {
    const contentId = req.params.contentId;
    const viewerId = req.query.viewerId ? req.query.viewerId : null;

    const sql = `
   SELECT
  cl.claim_link_id,
  cl.target_claim_id,
  cl.source_claim_id,
  cl.relationship,
  cl.support_level,
  cl.notes,
  c.claim_text AS source_claim_text,
  cc.content_id AS reference_content_id
FROM claim_links cl
JOIN content_claims cc_task ON cl.target_claim_id = cc_task.claim_id
JOIN content_claims cc ON cl.source_claim_id = cc.claim_id
JOIN claims c ON cc.claim_id = c.claim_id
WHERE cc_task.content_id = ?
  AND cl.disabled = 0
  ${viewerId ? "AND cl.user_id = ?" : ""}
  `;

    const params = viewerId ? [contentId, viewerId] : [contentId];
    try {
      const rows = await query(sql, params);
      res.json(rows);
    } catch (err) {
      console.error("Error fetching linked claims:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get(
    "/api/claims-and-linked-references/:contentId",
    async (req, res) => {
      const contentId = req.params.contentId;
      const viewerId = req.query.viewerId;

      const sql = `
    SELECT
      CONCAT(cl.claim_link_id, cr.reference_content_id) AS id,
      cl.claim_link_id AS claim_link_id,
      cc_task.content_id AS task_content_id,
      cl.target_claim_id AS left_claim_id,
      cl.source_claim_id,
      cr.reference_content_id AS right_reference_id,
      cl.relationship,
      cl.support_level AS confidence,
      cl.notes AS notes
    FROM claim_links cl
    JOIN content_claims cc_task ON cl.target_claim_id = cc_task.claim_id
    JOIN content_claims cc_ref ON cl.source_claim_id = cc_ref.claim_id
    JOIN content_relations cr ON cr.reference_content_id = cc_ref.content_id
    WHERE cc_task.content_id = cr.content_id
      AND cc_task.content_id = ?
      AND cl.disabled = false
      ${viewerId ? "AND cl.user_id = ?" : ""}
  `;

      const params = viewerId ? [contentId, viewerId] : [contentId];

      try {
        const claimsWithReferences = await query(sql, params);
        res.json(claimsWithReferences);
      } catch (err) {
        console.error("Error fetching references with claims:", err);
        res.status(500).json({ error: "Database error" });
      }
    },
  );

  //add claims in batch for a content_id (as in a scrape)
  // and link the claim to the content_id
  router.post("/api/claims/add", async (req, res) => {
    try {
      const { content_id, claims, content_type, user_id } = req.body;

      // ✅ Validate required fields
      if (
        !content_id ||
        !Array.isArray(claims) ||
        claims.length === 0 ||
        !content_type
      ) {
        console.error("❌ Missing required fields:", {
          content_id,
          claims,
          content_type,
        });
        return res.status(400).json({
          error: "content_id, claims array, and content_type are required",
        });
      }

      let insertedCount = 0;

      for (const claimText of claims) {
        if (typeof claimText !== "string" || claimText.trim() === "") {
          console.warn("⚠️ Skipping empty or invalid claim:", claimText);
          continue;
        }

        const cleanClaimText = claimText.trim();
        let claimId;
        let isNewClaim = false;

        try {
          // 1️⃣ **Check if claim already exists**
          const existingClaimResult = await query(
            "SELECT claim_id FROM claims WHERE claim_text = ?",
            [cleanClaimText],
          );
          const existingClaim = Array.isArray(existingClaimResult)
            ? existingClaimResult
            : [];

          if (existingClaim.length > 0) {
            claimId = existingClaim[0].claim_id;
          } else {
            // 2️⃣ **Insert new claim since it doesn't exist**
            const insertResult = await query(
              "INSERT INTO claims (claim_text) VALUES (?)",
              [cleanClaimText],
            );
            claimId = insertResult?.insertId || null;
            isNewClaim = true; // ✅ Mark this claim as newly inserted
          }
        } catch (err) {
          console.error("❌ Database error inserting claim:", err);
          continue; // Skip this claim and move to the next
        }

        if (!claimId) {
          console.warn(
            "⚠️ Skipping claim as claimId is undefined:",
            cleanClaimText,
          );
          continue;
        }

        try {
          // 3️⃣ **If this is a NEW claim, no need to check for a link—just insert it.**
          if (isNewClaim) {
            await query(
              "INSERT INTO content_claims (content_id, claim_id, relationship_type,user_id) VALUES (?,?,?,?)",
              [content_id, claimId, content_type, user_id],
            );
            insertedCount++;
            console.log(
              `🔗 Created new claim & linked to content: ${cleanClaimText}`,
            );
          } else {
            // 4️⃣ **If claim already existed, check if link exists first.**
            const existingLinkResult = await query(
              "SELECT cc_id FROM content_claims WHERE content_id = ? AND claim_id = ?",
              [content_id, claimId],
            );
            const existingLink = Array.isArray(existingLinkResult)
              ? existingLinkResult
              : [];

            if (existingLink.length === 0) {
              await query(
                "INSERT INTO content_claims (content_id, claim_id, relationship_type) VALUES (?,?,?)",
                [content_id, claimId, content_type],
              );
              insertedCount++;
              console.log(
                `🔗 Linked existing claim to content: ${cleanClaimText}`,
              );
            } else {
              console.log("✅ Claim already linked, skipping:", cleanClaimText);
            }
          }
        } catch (err) {
          console.error("❌ Database error linking claim to content:", err);
        }
      }

      console.log(`✅ Successfully linked ${insertedCount} claims.`);
      return res.json({ success: true, insertedCount });
    } catch (error) {
      console.error("❌ Error in /api/claims/add:", error);
      return res.status(500).json({ error: "Server error storing claims" });
    }
  });

  //VERIMETER and TROLLMETER SCORES
  router.get("/api/content/:contentId/claim-scores", async (req, res) => {
    const { contentId } = req.params;
    const userId = req.query.viewerId ?? null;

    try {
      await query("CALL compute_verimeter_for_content(?, ?)", [
        contentId,
        userId,
      ]);

      const results = await query(
        `
      SELECT claim_id, verimeter_score
      FROM claim_scores
      WHERE content_id = ? AND (user_id IS NULL OR user_id = ?)
    `,
        [contentId, userId],
      );

      const scoreMap = {};
      for (const row of results) {
        scoreMap[row.claim_id] = Number(row.verimeter_score);
      }

      res.json(scoreMap);
    } catch (err) {
      console.error("Error fetching claim scores:", err);
      res.status(500).json({ error: "Failed to fetch claim scores" });
    }
  });

  // -------------------- CLAIM SOURCES API -------------------- //

  // ✅ Add new claim source (reference or Task)
  router.post("/api/claim-sources", (req, res) => {
    const { claim_id, reference_content_id, is_primary, user_id } = req.body;
    const sql = `
    INSERT INTO claim_sources (claim_id, reference_content_id, is_primary, user_id)
    VALUES (?, ?, ?, ?)
  `;

    pool.query(
      sql,
      [claim_id, reference_content_id, is_primary, user_id],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ claim_source_id: results.insertId });
      },
    );
  });

  // ✅ Fetch claim sources for a given claim
  router.get("/api/claim-sources/:claimId", (req, res) => {
    const claimId = req.params.claimId;
    const sql = `
    SELECT cs.claim_source_id, cs.reference_content_id, cs.is_primary, cs.created_at, c.content_name,c.url
    FROM claim_sources cs JOIN content c
    ON cs.reference_content_id=c.content_id
    WHERE cs.claim_id = ?
  `;
    pool.query(sql, [claimId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
  });

  //delete a claim source for a claim_id
  router.delete("/api/claim-sources/:claimId", (req, res) => {
    const claimId = req.params.claimId;
    const sql = `
    DELETE FROM claim_sources
    WHERE claim_sources_id = ?
  `;
    pool.query(sql, [claimId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(results);
    });
  });

  // ✅ Update claim sources for a given claim
  router.put("/api/claim-sources/:claim_sources_id", (req, res) => {
    const claim_sources_id = req.params.claim_sources_id;
    const { new_reference_id, notes } = req.body;
    const sql = `
    UPDATE claim_sources SET reference_id = ?, notes = ?
    WHERE claim_source_id = ?
  `;
    pool.query(
      sql,
      [new_reference_id, notes || null, claim_sources_id],
      (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
      },
    );
  });

  /**
   * GET /api/reference-claim-links/:contentId
   * Get AI evidence links (reference_claim_links) for a task
   * Returns: Array of links with support_level, stance, confidence, quote
   */
  router.get("/api/reference-claim-links/:contentId", async (req, res) => {
    const { contentId } = req.params;

    try {
      const sql = `
        SELECT
          rcl.ref_claim_link_id AS link_id,
          rcl.claim_id AS task_claim_id,
          rcl.reference_content_id,
          rcl.stance,
          rcl.score,
          rcl.confidence,
          rcl.support_level,
          rcl.rationale,
          rcl.evidence_text AS quote,
          rcl.evidence_offsets,
          rcl.created_by_ai,
          c.claim_text AS task_claim_text,
          c.claim_type AS task_claim_type,
          ref.content_name AS reference_title,
          ref.url AS reference_url,
          ref.topic AS reference_topic
        FROM reference_claim_links rcl
        JOIN claims c ON rcl.claim_id = c.claim_id
        JOIN content_claims cc ON c.claim_id = cc.claim_id
        JOIN content ref ON rcl.reference_content_id = ref.content_id
        WHERE cc.content_id = ?
        ORDER BY rcl.support_level DESC
      `;

      const results = await query(sql, [contentId]);
      res.json(results);
    } catch (err) {
      console.error("❌ Error fetching reference-claim links:", err);
      res.status(500).json({ error: "Database query failed" });
    }
  });

  /**
   * GET /api/claims-with-evidence/:contentId
   * Get claims with their claim_type and snippet flag
   * Used to distinguish snippets from regular claims in UI
   * Respects viewerId filtering like /api/claims/:content_id
   */
  router.get("/api/claims-with-evidence/:contentId", async (req, res) => {
    const { contentId } = req.params;
    const viewerId = req.query.viewerId;

    try {
      const sql = `
        SELECT
          c.claim_id,
          c.claim_text,
          c.claim_type,
          c.veracity_score,
          c.confidence_level,
          c.last_verified,
          cc.relationship_type,
          cc.content_id
        FROM claims c
        JOIN content_claims cc ON c.claim_id = cc.claim_id
        WHERE cc.content_id = ?
          ${
            viewerId
              ? "AND (cc.user_id IS NULL OR cc.user_id = ?)"
              : "AND cc.user_id IS NULL"
          }
        ORDER BY
          CASE c.claim_type
            WHEN 'task' THEN 1
            WHEN 'reference' THEN 2
            WHEN 'snippet' THEN 3
            ELSE 4
          END,
          c.claim_id
      `;

      const params = viewerId ? [contentId, viewerId] : [contentId];
      const results = await query(sql, params);
      res.json(results);
    } catch (err) {
      console.error("❌ Error fetching claims with evidence:", err);
      res.status(500).json({ error: "Database query failed" });
    }
  });

  /**
   * POST /api/bulk-claims-and-references
   * Fetch all claims and their references for multiple tasks at once
   * Request body: { taskIds: [1, 2, 3] }
   * Returns: { claimsByTask: {...}, claimReferences: {...} }
   */
  router.post("/api/bulk-claims-and-references", async (req, res) => {
    const { taskIds, viewerId } = req.body;

    console.log(
      "[bulk-claims] Received taskIds:",
      taskIds,
      "viewerId:",
      viewerId,
    );

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      console.log("[bulk-claims] Invalid taskIds array");
      return res.status(400).json({ error: "taskIds array required" });
    }

    try {
      // Fetch all claims for all tasks in one query
      const placeholders = taskIds.map(() => "?").join(",");
      console.log("[bulk-claims] SQL placeholders:", placeholders);

      // Build SQL with same pattern as /api/claims/:content_id
      const claimsSql = `
        SELECT
          c.claim_id,
          c.claim_text,
          c.claim_type,
          c.veracity_score,
          c.confidence_level,
          c.last_verified,
          cc.relationship_type,
          cc.content_id
        FROM claims c
        JOIN content_claims cc ON c.claim_id = cc.claim_id
        WHERE cc.content_id IN (${placeholders})
          ${viewerId ? "AND (cc.user_id IS NULL OR cc.user_id = ?)" : "AND cc.user_id IS NULL"}
        ORDER BY cc.content_id, c.claim_id
      `;

      const claimsParams = viewerId ? [...taskIds, viewerId] : taskIds;

      console.log(
        "[bulk-claims] Executing claims query with",
        taskIds.length,
        "tasks and viewerId:",
        viewerId,
      );
      const claims = await query(claimsSql, claimsParams);
      console.log("[bulk-claims] Found", claims.length, "claims");

      // Group claims by task
      const claimsByTask = {};
      const allClaimIds = [];
      claims.forEach((claim) => {
        if (!claimsByTask[claim.content_id]) {
          claimsByTask[claim.content_id] = [];
        }
        claimsByTask[claim.content_id].push(claim);
        allClaimIds.push(claim.claim_id);
      });

      // Fetch all claim references in one query
      let claimReferences = {};
      if (allClaimIds.length > 0) {
        const refPlaceholders = allClaimIds.map(() => "?").join(",");
        const refsSql = `
          SELECT
            claim_id,
            reference_content_id,
            support_level
          FROM claims_references
          WHERE claim_id IN (${refPlaceholders})
          ORDER BY claim_id
        `;

        console.log(
          "[bulk-claims] Executing references query with",
          allClaimIds.length,
          "claim IDs",
        );
        const refs = await query(refsSql, allClaimIds);
        console.log("[bulk-claims] Found", refs.length, "references");

        // Group references by claim
        refs.forEach((ref) => {
          if (!claimReferences[ref.claim_id]) {
            claimReferences[ref.claim_id] = [];
          }
          claimReferences[ref.claim_id].push({
            referenceId: ref.reference_content_id,
            supportLevel: ref.support_level,
          });
        });
      }

      console.log(
        "[bulk-claims] Success! Returning",
        Object.keys(claimsByTask).length,
        "tasks with claims,",
        Object.keys(claimReferences).length,
        "claims with references",
      );
      res.json({ claimsByTask, claimReferences });
    } catch (err) {
      console.error("❌ Error fetching bulk claims and references:", err);
      console.error("❌ Stack trace:", err.stack);
      console.error("❌ Task IDs received:", taskIds);
      res
        .status(500)
        .json({ error: "Database query failed", details: err.message });
    }
  });

  /**
   * GET /api/failed-references/:taskContentId
   * Get references that failed to scrape (stance = "insufficient" or rationale LIKE "Failed%")
   * These need manual scraping via dashboard
   */
  router.get("/api/failed-references/:taskContentId", async (req, res) => {
    const { taskContentId } = req.params;

    try {
      const sql = `
        SELECT
          ref.content_id,
          ref.content_name,
          ref.url,
          MAX(rcl.rationale) AS failure_reason,
          COUNT(rcl.ref_claim_link_id) AS linked_claims_count
        FROM content ref
        INNER JOIN reference_claim_links rcl ON ref.content_id = rcl.reference_content_id
        INNER JOIN content_relations cr ON ref.content_id = cr.reference_content_id
        WHERE cr.content_id = ?
          AND rcl.scrape_status IN ('snippet_only', 'failed')
        GROUP BY ref.content_id, ref.content_name, ref.url
        ORDER BY ref.content_id DESC
      `;

      const results = await query(sql, [taskContentId]);
      res.json(results);
    } catch (err) {
      console.error("❌ Error fetching failed references:", err);
      res.status(500).json({ error: "Database query failed" });
    }
  });

  return router;
}
