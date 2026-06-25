// backend/src/utils/pdfPublisherExtractor.js
// Publisher name extraction from PDF info metadata.
// Same approach as choosePdfAuthors in misc.routes.js:
//   1. Check the relevant pdf-parse info field
//   2. Light scan of first-page lines as a fallback
//
// Shared by: sourceIdentityResolver, fetchExternalPageContent, scrapeReference, misc.routes.js

// Software names that appear in Creator/Producer but are not the publisher
const GENERIC_SOFTWARE = /microsoft|adobe|word|excel|acrobat|openoffice|libreoffice|ghostscript|pdflatex|latex|itext|reportlab|scribus|wkhtmltopdf|dompdf|fpdf|xelatex|lualatex|quarkxpress|indesign|afpublisher|foxit/i;

/**
 * Choose the best publisher name from the pdf-parse info dict and first-page lines.
 * Returns null when nothing credible is found — let the caller fall back to domain.
 *
 * @param {object}   info  - parsed.info from pdf-parse (Creator, Producer, Author, Subject, …)
 * @param {string[]} lines - first-page text split by newline, trimmed and filtered
 */
export function choosePdfPublisher(info, lines = []) {
  // 1. Creator field — "European Parliament", "WHO", "NIST", etc.
  if (info?.Creator) {
    const c = info.Creator.trim();
    if (c.length >= 3 && c.length <= 200 && !GENERIC_SOFTWARE.test(c)) {
      return c;
    }
  }

  // 2. Producer field — less common, but some orgs stamp it here
  if (info?.Producer) {
    const p = info.Producer.trim();
    if (p.length >= 3 && p.length <= 200 && !GENERIC_SOFTWARE.test(p)) {
      return p;
    }
  }

  // 3. Light first-page scan — only the "ACRONYM | Full Name" pattern that many
  //    inter-governmental and parliamentary PDFs use on line 1.
  for (const line of lines.slice(0, 10)) {
    const m = line.match(/^[A-Z]{2,10}\s*\|\s*(.{8,120})$/);
    if (m) return m[1].trim();
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
