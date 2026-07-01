import fs from "fs/promises";
import path from "path";
import { dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";
import { calculateUserContentScore } from "./verimeterScoringService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REVIEW_ARTICLE_ASSET_DIR = path.resolve(__dirname, "../../assets/images/review-articles");
const REVIEW_ARTICLE_ASSET_URL_BASE = "/assets/images/review-articles";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function mdEscape(value) {
  return safeText(value).replace(/\s+/g, " ");
}

function xmlText(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mdLink(label, url) {
  const cleanLabel = mdEscape(label || url || "Source");
  const cleanUrl = safeText(url);
  return cleanUrl ? `[${cleanLabel}](${cleanUrl})` : cleanLabel;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function relationshipFromSupport(relationship, supportLevel) {
  const rel = safeText(relationship).toLowerCase();
  if (["support", "supports", "supported"].includes(rel)) return "supports";
  if (["refute", "refutes", "refuted"].includes(rel)) return "refutes";
  if (["qualifies", "qualify", "nuance", "related"].includes(rel)) return "qualifies";
  if (["insufficient", "unclear"].includes(rel)) return "unclear";

  const score = numberOrNull(supportLevel);
  if (score !== null) {
    if (score > 0.3) return "supports";
    if (score < -0.3) return "refutes";
    return "qualifies";
  }

  return "unclear";
}

function strengthLabel(supportLevel, confidence) {
  const support = Math.abs(numberOrNull(supportLevel) ?? 0);
  const conf = numberOrNull(confidence);
  const weighted = conf !== null ? support * Math.max(conf, 0) : support;
  if (weighted >= 0.75) return "High";
  if (weighted >= 0.4) return "Medium";
  if (weighted > 0) return "Low";
  return "Unclear";
}

function verdictFromScore(score) {
  if (score === null || score === undefined) return "Review assembled";
  if (score >= 75) return "Mostly supported";
  if (score >= 58) return "Leans supported";
  if (score > 42) return "Mixed or qualified";
  if (score > 25) return "Leans refuted";
  return "Mostly refuted";
}

function confidenceFromLinks(links) {
  const values = links.map((l) => numberOrNull(l.confidence)).filter((v) => v !== null);
  if (!values.length) return "Not enough linked evidence";
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (avg >= 0.8) return "High";
  if (avg >= 0.55) return "Medium";
  return "Low";
}

function computeRatingScore(links) {
  const scored = links
    .map((l) => numberOrNull(l.support_level))
    .filter((v) => v !== null);
  if (!scored.length) return null;
  const avg = scored.reduce((sum, v) => sum + Math.max(-1, Math.min(1, v)), 0) / scored.length;
  return Math.round(((avg + 1) / 2) * 100);
}

function countRelationships(links) {
  return links.reduce(
    (acc, link) => {
      const rel = relationshipFromSupport(link.relationship || link.stance, link.support_level);
      if (rel === "supports") acc.supports += 1;
      else if (rel === "refutes") acc.refutes += 1;
      else acc.unresolved += 1;
      return acc;
    },
    { supports: 0, refutes: 0, unresolved: 0 },
  );
}

function normalizeArticleRow(row) {
  if (!row) return null;
  let modules = row.modules_json;
  if (typeof modules === "string") {
    try {
      modules = JSON.parse(modules);
    } catch {
      modules = [];
    }
  }
  return { ...row, modules_json: asArray(modules) };
}

function moduleObject(type, order, title, enabled, data, markdown) {
  return {
    id: type,
    type,
    enabled,
    order,
    title,
    data: data || {},
    markdown: markdown || "",
  };
}

function visualModuleObject(id, order, title, enabled, description, data = {}, asset = null) {
  return {
    id,
    type: "visual",
    enabled,
    order,
    title,
    description,
    data,
    asset,
    markdown: asset?.image_url
      ? [`## ${title}`, "", `![${mdEscape(asset.alt || title)}](${asset.image_url})`, "", asset.caption || ""].filter(Boolean).join("\n")
      : "",
  };
}

function xmlEscape(value) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgText(value, max = 72) {
  const clean = safeText(value, "Unavailable").replace(/\s+/g, " ");
  return xmlEscape(clean.length > max ? `${clean.slice(0, max - 3)}...` : clean);
}

function relationshipColor(relationship) {
  const rel = safeText(relationship).toLowerCase();
  if (rel === "supports") return "#22c55e";
  if (rel === "refutes") return "#f87171";
  if (rel === "qualifies") return "#fbbf24";
  return "#94a3b8";
}

function padAssetId(value, width = 2) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "00";
  return String(Math.trunc(n)).padStart(width, "0");
}

function svgShell(width, height, title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(title)}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#07111f"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="100%" height="100%" rx="18" fill="url(#bg)"/>
  <rect x="10" y="10" width="${width - 20}" height="${height - 20}" rx="16" fill="rgba(255,255,255,0.04)" stroke="#38bdf8" stroke-opacity="0.32"/>
  <text x="28" y="42" fill="#38bdf8" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="700">${xmlEscape(title)}</text>
  ${body}
</svg>`;
}

async function writeSvgAsset(articleId, filename, svg) {
  await fs.mkdir(REVIEW_ARTICLE_ASSET_DIR, { recursive: true });
  const safeArticleId = Number(articleId) || "draft";
  const file = `article_${safeArticleId}_${filename}.svg`;
  await fs.writeFile(path.join(REVIEW_ARTICLE_ASSET_DIR, file), svg, "utf8");
  return `${REVIEW_ARTICLE_ASSET_URL_BASE}/${file}`;
}

async function writeBinaryAsset(articleId, filename, buffer, extension = "png", options = {}) {
  await fs.mkdir(REVIEW_ARTICLE_ASSET_DIR, { recursive: true });
  const safeArticleId = Number(articleId) || "draft";
  const safeName = safeText(filename, "snapshot").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80);
  const safeExt = safeText(extension, "png").replace(/[^a-z0-9]+/gi, "").slice(0, 8) || "png";
  const file = options.prefixArticle === false ? `${safeName}.${safeExt}` : `article_${safeArticleId}_${safeName}.${safeExt}`;
  await fs.writeFile(path.join(REVIEW_ARTICLE_ASSET_DIR, file), buffer);
  return `${REVIEW_ARTICLE_ASSET_URL_BASE}/${file}`;
}

export function assembleMarkdownFromModules(modules) {
  return asArray(modules)
    .filter((module) => module && module.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((module) => safeText(module.markdown))
    .filter(Boolean)
    .join("\n\n");
}

export function buildRatingSummaryModule(reviewData) {
  const { content, verdict, confidence, ratingScore, summary } = reviewData;
  const titleLine = content?.content_name ? `\n\nOriginal content: ${mdLink(content.content_name, content.url)}` : "";
  const scoreLine = ratingScore !== null ? `\n**Score:** ${ratingScore}/100` : "";
  const markdown = [
    "## Verdict",
    "",
    `**Rating:** ${mdEscape(verdict)}`,
    `**Confidence:** ${mdEscape(confidence)}`,
    scoreLine.trim(),
    titleLine.trim(),
    "",
    mdEscape(summary),
  ].filter((line) => line !== "").join("\n");

  return moduleObject(
    "rating_summary",
    10,
    "Rating Summary",
    true,
    {
      verdict,
      confidence,
      rating_score: ratingScore,
      original_content_title: content?.content_name || null,
      original_content_url: content?.url || null,
      summary,
    },
    markdown,
  );
}

export function buildVerimeterGraphicModule(reviewData) {
  const score = numberOrNull(reviewData.verimeterScore?.verimeter_score);
  const pro = numberOrNull(reviewData.verimeterScore?.pro_score);
  const con = numberOrNull(reviewData.verimeterScore?.con_score);
  const linkCount = numberOrNull(reviewData.verimeterScore?.link_count) ?? asArray(reviewData.claimLinks).length;
  const percent = score !== null ? Math.round(score * 100) : null;

  return visualModuleObject(
    "verimeter_graphic",
    5,
    "Verimeter Graphic",
    true,
    "Publication-ready Verimeter gauge using the same claim-link score as the platform.",
    {
      score,
      percent,
      pro_score: pro,
      con_score: con,
      link_count: linkCount,
      verdict: reviewData.verdict,
      confidence: reviewData.confidence,
      source: reviewData.verimeterScore?.source || "verimeterScoringService",
    },
    null,
  );
}

export function buildClaimAnalysisModule(reviewData) {
  const links = asArray(reviewData.claimLinks);
  const body = links.length
    ? links.map((link, index) => {
      const relationship = relationshipFromSupport(link.relationship || link.stance, link.support_level);
      const sourceTitle = link.source_title || link.source_publisher || "Source";
      const rationale = safeText(link.rationale || link.notes, "No rationale provided yet.");
      const strength = link.support_level !== undefined && link.support_level !== null
        ? link.support_level
        : strengthLabel(link.support_level, link.confidence);
      return [
        `### Claim ${index + 1}: ${mdEscape(link.case_claim_text || link.content_claim_text || link.target_claim_text || "Claim")}`,
        "",
        `**Relationship:** ${relationship}`,
        `**Strength:** ${mdEscape(strength ?? "Not rated")}`,
        `**Source:** ${mdLink(sourceTitle, link.source_url)}`,
        `**Source claim:** ${mdEscape(link.source_claim_text || link.quote || "No source claim text recorded.")}`,
        "",
        "**Rationale:**",
        mdEscape(rationale),
      ].join("\n");
    }).join("\n\n")
    : "No user-created claim links were available for this review.";

  return {
    ...moduleObject(
      "claim_link_analysis",
      15,
      "Claim-Link Data",
      true,
      { claim_links: links, deterministic_markdown: `## Claim-link analysis\n\n${body}` },
      "",
    ),
    hidden: true,
  };
}

