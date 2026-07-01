// First-page PDF identity extraction. This is the source of truth for
// publisher, publication venue, and article type heuristics.

const GENERIC_SOFTWARE =
  /microsoft|adobe|word|excel|acrobat|openoffice|libreoffice|ghostscript|pdflatex|latex|itext|reportlab|scribus|wkhtmltopdf|dompdf|fpdf|xelatex|lualatex|quarkxpress|indesign|afpublisher|foxit/i;

const ARTICLE_TYPES = [
  "Case Study",
  "Case Report",
  "Research Article",
  "Review Article",
  "Short Communication",
  "Editorial",
  "Letter to the Editor",
  "Clinical Image",
  "Original Article",
  "Perspective",
  "Commentary",
  "Brief Report",
  "Systematic Review",
  "Meta-Analysis",
  "Fact Sheet",
];

const ARTICLE_TYPE_RE = new RegExp(
  `^(${ARTICLE_TYPES.map(escapeRegex).join("|")})$`,
  "i",
);

export function choosePdfIdentity(info = {}, lines = []) {
  const cleanLines = normalizeLines(lines);
  const identity = {
    publisher_name: null,
    publication_venue: null,
    journal_name: null,
    article_type: null,
    authors: [],
    published_date: null,
    evidence: {},
    methods: {},
    confidence: {},
  };

  const explicitPublisher = findExplicitPublisher(cleanLines);
  if (explicitPublisher) {
    identity.publisher_name = explicitPublisher.value;
    identity.evidence.publisher_name = explicitPublisher.evidence;
    identity.methods.publisher_name = explicitPublisher.method;
    identity.confidence.publisher_name = 0.95;
  }

  const articleType = findArticleType(cleanLines);
  if (articleType) {
    identity.article_type = articleType.value;
    identity.evidence.article_type = articleType.evidence;
    identity.methods.article_type = articleType.method;
    identity.confidence.article_type = articleType.confidence;
  }

  const venue = findPublicationVenue(cleanLines, identity.article_type);
  if (venue) {
    identity.publication_venue = venue.value;
    identity.journal_name = venue.value;
    identity.evidence.publication_venue = venue.evidence;
    identity.methods.publication_venue = venue.method;
    identity.confidence.publication_venue = venue.confidence;
  }

  const authors = findAuthors(info, cleanLines);
  if (authors.length) {
    identity.authors = authors.map((author) => ({ name: author.name }));
    identity.evidence.authors = authors.map((author) => author.evidence);
    identity.methods.authors = authors[0].method;
    identity.confidence.authors = Math.min(...authors.map((author) => author.confidence));
  }

  const publishedDate = findPublishedDate(cleanLines);
  if (publishedDate) {
    identity.published_date = publishedDate.value;
    identity.evidence.published_date = publishedDate.evidence;
    identity.methods.published_date = publishedDate.method;
    identity.confidence.published_date = publishedDate.confidence;
  }

  if (!identity.publisher_name) {
    const fallbackPublisher = choosePdfPublisher(info, cleanLines);
    if (fallbackPublisher) {
      identity.publisher_name = fallbackPublisher;
      identity.evidence.publisher_name = "pdf_info_or_known_org_fallback";
      identity.methods.publisher_name = "choose_pdf_publisher_fallback";
      identity.confidence.publisher_name = 0.55;
    }
  }

  return identity;
}

export function choosePdfPublisher(info = {}, lines = []) {
  if (info?.Creator) {
    const candidate = cleanIdentityCandidate(info.Creator);
    if (isCredibleIdentityCandidate(candidate)) return candidate;
  }

  if (info?.Producer) {
    const candidate = cleanIdentityCandidate(info.Producer);
    if (isCredibleIdentityCandidate(candidate)) return candidate;
  }

  for (const line of lines.slice(0, 10)) {
    const match = line.match(/^[A-Z]{2,10}\s*\|\s*(.{8,120})$/);
    if (!match) continue;
    const candidate = cleanIdentityCandidate(match[1]);
    if (isCredibleIdentityCandidate(candidate)) return candidate;
  }

  const head = lines.slice(0, 30).join("\n");
  if (/\bInternational Agency for Research on Cancer\b|\bIARC\b/.test(head)) {
    return "International Agency for Research on Cancer";
  }
  if (/\bWorld Health Organization\b|\bWHO\b/.test(head)) {
    return "World Health Organization";
  }
  return null;
}

