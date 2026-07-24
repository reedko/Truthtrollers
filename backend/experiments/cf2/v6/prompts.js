import { buildCf2DiscoveryPrompt } from "../prompts.js";
import {
  cf2V6DecompositionSchema,
  cf2V6EvidenceAnchorSchema,
} from "./schemas.js";

export function buildCf2V6DiscoveryPrompt({
  article,
  sourceUnits,
  candidateMaximum = 18,
}) {
  const baseline = buildCf2DiscoveryPrompt({ article, sourceUnits });
  if (candidateMaximum === 18) return baseline;
  const responseSchema = structuredClone(baseline.responseSchema);
  responseSchema.name = `cf2_fact_docket_discovery_v1_c${candidateMaximum}`;
  responseSchema.schema.properties.candidates.maxItems = candidateMaximum;
  return {
    ...baseline,
    user: baseline.user.replace(
      "no more than 18 candidate assertions",
      `no more than ${candidateMaximum} candidate assertions`,
    ),
    responseSchema,
  };
}

const metadata = (article) => [
  `Title: ${article.title}`,
  `Byline: ${(article.authors ?? []).join(", ") || "Not supplied"}`,
  `Publisher: ${article.publisher ?? "Not supplied"}`,
  `Published: ${article.publishedAt ?? "Not supplied"}`,
].join("\n");

function candidatePacket(candidate) {
  return `CANDIDATE ${candidate.candidateId}
Source-preserving assertion: ${candidate.rawAssertion}
Grounding: ${candidate.groundingUnitIds.join(", ")}
Host-detected explicit attribution cues: ${JSON.stringify(candidate.attributionCues ?? [])}
Local article units:
${candidate.contextUnits.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n")}`;
}

export function buildCf2V6DecompositionPrompt({
  article,
  thesisAssertion,
  candidates,
  candidateMaximum = 18,
}) {
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  return {
    system: `You separate factual content from its attribution structure.

Use only the supplied article units. Preserve polarity. Do not fact-check, search,
rank, select, or add assertions. Return one result for every candidate ID.`,
    user: `Process each candidate independently and in candidate-ID order.

1. attributionLayers
Identify explicit attribution or evidential frames that enclose another factual
assertion. Examples of attribution predicates include said, claimed, reported,
revealed, alleged, found, concluded, stated, and denied.

For each layer return:
- supplierName: the explicit person, institution, study, or document supplying the
  embedded content;
- supplierKind;
- operator: said, claimed, reported, revealed, alleged, found, concluded, stated,
  denied, wrote, testified, announced, declared, proved, showed, demonstrated, or
  according_to;
- assertedContent: the content that supplier asserts, with the predicate's polarity
  preserved;
- sourceUnitIds: units supporting both the supplier and this attribution relation.

List layers from outermost to innermost. Do not add the article byline as a layer.
Return an empty array when the candidate is supplied directly by article voice and
contains no explicit attribution frame.

Only the listed reporting/evidential operators open an attribution layer. Ordinary
events such as ordered, changed, destroyed, manipulated, caused, and increased are
substantive content, not attribution operators. The operator must be explicitly
present in a sourceUnitId supplied for that layer; never invent an operator to create
a layer.

Host-detected explicit attribution cues are literal syntactic observations, not semantic
answers. Every supplied cue must be represented by an attribution layer using its
operator and source units. Resolve the final assertedContent and supplier name from the
article context; do not discard a cue merely because the source-preserving assertion
could also be read as a single event.

For nested attribution, unwrap each layer:
"Publication P reports that Witness W says Agency A altered records."
has an outer P/reports layer and an inner W/says layer. The innermost asserted content
is "Agency A altered records."

Preserve negation and operator meaning:
"Agency A denied that Treatment T causes harm" means Agency A asserts that Treatment T
does not cause harm. Do not return the positive proposition as Agency A's assertion.

2. substantiveAssertion
Return the deepest independently verifiable factual content reached through those
attribution layers. Remove frames such as "X said," "according to X," and "X revealed."
When attributionLayers is nonempty, substantiveAssertion must equal assertedContent
from the final layer. When it is empty, return the candidate's directly asserted
factual content.

The final substantiveAssertion must stand alone. Resolve anaphora such as "it had
proved P" to P when the supplied units establish that "it" is the enclosing study or
document. Do not begin the final assertion with an unresolved it, they, he, she, this,
that, these, or those.

3. groundingUnitIds
Return units grounding substantiveAssertion itself. These may differ from the units
that establish its supplier.

4. articleTreatment
- adopted: the article uses the substantive assertion as part of its own case;
- challenged: the article introduces it to dispute, reject, or discredit it;
- reported: the article reports it without clearly adopting or challenging it.

5. effectIfTrue
Assume substantiveAssertion is true and compare only that assertion with the thesis.
- strengthens: makes the thesis more credible;
- weakens: makes the thesis less credible;
- no_effect: has no material effect.
Ignore supplier identity and presumed real-world truth for this judgment.

THESIS ASSERTION
${thesisAssertion}

ARTICLE METADATA
${metadata(article)}

CANDIDATES
${candidates.map(candidatePacket).join("\n\n")}`,
    responseSchema: cf2V6DecompositionSchema(candidateIds, candidateMaximum),
  };
}

function anchorPacket(packet, assertion) {
  return `ASSERTION ${assertion.candidateId}
Frozen substantive assertion: ${assertion.assertionText}
Locked supplier: ${assertion.sourceName ?? "unknown"} (${assertion.sourceKind})
Supplier units: ${assertion.sourceUnitIds.join(", ") || "none"}
Source candidates and structural diagnostics: ${JSON.stringify(packet.sourceCandidates)}
Relevant article units:
${packet.contextUnits.map((unit) => `[${unit.unitId}] ${unit.text}`).join("\n")}`;
}

export function buildCf2V6EvidenceAnchorPrompt({ article, packets, assertions }) {
  const candidateIds = assertions.map((assertion) => assertion.candidateId);
  const packetById = new Map(packets.map((packet) => [packet.candidateId, packet]));
  return {
    system: `You identify named evidence anchors for frozen factual assertions.

Use only the supplied packets. Do not rewrite assertions, change suppliers, judge
stance, rank, select, or fact-check.`,
    user: `Return one item for every assertion ID in order.

The assertion and supplier are locked. Do not return or reconsider them.

evidenceAnchors:
- List only named studies, documents, datasets, regulations, or other identifiable
  works that the supplied units connect to the assertion and that could anchor an
  evidence search.
- Do not list the article byline or assertion supplier merely because it is a supplier.
- Return an empty array when no named evidence anchor is present.
- Every name and unit ID must occur in the supplied packet.

ARTICLE BYLINE
${(article.authors ?? []).join(", ") || "Not supplied"}

ASSERTION PACKETS
${assertions.map((assertion) =>
    anchorPacket(packetById.get(assertion.candidateId), assertion)).join("\n\n")}`,
    responseSchema: cf2V6EvidenceAnchorSchema(candidateIds),
  };
}
