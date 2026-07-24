const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const normalizedKey = (value) => normalized(value).toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "for", "from",
  "had", "has", "have", "in", "into", "is", "it", "its", "of", "on", "or",
  "that", "the", "their", "there", "this", "to", "was", "were", "with",
]);

const GENERIC_NAMES = new Set([
  "a", "an", "and", "article", "call", "chapter", "general", "in", "part",
  "section", "the", "this", "today",
]);

function tokens(value) {
  return [...new Set(normalizedKey(value).split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token)))];
}

function overlapScore(assertion, unitText) {
  const assertionTokens = tokens(assertion);
  if (assertionTokens.length === 0) return 0;
  const unitTokens = new Set(tokens(unitText));
  const shared = assertionTokens.filter((token) => unitTokens.has(token)).length;
  return shared / assertionTokens.length;
}

function addCandidate(map, name, unitId, basis, candidateKind = "named_text_span") {
  const clean = normalized(name).replace(/^[“"'—–-]+|[”"',.:;!?—–-]+$/g, "");
  const key = normalizedKey(clean);
  if (clean.length < 2 || clean.length > 160 || GENERIC_NAMES.has(key)) return;
  const current = map.get(key) ?? {
    nameHint: clean,
    candidateKind,
    unitIds: [],
    bases: [],
  };
  if (unitId && !current.unitIds.includes(unitId)) current.unitIds.push(unitId);
  if (!current.bases.includes(basis)) current.bases.push(basis);
  map.set(key, current);
}

function extractNamedCandidates(contextUnits, articleAuthors, callBSource) {
  const candidates = new Map();
  for (const author of articleAuthors ?? []) {
    addCandidate(candidates, author, null, "article byline", "article_voice");
  }
  if (callBSource?.name) {
    for (const unitId of callBSource.unitIds ?? []) {
      addCandidate(candidates, callBSource.name, unitId,
        "Call B source judgment", callBSource.kind);
    }
    if ((callBSource.unitIds ?? []).length === 0) {
      addCandidate(candidates, callBSource.name, null,
        "Call B source judgment", callBSource.kind);
    }
  }
  const titleCase = /\b(?:[A-Z][\p{L}\p{N}&.’'®-]*|[A-Z]{2,})(?:\s+(?:(?:of|for|and|the|in|on|to)\s+)?(?:[A-Z][\p{L}\p{N}&.’'®-]*|[A-Z]{2,})){0,7}\b/gu;
  const acronyms = /\b[A-Z][A-Z0-9]{1,9}\b/g;
  for (const unit of contextUnits) {
    for (const match of unit.text.matchAll(titleCase)) {
      addCandidate(candidates, match[0], unit.unitId, "capitalized text span");
    }
    for (const match of unit.text.matchAll(acronyms)) {
      addCandidate(candidates, match[0], unit.unitId, "acronym");
    }
  }
  return [...candidates.values()].slice(0, 40);
}

function occurrenceIndexes(assertion, rawAssertion, groundingUnitIds, sourceUnits) {
  const indexById = new Map(sourceUnits.map((unit, index) => [unit.unitId, index]));
  const grounded = groundingUnitIds.map((unitId) => indexById.get(unitId))
    .filter(Number.isInteger);
  const scored = sourceUnits.map((unit, index) => ({
    index,
    score: Math.max(
      overlapScore(assertion, unit.text),
      overlapScore(rawAssertion, unit.text),
    ),
  })).filter((item) => item.score >= 0.58)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 8)
    .map((item) => item.index);
  return [...new Set([...grounded, ...scored])];
}

function expandIndexes(anchors, sourceUnitCount, radius = 5, maximum = 32) {
  const selected = new Set();
  for (let distance = 0; distance <= radius && selected.size < maximum; distance += 1) {
    for (const anchor of anchors) {
      const indexes = distance === 0 ? [anchor] : [anchor - distance, anchor + distance];
      for (const index of indexes) {
        if (index >= 0 && index < sourceUnitCount) selected.add(index);
        if (selected.size >= maximum) break;
      }
      if (selected.size >= maximum) break;
    }
  }
  return [...selected].sort((left, right) => left - right);
}

export function buildAttributionPackets(assertions, candidates, sourceUnits, article) {
  const candidatesById = new Map(candidates
    .map((candidate) => [candidate.candidateId, candidate]));
  return assertions.map((assertion) => {
    const candidate = candidatesById.get(assertion.candidateId);
    const anchors = occurrenceIndexes(
      assertion.assertionText,
      candidate?.rawAssertion ?? assertion.rawAssertion,
      assertion.groundingUnitIds,
      sourceUnits,
    );
    const contextUnits = expandIndexes(anchors, sourceUnits.length)
      .map((index) => sourceUnits[index]);
    const callBSource = {
      name: assertion.sourceName,
      kind: assertion.sourceKind,
      unitIds: assertion.sourceUnitIds,
    };
    return {
      candidateId: assertion.candidateId,
      assertionText: assertion.assertionText,
      rawAssertion: candidate?.rawAssertion ?? assertion.rawAssertion,
      groundingUnitIds: assertion.groundingUnitIds,
      callBSource,
      contextUnits,
      sourceCandidates: extractNamedCandidates(
        contextUnits,
        article.authors ?? [],
        callBSource,
      ),
    };
  });
}

