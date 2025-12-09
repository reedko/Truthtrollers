// backend/src/storage/persistAuthors.js
// Fully rewritten to mirror legacy server.js behavior EXACTLY.

const surnameParticles = new Set([
  "de",
  "del",
  "de la",
  "da",
  "di",
  "van",
  "von",
  "bin",
  "ibn",
  "al",
  "le",
  "du",
  "des",
  "la",
  "mc",
  "mac",
  "st.",
  "st",
  "o’",
  "o'",
]);

const knownTitles = [
  "Dr.",
  "Mr.",
  "Mrs.",
  "Ms.",
  "Prof.",
  "Rev.",
  "Hon.",
  "Sir",
];

const knownSuffixes = [
  "PhD",
  "Ph.D.",
  "MD",
  "M.D.",
  "DO",
  "D.O.",
  "MS",
  "M.S.",
  "MBA",
  "BSc",
  "B.Sc.",
  "JD",
  "J.D.",
  "DDS",
  "D.D.S.",
  "RN",
  "R.N.",
  "Esq.",
  "Jr.",
  "Sr.",
  "III",
  "IV",
];

function parseAuthorName(raw) {
  let cleaned = raw.trim().replace(/\s+/g, " ");
  const displayName = cleaned;

  let name = cleaned;
  let title = null;
  let suffix = null;

  // suffix after comma
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    name = parts[0];
    const possible = parts[1].trim();
    if (knownSuffixes.includes(possible)) {
      suffix = possible;
    }
  }

  // extract title
  for (const t of knownTitles) {
    if (name.startsWith(t + " ")) {
      title = t;
      name = name.slice(t.length).trim();
      break;
    }
  }

  const parts = name.split(" ");
  if (parts.length < 2) {
    return {
      display_name: displayName,
      title,
      first_name: parts[0],
      middle_name: null,
      last_name: "",
      suffix,
    };
  }

  // suffix without comma
  const lastWord = parts[parts.length - 1];
  if (knownSuffixes.includes(lastWord)) {
    suffix = lastWord;
    parts.pop();
  }

  const firstName = parts.shift();
  const lastNameParts = [];

  // build last name
  while (parts.length) {
    const part = parts[parts.length - 1];
    if (
      surnameParticles.has(part.toLowerCase()) ||
      lastNameParts.length === 0
    ) {
      lastNameParts.unshift(parts.pop());
    } else break;
  }

  return {
    display_name: displayName,
    title,
    first_name: firstName,
    middle_name: parts.length ? parts.join(" ") : null,
    last_name: lastNameParts.join(" "),
    suffix,
  };
}

/**
 * persistAuthors(pool, contentId, authors)
 *
 * authors must be an array of:
 *   { name: "John Smith", description: "...", image: "URL" }
 *
 * This function now EXACTLY matches the old working server.js route.
 */
export async function persistAuthors(query, contentId, authors = []) {
  if (!contentId || !Array.isArray(authors) || authors.length === 0) return [];

  const authorIds = [];

  for (const author of authors) {
    if (
      !author ||
      (!author.name &&
        !author.displayName &&
        !author.firstName &&
        !author.lastName)
    ) {
      continue;
    }
    // 1. Build rawName string
    const rawName =
      author.name ||
      author.displayName ||
      [author.firstName, author.middleName, author.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();

    if (!rawName) continue;

    // 2. Parse it
    const parsed = parseAuthorName(rawName);
    const sql = `
      CALL InsertOrGetAuthor(?, ?, ?, ?, ?, ?, ?, ?, @authorId);
    `;

    const params = [
      parsed.first_name,
      parsed.middle_name,
      parsed.last_name,
      parsed.title,
      parsed.suffix,
      parsed.display_name,
      author.description || null,
      author.image || null,
    ];

    // IMPORTANT: legacy behavior → result[0][0]
    const result = await query(sql, params);

    const callRows = result[0]; // CALL returns rows in result[0]
    const authorId = callRows?.[0]?.authorId;

    if (!authorId) {
      console.error("❌ persistAuthors: SP did not return authorId");
      continue;
    }

    authorIds.push(authorId);

    // link to content
    await query(
      `INSERT IGNORE INTO content_authors (content_id, author_id)
       VALUES (?, ?)`,
      [contentId, authorId]
    );
  }

  return authorIds;
}