function findExplicitPublisher(lines) {
  for (const line of lines.slice(0, 80)) {
    const match = line.match(
      /\b(?:Publisher Name|Publisher|Published by|Publication by)\s*[:\-]\s*(.{3,160})$/i,
    );
    if (!match) continue;
    const candidate = cleanIdentityCandidate(match[1]);
    if (isCredibleIdentityCandidate(candidate)) {
      return {
        value: candidate,
        evidence: line,
        method: "first_page_explicit_publisher_label",
      };
    }
  }

  for (const line of lines.slice(0, 100)) {
    const match = line.match(
      /©\s*\d{4}\s*[-–]\s*(.{3,120}?)\s*(?:\.|,)?\s*All Rights Reserved/i,
    );
    if (!match) continue;
    const candidate = cleanIdentityCandidate(match[1]);
    if (isCredibleIdentityCandidate(candidate)) {
      return {
        value: normalizePublisherName(candidate),
        evidence: line,
        method: "first_page_copyright_publisher_line",
      };
    }
  }
  return null;
}

function findArticleType(lines) {
  for (const [index, line] of lines.slice(0, 80).entries()) {
    const candidate = cleanIdentityCandidate(line);
    const labeled = candidate.match(/\bArticle Type\s*[:\-]\s*(.{3,80})$/i);
    if (labeled) {
      const value = normalizeArticleType(labeled[1]);
      if (value) {
        return {
          value,
          evidence: line,
          method: "first_page_explicit_article_type_label",
          confidence: 0.95,
        };
      }
    }

    const standalone = normalizeArticleType(candidate);
    if (standalone) {
      return {
        value: standalone,
        evidence: line,
        method: "first_page_standalone_article_type_line",
        confidence: 0.88,
      };
    }

    // Fact sheets commonly include the document type in the title rather
    // than on a standalone metadata line (for example "CHD Fact Sheet").
    if (index < 12 && /\bfact\s*sheet\b/i.test(candidate)) {
      return {
        value: "Fact Sheet",
        evidence: line,
        method: "first_page_title_document_type",
        confidence: 0.86,
      };
    }
  }
  return null;
}

function findPublicationVenue(lines, articleType = null) {
  for (const line of lines.slice(0, 80)) {
    const match = line.match(
      /\b(?:Journal|Journal Name|Publication|Publication Venue|Venue|Published in)\s*[:\-]\s*(.{3,160})$/i,
    );
    if (!match) continue;
    const candidate = cleanIdentityCandidate(match[1]);
    if (isCredibleVenueCandidate(candidate, articleType)) {
      return {
        value: candidate,
        evidence: line,
        method: "first_page_explicit_venue_label",
        confidence: 0.95,
      };
    }
  }

  for (const line of lines.slice(0, 20)) {
    const candidate = cleanIdentityCandidate(line);
    if (isCredibleVenueCandidate(candidate, articleType)) {
      return {
        value: candidate,
        evidence: line,
        method: "first_page_journal_like_title",
        confidence: 0.86,
      };
    }
  }

  for (const line of lines.slice(0, 100)) {
    const match = line.match(
      /\bCitation:\s*.+?\.\s*([A-Z][A-Za-z\s]+(?:Case|Clin|Clinical|Med|Medicine|Sci|Science|Stud|Studies|Rep|Reports|J|Journal)[A-Za-z\s]*)\.\s*\d{4}/i,
    );
    if (!match) continue;
    const candidate = cleanIdentityCandidate(match[1]);
    if (isCredibleVenueCandidate(candidate, articleType)) {
      return {
        value: candidate,
        evidence: line,
        method: "citation_line_abbreviated_venue",
        confidence: 0.65,
      };
    }
  }
  return null;
}

function findAuthors(info, lines) {
  const candidates = [];
  const addNames = (value, evidence, method, confidence) => {
    for (const name of splitAuthorNames(value)) {
      if (!candidates.some((author) => author.name.toLowerCase() === name.toLowerCase())) {
        candidates.push({ name, evidence, method, confidence });
      }
    }
  };

  for (const line of lines.slice(0, 80)) {
    // Anchor the label. A loose `author:` match also catches
    // "Corresponding author: Lennart Hardell" later on the page and then
    // incorrectly treats that single contact as the complete byline.
    const labeled = line.match(/^\s*(?:Authors?|By)\s*[:\-]\s*(.{4,240})$/i);
    if (labeled) addNames(labeled[1], line, "first_page_explicit_author_label", 0.96);
  }
  if (candidates.length) return candidates;

  // Journal PDFs commonly place a multi-author byline immediately below the
  // article type/title, with `and`, commas, and affiliation markers.
  const bylineLines = lines.slice(0, 35);
  for (let index = 0; index < bylineLines.length; index += 1) {
    const line = bylineLines[index];
    const nextLine = bylineLines[index + 1] || "";
    // pdf-parse can break "Lennart Hardell1* and Mona Nilsson2" immediately
    // before `and`. Rejoin that specific continuation before splitting names.
    const candidateLine = /^\s*(?:and|&)\s+/i.test(nextLine)
      ? `${line} ${nextLine}`
      : line;
    if (!/\s(?:and|&)\s|[,;]/i.test(candidateLine)) continue;
    if (/\b(?:journal|annals|abstract|keywords|citation|doi|issn|volume|issue|published|publisher|copyright|correspondence|university|department|institute|hospital|foundation|research|laboratory|association|society|radiation protection)\b/i.test(candidateLine)) continue;
    const names = splitAuthorNames(candidateLine);
    if (names.length >= 2) {
      names.forEach((name) => addNames(name, candidateLine, "first_page_author_byline", 0.9));
      return candidates;
    }
  }

  if (info?.Author) {
    // The PDF's explicit Author property is valid embedded authorship
    // evidence even when the visible first page does not repeat the byline.
    addNames(info.Author, cleanIdentityCandidate(info.Author), "pdf_info_author", 0.82);
  }

  // A corresponding-author contact is useful only as a final fallback. It is
  // not evidence that the document has exactly one author.
  if (!candidates.length) {
    for (const line of lines.slice(0, 100)) {
      const corresponding = line.match(/^\s*\*?Corresponding author\s*[:\-]\s*([^,]{4,120})/i);
      if (corresponding) {
        addNames(corresponding[1], line, "first_page_corresponding_author_fallback", 0.62);
        if (candidates.length) break;
      }
    }
  }
  return candidates;
}

