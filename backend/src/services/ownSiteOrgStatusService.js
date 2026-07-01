import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 8000;
const MAX_DISCOVERY_PAGES = 2;
const MAX_STATUS_PAGES = 4;
const MAX_TEXT_CHARS = 18000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/;
const STATUS_LINK_RE = /\b(about|mission|who-we-are|who we are|membership|members|board|board-of-governors|leadership|governance|coalition|partners|sponsors|funding|supporters|advisory|policy|advocacy|contact|impressum|imprint|legal notice)\b/i;
const TRADE_RE = /\b(trade association|industry association|industry trade organization|industry trade association|consortium|coalition|alliance|membership organization|member companies|board of governors|board members|wireless carriers|telecommunications service providers|manufacturers|device manufacturers|network equipment providers|ecosystem companies|stakeholder mix)\b/i;
const MEMBER_RE = /\b(member companies|members|membership|member organizations|stakeholder mix|providers|carriers|manufacturers)\b/i;
const BOARD_RE = /\b(board of governors|board members|board of directors|leadership|governance)\b/i;
const ADVOCACY_RE = /\b(advocacy|advocate|policy recommendations|regulatory policy|government affairs|public policy|policymakers|regulators|advance the industry|promote adoption|shape policy)\b/i;
const TELECOM_RE = /\b(5g|6g|wireless|mobile broadband|telecommunications|telecom|network equipment|device manufacturers|wireless carriers|spectrum|cellular)\b/i;
const HEALTH_TOPIC_RE = /\b(health|safety|radiation|rf|radiofrequency|electromagnetic|emf|exposure|cancer|public health)\b/i;
const PROVENANCE_RE = /\b(published by|owned by|operated by|a project of|a program of|sponsored by|funded by|reprinted from|originally published by|republished from|source:|via:|from:)\b/i;
// Require explicit public-authority language. Generic mentions of "government"
// (for example, an advocacy group's government-affairs page) are not enough.
const GOVERNMENT_RE = /\b(federal office|federal department|ministry of|government ministry|government department|government agency|national public health (?:office|agency)|public authority|statutory public body)\b/i;

const ALIGNMENT_MARKERS = {
  industry_trade_association: { marker: "IND", label: "Industry aligned" },
  advocacy_organization: { marker: "ADV", label: "Advocacy aligned" },
  government_organization: { marker: "GOV", label: "Government source" },
  corporate_publisher: { marker: "CORP", label: "Corporate source" },
  partisan_organization: { marker: "PART", label: "Partisan aligned" },
  state_controlled_media: { marker: "STATE", label: "State controlled" },
  sponsored_content: { marker: "SPON", label: "Sponsored content" },
};

function normalizeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (u.hostname === "localhost" || PRIVATE_IP_RE.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function sameRootDomain(url, rootDomain) {
  const host = normalizeDomain(url);
  return host === rootDomain || host?.endsWith(`.${rootDomain}`);
}

function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  if (!isSafeUrl(url)) throw new Error(`Unsafe URL: ${url}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    if (contentType && !/html|text/i.test(contentType)) return "";
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function pageTypeFor(url, label = "") {
  const haystack = `${url} ${label}`.toLowerCase();
  if (/membership|members|member-companies/.test(haystack)) return "own_site_membership_page";
  if (/board|governance|leadership|governors/.test(haystack)) return "own_site_board_page";
  if (/about|mission|who-we-are|who we are/.test(haystack)) return "own_site_about_page";
  if (/contact|impressum|imprint|legal-notice|legal notice/.test(haystack)) return "own_site_imprint_page";
  if (/policy|advocacy|government-affairs/.test(haystack)) return "own_site_policy_page";
  if (/sponsor|funding|supporter|partner/.test(haystack)) return "own_site_funding_page";
  return "own_site_status_page";
}

function textFromHtml(html) {
  const $ = cheerio.load(html || "");
  $("script, style, noscript, svg").remove();
  const navText = $("header, nav, footer").text();
  const headingText = $("h1,h2,h3,h4").text();
  const bodyText = $("body").text();
  return [navText, headingText, bodyText]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function sentenceFor(text, pattern) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  const sentences = normalized.match(/[^.!?]{0,260}[.!?]/g) || [normalized.slice(0, 320)];
  return sentences.find((s) => pattern.test(s))?.trim().slice(0, 500) || null;
}

export function discoverOrgStatusLinksFromHtml(html, baseUrl, rootDomain = normalizeDomain(baseUrl)) {
  const $ = cheerio.load(html || "");
  const links = [];
  $("header a, nav a, footer a, a").each((_, el) => {
    const href = $(el).attr("href");
    const label = $(el).text().replace(/\s+/g, " ").trim();
    if (!href) return;
    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!sameRootDomain(url, rootDomain)) return;
    if (!STATUS_LINK_RE.test(`${label} ${url}`)) return;
    const clean = canonicalUrl(url);
    if (!clean) return;
    links.push({ url: clean, label, pageType: pageTypeFor(clean, label) });
  });

  const seen = new Set();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function scoreLink(link) {
  const text = `${link.label} ${link.url}`.toLowerCase();
  if (/membership|members|board|governance|leadership|governors/.test(text)) return 0;
  if (/about|mission|who/.test(text)) return 1;
  if (/policy|advocacy/.test(text)) return 2;
  return 3;
}

function addEvidence(evidence, field, value, page, pattern, confidence = 0.75) {
  const snippet = sentenceFor(page.text, pattern);
  if (!snippet) return;
  evidence.push({
    field,
    value,
    source_url: page.url,
    source_page_type: page.pageType,
    snippet,
    confidence,
  });
}

export function classifyOrganizationStatusFromPages({
  publisherName,
  sourceUrl,
  pages = [],
} = {}) {
  const allText = pages.map((p) => p.text || "").join(" ");
  const evidence = [];

  const tradeSignal = TRADE_RE.test(allText);
  const memberSignal = MEMBER_RE.test(allText);
  const boardSignal = BOARD_RE.test(allText);
  const advocacySignal = ADVOCACY_RE.test(allText);
  const governmentSignal = GOVERNMENT_RE.test(allText);
  const governmentOperator = /\bFederal Office of Public Health(?:\s*\(FOPH\)|\s+FOPH)?\b/i.test(allText)
    ? "Federal Office of Public Health (FOPH)"
    : null;
  const telecomSignal = TELECOM_RE.test(`${publisherName || ""} ${sourceUrl || ""} ${allText}`);
  const healthTopic = HEALTH_TOPIC_RE.test(String(sourceUrl || "")) || HEALTH_TOPIC_RE.test(allText.slice(0, 3000));

  for (const page of pages) {
    addEvidence(evidence, "publisher_type", "industry_trade_association", page, TRADE_RE, 0.84);
    addEvidence(evidence, "membership_disclosed", true, page, MEMBER_RE, 0.82);
    addEvidence(evidence, "board_members_disclosed", true, page, BOARD_RE, 0.82);
    addEvidence(evidence, "advocacy_role", true, page, ADVOCACY_RE, 0.72);
    addEvidence(evidence, "sector", "telecommunications / wireless", page, TELECOM_RE, 0.8);
    addEvidence(evidence, "provenance", "publisher_lineage_or_sponsorship_language", page, PROVENANCE_RE, 0.68);
    addEvidence(evidence, "publisher_type", "government_organization", page, GOVERNMENT_RE, 0.94);
  }

  const isIndustryGroup = tradeSignal && (memberSignal || boardSignal);
  const isGovernmentSource = governmentSignal && !isIndustryGroup;
  const publisherType = isIndustryGroup
    ? "industry_trade_association"
    : isGovernmentSource
      ? "government_organization"
      : null;
  const sector = telecomSignal ? "telecommunications / wireless" : null;
  const riskFlags = [];
  if (isIndustryGroup) riskFlags.push("material_industry_interest");
  if (advocacySignal) riskFlags.push("advocacy_role");
  if (isIndustryGroup && telecomSignal && healthTopic) riskFlags.push("health_claims_require_independent_corroboration");

  const status = {
    publisher_name: publisherName || null,
    publisher_type: publisherType,
    sector,
    ultimate_publisher_or_interest_group: isGovernmentSource
      ? governmentOperator || "government public authority"
      : isIndustryGroup && telecomSignal
      ? "wireless telecommunications industry consortium"
      : isIndustryGroup
        ? "industry consortium"
        : null,
    stakeholder_alignment: isGovernmentSource
      ? "government / public information"
      : isIndustryGroup && telecomSignal
      ? "telecom / wireless industry advocacy"
      : isIndustryGroup
        ? "industry aligned"
        : null,
    advocacy_role: advocacySignal,
    membership_disclosed: memberSignal,
    board_members_disclosed: boardSignal,
    identity_confidence: isGovernmentSource ? 0.95 : isIndustryGroup ? 0.9 : evidence.length ? 0.65 : 0.2,
    domain_expertise_score: telecomSignal ? 0.85 : null,
    conflict_of_interest_score: isIndustryGroup ? 0.8 : 0,
    independence_score: isGovernmentSource ? 0.8 : isIndustryGroup ? 0.45 : null,
    default_reliability_letter: isGovernmentSource ? "B" : isIndustryGroup ? "C" : null,
    default_admiralty_code: isGovernmentSource ? "BØ" : isIndustryGroup ? "CØ" : null,
    risk_flags: riskFlags,
    use_note: isGovernmentSource
      ? "Official government source. Strong for the agency's records, rules, and stated position; external claims still require claim-level assessment."
      : isIndustryGroup && telecomSignal
      ? "Good for telecom industry position and technical context; not sufficient alone for public-health conclusions. Compare health claims against independent public-health agencies, regulators, and peer-reviewed reviews."
      : isIndustryGroup
        ? "Industry-aligned source; compare claims affecting member interests against independent sources."
        : null,
    evidence,
  };

  return {
    providerName: "own_site_org_status",
    ok: true,
    matchFound: Boolean(publisherType || evidence.length),
    status: publisherType ? "found" : evidence.length ? "context_found" : "no_match",
    confidence: publisherType ? "high" : evidence.length ? "medium" : "low",
    normalized: status,
    raw: { pages: pages.map(({ url, pageType }) => ({ url, pageType })) },
  };
}

export function deriveSourceAlignment(status = null) {
  if (!status) return null;
  let type = status.publisher_type || null;
  const flags = Array.isArray(status.risk_flags) ? status.risk_flags : [];
  if (!type && flags.includes("sponsored_content")) type = "sponsored_content";
  const meta = ALIGNMENT_MARKERS[type];
  if (!meta) return null;

  const rawScore = Number(status.conflict_of_interest_score);
  const score = Number.isFinite(rawScore)
    ? Math.round(Math.max(0, Math.min(1, rawScore)) * 100)
    : null;
  const degree = score == null ? "unknown" : score >= 75 ? "high" : score >= 40 ? "moderate" : "low";

  return {
    marker: meta.marker,
    type,
    label: meta.label,
    riskScore: score,
    degree,
    explanation: status.use_note || null,
    confidence: status.identity_confidence ?? null,
    evidence: Array.isArray(status.evidence) ? status.evidence : [],
    provenance: "self_described",
  };
}

export function providerResultsFromOrgStatus(result) {
  const normalized = result?.normalized || {};
  const evidence = normalized.evidence?.length ? normalized.evidence : [{
    field: "publisher_status",
    value: normalized.publisher_type || "no_classification",
    source_url: null,
    source_page_type: "own_site_status",
    snippet: null,
    confidence: result?.confidence === "high" ? 0.9 : 0.5,
  }];

  return evidence.map((item) => ({
    providerName: "own_site_org_status",
    ok: true,
    matchFound: result.matchFound,
    status: result.status,
    confidence: result.confidence,
    normalized: {
      ...normalized,
      fieldName: item.field,
      fieldValue: item.value,
      sourcePageType: item.source_page_type,
      snippet: item.snippet,
      evidence: [item],
      externalUrl: item.source_url,
    },
    raw: {
      ...result.raw,
      extraction: normalized,
      evidence: item,
    },
  }));
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function assemblePublisherStatusFromSignals(signals = []) {
  const statuses = signals
    .filter((signal) => String(signal.provider || "").toLowerCase() === "own_site_org_status")
    .map((signal) => {
      const raw = parseMaybeJson(signal.raw_value) || parseMaybeJson(signal.raw) || {};
      return raw.normalized || raw.extraction || null;
    })
    .filter(Boolean);

  if (!statuses.length) return null;

  const merged = statuses.reduce((acc, status) => {
    for (const [key, value] of Object.entries(status)) {
      if (value == null) continue;
      if (key === "evidence") {
        acc.evidence = [...(acc.evidence || []), ...(Array.isArray(value) ? value : [])];
      } else if (key === "risk_flags") {
        acc.risk_flags = [...new Set([...(acc.risk_flags || []), ...(Array.isArray(value) ? value : [])])];
      } else if (acc[key] == null || acc[key] === false) {
        acc[key] = value;
      }
    }
    return acc;
  }, {});

  if (merged.evidence?.length) {
    const seen = new Set();
    merged.evidence = merged.evidence.filter((item) => {
      const key = `${item.field}|${item.value}|${item.source_url}|${item.snippet}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  return merged;
}

export async function discoverOwnSiteOrgStatus({
  publisherName,
  sourceUrl,
  domain,
  maxPages = MAX_STATUS_PAGES,
} = {}) {
  const rootDomain = domain || normalizeDomain(sourceUrl);
  if (!rootDomain) return null;
  const baseUrl = sourceUrl || `https://${rootDomain}/`;
  const homepage = `https://${rootDomain}/`;

  const discoveryUrls = [...new Set([baseUrl, homepage])].slice(0, MAX_DISCOVERY_PAGES);
  const discovered = [];
  for (const url of discoveryUrls) {
    try {
      const html = await fetchHtml(url);
      if (!html) continue;
      discovered.push(...discoverOrgStatusLinksFromHtml(html, url, rootDomain));
    } catch {}
  }

  const candidates = discovered
    .sort((a, b) => scoreLink(a) - scoreLink(b))
    .slice(0, maxPages);

  const pages = [];
  for (const candidate of candidates) {
    try {
      const html = await fetchHtml(candidate.url);
      if (!html) continue;
      pages.push({
        url: candidate.url,
        pageType: candidate.pageType,
        text: textFromHtml(html),
      });
    } catch {}
  }

  if (!pages.length) {
    return {
      providerName: "own_site_org_status",
      ok: true,
      matchFound: false,
      status: "no_match",
      confidence: "low",
      normalized: {
        publisher_name: publisherName || null,
        evidence: [],
        risk_flags: [],
      },
      raw: { discovered },
    };
  }

  return classifyOrganizationStatusFromPages({ publisherName, sourceUrl, pages });
}