export function buildRatingGraphModule(reviewData) {
  const counts = countRelationships(reviewData.claimLinks);
  const score = reviewData.ratingScore;
  const markdown = [
    "## Rating graph",
    "",
    `The review included ${counts.supports} supporting links, ${counts.refutes} refuting links, and ${counts.unresolved} unresolved or qualifying links.`,
    score !== null ? `Overall deterministic review score: ${score}/100.` : "No aggregate rating score was available.",
  ].join("\n");

  return moduleObject(
    "rating_graph",
    30,
    "Rating Graph",
    true,
    {
      verdict: reviewData.verdict,
      score,
      confidence: reviewData.confidence,
      support_count: counts.supports,
      refute_count: counts.refutes,
      unresolved_count: counts.unresolved,
    },
    markdown,
  );
}

export function buildEvidenceMapSnapshotModule(reviewData) {
  const counts = countRelationships(reviewData.claimLinks);
  const markdown = [
    "## Evidence map",
    "",
    `This evidence map snapshot contains ${counts.supports} supporting links, ${counts.refutes} refuting links, and ${counts.unresolved} qualifying or unclear links.`,
    "",
    "View the live VeriStrata evidence map:",
    reviewData.canonicalReviewUrl,
  ].join("\n");

  return moduleObject(
    "evidence_map_snapshot",
    40,
    "Evidence Map Snapshot",
    true,
    {
      content_id: reviewData.content?.content_id,
      review_id: reviewData.reviewId || null,
      canonical_evidence_map_url: reviewData.canonicalReviewUrl,
      graph_snapshot: {
        claim_links: asArray(reviewData.claimLinks),
        relationship_counts: counts,
      },
    },
    markdown,
  );
}

export function buildEvidenceMapImageModule(reviewData) {
  const counts = countRelationships(reviewData.claimLinks);
  return visualModuleObject(
    "evidence_map_image",
    35,
    "Evidence Map Snapshot",
    true,
    "Snapshot of the claim/source evidence map.",
    {
      content_id: reviewData.content?.content_id,
      review_id: reviewData.reviewId || null,
      canonical_evidence_map_url: reviewData.canonicalReviewUrl,
      graph_snapshot: {
        claim_links: asArray(reviewData.claimLinks),
        relationship_counts: counts,
      },
    },
    null,
  );
}

export function buildKnowledgeGraphSnapshotModule(reviewData) {
  const content = reviewData.content || {};
  const author = reviewData.authors?.[0]?.author_name || "Unknown";
  const publisher = reviewData.publishers?.[0]?.publisher_name || content.media_source || "Unknown";
  const sources = new Set(asArray(reviewData.claimLinks).map((l) => l.source_url || l.source_title).filter(Boolean));
  const linkedCaseClaims = new Set(asArray(reviewData.claimLinks).map((l) => l.case_claim_id || l.task_claim_id).filter(Boolean));
  const claimCount = linkedCaseClaims.size || asArray(reviewData.claimLinks).length;

  const markdown = [
    "## Knowledge graph snapshot",
    "",
    "This review connects:",
    "",
    `* Content: ${mdEscape(content.content_name || "Untitled content")}`,
    `* Author: ${mdEscape(author)}`,
    `* Publisher: ${mdEscape(publisher)}`,
    `* Claims reviewed: ${claimCount}`,
    `* Sources used: ${sources.size}`,
  ].join("\n");

  return moduleObject(
    "knowledge_graph_snapshot",
    50,
    "Knowledge Graph Snapshot",
    true,
    {
      content,
      author,
      publisher,
      claims_reviewed: claimCount,
      sources_used: sources.size,
      claim_links: asArray(reviewData.claimLinks),
      related_prior_reviews: asArray(reviewData.relatedReviews),
    },
    markdown,
  );
}

export function buildKnowledgeGraphImageModule(reviewData) {
  const content = reviewData.content || {};
  const author = reviewData.authors?.[0]?.author_name || "Unknown";
  const publisher = reviewData.publishers?.[0]?.publisher_name || content.media_source || "Unknown";
  const sources = new Set(asArray(reviewData.claimLinks).map((l) => l.source_url || l.source_title).filter(Boolean));
  return visualModuleObject(
    "knowledge_graph_image",
    15,
    "Knowledge Graph Snapshot",
    true,
    "Snapshot of content, publisher, claims, and sources connected by this review.",
    {
      content,
      author,
      publisher,
      claim_links: asArray(reviewData.claimLinks),
      sources_used: sources.size,
    },
    null,
  );
}

export function buildSourceLandscapeGraphicModule(reviewData) {
  const content = reviewData.content || {};
  const publisher = reviewData.publishers?.[0]?.publisher_name || content.media_source || "Original publisher";
  return visualModuleObject(
    "source_landscape_graphic",
    40,
    "Source Landscape Graphic",
    true,
    "Static source landscape comparing the reviewed publisher with linked source publishers.",
    {
      original_publisher: publisher,
      publisher_context: buildPublisherContext(reviewData.publishers, reviewData.publisherRatings, reviewData.publisherProfiles),
      claim_links: asArray(reviewData.claimLinks),
    },
    null,
  );
}

export function buildClaimLinkMiniGraphicsModule(reviewData) {
  return visualModuleObject(
    "claim_link_mini_graphics",
    60,
    "Claim-Link Mini Graphics",
    false,
    "One compact graphic for each case-claim to source-claim relationship.",
    {
      claim_links: asArray(reviewData.claimLinks),
    },
    null,
  );
}

export function buildKnowledgeRootsModule(reviewData) {
  const items = asArray(reviewData.backgroundSignals);
  const body = items.length
    ? items.map((item) => `* ${mdEscape(item.text)}${item.url ? ` (${item.url})` : ""}${item.confidence ? ` - confidence: ${item.confidence}` : ""}`).join("\n")
    : "* No sourced background signals were available for this draft.";

  return moduleObject(
    "knowledge_roots",
    60,
    "Relevant Background Signals",
    false,
    { signals: items },
    [
      "## Relevant background signals",
      "",
      "The following context may help readers understand the source landscape. These items should be treated as background signals, not as proof that the current claim is true or false.",
      "",
      body,
    ].join("\n"),
  );
}

export function buildPublisherMediaRatingsModule(reviewData) {
  const publisher = reviewData.publishers?.[0] || {};
  const ratings = asArray(reviewData.publisherRatings);
  const profiles = asArray(reviewData.publisherProfiles);
  const wikipedia = profiles.find((p) => safeText(p.source).toLowerCase().includes("wikipedia"));
  const mbfc = ratings.find((r) => safeText(r.source).toLowerCase().includes("media bias") || safeText(r.source).toLowerCase().includes("mbfc"));
  const adFontes = ratings.find((r) => safeText(r.source).toLowerCase().includes("ad fontes") || safeText(r.source).toLowerCase().includes("adfontes"));

  const ratingLine = (label, row) => {
    if (!row) return `* **${label}:** Not available`;
    const parts = [row.rating_label, row.rating_type, row.score != null ? `score ${row.score}` : null].filter(Boolean).join(", ");
    return `* **${label}:** ${mdEscape(parts || row.notes || "Available")} ${row.url ? `(${row.url})` : ""}`;
  };

  const markdown = [
    "## Publisher context",
    "",
    "External context sources:",
    "",
    wikipedia
      ? `* **Wikipedia:** ${mdEscape(wikipedia.summary || wikipedia.evidence_quote || wikipedia.notes || "Profile available")} ${wikipedia.url ? `(${wikipedia.url})` : ""}`
      : "* **Wikipedia:** Not available",
    ratingLine("Media Bias/Fact Check", mbfc),
    ratingLine("Ad Fontes", adFontes),
    `* **VeriStrata publisher record:** ${publisher.publisher_name ? mdEscape(publisher.publisher_name) : "No aggregate available"}`,
  ].join("\n");

  return moduleObject(
    "publisher_context_graphic",
    20,
    "Publisher Context Graphic",
    true,
    {
      publisher_context: buildPublisherContext(reviewData.publishers, reviewData.publisherRatings, reviewData.publisherProfiles),
      publisher,
      wikipedia: wikipedia || null,
      media_bias_fact_check: mbfc || null,
      ad_fontes: adFontes || null,
      veristrata_publisher_record: publisher || null,
      all_ratings: ratings,
      all_profiles: profiles,
    },
    markdown,
  );
}

export function buildSubjectContextModule(reviewData) {
  const authorSubjects = asArray(reviewData.authorSubjectContext);
  const publisherSubjects = asArray(reviewData.publisherSubjectContext);
  const line = (row) => {
    const subject = row.topic || row.subtopic || "Uncategorized";
    const count = row.review_count ?? row.content_count ?? 0;
    const latest = row.latest_title ? `; latest: ${mdEscape(row.latest_title)}` : "";
    return `* ${mdEscape(subject)}: ${count} prior VeriStrata item${Number(count) === 1 ? "" : "s"}${latest}`;
  };

  const authorBody = authorSubjects.length
    ? authorSubjects.map(line).join("\n")
    : "* No prior author subject patterns were available in VeriStrata records.";
  const publisherBody = publisherSubjects.length
    ? publisherSubjects.map(line).join("\n")
    : "* No prior publisher subject patterns were available in VeriStrata records.";

  return moduleObject(
    "subject_context",
    70,
    "Author and Publisher Subject Context",
    false,
    {
      author_subjects: authorSubjects,
      publisher_subjects: publisherSubjects,
    },
    [
      "## Author and publisher subject context",
      "",
      "This context is based on prior VeriStrata records for the same author or publisher. It is background context, not proof that the current claim is true or false.",
      "",
      "### Author subjects",
      "",
      authorBody,
      "",
      "### Publisher subjects",
      "",
      publisherBody,
    ].join("\n"),
  );
}