function validatePacketUnitIds(ids, allowedIds, path, { allowEmpty = false } = {}) {
  if (!Array.isArray(ids) || (!allowEmpty && ids.length === 0)) {
    throw Object.assign(new Error(`${path} must contain packet unit IDs`), {
      code: "CF2_ATTRIBUTION_INVALID_UNITS",
    });
  }
  const unique = [];
  for (const unitId of ids) {
    if (!allowedIds.has(unitId)) {
      throw Object.assign(new Error(`${path} contains unavailable ${unitId}`), {
        code: "CF2_ATTRIBUTION_UNKNOWN_UNIT",
      });
    }
    if (!unique.includes(unitId)) unique.push(unitId);
  }
  return unique;
}

function nameIsGrounded(name, packet, articleAuthors) {
  const key = normalizedKey(name);
  if (!key) return false;
  if ((articleAuthors ?? []).some((author) => {
    const authorKey = normalizedKey(author);
    return authorKey.includes(key) || key.includes(authorKey);
  })) return true;
  if (packet.sourceCandidates.some((candidate) => {
    const candidateKey = normalizedKey(candidate.nameHint);
    return candidateKey.includes(key) || key.includes(candidateKey);
  })) return true;
  return packet.contextUnits.some((unit) => normalizedKey(unit.text).includes(key));
}

export function normalizeAttributions(output, packets, article) {
  if (!output || typeof output !== "object" || !Array.isArray(output.attributions)
    || output.attributions.length > 12) {
    throw Object.assign(new Error("Call C attributions must be an array of at most 12"), {
      code: "CF2_INVALID_ATTRIBUTION",
    });
  }
  const packetsById = new Map(packets.map((packet) => [packet.candidateId, packet]));
  const seen = new Set();
  const attributions = [];
  for (const raw of output.attributions) {
    const packet = packetsById.get(raw?.candidateId);
    if (!packet || seen.has(raw.candidateId)) {
      throw Object.assign(new Error(`Call C returned invalid ${raw?.candidateId}`), {
        code: "CF2_INVALID_ATTRIBUTION_ID",
      });
    }
    const allowedIds = new Set(packet.contextUnits.map((unit) => unit.unitId));
    let supplierName = raw.supplierName === null ? null : normalized(raw.supplierName);
    let supplierNameOrigin = supplierName ? "call_c_model" : null;
    if (raw.supplierKind === "unknown"
      && /^(?:unknown|unresolved|unclear)$/i.test(supplierName ?? "")) supplierName = null;
    if (raw.supplierKind === "article_voice" && !supplierName
      && (article.authors ?? []).length > 0) {
      supplierName = article.authors.map(normalized).filter(Boolean).join(", ");
      supplierNameOrigin = "host_materialized_byline_after_call_c";
    }
    if (supplierName && !nameIsGrounded(supplierName, packet, article.authors)) {
      throw Object.assign(new Error(`${raw.candidateId} returned ungrounded ${supplierName}`), {
        code: "CF2_ATTRIBUTION_UNGROUNDED_NAME",
      });
    }
    const supplierUnitIds = validatePacketUnitIds(
      raw.supplierUnitIds,
      allowedIds,
      `${raw.candidateId} supplier`,
      { allowEmpty: true },
    );
    const evidenceAnchors = (raw.evidenceAnchors ?? []).map((anchor, anchorIndex) => {
      const name = normalized(anchor.name);
      if (!name || !nameIsGrounded(name, packet, article.authors)) {
        throw Object.assign(
          new Error(`${raw.candidateId} anchor ${anchorIndex + 1} is ungrounded`),
          { code: "CF2_ATTRIBUTION_UNGROUNDED_ANCHOR" },
        );
      }
      return {
        name,
        kind: anchor.kind,
        unitIds: validatePacketUnitIds(
          anchor.unitIds,
          allowedIds,
          `${raw.candidateId} anchor ${anchorIndex + 1}`,
        ),
      };
    });
    seen.add(raw.candidateId);
    attributions.push({
      candidateId: raw.candidateId,
      supplierName,
      supplierKind: raw.supplierKind,
      supplierUnitIds,
      supplierBasis: raw.supplierBasis,
      supplierNameOrigin,
      evidenceAnchors,
    });
  }
  if (seen.size !== packets.length) {
    const missing = packets.map((packet) => packet.candidateId)
      .filter((candidateId) => !seen.has(candidateId));
    throw Object.assign(new Error(`Call C omitted ${missing.join(", ")}`), {
      code: "CF2_ATTRIBUTION_MISSING_ID",
    });
  }
  return attributions;
}

export function applyRecoveredAttributions(assertions, attributions) {
  const byId = new Map(attributions
    .map((attribution) => [attribution.candidateId, attribution]));
  return assertions.map((assertion) => {
    const attribution = byId.get(assertion.candidateId);
    if (!attribution) return assertion;
    return {
      ...assertion,
      callBSourceName: assertion.sourceName,
      callBSourceKind: assertion.sourceKind,
      callBSourceUnitIds: assertion.sourceUnitIds,
      callBSourceNameOrigin: assertion.sourceNameOrigin,
      sourceName: attribution.supplierName,
      sourceKind: attribution.supplierKind,
      sourceUnitIds: attribution.supplierUnitIds,
      sourceNameOrigin: attribution.supplierNameOrigin,
      attributionBasis: attribution.supplierBasis,
      evidenceAnchors: attribution.evidenceAnchors,
    };
  });
}
