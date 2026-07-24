import {
  CF2_DISCOVERY_SCHEMA_V1,
  cf2AttributionSchema,
  cf2FinalizationSchema,
} from "./schemas.js";

function metadata(article = {}) {
  return [
    `Title: ${article.title || "Unknown"}`,
    `Byline: ${(article.authors ?? []).join(", ") || "Not supplied"}`,
    `Publisher: ${article.publisher || "Not supplied"}`,
    `Published: ${article.publishedAt || "Not supplied"}`,
  ].join("\n");
}

export function serializeCf2Article(sourceUnits = []) {
  return sourceUnits.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n");
}

export function buildCf2DiscoveryPrompt({ article, sourceUnits }) {
  return {
    system: `You build a fact-check docket from an article.

Use only the supplied article. Do not fact-check it and do not use outside knowledge.
Return the article's assertions in their original polarity. If the article introduces a
proposition in order to challenge it, preserve the proposition as its original source
asserted it, not as the article's rebuttal.`,
    user: `Read the complete article before choosing the docket.

State the article's central position as one concise thesisAssertion.

Then return a broad but compact set of no more than 18 factual candidates that an
external fact-checker could verify or dispute. Do not fill a quota.

For each candidate:
- rawAssertion must contain one independently testable factual proposition: one subject
  and one predicate. Do not join separate propositions with "and", "but", or a semicolon.
- Preserve specific names, institutions, studies, documents, dates, numbers, populations,
  comparisons, and allegation strength.
- Preserve a reporting frame in rawAssertion when it identifies who supplied the
  proposition. A later call will separate source from substance.
- groundingUnitIds must independently support the proposition. For an attributed
  proposition, include the local unit that identifies its supplier.

Exclude the thesis itself, generic argument summaries, article or section descriptions,
biographies, presentation details, navigation, rhetorical questions, and incidental
background. Do not classify source, stance, article role, materiality, or evidence needs.

ARTICLE METADATA
${metadata(article)}

ARTICLE WITH SOURCE UNITS
${serializeCf2Article(sourceUnits)}`,
    responseSchema: CF2_DISCOVERY_SCHEMA_V1,
  };
}

function candidatePacket(candidate) {
  const context = candidate.contextUnits
    .map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n");
  return `CANDIDATE ${candidate.candidateId}
Raw assertion: ${candidate.rawAssertion}
Call A grounding: ${candidate.groundingUnitIds.join(", ")}
Local article context:
${context}`;
}

export function buildCf2FinalizationPrompt({ article, thesisAssertion, candidates }) {
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  return {
    system: `You finalize a fact-check docket.

Use only the supplied thesis, candidates, and local article context. Do not fact-check
the assertions and do not use outside knowledge. Return a compact portfolio whose
assertions are immediately understandable to a human and directly usable by an evidence
search system.`,
    user: `Return one judgment for every supplied candidate, in candidate-ID order.
Do not select a portfolio and do not omit a candidate. The host will make that mechanical
selection after your judgments.

For every candidate, decide fields in this order:

1. assertionText
Write one atomic substantive proposition. Remove "X said", "according to X", and similar
reporting frames. Preserve the proposition's original polarity, specificity, numbers,
population, comparison, and allegation strength. If rawAssertion contains multiple
independently testable propositions, retain only the single proposition most important
to evaluating the article. Never fuse clauses.

2. groundingUnitIds
Identify the supplied units that independently ground assertionText.

3. articleTreatment
- adopted: the article uses the proposition as part of its own factual case.
- challenged: the article introduces the proposition to dispute, reject, or discredit it.
- reported: the article reports it without clearly adopting or challenging it.

4. effectIfTrue
Fix the thesis direction and assume assertionText is true.
- strengthens: that makes the thesis more credible.
- weakens: that makes the thesis less credible.
- no_effect: that does not materially change confidence in the thesis.
Ignore source identity, tone, and presumed real-world truth when deciding this field.

5. sourceName, sourceKind, and sourceUnitIds
Only after the preceding decisions, identify who supplies the complete substantive
proposition in the article. Use an exact person, institution, study, or document name
when the text supports it. When the article's own narrative voice supplies the
proposition and no external source does, use the exact byline as sourceName and
article_voice as sourceKind. Evidence cited in support is not automatically the source.
When the supplied context genuinely does not resolve the supplier, set sourceKind to
unknown, sourceName to null, and sourceUnitIds to an empty array. sourceUnitIds must
support every resolved attribution.

THESIS ASSERTION
${thesisAssertion}

ARTICLE METADATA
${metadata(article)}

CANDIDATES AND LOCAL CONTEXT
${candidates.map(candidatePacket).join("\n\n")}`,
    responseSchema: cf2FinalizationSchema(candidateIds),
  };
}

function attributionPacket(packet) {
  return `ASSERTION ${packet.candidateId}
Frozen assertion: ${packet.assertionText}
Original source-preserving candidate: ${packet.rawAssertion}
Call B source judgment: ${JSON.stringify(packet.callBSource)}
Host-found source candidates: ${JSON.stringify(packet.sourceCandidates)}
Relevant article units:
${packet.contextUnits.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n")}`;
}

export function buildCf2AttributionPrompt({ article, packets }) {
  const candidateIds = packets.map((packet) => packet.candidateId);
  return {
    system: `You resolve attribution for frozen factual assertions.

Use only the supplied article excerpts and source candidates. Do not fact-check,
rewrite, select, rank, or judge the assertions. Separate who supplies the complete
proposition from studies, documents, datasets, or records merely cited as evidence.`,
    user: `Return one attribution for every supplied assertion, in assertion-ID order.

assertionSupplier:
- Choose the person, institution, study, or document that supplies the complete frozen
  proposition in the article.
- Use article_voice only when the article's own narrative voice supplies the complete
  proposition and no external source does.
- Use unknown only when the supplied excerpts genuinely do not resolve the supplier.
- A study, document, dataset, institution, or person cited as evidence is not
  automatically the assertion supplier.

evidenceAnchors:
- Separately list named studies, documents, datasets, regulations, or other identifiable
  works that the excerpts connect to the assertion and that could anchor evidence search.
- Do not list the article byline merely because it is the assertion supplier.
- Return an empty array when no named evidence anchor is present.

Names and unit IDs must be grounded in the supplied packet. Host-found candidates are
possibilities, not authoritative answers.

ARTICLE BYLINE
${(article.authors ?? []).join(", ") || "Not supplied"}

ASSERTION PACKETS
${packets.map(attributionPacket).join("\n\n")}`,
    responseSchema: cf2AttributionSchema(candidateIds),
  };
}