export function buildReviewerReputationModule(reviewData) {
  const reviewer = reviewData.reviewer || {};
  const rep = reviewData.reputation || {};
  const score = rep.veracity_rating ?? rep.reputation_score ?? rep.score ?? "not yet scored";
  const reviewCount = rep.total_ratings ?? reviewData.reviewerReviewCount ?? null;
  const name = reviewer.full_name || reviewer.username || "A VeriStrata reviewer";
  const reviewCountText = reviewCount !== null ? ` Review count: ${reviewCount}.` : "";

  return moduleObject(
    "reviewer_reputation",
    80,
    "Reviewer Reputation",
    true,
    {
      reviewer_name: name,
      username: reviewer.username || null,
      reputation_score: score,
      review_count: reviewCount,
      role_badges: asArray(reviewData.reviewerRoles).map((r) => r.name),
    },
    `## Reviewer\n\nThis review was prepared by ${mdEscape(name)}, VeriStrata reputation score: ${score}.${reviewCountText}`,
  );
}

export function buildCanonicalLinkModule(reviewData) {
  return moduleObject(
    "canonical_link",
    90,
    "Live VeriStrata Review",
    true,
    { canonical_review_url: reviewData.canonicalReviewUrl },
    [
      "## Live VeriStrata review",
      "",
      "This article was generated from a VeriStrata evidence review. View the live evidence map, claim links, and aggregate review here:",
      reviewData.canonicalReviewUrl,
    ].join("\n"),
  );
}

export function buildArticleModules(reviewData) {
  return [
    buildVerimeterGraphicModule(reviewData),
    buildRatingSummaryModule(reviewData),
    buildEvidenceMapImageModule(reviewData),
    buildKnowledgeGraphImageModule(reviewData),
    buildSourceLandscapeGraphicModule(reviewData),
    buildClaimLinkMiniGraphicsModule(reviewData),
    buildClaimAnalysisModule(reviewData),
    buildSubjectContextModule(reviewData),
    buildReviewerReputationModule(reviewData),
    buildCanonicalLinkModule(reviewData),
  ];
}

async function optionalQuery(query, sql, params = [], fallback = []) {
  try {
    return await query(sql, params);
  } catch (err) {
    console.warn("[review-articles] Optional query failed:", err.message);
    return fallback;
  }
}

export async function ensureReviewArticlesTable(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS review_articles (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      content_id BIGINT UNSIGNED NOT NULL,
      author_user_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(512) NOT NULL,
      slug VARCHAR(255) NULL,
      status ENUM('draft', 'published') NOT NULL DEFAULT 'draft',
      verdict VARCHAR(128) NULL,
      confidence VARCHAR(128) NULL,
      summary TEXT NULL,
      body_markdown MEDIUMTEXT NULL,
      modules_json JSON NOT NULL,
      canonical_review_url VARCHAR(2048) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      published_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_review_articles_slug (slug),
      UNIQUE KEY uq_review_articles_content_author (content_id, author_user_id),
      KEY idx_review_articles_content_id (content_id),
      KEY idx_review_articles_author_user_id (author_user_id),
      KEY idx_review_articles_status (status)
    )
  `);
}

function normalizeClaimLinkRows(rows) {
  return asArray(rows).map((row) => {
    const relationship = relationshipFromSupport(row.relationship, row.support_level);
    const rationale = safeText(row.rationale || row.notes, "No rationale provided yet.");
    return {
      id: row.claim_link_id ?? row.link_id,
      claim_link_id: row.claim_link_id ?? row.link_id,
      case_claim_id: row.case_claim_id ?? row.target_claim_id ?? row.task_claim_id,
      case_claim_text: row.case_claim_text || row.content_claim_text || row.target_claim_text || "",
      source_claim_id: row.source_claim_id,
      source_claim_text: row.source_claim_text || "",
      source_content_id: row.source_content_id ?? null,
      source_publisher_id: row.source_publisher_id ?? null,
      source_title: row.source_title || null,
      source_url: row.source_url || null,
      source_publisher: row.source_publisher_name || row.source_publisher || null,
      source_admiralty_code: row.source_admiralty_code || null,
      relationship,
      support_level: row.support_level ?? null,
      confidence: row.confidence ?? null,
      rationale,
      created_by: row.created_by ?? row.user_id ?? null,
      created_at: row.created_at || null,
    };
  });
}

function buildPublisherContext(publishers, publisherRatings, publisherProfiles) {
  const publisher = asArray(publishers)[0] || {};
  const ratings = asArray(publisherRatings);
  const profiles = asArray(publisherProfiles);
  const wikipedia = profiles.find((p) => safeText(p.source).toLowerCase().includes("wikipedia"));
  const mbfc = ratings.find((r) => safeText(r.source).toLowerCase().includes("media bias") || safeText(r.source).toLowerCase().includes("mbfc"));
  const adFontes = ratings.find((r) => safeText(r.source).toLowerCase().includes("ad fontes") || safeText(r.source).toLowerCase().includes("adfontes"));

  return {
    id: publisher.publisher_id || null,
    name: publisher.publisher_name || publisher.name || null,
    wikipedia_summary: wikipedia?.summary || wikipedia?.evidence_quote || wikipedia?.notes || null,
    wikipedia_url: wikipedia?.url || null,
    mbfc_bias: mbfc?.rating_label || mbfc?.rating_type || null,
    mbfc_factual: mbfc?.score != null ? mbfc.score : mbfc?.notes || null,
    mbfc_url: mbfc?.url || null,
    adfontes_bias: adFontes?.rating_label || adFontes?.rating_type || null,
    adfontes_reliability: adFontes?.score != null ? adFontes.score : adFontes?.notes || null,
    adfontes_url: adFontes?.url || null,
    veristrata_score: publisher.aggregate_score ?? publisher.veristrata_score ?? publisher.score ?? null,
  };
}

async function collectSubjectContext(query, contentId, authors, publishers) {
  const authorIds = asArray(authors).map((author) => author.author_id).filter(Boolean);
  const publisherIds = asArray(publishers).map((publisher) => publisher.publisher_id).filter(Boolean);
  const authorPlaceholders = authorIds.map(() => "?").join(",");
  const publisherPlaceholders = publisherIds.map(() => "?").join(",");

  const authorSubjects = authorIds.length
    ? await optionalQuery(query, `
      SELECT
        COALESCE(NULLIF(CONCAT_WS(' / ', NULLIF(c.topic, ''), NULLIF(c.subtopic, '')), ''), 'Uncategorized') AS topic,
        COUNT(DISTINCT c.content_id) AS content_count,
        MAX(c.content_id) AS latest_content_id,
        SUBSTRING_INDEX(
          GROUP_CONCAT(COALESCE(c.content_name, c.url, CONCAT('Content ', c.content_id)) ORDER BY c.content_id DESC SEPARATOR '||'),
          '||',
          1
        ) AS latest_title
      FROM content_authors ca
      JOIN content c ON c.content_id = ca.content_id
      WHERE ca.author_id IN (${authorPlaceholders})
        AND c.content_id <> ?
      GROUP BY COALESCE(NULLIF(CONCAT_WS(' / ', NULLIF(c.topic, ''), NULLIF(c.subtopic, '')), ''), 'Uncategorized')
      ORDER BY content_count DESC, latest_content_id DESC
      LIMIT 8
    `, [...authorIds, contentId])
    : [];

  const publisherSubjects = publisherIds.length
    ? await optionalQuery(query, `
      SELECT
        COALESCE(NULLIF(CONCAT_WS(' / ', NULLIF(c.topic, ''), NULLIF(c.subtopic, '')), ''), 'Uncategorized') AS topic,
        COUNT(DISTINCT c.content_id) AS content_count,
        MAX(c.content_id) AS latest_content_id,
        SUBSTRING_INDEX(
          GROUP_CONCAT(COALESCE(c.content_name, c.url, CONCAT('Content ', c.content_id)) ORDER BY c.content_id DESC SEPARATOR '||'),
          '||',
          1
        ) AS latest_title
      FROM content_publishers cp
      JOIN content c ON c.content_id = cp.content_id
      WHERE cp.publisher_id IN (${publisherPlaceholders})
        AND c.content_id <> ?
      GROUP BY COALESCE(NULLIF(CONCAT_WS(' / ', NULLIF(c.topic, ''), NULLIF(c.subtopic, '')), ''), 'Uncategorized')
      ORDER BY content_count DESC, latest_content_id DESC
      LIMIT 8
    `, [...publisherIds, contentId])
    : [];

  return { authorSubjects, publisherSubjects };
}

function absoluteAssetUrl(publicBaseUrl, relativeUrl) {
  if (!relativeUrl) return null;
  if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
  return `${safeText(publicBaseUrl, "https://truthtrollers.com").replace(/\/$/, "")}${relativeUrl}`;
}

function markdownForAssetModule(module) {
  const asset = module.asset;
  if (!asset?.image_url) return "";
  return [
    `## ${module.title}`,
    "",
    `![${mdEscape(asset.alt || module.title)}](${asset.image_url})`,
    "",
    asset.caption || "",
  ].filter(Boolean).join("\n");
}

