// Deterministic source-candidate extraction for compact 1B packets.
// These are textual hints, never authoritative assertionSource decisions.

const ATTRIBUTION_VERB = "said|says|told|asked|argued|claimed|claims|wrote|writes|stated|states|denied|denies|asserted|asserts|noted|notes|observed|observes|explained|explains|warned|warns|testified|insisted|insists|contended|contends|maintained|maintains|announced|reported|reports|found|revealed|reveals|showed|shows|concluded|concludes|demonstrated|demonstrates|classified|classifies";
const ATTRIBUTION_CUE = new RegExp(`\\b(?:${ATTRIBUTION_VERB}|according to)\\b`, "i");
const BEFORE_VERB = new RegExp(
  `((?:the\\s+)?(?:[A-Z]{2,}|[A-Z][\\w'’.-]*)(?:\\s+(?:[A-Z]{2,}|[A-Z][\\w'’&.-]*|of|the|and|for)){0,6})\\s+(?:${ATTRIBUTION_VERB})\\b`, "g");
const ACCORDING_TO = /\baccording to\s+((?:the\s+)?[^,.;:]{2,100})/gi;
const POSSESSIVE_SOURCE = /\b((?:the\s+)?(?:[A-Z]{2,}|[A-Z][\w'’.-]*)(?:\s+(?:[A-Z]{2,}|[A-Z][\w'’&.-]*|of|the|and|for)){0,6})['’]s\s+(?:claim|claims|report|study|data|statement|ad|advertisement)\b/g;
const AFTER_VERB = new RegExp(
  `\\b(?:${ATTRIBUTION_VERB})\\s+((?:the\\s+)?(?:[A-Z]{2,}|[A-Z][\\w'’.-]*)(?:\\s+(?:[A-Z]{2,}|[A-Z][\\w'’&.-]*|of|the|and|for)){0,6})`, "g");
const GENERIC_SOURCE = new RegExp(
  `\\b((?:(?:the|a|an)\\s+)?(?:(?:\\d{4}|recent|new)\\s+)?(?:ad|advertisement|article|report|study|analysis|summary|survey|trial|review|department|agency|author|researchers?|officials?|authorities))(?:\\s+of\\s+[^,.;:]{1,80})?\\s+(?:${ATTRIBUTION_VERB}|opens?)\\b`, "gi");
const FROM_DOCUMENT_SOURCE = /\bfrom\s+((?:the\s+)?[^,;:“”"]{0,90}\b(?:package insert|report|study|analysis|review|paper|document|data sheet|database)(?:\s+of\s+[^,;:“”"]{1,80})?)/gi;

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
  .replace(/^(?:as\s+|the\s+)/i, "").replace(/[\s,.;:]+$/, "");

function hints(text) {
  const found = [];
  for (const pattern of [ACCORDING_TO, BEFORE_VERB, AFTER_VERB, POSSESSIVE_SOURCE,
    GENERIC_SOURCE, FROM_DOCUMENT_SOURCE]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) found.push({ nameHint: clean(match[1]),
      trigger: pattern === ACCORDING_TO ? "according_to"
        : pattern === POSSESSIVE_SOURCE ? "possessive_source"
          : pattern === GENERIC_SOURCE ? "generic_source_attribution"
            : pattern === FROM_DOCUMENT_SOURCE ? "document_source"
              : "attribution_verb" });
  }
  return found.filter((item) => item.nameHint);
}

export function detectSplitSourceCandidates({ claimUnits = [], attributionContextUnits = [],
  localResponseUnits = [] } = {}) {
  const candidates = [];
  const seen = new Set();
  const add = ({ nameHint = null, trigger, records, contextRegion }) => {
    if (!clean(nameHint)) return;
    const unitIds = [...new Set(records.map((record) => record.unitId).filter(Boolean))];
    const key = clean(nameHint).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ sourceCandidateId: `SRC${String(candidates.length + 1).padStart(2, "0")}`,
      nameHint: nameHint || null,
      candidateKind: contextRegion === "claim_or_attribution" ? "explicit_external" : "local_context_external",
      unitIds, trigger, contextRegion,
      excerpt: clean(records.map((record) => record.text).join(" ")),
      basis: contextRegion === "claim_or_attribution"
        ? "Explicit attribution syntax detected in claim or attribution context"
        : "Explicit attribution syntax detected in bounded local context" });
  };

  const scanRecord = (record, contextRegion) => {
    const text = clean(record?.text);
    if (!text) return;
    const parsed = hints(text);
    for (const item of parsed) add({ ...item, records: [record], contextRegion });
  };
  const scanJoined = (records, contextRegion, triggerPrefix) => {
    const usable = records.filter((record) => record?.unitId && clean(record.text));
    if (usable.length < 2) return;
    for (const item of hints(usable.map((record) => record.text).join(" "))) {
      add({ ...item, trigger: `${triggerPrefix}_${item.trigger}`, records: usable, contextRegion });
    }
  };

  for (const record of claimUnits) scanRecord(record, "claim_or_attribution");
  for (const record of attributionContextUnits) scanRecord(record, "claim_or_attribution");

  scanJoined(claimUnits, "claim_or_attribution", "joined_claim");
  scanJoined(attributionContextUnits, "claim_or_attribution", "joined_attribution");
  // Source-unit segmentation can split a name or attribution clause at an initial,
  // title, or other boundary. Join only the claim tail and the first bounded local
  // units; these remain hints and 1B must tie them to the proposition.
  if (claimUnits.length && localResponseUnits.length) {
    const tail = String(claimUnits.at(-1)?.text ?? "").replace(/\s+/g, " ").trim();
    const next = clean(localResponseUnits[0]?.text);
    const splitInitial = /\b[A-Z]\.$/.test(tail)
      && /^[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){0,3}\s+(?:observed|observes|reported|reports|explained|explains|said|says|stated|states|revealed|reveals)\b/.test(next);
    if (splitInitial) {
      scanJoined([claimUnits.at(-1), localResponseUnits[0]],
        "grounding_continuation", "cross_unit_continuation");
    }
  }

  return {
    sourceCandidateStatus: candidates.length ? "candidates_found" : "no_candidates_detected",
    sourceCandidates: candidates,
  };
}
