// /backend/src/utils/parseAuthorName.js

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
  "o'",
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

export function parseAuthorName(raw) {
  let cleaned = raw.trim().replace(/\s+/g, " ");
  const displayName = cleaned; // Preserve full name as-is

  let name = cleaned;
  let title = null;
  let suffix = null;

  // Handle suffix after comma
  if (cleaned.includes(",")) {
    const parts = cleaned.split(",");
    name = parts[0];
    const possibleSuffix = parts[1].trim();
    if (knownSuffixes.includes(possibleSuffix)) {
      suffix = possibleSuffix;
    }
  }

  // Extract title
  for (const t of knownTitles) {
    if (name.startsWith(t + " ")) {
      title = t;
      name = name.slice(t.length).trim();
      break;
    }
  }

  const nameParts = name.split(" ");
  if (nameParts.length < 2) {
    return {
      display_name: displayName,
      title,
      first_name: nameParts[0],
      middle_name: null,
      last_name: "",
      suffix,
    };
  }

  // Suffix again if no comma
  const lastWord = nameParts[nameParts.length - 1];
  if (knownSuffixes.includes(lastWord)) {
    suffix = lastWord;
    nameParts.pop();
  }

  const firstName = nameParts.shift();
  const lastNameParts = [];

  // Grab last name and particles
  while (nameParts.length) {
    const part = nameParts[nameParts.length - 1];
    if (
      surnameParticles.has(part.toLowerCase()) ||
      lastNameParts.length === 0
    ) {
      lastNameParts.unshift(nameParts.pop());
    } else {
      break;
    }
  }

  const lastName = lastNameParts.join(" ");
  const middleName = nameParts.length ? nameParts.join(" ") : null;

  return {
    display_name: displayName,
    title,
    first_name: firstName,
    middle_name: middleName,
    last_name: lastName,
    suffix,
  };
}