function polarPoint(cx, cy, radius, angleDegrees) {
  const angle = (angleDegrees - 180) * Math.PI / 180;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function arcPath(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, endAngle);
  const end = polarPoint(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function verimeterGraphicSvg(module) {
  const score = clamp(numberOrNull(module.data?.score) ?? 0, -1, 1);
  const percent = Math.round(score * 100);
  const normalized = (score + 1) / 2;
  const needle = polarPoint(400, 230, 114, normalized * 180);
  const color = score < -0.35 ? "#f87171" : score > 0.35 ? "#22c55e" : "#fbbf24";
  const pro = module.data?.pro_score !== null && module.data?.pro_score !== undefined
    ? `${Math.round(Number(module.data.pro_score) * 100)}%`
    : "n/a";
  const con = module.data?.con_score !== null && module.data?.con_score !== undefined
    ? `${Math.round(Number(module.data.con_score) * 100)}%`
    : "n/a";
  const body = `
    <path d="${arcPath(400, 230, 150, 0, 60)}" fill="none" stroke="#f87171" stroke-width="24" stroke-linecap="round" opacity="0.78"/>
    <path d="${arcPath(400, 230, 150, 60, 120)}" fill="none" stroke="#fbbf24" stroke-width="24" stroke-linecap="round" opacity="0.78"/>
    <path d="${arcPath(400, 230, 150, 120, 180)}" fill="none" stroke="#22c55e" stroke-width="24" stroke-linecap="round" opacity="0.78"/>
    <path d="${arcPath(400, 230, 150, 0, 180)}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
    <line x1="400" y1="230" x2="${needle.x.toFixed(2)}" y2="${needle.y.toFixed(2)}" stroke="${color}" stroke-width="7" stroke-linecap="round" filter="url(#glow)"/>
    <circle cx="400" cy="230" r="13" fill="${color}" stroke="#e5f5ff" stroke-width="2"/>
    <text x="400" y="178" text-anchor="middle" fill="#f8fafc" font-family="Inter, Arial" font-size="42" font-weight="900">${percent > 0 ? "+" : ""}${percent}%</text>
    <text x="400" y="207" text-anchor="middle" fill="#94a3b8" font-family="Inter, Arial" font-size="14">Verimeter claim-link score</text>
    <text x="250" y="262" text-anchor="middle" fill="#f87171" font-family="Inter, Arial" font-size="13" font-weight="700">REFUTED</text>
    <text x="400" y="288" text-anchor="middle" fill="#fbbf24" font-family="Inter, Arial" font-size="13" font-weight="700">MIXED</text>
    <text x="550" y="262" text-anchor="middle" fill="#22c55e" font-family="Inter, Arial" font-size="13" font-weight="700">SUPPORTED</text>
    <rect x="85" y="316" width="190" height="44" rx="12" fill="#2b1118" stroke="#f87171" stroke-opacity="0.42"/>
    <text x="102" y="344" fill="#fecaca" font-family="Inter, Arial" font-size="13">Con weight: ${svgText(con, 12)}</text>
    <rect x="305" y="316" width="190" height="44" rx="12" fill="#111827" stroke="#38bdf8" stroke-opacity="0.42"/>
    <text x="322" y="344" fill="#e0f2fe" font-family="Inter, Arial" font-size="13">Links: ${svgText(module.data?.link_count ?? "0", 10)}</text>
    <rect x="525" y="316" width="190" height="44" rx="12" fill="#0d261c" stroke="#22c55e" stroke-opacity="0.42"/>
    <text x="542" y="344" fill="#dcfce7" font-family="Inter, Arial" font-size="13">Pro weight: ${svgText(pro, 12)}</text>`;
  return svgShell(800, 390, "Verimeter Graphic", body);
}

function evidenceMapSvg(module) {
  const links = asArray(module.data?.graph_snapshot?.claim_links || module.data?.claim_links).slice(0, 6);
  const rows = links.length ? links.map((link, index) => {
    const y = 86 + index * 74;
    const color = relationshipColor(link.relationship);
    return `
      <rect x="30" y="${y - 24}" width="260" height="48" rx="10" fill="#0b2038" stroke="#38bdf8" stroke-opacity="0.42"/>
      <text x="44" y="${y - 5}" fill="#e5f5ff" font-family="Inter, Arial" font-size="12">${svgText(link.case_claim_text, 42)}</text>
      <line x1="292" y1="${y}" x2="468" y2="${y}" stroke="${color}" stroke-width="3" filter="url(#glow)"/>
      <rect x="324" y="${y - 15}" width="112" height="30" rx="15" fill="${color}" fill-opacity="0.16" stroke="${color}"/>
      <text x="343" y="${y + 5}" fill="${color}" font-family="Inter, Arial" font-size="12" font-weight="700">${svgText(link.relationship || "unclear", 12)}</text>
      <rect x="470" y="${y - 24}" width="300" height="48" rx="10" fill="#0d261c" stroke="#22c55e" stroke-opacity="0.42"/>
      <text x="486" y="${y - 7}" fill="#ecfdf5" font-family="Inter, Arial" font-size="12">${svgText(link.source_publisher || link.source_title || "Source", 40)}</text>
      <text x="486" y="${y + 11}" fill="#94a3b8" font-family="Inter, Arial" font-size="10">${svgText(link.source_claim_text, 46)}</text>`;
  }).join("") : `<text x="30" y="96" fill="#94a3b8" font-family="Inter, Arial" font-size="16">No claim links available for this snapshot.</text>`;
  return svgShell(800, Math.max(190, 110 + links.length * 74), "Evidence Map Image", rows);
}

function knowledgeGraphSvg(module) {
  const content = module.data?.content || {};
  const links = asArray(module.data?.claim_links);
  const sources = module.data?.sources_used ?? new Set(links.map((l) => l.source_url || l.source_title).filter(Boolean)).size;
  const body = `
    <circle cx="400" cy="165" r="58" fill="#082f49" stroke="#38bdf8" stroke-width="2" filter="url(#glow)"/>
    <text x="355" y="158" fill="#e0f2fe" font-family="Inter, Arial" font-size="13" font-weight="700">Reviewed</text>
    <text x="350" y="178" fill="#e0f2fe" font-family="Inter, Arial" font-size="13" font-weight="700">Content</text>
    <rect x="45" y="95" width="220" height="58" rx="12" fill="#291334" stroke="#c084fc" stroke-opacity="0.55"/>
    <text x="62" y="128" fill="#f3e8ff" font-family="Inter, Arial" font-size="13">Publisher: ${svgText(module.data?.publisher, 22)}</text>
    <rect x="45" y="190" width="220" height="58" rx="12" fill="#3a2608" stroke="#fbbf24" stroke-opacity="0.55"/>
    <text x="62" y="223" fill="#fef3c7" font-family="Inter, Arial" font-size="13">Author: ${svgText(module.data?.author, 28)}</text>
    <rect x="535" y="95" width="220" height="58" rx="12" fill="#0b2038" stroke="#38bdf8" stroke-opacity="0.55"/>
    <text x="552" y="128" fill="#e0f2fe" font-family="Inter, Arial" font-size="13">Claims linked: ${links.length}</text>
    <rect x="535" y="190" width="220" height="58" rx="12" fill="#0d261c" stroke="#22c55e" stroke-opacity="0.55"/>
    <text x="552" y="223" fill="#dcfce7" font-family="Inter, Arial" font-size="13">Sources used: ${sources}</text>
    <line x1="265" y1="124" x2="342" y2="154" stroke="#c084fc" stroke-width="2"/>
    <line x1="265" y1="219" x2="342" y2="178" stroke="#fbbf24" stroke-width="2"/>
    <line x1="458" y1="154" x2="535" y2="124" stroke="#38bdf8" stroke-width="2"/>
    <line x1="458" y1="178" x2="535" y2="219" stroke="#22c55e" stroke-width="2"/>
    <text x="40" y="310" fill="#94a3b8" font-family="Inter, Arial" font-size="13">Content: ${svgText(content.content_name || content.title || "Untitled content", 92)}</text>`;
  return svgShell(800, 340, "Knowledge Graph Image", body);
}

function sourceLandscapeSvg(module) {
  const original = module.data?.original_publisher || "Original publisher";
  const links = asArray(module.data?.claim_links);
  const publishers = Array.from(new Set(links.map((l) => l.source_publisher || l.source_title).filter(Boolean))).slice(0, 6);
  const cards = [original, ...publishers].slice(0, 7).map((publisher, index) => {
    const x = 36 + (index % 3) * 250;
    const y = 86 + Math.floor(index / 3) * 82;
    const role = index === 0 ? "Original" : "Linked source";
    return `
      <rect x="${x}" y="${y}" width="220" height="58" rx="12" fill="${index === 0 ? "#291334" : "#0b2038"}" stroke="${index === 0 ? "#c084fc" : "#38bdf8"}" stroke-opacity="0.5"/>
      <text x="${x + 14}" y="${y + 22}" fill="#94a3b8" font-family="Inter, Arial" font-size="11">${role}</text>
      <text x="${x + 14}" y="${y + 43}" fill="#f8fafc" font-family="Inter, Arial" font-size="13" font-weight="700">${svgText(publisher, 27)}</text>`;
  }).join("");
  return svgShell(800, 300, "Source Landscape Graphic", cards || `<text x="30" y="96" fill="#94a3b8" font-family="Inter, Arial" font-size="16">No source landscape data available.</text>`);
}

function claimLinkMiniSvg(module) {
  const links = asArray(module.data?.claim_links).slice(0, 5);
  const rows = links.map((link, index) => {
    const y = 86 + index * 76;
    const color = relationshipColor(link.relationship);
    const support = Math.max(-1, Math.min(1, numberOrNull(link.support_level) ?? 0));
    const needleX = 306 + ((support + 1) / 2) * 188;
    const strength = Number.isFinite(support) ? `${support > 0 ? "+" : ""}${Math.round(support * 100)}%` : "Unrated";
    return `
      <rect x="28" y="${y - 30}" width="744" height="60" rx="14" fill="#06111f" stroke="#38bdf8" stroke-opacity="0.22"/>
      <rect x="44" y="${y - 20}" width="220" height="40" rx="10" fill="#0b2038" stroke="#38bdf8" stroke-opacity="0.42"/>
      <text x="58" y="${y - 2}" fill="#e0f2fe" font-family="Inter, Arial" font-size="11" font-weight="700">CASE</text>
      <text x="58" y="${y + 14}" fill="#e0f2fe" font-family="Inter, Arial" font-size="11">${svgText(link.case_claim_text, 31)}</text>
      <rect x="306" y="${y - 8}" width="188" height="16" rx="8" fill="#111827"/>
      <rect x="306" y="${y - 8}" width="63" height="16" rx="8" fill="#f87171" opacity="0.78"/>
      <rect x="369" y="${y - 8}" width="62" height="16" fill="#fbbf24" opacity="0.78"/>
      <rect x="431" y="${y - 8}" width="63" height="16" rx="8" fill="#22c55e" opacity="0.78"/>
      <line x1="${needleX}" y1="${y - 17}" x2="${needleX}" y2="${y + 17}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
      <text x="400" y="${y - 18}" text-anchor="middle" fill="${color}" font-family="Inter, Arial" font-size="12" font-weight="800">${svgText(link.relationship || "unclear", 14)} ${strength}</text>
      <text x="306" y="${y + 27}" fill="#f87171" font-family="Inter, Arial" font-size="9" font-weight="700">REFUTE</text>
      <text x="383" y="${y + 27}" fill="#fbbf24" font-family="Inter, Arial" font-size="9" font-weight="700">MIXED</text>
      <text x="454" y="${y + 27}" fill="#22c55e" font-family="Inter, Arial" font-size="9" font-weight="700">SUPPORT</text>
      <rect x="536" y="${y - 20}" width="220" height="40" rx="10" fill="#0d261c" stroke="#22c55e" stroke-opacity="0.42"/>
      <text x="550" y="${y - 2}" fill="#dcfce7" font-family="Inter, Arial" font-size="11" font-weight="700">SOURCE</text>
      <text x="550" y="${y + 14}" fill="#dcfce7" font-family="Inter, Arial" font-size="11">${svgText(link.source_claim_text || link.source_publisher || link.source_title || "Source", 31)}</text>`;
  }).join("");
  return svgShell(800, Math.max(210, 124 + links.length * 76), "Claim-Link Mini Graphics", rows || `<text x="30" y="96" fill="#94a3b8" font-family="Inter, Arial" font-size="16">No claim links available.</text>`);
}

function visualAssetForModule(module) {
  const alt = {
    verimeter_graphic: "Verimeter gauge showing the aggregate claim-link score for this review.",
    evidence_map_image: "Evidence map showing claim links for this review.",
    knowledge_graph_image: "Knowledge graph showing content, publisher, claims, and sources for this review.",
    source_landscape_graphic: "Source landscape comparing the original publisher with linked source publishers.",
    claim_link_mini_graphics: "Mini graphics showing case claim to source claim relationships.",
  }[module.id] || module.title;
  const caption = {
    verimeter_graphic: "The Verimeter summarizes the enabled user-created claim links using the same scoring source as the platform.",
    evidence_map_image: "The evidence map shows how source claims support, refute, or qualify the reviewed claims.",
    knowledge_graph_image: "The knowledge graph summarizes how the reviewed content connects to authors, publishers, claims, and sources.",
    source_landscape_graphic: "The source landscape compares the original publisher with the sources used in the review.",
    claim_link_mini_graphics: "Each mini graphic pairs a case claim with its linked source claim and recorded relationship.",
  }[module.id] || module.description || module.title;
  return { kind: "image", image_url: null, public_image_url: null, alt, caption };
}

async function generateVisualAssetForModule(module, articleId, publicBaseUrl) {
  if (module.type !== "visual") return module;
  if (module.asset?.image_url && module.data?.snapshot_source === "workspace_dom_capture") return module;
  if (module.id === "evidence_map_image" || module.id === "knowledge_graph_image") return module;
  const svgById = {
    verimeter_graphic: verimeterGraphicSvg,
    source_landscape_graphic: sourceLandscapeSvg,
    claim_link_mini_graphics: claimLinkMiniSvg,
  };
  const makeSvg = svgById[module.id];
  if (!makeSvg) return module;
  const relativeUrl = await writeSvgAsset(articleId, module.id, makeSvg(module));
  const next = {
    ...module,
    asset: {
      ...visualAssetForModule(module),
      image_url: absoluteAssetUrl(publicBaseUrl, relativeUrl),
      public_image_url: relativeUrl,
    },
  };
  return { ...next, markdown: markdownForAssetModule(next) };
}

async function attachSourceCrestsToClaimModule(module, articleId, publicBaseUrl) {
  if (module.id !== "claim_link_analysis") return module;
  const links = asArray(module.data?.claim_links).map((link) => {
    const { source_crest, ...rest } = link;
    return rest;
  });
  return {
    ...module,
    data: {
      ...module.data,
      claim_links: links,
    },
  };
}

export async function ensureVisualAssetsForModules(modules, articleId, publicBaseUrl) {
  const withVisuals = await Promise.all(asArray(modules).map((module) => generateVisualAssetForModule(module, articleId, publicBaseUrl)));
  return Promise.all(withVisuals.map((module) => attachSourceCrestsToClaimModule(module, articleId, publicBaseUrl)));
}

export async function getReviewClaimLinksData(query, contentId, userId) {
  const [content] = await optionalQuery(query, "SELECT * FROM content WHERE content_id = ?", [contentId]);
  if (!content) {
    const err = new Error("Content not found");
    err.status = 404;
    throw err;
  }

  const [publishers, manualLinks] = await Promise.all([
    optionalQuery(query, `
      SELECT p.*
      FROM content_publishers cp
      JOIN publishers p ON p.publisher_id = cp.publisher_id
      WHERE cp.content_id = ?
    `, [contentId]),
    optionalQuery(query, `
      SELECT
        cl.claim_link_id,
        cl.target_claim_id AS case_claim_id,
        cl.source_claim_id,
        cl.relationship,
        cl.support_level,
        NULL AS confidence,
        cl.notes AS rationale,
        target_claim.claim_text AS case_claim_text,
        source_claim.claim_text AS source_claim_text,
        source_content.content_name AS source_title,
        source_content.content_id AS source_content_id,
        source_content.url AS source_url,
        source_content.media_source AS source_publisher,
        source_p.publisher_id AS source_publisher_id,
        source_p.publisher_name AS source_publisher_name,
        COALESCE(
          (SELECT ae.admiralty_code FROM admiralty_evaluations ae WHERE ae.target_type = 'content' AND ae.target_id = source_content.content_id AND ae.publisher_id = source_p.publisher_id AND ae.evaluation_status NOT IN ('insufficient_data') ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested') LIMIT 1),
          (SELECT ae.admiralty_code FROM admiralty_evaluations ae WHERE ae.target_type = 'publisher' AND ae.target_id = source_p.publisher_id AND ae.evaluation_status NOT IN ('insufficient_data') ORDER BY FIELD(ae.evaluation_status,'human_confirmed','community_reviewed','machine_suggested') LIMIT 1)
        ) AS source_admiralty_code,
        cl.user_id AS created_by,
        cl.created_at
      FROM claim_links cl
      JOIN claims target_claim ON target_claim.claim_id = cl.target_claim_id
      JOIN claims source_claim ON source_claim.claim_id = cl.source_claim_id
      JOIN content_claims target_cc ON target_cc.claim_id = cl.target_claim_id AND target_cc.content_id = ?
      LEFT JOIN content_claims source_cc ON source_cc.claim_id = cl.source_claim_id
      LEFT JOIN content source_content ON source_content.content_id = source_cc.content_id
      LEFT JOIN content_publishers source_cp ON source_cp.content_id = source_content.content_id
      LEFT JOIN publishers source_p ON source_p.publisher_id = source_cp.publisher_id
      WHERE COALESCE(cl.disabled, 0) = 0
        AND COALESCE(cl.created_by_ai, 0) = 0
        AND cl.user_id = ?
      ORDER BY ABS(COALESCE(cl.support_level, 0)) DESC, cl.claim_link_id DESC
      LIMIT 100
    `, [contentId, userId]),
  ]);

  const publisherId = publishers?.[0]?.publisher_id;
  const [publisherRatings, publisherProfiles] = await Promise.all([
    publisherId
      ? optionalQuery(query, "SELECT * FROM publisher_ratings WHERE publisher_id = ? ORDER BY last_checked DESC, publisher_rating_id DESC LIMIT 20", [publisherId])
      : [],
    publisherId
      ? optionalQuery(query, "SELECT * FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 10", [publisherId])
      : [],
  ]);

  return {
    content_id: content.content_id,
    content_title: content.content_name || content.title || null,
    content_url: content.url || null,
    publisher: buildPublisherContext(publishers, publisherRatings, publisherProfiles),
    claim_links: normalizeClaimLinkRows(manualLinks),
  };
}

export async function getLatestReviewArticleForContent(query, contentId, userId) {
  await ensureReviewArticlesTable(query);
  const rows = await query(
    `SELECT *
       FROM review_articles
      WHERE content_id = ?
        AND author_user_id = ?
        AND status = 'draft'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [contentId, userId],
  );
  return normalizeArticleRow(rows[0]);
}

export async function collectReviewData(query, contentId, userId, options = {}) {
  const publicBaseUrl = options.publicBaseUrl || process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "https://truthtrollers.com";
  const canonicalReviewUrl = `${publicBaseUrl.replace(/\/$/, "")}/evidence-map/${contentId}`;

  const [content] = await optionalQuery(query, "SELECT * FROM content WHERE content_id = ?", [contentId]);
  if (!content) {
    const err = new Error("Content not found");
    err.status = 404;
    throw err;
  }

  const [claims, manualLinksData, authors, publishers, reviewerRows, reviewerRoles, reputationRows, contentRatings] = await Promise.all([
    optionalQuery(query, `
      SELECT c.*, cc.relationship_type, cc.claim_role, cc.claim_depth, cc.claim_order
      FROM content_claims cc
      JOIN claims c ON c.claim_id = cc.claim_id
      WHERE cc.content_id = ?
      ORDER BY COALESCE(cc.claim_order, 999999), c.claim_id
    `, [contentId]),
    getReviewClaimLinksData(query, contentId, userId).then((data) => data.claim_links),
    optionalQuery(query, `
      SELECT a.*, TRIM(CONCAT(IFNULL(a.author_first_name, ''), ' ', IFNULL(a.author_last_name, ''))) AS author_name
      FROM content_authors ca
      JOIN authors a ON a.author_id = ca.author_id
      WHERE ca.content_id = ?
    `, [contentId]),
    optionalQuery(query, `
      SELECT p.*
      FROM content_publishers cp
      JOIN publishers p ON p.publisher_id = cp.publisher_id
      WHERE cp.content_id = ?
    `, [contentId]),
    optionalQuery(query, "SELECT user_id, username, email FROM users WHERE user_id = ?", [userId]),
    optionalQuery(query, `
      SELECT r.name
      FROM user_roles ur
      JOIN roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = ?
    `, [userId]),
    optionalQuery(query, "SELECT * FROM user_reputation WHERE user_id = ?", [userId]),
    optionalQuery(query, `
      SELECT * FROM content_ratings
      WHERE content_id = ? AND user_id = ?
      ORDER BY completed DESC, submitted_at DESC, created_at DESC
      LIMIT 1
    `, [contentId, userId]),
  ]);

  const publisherId = publishers?.[0]?.publisher_id;
  const [publisherRatings, publisherProfiles, relatedReviews, reviewerCountRows, verimeterScore, subjectContext] = await Promise.all([
    publisherId
      ? optionalQuery(query, "SELECT * FROM publisher_ratings WHERE publisher_id = ? ORDER BY last_checked DESC, publisher_rating_id DESC LIMIT 20", [publisherId])
      : [],
    publisherId
      ? optionalQuery(query, "SELECT * FROM publisher_profiles WHERE publisher_id = ? ORDER BY last_checked DESC LIMIT 10", [publisherId])
      : [],
    publisherId
      ? optionalQuery(query, `
        SELECT ra.id, ra.title, ra.slug, ra.status, ra.published_at
        FROM review_articles ra
        JOIN content_publishers cp ON cp.content_id = ra.content_id
        WHERE cp.publisher_id = ? AND ra.status = 'published' AND ra.content_id <> ?
        ORDER BY ra.published_at DESC
        LIMIT 5
      `, [publisherId, contentId])
      : [],
    optionalQuery(query, "SELECT COUNT(*) AS count FROM content_ratings WHERE user_id = ? AND completed = TRUE", [userId]),
    calculateUserContentScore(query, contentId, userId)
      .then((score) => ({ ...score, source: "verimeterScoringService" }))
      .catch((err) => {
        console.warn("[review-articles] Verimeter score unavailable:", err.message);
        return null;
      }),
    collectSubjectContext(query, contentId, authors, publishers),
  ]);

  const claimLinks = asArray(manualLinksData);
  const ratingScore = computeRatingScore(claimLinks);
  const verdict = verdictFromScore(ratingScore);
  const confidence = confidenceFromLinks(claimLinks);
  const contentTitle = content.content_name || content.title || content.url || `Content ${contentId}`;
  const summary = claimLinks.length
    ? `This VeriStrata public review draft is built from ${claimLinks.length} user-created claim link${claimLinks.length === 1 ? "" : "s"} in the active workspace. It preserves each case claim, linked source claim, relationship rating, rationale, and source context for human editing before publication.`
    : `VeriStrata assembled a public review draft for ${contentTitle}. No user-created claim links were available yet, so the article should be completed before publication.`;

  return {
    content,
    claims,
    claimLinks,
    authors,
    publishers,
    publisherRatings,
    publisherProfiles,
    reviewer: reviewerRows?.[0] || { user_id: userId },
    reviewerRoles,
    reputation: reputationRows?.[0] || null,
    reviewerReviewCount: reviewerCountRows?.[0]?.count ?? null,
    contentRating: contentRatings?.[0] || null,
    relatedReviews,
    backgroundSignals: [],
    verimeterScore,
    authorSubjectContext: subjectContext.authorSubjects,
    publisherSubjectContext: subjectContext.publisherSubjects,
    verdict,
    confidence,
    ratingScore,
    summary,
    canonicalReviewUrl,
    reviewId: options.reviewId || contentRatings?.[0]?.content_rating_id || null,
  };
}

export async function generateReviewArticleDraft(query, contentId, userId, options = {}) {
  await ensureReviewArticlesTable(query);
  const reviewData = await collectReviewData(query, contentId, userId, options);
  const modules = buildArticleModules(reviewData);
  const title = `VeriStrata Review: ${reviewData.content.content_name || reviewData.content.url || `Content ${contentId}`}`;
  const existingRows = await query(
    `
      SELECT *
      FROM review_articles
      WHERE content_id = ?
        AND author_user_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `,
    [contentId, userId],
  );
  const existingArticle = normalizeArticleRow(existingRows?.[0]);

  if (existingArticle) {
    const existingById = new Map(asArray(existingArticle.modules_json).map((module) => [module.id, module]));
    const mergedModules = modules.map((module) => {
      const existing = existingById.get(module.id);
      if (!existing) return module;
      const isCapturedSnapshot =
        existing.asset?.image_url &&
        existing.data?.snapshot_source === "workspace_dom_capture";
      return {
        ...module,
        enabled: existing.enabled,
        order: existing.order ?? module.order,
        ...(isCapturedSnapshot
          ? {
              data: { ...module.data, ...existing.data },
              asset: existing.asset,
              markdown: markdownForAssetModule(existing),
            }
          : {}),
      };
    });
    const modulesWithAssets = await ensureVisualAssetsForModules(mergedModules, existingArticle.id, options.publicBaseUrl);
    const oldAssembled = assembleMarkdownFromModules(existingArticle.modules_json);
    const shouldRefreshBody =
      !safeText(existingArticle.body_markdown) ||
      safeText(existingArticle.body_markdown) === safeText(oldAssembled);
    const bodyMarkdown = shouldRefreshBody
      ? assembleMarkdownFromModules(modulesWithAssets)
      : existingArticle.body_markdown;

    await query(
      `
        UPDATE review_articles
        SET title = ?,
            verdict = ?,
            confidence = ?,
            summary = ?,
            body_markdown = ?,
            modules_json = ?,
            canonical_review_url = ?
        WHERE id = ?
      `,
      [
        title,
        reviewData.verdict,
        reviewData.confidence,
        reviewData.summary,
        bodyMarkdown,
        JSON.stringify(modulesWithAssets),
        reviewData.canonicalReviewUrl,
        existingArticle.id,
      ],
    );

    return getReviewArticleById(query, existingArticle.id);
  }

  const result = await query(
    `
      INSERT INTO review_articles (
        content_id,
        author_user_id,
        title,
        status,
        verdict,
        confidence,
        summary,
        body_markdown,
        modules_json,
        canonical_review_url
      )
      VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)
    `,
    [
      contentId,
      userId,
      title,
      reviewData.verdict,
      reviewData.confidence,
      reviewData.summary,
      assembleMarkdownFromModules(modules),
      JSON.stringify(modules),
      reviewData.canonicalReviewUrl,
    ],
  );

  const modulesWithAssets = await ensureVisualAssetsForModules(modules, result.insertId, options.publicBaseUrl);
  await query(
    "UPDATE review_articles SET modules_json = ?, body_markdown = ? WHERE id = ?",
    [JSON.stringify(modulesWithAssets), assembleMarkdownFromModules(modulesWithAssets), result.insertId],
  );

  return getReviewArticleById(query, result.insertId);
}

export async function attachWorkspaceSnapshotToReviewArticle(query, {
  contentId,
  userId,
  dataUrl,
  articleId = null,
  moduleId = "evidence_map_image",
  publicBaseUrl,
}) {
  await ensureReviewArticlesTable(query);
  const match = safeText(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    const err = new Error("snapshot data_url must be a PNG, JPEG, or WebP data URL");
    err.status = 400;
    throw err;
  }

  let article = articleId ? await getReviewArticleById(query, articleId) : null;
  if (!article) {
    article = await getLatestReviewArticleForContent(query, contentId, userId);
  }
  if (!article) {
    article = await generateReviewArticleDraft(query, contentId, userId, { publicBaseUrl });
  }
  if (article.author_user_id !== userId) {
    const err = new Error("Not authorized to update this review article");
    err.status = 403;
    throw err;
  }

  const allowedSnapshotModules = new Set(["evidence_map_image", "knowledge_graph_image"]);
  const targetModuleId = allowedSnapshotModules.has(safeText(moduleId)) ? safeText(moduleId) : "evidence_map_image";
  const isKnowledgeGraph = targetModuleId === "knowledge_graph_image";
  const targetTitle = isKnowledgeGraph ? "Knowledge Graph Image" : "Evidence Map Image";
  const targetDescription = isKnowledgeGraph
    ? "Snapshot of the review knowledge graph."
    : "Snapshot of the claim/source evidence map.";
  const targetOrder = isKnowledgeGraph ? 30 : 20;
  const snapshotPrefix = isKnowledgeGraph ? "knowgraph" : "evidencemap";
  const alt = isKnowledgeGraph
    ? "Knowledge graph snapshot captured from the live VeriStrata graph page."
    : "Evidence map snapshot captured from the live VeriStrata evidence map.";
  const caption = isKnowledgeGraph
    ? "Snapshot captured from the live VeriStrata knowledge graph for this review."
    : "Snapshot captured from the live VeriStrata evidence map for this review.";

  const extension = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  const [ratingRows] = await Promise.all([
    optionalQuery(
      query,
      `
        SELECT content_rating_id
        FROM content_ratings
        WHERE content_id = ? AND user_id = ?
        ORDER BY submitted_at DESC, content_rating_id DESC
        LIMIT 1
      `,
      [contentId, userId],
    ),
  ]);
  const evidenceChainId = ratingRows?.[0]?.content_rating_id || article.review_id || article.id;
  const filename = `${snapshotPrefix}_${contentId}_${padAssetId(userId)}_${padAssetId(evidenceChainId)}`;
  const relativeUrl = await writeBinaryAsset(
    article.id,
    filename,
    buffer,
    extension === "jpeg" ? "jpg" : extension,
    { prefixArticle: false },
  );
  const imageUrl = absoluteAssetUrl(publicBaseUrl, relativeUrl);
  const baseModules = asArray(article.modules_json);
  const modulesToUpdate = baseModules.some((module) => module?.id === targetModuleId)
    ? baseModules
    : [
        ...baseModules,
        visualModuleObject(targetModuleId, targetOrder, targetTitle, true, targetDescription),
      ];
  const modules = modulesToUpdate.map((module) => {
    if (module.id !== targetModuleId) return module;
    const next = {
      ...module,
      enabled: true,
      data: {
        ...module.data,
        snapshot_source: "workspace_dom_capture",
        captured_at: new Date().toISOString(),
      },
      asset: {
        kind: "image",
        image_url: imageUrl,
        public_image_url: relativeUrl,
        alt,
        caption,
      },
    };
    return { ...next, markdown: markdownForAssetModule(next) };
  });

  const oldAssembled = assembleMarkdownFromModules(article.modules_json);
  const shouldRefreshBody = !safeText(article.body_markdown) || safeText(article.body_markdown) === safeText(oldAssembled);
  const nextBody = shouldRefreshBody ? assembleMarkdownFromModules(modules) : article.body_markdown;

  await query(
    "UPDATE review_articles SET modules_json = ?, body_markdown = ? WHERE id = ?",
    [JSON.stringify(modules), nextBody, article.id],
  );

  return {
    article: await getReviewArticleById(query, article.id),
    asset: { image_url: imageUrl, public_image_url: relativeUrl },
    body_updated: shouldRefreshBody,
  };
}

export async function rebuildReviewArticleModules(query, article, publicBaseUrl) {
  const freshData = await collectReviewData(query, article.content_id, article.author_user_id, { publicBaseUrl });
  const existingById = new Map(asArray(article.modules_json).map((module) => [module.id, module]));
  const rebuilt = buildArticleModules(freshData).map((module) => {
    const existing = existingById.get(module.id);
    if (!existing) return module;
    const isCapturedSnapshot =
      existing.asset?.image_url &&
      existing.data?.snapshot_source === "workspace_dom_capture";
    return {
      ...module,
      enabled: existing.enabled,
      order: existing.order ?? module.order,
      ...(isCapturedSnapshot
        ? {
            data: { ...module.data, ...existing.data },
            asset: existing.asset,
            markdown: markdownForAssetModule(existing),
          }
        : {}),
    };
  });
  return ensureVisualAssetsForModules(rebuilt, article.id, publicBaseUrl);
}

function buildLLMArticlePacket(article, modules) {
  const enabled = asArray(modules)
    .filter((module) => module && module.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const claimModule = enabled.find((module) => module.type === "claim_link_analysis");
  const canonicalModule = enabled.find((module) => module.type === "canonical_link");
  const visualModules = enabled.filter((module) => module.type === "visual" && module.asset?.image_url);
  const visualById = Object.fromEntries(visualModules.map((module) => [
    module.id,
    {
      enabled: true,
      image_url: module.asset.image_url,
      alt: module.asset.alt,
      caption: module.asset.caption,
    },
  ]));

  return {
    title: article.title,
    verdict: article.verdict,
    confidence: article.confidence,
    summary: article.summary,
    canonical_review_url: article.canonical_review_url || canonicalModule?.data?.canonical_review_url || null,
    visual_assets: {
      verimeter_graphic: visualById.verimeter_graphic || null,
      evidence_map: visualById.evidence_map_image || null,
      knowledge_graph: visualById.knowledge_graph_image || null,
      source_landscape_graphic: visualById.source_landscape_graphic || null,
      claim_link_mini_graphics: visualById.claim_link_mini_graphics ? [visualById.claim_link_mini_graphics] : [],
    },
    claim_links: asArray(claimModule?.data?.claim_links).map((link, index) => ({
      index: index + 1,
      case_claim_text: link.case_claim_text || null,
      source_claim_text: link.source_claim_text || null,
      relationship: relationshipFromSupport(link.relationship, link.support_level),
      support_level: link.support_level ?? null,
      rationale: safeText(link.rationale, "No rationale provided yet."),
      source_title: link.source_title || null,
      source_url: link.source_url || null,
      source_publisher: link.source_publisher || null,
    })),
    subject_context: enabled.find((module) => module.id === "subject_context")?.data || null,
  };
}

export async function generateReviewArticleEssay(query, articleId, userId, payload = {}) {
  const article = await getReviewArticleById(query, articleId);
  if (!article) {
    const err = new Error("Review article not found");
    err.status = 404;
    throw err;
  }
  if (article.author_user_id !== userId) {
    const err = new Error("Not authorized to draft this article");
    err.status = 403;
    throw err;
  }

  const publicBaseUrl = payload.publicBaseUrl || payload.public_base_url || "https://truthtrollers.com";
  const freshModules = await rebuildReviewArticleModules(query, article, publicBaseUrl);
  const requestedById = new Map(asArray(payload.modules_json).map((module) => [module.id, module]));
  const modules = freshModules.map((module) => {
    const requested = requestedById.get(module.id);
    return requested ? { ...module, enabled: requested.enabled, order: requested.order ?? module.order } : module;
  });
  await query(
    "UPDATE review_articles SET modules_json = ?, body_markdown = ? WHERE id = ?",
    [JSON.stringify(modules), assembleMarkdownFromModules(modules), articleId],
  );
  const packet = buildLLMArticlePacket(
    {
      ...article,
      title: payload.title || article.title,
      verdict: payload.verdict || article.verdict,
      confidence: payload.confidence || article.confidence,
      summary: payload.summary || article.summary,
      canonical_review_url: payload.canonical_review_url || article.canonical_review_url,
    },
    modules,
  );

  const { openAiLLM } = await import("../core/openAiLLM.js");
  const response = await openAiLLM.generate({
    temperature: 0.35,
    timeout: 45000,
    maxRetries: 1,
    system: [
      "You are writing a polished public VeriStrata review essay for a Substack-style audience.",
      "This must be a real human-readable essay with an introduction, body, and conclusion, not a module list, not release notes, and not a data dump.",
      "Use section headings sparingly and write connected paragraphs with narrative flow.",
      "The essay arc must: set up the reviewed claim; explain why it sounds plausible; explain how the evidence map changes the picture; discuss the strongest refuting evidence; discuss any weaker, supporting, or qualified evidence; identify rhetorical moves or logical fallacies when they are grounded in the packet; discuss source context only when grounded in the packet; conclude with a careful verdict; and link back to the inspectable VeriStrata map.",
      "Do not mention Admiralty codes or SourceCrest badges.",
      "Do not invent sources, claims, rationales, ratings, author history, publisher ratings, or claim relationships.",
      "Do not invent image URLs.",
      "When enabled visual_assets contain image_url values, place those images naturally in the Markdown using standard image syntax and the provided alt/caption.",
      "If visual_assets.knowledge_graph is present, place it immediately after the introduction or opening context section.",
      "If visual_assets.evidence_map is present, place it under the section that discusses the evidence map, not at the end.",
      "If visual_assets.verimeter_graphic is present, place it near the opening verdict or immediately after the introduction.",
      "If subject_context is present, use it only as cautious background about prior VeriStrata records for the author or publisher; do not present it as proof.",
      "Do not include disabled or null visual assets.",
      "If a rationale is missing, write exactly: No rationale provided yet.",
      "Use cautious language. Do not accuse a source or author of bad faith unless the packet explicitly supports that.",
      "Keep the article clear, skeptical, transparent, readable, and suitable for publication.",
      "Return Markdown only in the markdown field.",
    ].join(" "),
    user: JSON.stringify(packet, null, 2),
    schemaHint: JSON.stringify({
      markdown: "A long-form Markdown essay with title omitted. It should have an introduction, knowledge-graph image immediately after the introduction when provided, opening Verimeter graphic when provided, evidence-map discussion with the evidence-map image under that section when provided, refuting evidence discussion, qualified/supporting evidence discussion when present, rhetorical/source-context discussion, cautious author/publisher subject context when enabled, careful conclusion, enabled image markdown only for provided image_url values, and a final live VeriStrata review link.",
    }),
  });

  const markdown = safeText(response?.markdown);
  if (!markdown) {
    const err = new Error("LLM did not return article markdown");
    err.status = 502;
    throw err;
  }

  await query(
    "UPDATE review_articles SET modules_json = ?, body_markdown = ? WHERE id = ?",
    [JSON.stringify(modules), markdown, articleId],
  );

  return {
    markdown,
    modules_json: modules,
    source: "llm",
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function makeZip(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    fileParts.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + data.length;
  });

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...fileParts, centralDir, end]);
}

function paragraphXml(text, style = null) {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r></w:p>`;
}

function imageBlockXml(image, rId) {
  return [
    imageParagraphXml(rId, image.width, image.height, image.alt),
    image.caption ? paragraphXml(image.caption) : "",
  ].filter(Boolean);
}

function markdownToDocxParagraphs(markdown, imageByUrl = new Map(), imageById = new Map(), usedImageIds = new Set()) {
  const out = [];
  for (const line of safeText(markdown).split(/\r?\n/)) {
    const clean = line.trim();
    const imageMatch = clean.match(/^!\[[^\]]*]\(([^)]+)\)/);
    if (imageMatch) {
      const image = imageByUrl.get(imageMatch[1]);
      if (image && !usedImageIds.has(image.id)) {
        out.push(...imageBlockXml(image, image.rId));
        usedImageIds.add(image.id);
      }
      continue;
    }
    if (!clean) {
      out.push("<w:p/>");
      continue;
    }
    const lower = clean.toLowerCase();
    if (clean.startsWith("### ")) {
      out.push(paragraphXml(clean.replace(/^###\s+/, ""), "Heading3"));
    } else if (clean.startsWith("## ")) {
      out.push(paragraphXml(clean.replace(/^##\s+/, ""), "Heading2"));
      if (lower.includes("evidence map")) {
        const image = imageById.get("evidence_map_image");
        if (image && !usedImageIds.has(image.id)) {
          out.push(...imageBlockXml(image, image.rId));
          usedImageIds.add(image.id);
        }
      }
    } else if (clean.startsWith("# ")) {
      out.push(paragraphXml(clean.replace(/^#\s+/, ""), "Heading1"));
    } else if (clean.startsWith("* ") || clean.startsWith("- ")) {
      out.push(paragraphXml(`• ${clean.replace(/^[-*]\s+/, "")}`));
    } else {
      out.push(paragraphXml(clean.replace(/\*\*/g, "")));
    }
  }
  return out;
}

function imageParagraphXml(rId, widthPx, heightPx, altText) {
  const pxToEmu = 9525;
  let cx = Math.max(1, Math.round((widthPx || 900) * pxToEmu));
  let cy = Math.max(1, Math.round((heightPx || 500) * pxToEmu));
  const scale = Math.min(1, 5_900_000 / cx, 4_600_000 / cy);
  cx = Math.round(cx * scale);
  cy = Math.round(cy * scale);
  const descr = xmlEscape(altText || "Review image");
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${rId.replace(/\D/g, "") || "1"}" name="${descr}" descr="${descr}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${descr}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function localAssetPathFromUrl(imageUrl) {
  const raw = safeText(imageUrl);
  if (!raw) return null;
  let pathname = raw;
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }
  if (!pathname.startsWith(REVIEW_ARTICLE_ASSET_URL_BASE)) return null;
  const relative = pathname.slice(REVIEW_ARTICLE_ASSET_URL_BASE.length).replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return null;
  return path.join(REVIEW_ARTICLE_ASSET_DIR, relative);
}

async function collectDocxImages(modules) {
  const images = [];
  for (const module of asArray(modules).filter((item) =>
    item?.enabled !== false &&
    !item?.hidden &&
    item?.id !== "publisher_admiralty_crests" &&
    item?.data?.snapshot_source === "workspace_dom_capture"
  )) {
    const localPath = localAssetPathFromUrl(module.asset?.public_image_url || module.asset?.image_url);
    if (!localPath) continue;
    try {
      const input = await fs.readFile(localPath);
      const data = await sharp(input).png().toBuffer();
      const metadata = await sharp(data).metadata();
      images.push({
        id: module.id || `image_${images.length + 1}`,
        module,
        data,
        width: metadata.width || 900,
        height: metadata.height || 500,
        filename: `${module.id || `image_${images.length + 1}`}.png`.replace(/[^a-z0-9_.-]/gi, "_"),
        alt: module.asset?.alt || module.title || "Review image",
        caption: module.asset?.caption || "",
      });
    } catch (error) {
      console.warn("[review-articles] Skipping DOCX image asset:", localPath, error.message);
    }
  }
  return images;
}

export async function buildReviewArticleDocx(article) {
  const modules = asArray(article.modules_json);
  const images = await collectDocxImages(modules);
  const rels = [];
  const mediaEntries = [];
  const imageById = new Map();
  const imageByUrl = new Map();
  const usedImageIds = new Set();
  images.forEach((image, index) => {
    image.rId = `rId${index + 1}`;
    imageById.set(image.id, image);
    for (const url of [image.module.asset?.image_url, image.module.asset?.public_image_url].filter(Boolean)) {
      imageByUrl.set(url, image);
    }
  });
  const body = [
    paragraphXml(article.title || "VeriStrata Review", "Title"),
    article.verdict ? paragraphXml(`Verdict: ${article.verdict}`) : "",
    article.confidence ? paragraphXml(`Confidence: ${article.confidence}`) : "",
    article.summary ? paragraphXml(article.summary) : "",
  ].filter(Boolean);

  const knowledgeImage = imageById.get("knowledge_graph_image");
  if (knowledgeImage) {
    body.push(...imageBlockXml(knowledgeImage, knowledgeImage.rId));
    usedImageIds.add(knowledgeImage.id);
  }

  body.push(...markdownToDocxParagraphs(
    article.body_markdown || assembleMarkdownFromModules(modules),
    imageByUrl,
    imageById,
    usedImageIds,
  ));

  images.forEach((image) => {
    rels.push(`<Relationship Id="${image.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.filename}"/>`);
    mediaEntries.push({ name: `word/media/${image.filename}`, data: image.data });
  });

  for (const image of images) {
    if (usedImageIds.has(image.id)) continue;
    body.push(paragraphXml(image.module.title || "Review Image", "Heading2"));
    body.push(...imageBlockXml(image, image.rId));
    usedImageIds.add(image.id);
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" mc:Ignorable=""><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="44"/></w:rPr><w:pPr><w:spacing w:after="240"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="0F4C81"/></w:rPr><w:pPr><w:spacing w:before="260" w:after="120"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="0F4C81"/></w:rPr><w:pPr><w:spacing w:before="220" w:after="100"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="23"/></w:rPr><w:pPr><w:spacing w:before="180" w:after="80"/></w:pPr></w:style></w:styles>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  return makeZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/styles.xml", data: stylesXml },
    { name: "word/_rels/document.xml.rels", data: documentRels },
    ...mediaEntries,
  ]);
}

export async function getReviewArticleById(query, id) {
  await ensureReviewArticlesTable(query);
  const rows = await query("SELECT * FROM review_articles WHERE id = ?", [id]);
  return normalizeArticleRow(rows[0]);
}

export async function getReviewArticleBySlug(query, slug) {
  await ensureReviewArticlesTable(query);
  const rows = await query("SELECT * FROM review_articles WHERE slug = ? AND status = 'published'", [slug]);
  return normalizeArticleRow(rows[0]);
}

export function makeSlug(title, id) {
  const base = safeText(title, "veristrata-review")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "veristrata-review";
  return `${base}-${id}`;
}

export function normalizeArticlePayload(payload = {}) {
  const modules = Array.isArray(payload.modules_json) ? payload.modules_json : null;
  return {
    title: payload.title,
    summary: payload.summary,
    verdict: payload.verdict,
    confidence: payload.confidence,
    body_markdown: payload.body_markdown,
    modules_json: modules,
    status: payload.status,
  };
}

export { normalizeArticleRow };
