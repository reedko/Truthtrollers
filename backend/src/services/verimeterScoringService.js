const DEFAULT_POLICY = {
  version: 1,
  components: {
    source_crest: { enabled: true, multiplier: 1 },
    reviewer_reputation: { enabled: true, multiplier: 0.25 },
    publisher_rating: { enabled: false, multiplier: 0.25 },
    author_rating: { enabled: false, multiplier: 0.15 },
  },
  source_crest: {
    letter: { A: 1.2, B: 1.1, C: 1, D: 0.85, E: 0.65, F: 0.5, "Ø": 1 },
    number: { "1": 1.1, "2": 1.05, "3": 1, "4": 0.9, "5": 0.8, "6": 0.7, "Ø": 1 },
  },
  missing: {
    source_crest: 1,
    reviewer_reputation: 1,
    publisher_rating: 1,
    author_rating: 1,
  },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? deepMerge(base?.[key] || {}, value)
        : value;
  }
  return output;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function getVerimeterPolicy(query) {
  try {
    const rows = await query(
      "SELECT config_key, config_value FROM verimeter_weighting_config WHERE is_active = 1",
    );
    const patch = {};
    for (const row of rows || []) {
      patch[row.config_key] = parseJson(row.config_value, row.config_value);
    }
    return deepMerge(DEFAULT_POLICY, patch);
  } catch (error) {
    if (error?.code !== "ER_NO_SUCH_TABLE") {
      console.warn("[verimeter] Falling back to default policy:", error.message);
    }
    return DEFAULT_POLICY;
  }
}

export async function saveVerimeterPolicy(query, policy, userId = null) {
  const next = deepMerge(DEFAULT_POLICY, policy || {});
  const entries = [
    ["version", next.version, "Verimeter scoring policy version."],
    ["components", next.components, "Enabled components and multipliers."],
    ["source_crest", next.source_crest, "Admiralty/source crest letter and number weights."],
    ["missing", next.missing, "Neutral fallback weights for missing signals."],
  ];

  for (const [key, value, description] of entries) {
    await query(
      `INSERT INTO verimeter_weighting_config
         (config_key, config_value, description, updated_by, updated_at, is_active)
       VALUES (?, ?, ?, ?, NOW(), 1)
       ON DUPLICATE KEY UPDATE
         config_value = VALUES(config_value),
         description = VALUES(description),
         updated_by = VALUES(updated_by),
         updated_at = NOW(),
         is_active = 1`,
      [key, JSON.stringify(value), description, userId],
    );
  }
  return next;
}

function normalizeRatingScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n <= 10) return clamp(n * 10, 0, 100);
  return clamp(n, 0, 100);
}

function scoreToFactor(score, multiplier, missing = 1) {
  const normalized = normalizeRatingScore(score);
  if (normalized === null) return missing;
  return clamp(1 + Number(multiplier || 0) * ((normalized - 50) / 50), 0.1, 3);
}

function factorFromRawWeight(rawWeight, multiplier, missing = 1) {
  const n = Number(rawWeight);
  if (!Number.isFinite(n)) return missing;
  return clamp(1 + Number(multiplier || 0) * (n - 1), 0.1, 3);
}

export function parseSourceCrestFactor(admiraltyCode, policy) {
  const code = String(admiraltyCode || "").trim().toUpperCase();
  if (!code) return { factor: policy.missing.source_crest, raw: null, letter: "Ø", number: "Ø" };

  const letter = code.match(/^([A-FØ])/)?.[1] || "Ø";
  const number = code.match(/([1-6Ø])$/)?.[1] || "Ø";
  const letterWeight = Number(policy.source_crest?.letter?.[letter] ?? policy.source_crest?.letter?.["Ø"] ?? 1);
  const numberWeight = Number(policy.source_crest?.number?.[number] ?? policy.source_crest?.number?.["Ø"] ?? 1);
  const raw = letterWeight * numberWeight;
  return {
    factor: factorFromRawWeight(raw, policy.components.source_crest.multiplier, policy.missing.source_crest),
    raw,
    letter,
    number,
  };
}

async function getReviewerFactor(query, userId, policy) {
  if (!policy.components.reviewer_reputation.enabled || !userId) {
    return { factor: 1, score: null };
  }
  const rows = await query("SELECT veracity_rating FROM user_reputation WHERE user_id = ? LIMIT 1", [userId]);
  const score = rows?.[0]?.veracity_rating;
  return {
    factor: scoreToFactor(score, policy.components.reviewer_reputation.multiplier, policy.missing.reviewer_reputation),
    score: normalizeRatingScore(score),
  };
}

