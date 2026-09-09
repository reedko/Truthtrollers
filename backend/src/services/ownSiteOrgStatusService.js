import * as cheerio from "cheerio";

const FETCH_TIMEOUT_MS = 8000;
const MAX_DISCOVERY_PAGES = 2;
const MAX_STATUS_PAGES = 4;
const MAX_TEXT_CHARS = 18000;
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/;
const STATUS_LINK_RE = /\b(about|mission|who-we-are|who we are|membership|members|board|board-of-governors|leadership|governance|coalition|partners|sponsors|funding|supporters|advisory|policy|advocacy|contact|impressum|imprint|legal notice)\b/i;
// Bare single words like "alliance", "providers", "manufacturers",
// "members" are too generic to mean anything on their own -- a nonprofit's
// corporate-donor "Alliance Program", or ordinary references to "healthcare
// providers" in health content, will match every time. Require the actual
// multi-word trade/membership phrase, not a word that merely occurs inside
// one somewhere else.
const TRADE_RE = /\b(trade association|industry association|industry trade organization|industry trade association|industry consortium|industry coalition|industry alliance|trade alliance|membership organization|member companies|board of governors|wireless carriers|telecommunications service providers|device manufacturers|network equipment providers|ecosystem companies|stakeholder mix)\b/i;
const MEMBER_RE = /\b(member companies|member organizations|membership organization|stakeholder mix|dues-paying members?)\b/i;
const BOARD_RE = /\b(board of governors|board members|board of directors|leadership|governance)\b/i;
const ADVOCACY_RE = /\b(advocacy|advocate|policy recommendations|regulatory policy|government affairs|public policy|policymakers|regulators|advance the industry|promote adoption|shape policy)\b/i;
const TELECOM_RE = /\b(5g|6g|wireless|mobile broadband|telecommunications|telecom|network equipment|device manufacturers|wireless carriers|spectrum|cellular)\b/i;
const HEALTH_TOPIC_RE = /\b(health|safety|radiation|rf|radiofrequency|electromagnetic|emf|exposure|cancer|public health)\b/i;
const PROVENANCE_RE = /\b(published by|owned by|operated by|a project of|a program of|sponsored by|funded by|reprinted from|originally published by|republished from|source:|via:|from:)\b/i;
const NONPROFIT_RE = /\b(non[- ]?profit|not[- ]for[- ]profit|501\s*\(c\)\s*\(3\)|501c3|public charity|charitable organization|tax[- ]exempt organization|nonprofit subsidiary)\b/i;
// A membership organization can be public media or civic/nonprofit, not only
// a trade body. Require explicit industry/commercial-member language for IND.
const EXPLICIT_INDUSTRY_RE = /\b(trade association|industry association|industry trade organization|industry trade association|industry consortium|industry coalition|industry alliance|trade alliance|member companies|wireless carriers|device manufacturers|network equipment providers|advance the industry)\b/i;
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
  nonprofit_organization: { marker: "NPO", label: "Nonprofit organization" },
};

function normalizeDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// .gov and .mil are gatekept exclusively for real US government/military
// entities (registration is verified by GSA/DoD) -- unlike about-page prose,
// which varies too much in phrasing to match reliably, the TLD itself is a
// deterministic, unspoofable government signal.
function isGovernmentTld(url) {
  const host = normalizeDomain(url);
  return Boolean(host) && /\.(gov|mil)$/iu.test(host);
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

  // Scoped to chrome (header/nav/footer) when the page actually has those
  // landmarks. A trailing bare "a" here previously matched every link on the
  // page, including ordinary article teasers -- on a news homepage that
  // pulls in unrelated article bodies whose incidental vocabulary
  // ("manufacturers", "members", "board") gets misread as the outlet's own
  // organizational self-description. But plenty of institutional/government
  // sites (e.g. itu.int) build their chrome out of plain <div>s with no
  // <header>/<nav>/<footer> tags at all -- scoping to those landmarks then
  // finds zero links and the classifier silently returns no_match. Only
  // fall back to scanning every link on the page when no chrome landmarks
  // exist to scope to; sites that do have real landmarks keep the narrow,
  // false-positive-safe selector.
  const hasChromeLandmarks = $("header, nav, footer").length > 0;
  const selector = hasChromeLandmarks ? "header a, nav a, footer a" : "a";

  const links = [];
  $(selector).each((_, el) => {
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
  const explicitIndustrySignal = EXPLICIT_INDUSTRY_RE.test(allText);
  const nonprofitSignal = NONPROFIT_RE.test(allText);
  const memberSignal = MEMBER_RE.test(allText);
  const boardSignal = BOARD_RE.test(allText);
  const advocacySignal = ADVOCACY_RE.test(allText);
  const governmentTldSignal = isGovernmentTld(sourceUrl);
  const governmentSignal = GOVERNMENT_RE.test(allText) || governmentTldSignal;
  const governmentOperator = /\bFederal Office of Public Health(?:\s*\(FOPH\)|\s+FOPH)?\b/i.test(allText)
    ? "Federal Office of Public Health (FOPH)"
    : governmentTldSignal
      ? publisherName || null
      : null;
  if (governmentTldSignal) {
    evidence.push({
      field: "publisher_type",
      value: "government_organization",
      source_url: sourceUrl || null,
      source_page_type: "domain_tld",
      snippet: `${normalizeDomain(sourceUrl)} uses a gatekept US government TLD.`,
      confidence: 0.97,
    });
  }
  const telecomSignal = TELECOM_RE.test(`${publisherName || ""} ${sourceUrl || ""} ${allText}`);
  const healthTopic = HEALTH_TOPIC_RE.test(String(sourceUrl || "")) || HEALTH_TOPIC_RE.test(allText.slice(0, 3000));

  for (const page of pages) {
    addEvidence(evidence, "publisher_type", "industry_trade_association", page, EXPLICIT_INDUSTRY_RE, 0.84);
    addEvidence(evidence, "membership_disclosed", true, page, MEMBER_RE, 0.82);
    addEvidence(evidence, "board_members_disclosed", true, page, BOARD_RE, 0.82);
    addEvidence(evidence, "advocacy_role", true, page, ADVOCACY_RE, 0.72);
    addEvidence(evidence, "sector", "telecommunications / wireless", page, TELECOM_RE, 0.8);
    addEvidence(evidence, "provenance", "publisher_lineage_or_sponsorship_language", page, PROVENANCE_RE, 0.68);
    addEvidence(evidence, "publisher_type", "government_organization", page, GOVERNMENT_RE, 0.94);
    addEvidence(evidence, "publisher_type", "nonprofit_organization", page, NONPROFIT_RE, 0.94);
  }

  const isIndustryGroup = tradeSignal && explicitIndustrySignal && (memberSignal || boardSignal);
  const isGovernmentSource = governmentSignal && !isIndustryGroup;
  // Advocacy is a real, pertinent fact about a source -- not a red flag by
  // itself, but a reader should be able to see it at a glance the same way
  // they see GOV/IND. This only adds the sash; it does not feed into
  // default_reliability_letter/default_admiralty_code below, so it can't
  // silently shift a rating the way the government/industry classifications
  // deliberately do.
  const isAdvocacyOrg = advocacySignal && !isIndustryGroup && !isGovernmentSource;
  const isNonprofitOrg = nonprofitSignal && !isIndustryGroup && !isGovernmentSource && !isAdvocacyOrg;
  const publisherType = isIndustryGroup
    ? "industry_trade_association"
    : isGovernmentSource
      ? "government_organization"
      : isAdvocacyOrg
        ? "advocacy_organization"
        : isNonprofitOrg
          ? "nonprofit_organization"
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
        : isAdvocacyOrg
          ? "advocacy / stated position"
          : isNonprofitOrg
            ? "nonprofit / public-interest organization"
          : null,
    advocacy_role: advocacySignal,
    membership_disclosed: memberSignal,
    board_members_disclosed: boardSignal,
    identity_confidence: isGovernmentSource ? 0.95 : isIndustryGroup ? 0.9 : isNonprofitOrg ? 0.9 : isAdvocacyOrg ? 0.75 : evidence.length ? 0.65 : 0.2,
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
        : isAdvocacyOrg
          ? "Advocacy source with a stated position on this topic; useful for that position, but claims should be corroborated against independent sources."
          : isNonprofitOrg
            ? "Nonprofit organizational status is verified from the publisher's own disclosure. This is identity context, not a reliability rating."
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

// Each own_site_org_status row is already one complete, internally
// consistent classification from a single discoverOwnSiteOrgStatus call --
// it is not a partial fact to be combined with other rows. Merging fields
// across separate rows (as this used to do) mixes classifications from
// different runs, different dates, and (across a code change) different
// heuristics into one incoherent object: a stale run's
// conflict_of_interest_score=0 silently "won" over a newer run's =0.8
// merely because it was processed first, while publisher_type was picked
// up from yet another run entirely. Only ever trust the single most recent
// row. Sorted internally (by retrieved_at, when the caller provides it) so
// this can't regress just because some caller's SQL forgets ORDER BY.
export function assemblePublisherStatusFromSignals(signals = []) {
  const statuses = signals
    .filter((signal) => String(signal.provider || "").toLowerCase() === "own_site_org_status")
    .map((signal) => {
      const raw = parseMaybeJson(signal.raw_value) || parseMaybeJson(signal.raw) || {};
      return { status: raw.normalized || raw.extraction || null, retrievedAt: signal.retrieved_at || null };
    })
    .filter((entry) => entry.status)
    .sort((a, b) => {
      const bTime = b.retrievedAt ? new Date(b.retrievedAt).getTime() : 0;
      const aTime = a.retrievedAt ? new Date(a.retrievedAt).getTime() : 0;
      return bTime - aTime;
    });

  return statuses[0]?.status ?? null;
}

/**
 * The SourceCrest sash must come from one place: this function, wrapping
 * assemblePublisherStatusFromSignals + deriveSourceAlignment -- the same
 * pair SourceDetailModal's /api/publishers/:id/enrichment route calls.
 * Every list/graph endpoint that renders a SourceCrest sash should batch
 * through this rather than re-deriving IND/GOV/ADV/etc. in SQL or in the
 * frontend, which is how the sash silently went out of sync (ADV existed
 * here but not in three separate hand-written SQL CASE WHEN blocks and two
 * frontend label maps).
 */
export async function attachSourceAlignments(query, rows, { publisherIdField = "publisher_id", attach = "alignment" } = {}) {
  const publisherIds = [...new Set(
    rows.map((row) => row[publisherIdField]).filter((id) => id != null),
  )];
  if (!publisherIds.length) return rows;
  const signalRows = await query(
    `SELECT publisher_id, raw_value, retrieved_at
       FROM publisher_external_signals
      WHERE publisher_id IN (?)
        AND provider = 'own_site_org_status'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY retrieved_at DESC, id DESC`,
    [publisherIds],
  );
  const signalsByPublisher = new Map();
  for (const signalRow of signalRows) {
    const list = signalsByPublisher.get(signalRow.publisher_id) || [];
    list.push({ provider: "own_site_org_status", raw_value: signalRow.raw_value, retrieved_at: signalRow.retrieved_at });
    signalsByPublisher.set(signalRow.publisher_id, list);
  }
  const alignmentByPublisher = new Map();
  for (const publisherId of publisherIds) {
    const status = assemblePublisherStatusFromSignals(signalsByPublisher.get(publisherId) || []);
    alignmentByPublisher.set(publisherId, deriveSourceAlignment(status));
  }
  return rows.map((row) => ({
    ...row,
    [attach]: row[publisherIdField] != null ? alignmentByPublisher.get(row[publisherIdField]) || null : null,
  }));
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
    // No about/membership/etc. page was discoverable, but a .gov/.mil TLD is
    // sufficient evidence on its own -- don't report no_match for a domain
    // that's definitionally government-operated.
    if (isGovernmentTld(sourceUrl || baseUrl)) {
      return classifyOrganizationStatusFromPages({ publisherName, sourceUrl: sourceUrl || baseUrl, pages: [] });
    }
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
