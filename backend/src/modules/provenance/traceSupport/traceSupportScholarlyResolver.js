import axios from "axios";
import https from "node:https";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { DEFAULT_HEADERS } from "../../../utils/helpers.js";
import { searchPubMed } from "../../../core/pubmedSearch.js";

const TITLE_STOP_WORDS = new Set([
  "analysis", "data", "effect", "effects", "first", "incidence", "paper",
  "relationship", "results", "study", "time", "using", "with",
]);

function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizedTerms(value = "") {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((term) => term.length >= 3 && !TITLE_STOP_WORDS.has(term)),
  );
}

function isNoticeTitle(title = "") {
  return /^(retraction|expression of concern|withdrawal)\s*:/i.test(clean(title));
}

export function titleAgreement(left, right) {
  const leftTerms = normalizedTerms(left);
  const rightTerms = normalizedTerms(right);
  if (!leftTerms.size || !rightTerms.size) return 0;
  const shared = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  return shared / Math.max(leftTerms.size, rightTerms.size);
}

export function extractFirstPageIdentity(parsed = {}) {
  const metadataTitle = clean(parsed?.info?.Title);
  const lines = String(parsed?.text || "")
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);

  let title = metadataTitle.length >= 12 ? metadataTitle : null;
  let author = null;

  const authorIndex = lines.findIndex((line) =>
    /\b(?:ph\.?d\.?|m\.?d\.?|d\.?o\.?|professor)\b/i.test(line),
  );
  if (authorIndex >= 0) {
    author = lines[authorIndex];
    if (!title) {
      const titleLines = lines
        .slice(Math.max(0, authorIndex - 3), authorIndex)
        .filter((line) =>
          line.length >= 12 &&
          line.length <= 160 &&
          !/^\d+$/.test(line) &&
          (/^[A-Z0-9]/.test(line) || /^(?:and|for|in|of|on|the)\b/i.test(line)) &&
          !/journal|volume|abstract|introduction/i.test(line),
        );
      title = clean(titleLines.join(" ")) || null;
    }
  }

  return { title, author, pageCountInspected: 1 };
}

export async function loadPdfFirstPageIdentity(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    maxContentLength: 25 * 1024 * 1024,
    headers: DEFAULT_HEADERS,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  });
  const parsed = await pdfParse(Buffer.from(response.data), { max: 1 });
  return extractFirstPageIdentity(parsed);
}

function authorSurname(author = "") {
  const withoutCredentials = clean(author).split(",")[0];
  const parts = withoutCredentials.match(/[A-Za-z][A-Za-z'-]+/g) || [];
  return parts.at(-1) || null;
}

function distinctiveTitleTerms(title = "") {
  return [...normalizedTerms(title)]
    .sort((left, right) => right.length - left.length)
    .slice(0, 4);
}

export function classifyPubMedMatch(identity, result) {
  const agreement = titleAgreement(identity?.title, result?.title);
  const surname = authorSurname(identity?.author)?.toLowerCase();
  const authorMatches = Boolean(
    surname &&
      (result?.authors || []).some((author) =>
        String(author).toLowerCase().includes(surname),
      ),
  );

  if (agreement >= 0.82) {
    return { matchKind: "exact", confidence: "high", titleAgreement: agreement };
  }
  if (authorMatches && agreement >= 0.3) {
    return { matchKind: "related", confidence: agreement >= 0.5 ? "high" : "medium", titleAgreement: agreement };
  }
  return { matchKind: "none", confidence: "low", titleAgreement: agreement };
}

export async function resolvePdfScholarlyIdentity(
  source,
  { loadIdentity = loadPdfFirstPageIdentity, search = searchPubMed } = {},
) {
  if (!/\.pdf(?:$|[?#])/i.test(String(source?.url || ""))) return null;

  const identity = await loadIdentity(source.url);
  if (!identity?.title) return null;

  const exactQuery = `"${identity.title.replace(/"/g, "")}"[Title]`;
  let results = await search({ query: exactQuery, topK: 5 });
  let queryUsed = exactQuery;

  if (!results.length) {
    const surname = authorSurname(identity.author);
    const terms = distinctiveTitleTerms(identity.title);
    if (!surname || terms.length < 2) return { identity, matchKind: "none", queryUsed };
    queryUsed = `${surname}[Author] AND ${terms
      .map((term) => `${term}[Title/Abstract]`)
      .join(" AND ")}`;
    results = await search({ query: queryUsed, topK: 8 });
  }

  const candidates = results
    .filter((result) => !isNoticeTitle(result.title))
    .map((result) => ({ result, match: classifyPubMedMatch(identity, result) }))
    .filter(({ match }) => match.matchKind !== "none")
    .sort((left, right) => right.match.titleAgreement - left.match.titleAgreement);

  if (!candidates.length) return { identity, matchKind: "none", queryUsed };
  const { result, match } = candidates[0];
  return {
    identity,
    queryUsed,
    ...match,
    title: result.title,
    authors: result.authors || [],
    pmid: result.pmid || null,
    doi: result.doi || null,
    canonicalUrl: result.url || (result.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${result.pmid}/` : null),
  };
}