async function reputationWeightedRatingFactor(query, table, idColumn, id, policy, componentKey) {
  const component = policy.components[componentKey];
  if (!component?.enabled || !id) return { factor: 1, score: null, rating_count: 0 };

  const rows = await query(
    `SELECT r.veracity_score, r.user_id, COALESCE(ur.veracity_rating, 50) AS rater_reputation
       FROM ${table} r
       LEFT JOIN user_reputation ur ON ur.user_id = r.user_id
      WHERE r.${idColumn} = ?
        AND r.veracity_score IS NOT NULL`,
    [id],
  );

  let weightedSum = 0;
  let totalWeight = 0;
  for (const row of rows || []) {
    const score = normalizeRatingScore(row.veracity_score);
    if (score === null) continue;
    const raterWeight = row.user_id ? scoreToFactor(row.rater_reputation, 0.25, 1) : 1;
    weightedSum += score * raterWeight;
    totalWeight += raterWeight;
  }

  if (totalWeight <= 0) {
    return { factor: policy.missing[componentKey], score: null, rating_count: 0 };
  }

  const score = weightedSum / totalWeight;
  return {
    factor: scoreToFactor(score, component.multiplier, policy.missing[componentKey]),
    score,
    rating_count: rows.length,
  };
}

async function getAuthorFactor(query, sourceContentId, policy) {
  if (!policy.components.author_rating.enabled || !sourceContentId) {
    return { factor: 1, score: null, rating_count: 0 };
  }
  const authors = await query("SELECT author_id FROM content_authors WHERE content_id = ?", [sourceContentId]);
  if (!authors?.length) return { factor: policy.missing.author_rating, score: null, rating_count: 0 };

  const factors = [];
  for (const author of authors) {
    factors.push(await reputationWeightedRatingFactor(query, "author_ratings", "author_id", author.author_id, policy, "author_rating"));
  }
  const scored = factors.filter((f) => f.score !== null);
  if (!scored.length) return { factor: policy.missing.author_rating, score: null, rating_count: 0 };
  return {
    factor: scored.reduce((sum, f) => sum + f.factor, 0) / scored.length,
    score: scored.reduce((sum, f) => sum + f.score, 0) / scored.length,
    rating_count: scored.reduce((sum, f) => sum + f.rating_count, 0),
  };
}

async function fetchManualLinks(query, contentId, userId = null, targetClaimId = null) {
  const params = [contentId];
  let userFilter = "";
  let claimFilter = "";
  if (targetClaimId) {
    claimFilter = "AND cl.target_claim_id = ?";
    params.push(targetClaimId);
  }
  if (userId) {
    userFilter = "AND cl.user_id = ?";
    params.push(userId);
  }

  return query(
    `SELECT
       cl.claim_link_id,
       cl.target_claim_id,
       target_claim.claim_text AS case_claim_text,
       cl.source_claim_id,
       source_claim.claim_text AS source_claim_text,
       target_cc.relationship_type AS target_relationship_type,
       target_cc.object_claim_text,
       target_cc.article_stance,
       target_cc.argument_function,
       target_cc.score_transform,
       cl.relationship,
       cl.support_level,
       cl.user_id,
       source_content.content_id AS source_content_id,
       source_p.publisher_id AS source_publisher_id,
       source_p.publisher_name AS source_publisher_name,
       COALESCE(
         (SELECT ae.admiralty_code
            FROM admiralty_evaluations ae
           WHERE ae.target_type = 'content'
             AND ae.target_id = source_content.content_id
             AND (source_p.publisher_id IS NULL OR ae.publisher_id = source_p.publisher_id)
             AND ae.evaluation_status NOT IN ('insufficient_data')
           ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested')
           LIMIT 1),
         (SELECT ae.admiralty_code
            FROM admiralty_evaluations ae
           WHERE ae.target_type = 'publisher'
             AND ae.target_id = source_p.publisher_id
             AND ae.evaluation_status NOT IN ('insufficient_data')
           ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested')
           LIMIT 1)
       ) AS source_admiralty_code
     FROM claim_links cl
     JOIN claims target_claim ON target_claim.claim_id = cl.target_claim_id
     JOIN claims source_claim ON source_claim.claim_id = cl.source_claim_id
     JOIN content_claims target_cc ON target_cc.claim_id = cl.target_claim_id
     LEFT JOIN content_claims source_cc ON source_cc.claim_id = cl.source_claim_id
     LEFT JOIN content source_content ON source_content.content_id = source_cc.content_id
     LEFT JOIN content_publishers source_cp ON source_cp.content_id = source_content.content_id
     LEFT JOIN publishers source_p ON source_p.publisher_id = source_cp.publisher_id
     WHERE target_cc.content_id = ?
       ${claimFilter}
       ${userFilter}
       AND COALESCE(cl.disabled, 0) = 0
       AND COALESCE(cl.created_by_ai, 0) = 0
       AND cl.support_level IS NOT NULL
       AND cl.support_level != 0
       AND COALESCE(target_cc.score_transform, 'normal') NOT IN ('none', 'review')
       AND (
         COALESCE(target_cc.relationship_type, '') <> 'provenance'
         OR COALESCE(target_cc.score_transform, '') IN ('normal', 'invert')
       )
     GROUP BY
       cl.claim_link_id, cl.target_claim_id, target_claim.claim_text,
       target_cc.relationship_type, target_cc.object_claim_text,
       target_cc.article_stance, target_cc.argument_function, target_cc.score_transform,
       cl.source_claim_id, source_claim.claim_text, cl.relationship,
       cl.support_level, cl.user_id, source_content.content_id,
       source_p.publisher_id, source_p.publisher_name
     ORDER BY cl.claim_link_id`,
    params,
  );
}