function splitAuthorNames(value) {
  const cleaned = String(value || "")
    .replace(/\b(?:authors?|by)\s*[:\-]\s*/i, "")
    .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "")
    .replace(/([\p{L}.'’\-])\d+(?:,\d+)*[*†‡]?/gu, "$1")
    .replace(/[*†‡]+/g, "")
    .replace(/\b(?:MD|M\.D\.|PhD|Ph\.D\.|MSc|BSc|MPH)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(/\s+(?:and|&)\s+|\s*;\s*|\s*,\s*/i)
    .map((name) => name.replace(/^[\s.]+|[\s.]+$/g, "").trim())
    .filter(isCrediblePersonName);
}

function isCrediblePersonName(value) {
  if (!value || value.length < 5 || value.length > 100) return false;
  if (/\d|@|https?:|\b(?:journal|annals|article|study|report|review|clinical|medical|science|university|department|copyright|environment|foundation|research|institute|institution|laboratory|association|society|radiation|protection|ministry|agency|company|corporation|limited|llc)\b/i.test(value)) return false;
  const words = value.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  return words.every((word) => /^(?:[\p{Lu}][\p{L}.'’\-]*|de|del|da|di|van|von|la)$/u.test(word));
}

function findPublishedDate(lines) {
  for (const line of lines.slice(0, 100)) {
    const match = line.match(/\b(?:Published Date|Publication Date|Date Published|Published|Publication)\s*[:\-]\s*([A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
    if (!match) continue;
    const normalized = normalizeDate(match[1]);
    if (normalized) {
      return { value: normalized, evidence: line, method: "first_page_explicit_published_date", confidence: 0.95 };
    }
  }
  return null;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const named = raw.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (!named) return null;
  const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  const month = months[named[1].toLowerCase()];
  if (!month) return null;
  return `${named[3]}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
}

function normalizeLines(lines = []) {
  return lines.map(cleanIdentityCandidate).filter(Boolean);
}

function cleanIdentityCandidate(value) {
  return String(value || "").replace(/\s+/g, " ").replace(/[.;,]\s*$/, "").trim();
}

function isCredibleIdentityCandidate(value) {
  if (!value || value.length < 3 || value.length > 200 || GENERIC_SOFTWARE.test(value)) return false;
  return !/^(abstract|keywords|citation|doi|correspondence|introduction|methods|results|discussion|conclusion|references)$/i.test(value);
}

function isCredibleVenueCandidate(value, articleType = null) {
  if (!isCredibleIdentityCandidate(value)) return false;
  if (articleType && value.toLowerCase() === articleType.toLowerCase()) return false;
  if (value.length > 140) return false;
  if (/\b(title|author|authors|publisher|published date|copyright|issn|volume|article|citation|doi|abstract|keywords)\b/i.test(value)) return false;
  return /(?:journal|annals|proceedings|transactions|bulletin|review|studies|reports|medicine|medical|clinical|science|scientific|research|case studies|case reports)/i.test(value);
}

function normalizeArticleType(value) {
  const candidate = cleanIdentityCandidate(value);
  const match = candidate.match(ARTICLE_TYPE_RE);
  if (!match) return null;
  const found = match[1].toLowerCase();
  return ARTICLE_TYPES.find((type) => type.toLowerCase() === found) || candidate;
}

function normalizePublisherName(value) {
  const candidate = cleanIdentityCandidate(value);
  return /^Medtext Publications$/i.test(candidate) ? "Medtext Publications" : candidate;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