async function explainLink(query, link, policy) {
  const rawSupportLevel = clamp(Number(link.support_level) || 0, -1, 1);
  const scoreTransform = link.score_transform || "normal";
  const supportLevel = scoreTransform === "invert" ? -rawSupportLevel : rawSupportLevel;
  const factors = [];

  const sourceCrest = policy.components.source_crest.enabled
    ? parseSourceCrestFactor(link.source_admiralty_code, policy)
    : { factor: 1, raw: null, letter: null, number: null };
  factors.push({ id: "source_crest", enabled: policy.components.source_crest.enabled, factor: sourceCrest.factor, detail: sourceCrest });

  const reviewer = await getReviewerFactor(query, link.user_id, policy);
  factors.push({ id: "reviewer_reputation", enabled: policy.components.reviewer_reputation.enabled, factor: reviewer.factor, detail: reviewer });

  const publisher = await reputationWeightedRatingFactor(
    query,
    "publisher_ratings",
    "publisher_id",
    link.source_publisher_id,
    policy,
    "publisher_rating",
  );
  factors.push({ id: "publisher_rating", enabled: policy.components.publisher_rating.enabled, factor: publisher.factor, detail: publisher });

  const author = await getAuthorFactor(query, link.source_content_id, policy);
  factors.push({ id: "author_rating", enabled: policy.components.author_rating.enabled, factor: author.factor, detail: author });

  const weight = factors.reduce((product, factor) => product * (Number(factor.factor) || 1), 1);
  return {
    ...link,
    raw_support_level: rawSupportLevel,
    support_level: supportLevel,
    article_score_transform: scoreTransform,
    weight,
    weighted_score: supportLevel * weight,
    factors,
  };
}

function summarizeWeightedLinks(explanations) {
  const totalWeight = explanations.reduce((sum, link) => sum + link.weight, 0);
  const weightedScore = explanations.reduce((sum, link) => sum + link.weighted_score, 0);
  const proScore = explanations
    .filter((link) => link.support_level > 0)
    .reduce((sum, link) => sum + link.weight, 0);
  const conScore = explanations
    .filter((link) => link.support_level < 0)
    .reduce((sum, link) => sum + link.weight, 0);

  return {
    verimeter_score: totalWeight > 0 ? clamp(weightedScore / totalWeight, -1, 1) : 0,
    pro_score: totalWeight > 0 ? clamp(proScore / totalWeight, 0, 1) : 0,
    con_score: totalWeight > 0 ? clamp(conScore / totalWeight, 0, 1) : 0,
    link_count: explanations.length,
    total_weight: totalWeight,
  };
}

export async function calculateUserContentScore(query, contentId, userId = null, options = {}) {
  const policy = options.policy || await getVerimeterPolicy(query);
  const links = await fetchManualLinks(query, contentId, userId);
  const explanations = [];
  for (const link of links || []) {
    explanations.push(await explainLink(query, link, policy));
  }
  return {
    ...summarizeWeightedLinks(explanations),
    mode: "user",
    userId,
    policy,
    explanation: options.includeExplanation ? explanations : undefined,
  };
}

export async function calculateUserClaimScore(query, claimId, userId = null, options = {}) {
  const policy = options.policy || await getVerimeterPolicy(query);
  const rows = await query("SELECT content_id FROM content_claims WHERE claim_id = ? LIMIT 1", [claimId]);
  const contentId = rows?.[0]?.content_id;
  if (!contentId) return { verimeter_score: 0, pro_score: 0, con_score: 0, link_count: 0 };

  const links = await fetchManualLinks(query, contentId, userId, claimId);
  const explanations = [];
  for (const link of links || []) {
    explanations.push(await explainLink(query, link, policy));
  }
  return {
    ...summarizeWeightedLinks(explanations),
    mode: "user",
    userId,
    claim_id: claimId,
    policy,
    explanation: options.includeExplanation ? explanations : undefined,
  };
}

export async function calculateUserClaimScoresForContent(query, contentId, userId = null) {
  const policy = await getVerimeterPolicy(query);
  const links = await fetchManualLinks(query, contentId, userId);
  const grouped = new Map();
  for (const link of links || []) {
    const explanation = await explainLink(query, link, policy);
    const list = grouped.get(link.target_claim_id) || [];
    list.push(explanation);
    grouped.set(link.target_claim_id, list);
  }
  const scores = {};
  for (const [claimId, explanations] of grouped.entries()) {
    scores[claimId] = summarizeWeightedLinks(explanations).verimeter_score;
  }
  return scores;
}

export function getDefaultVerimeterPolicy() {
  return DEFAULT_POLICY;
}
