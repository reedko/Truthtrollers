import {
  CF1_ARTICLE_ROLES, CF1_ARTICLE_STANCES, CF1_ARTICLE_USES, CF1_ASSERTION_FORMS,
  CF1_CLUSTER_RELATIONSHIPS, CF1_CONSISTENCY_RESOLUTIONS, CF1_CONSISTENCY_TYPES,
  CF1_EVIDENCE_ROLES, CF1_MAPPING_STATUSES, CF1_MATERIALITY, CF1_PILLAR_IMPORTANCE,
  CF1_RECONCILIATION_RELATIONSHIPS, CF1_SCORE_TRANSFORMS, CF1_SELECTION_RELEVANCE,
  CF1_SEMANTIC_FUNCTIONS, CF1_TARGET_TYPES,
} from "../contract.js";
import { CF1_AGENT_DRAFT_SCHEMA } from "./agentDraftSchema.js";

const values = (items) => items.join(" | ");

function renderBlock(block, units) {
  return JSON.stringify({ blockId: block.blockId, order: block.order, heading: block.heading,
    structuralType: block.structuralType,
    sourceUnits: (block.sourceUnitIds ?? []).map((unitId) => units.get(unitId)).filter(Boolean)
      .map(({ unitId, text }) => ({ unitId, text })) });
}

export function buildPrimaryPrompt({ article, structuralBlocks, sourceUnits = [] }) {
  const units = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  const system = `You are Claim Foundry CF1. Analyze only the supplied article.
Your job is to produce a coherent, evidence-ready claim package draft, not to judge truth.
Never browse, search, fetch, or add outside facts. Never invent a study, identifier, quotation, speaker, source, or article position.
Preserve attribution, uncertainty, scope, time, population, comparison, and causal strength.
The deterministic host owns source text, offsets, canonical IDs, hashes, verification, persistence, and execution state.`;

  const user = `Analyze the article as one argument. Return only the requested structured object.

ARTICLE METADATA
Title: ${article.title}
Publisher: ${article.publisher ?? "unknown"}
Authors: ${article.authors.length ? article.authors.join("; ") : "unknown"}
Published: ${article.publishedAt ?? "unknown"}
Language: ${article.language ?? "unknown"}

SOURCE BLOCKS
${structuralBlocks.map((block) => renderBlock(block, units)).join("\n\n")}

TASK
1. Annotate only source blocks that materially contribute to the theme, thesis, pillars, selected claims, qualifications, or internal consistency. The host retains and conservatively defaults omitted structural blocks.
2. Build a bounded raw assertion inventory. Preserve repeated occurrences and reconcile them explicitly.
3. State the article theme, its actual thesis, load-bearing pillars, claim clusters, opposing positions, and qualifications.
4. If no defensible thesis exists, say so explicitly in thesis.text, use grounded empty references where necessary, warn in mapWarnings, and do not invent an argument.
5. Identify material internal consistency findings across semantic blocks. Distinguish genuine conflict from nuance resolved by context.
6. Select compelling claims whose support, refutation, qualification, or unresolved status would materially change the article's central case. Make wording immediately legible: the proposition, attribution, qualifiers, and what could bear on it must be clear.
7. Aim for 8–12 selected claims only when the article supports that many. If you select fewer than 8 or more than 12, selectionCountException MUST be a non-empty explanation; otherwise it MUST be null.
8. Create evidence-facing Phase 3 targets only from selected claims. Do not target raw assertions directly.
9. Create exactly one Evidence Need Card per target. Query seeds are research instructions only; do not claim that a source was found.
10. Copy only identifiers and named works present in the supplied article. Use no discovered URLs.

ID AND GROUNDING RULES
- Reuse the supplied B### block IDs exactly.
- Create unique temporary IDs for assertions, pillars, clusters, findings, selected claims, and targets.
- Every raw assertion must cite one or more supplied U#### sourceUnitIds in document order.
- Selected claims and targets cite raw assertion IDs; the host inherits their unit, block, span, excerpt, and offset provenance.
- Every reference must resolve to a supplied block/unit ID or a temporary ID in this response.
- Do not output source offsets, package/run IDs, hashes, timestamps, verification, telemetry, or persistence fields.

ENUMS
semanticFunction: ${values(CF1_SEMANTIC_FUNCTIONS)}
articleStance: ${values(CF1_ARTICLE_STANCES)}
assertionForm: ${values(CF1_ASSERTION_FORMS)}
articleUse: ${values(CF1_ARTICLE_USES)}
reconciliation.relationship: ${values(CF1_RECONCILIATION_RELATIONSHIPS)}
pillar.importance: ${values(CF1_PILLAR_IMPORTANCE)}
cluster.relationship: ${values(CF1_CLUSTER_RELATIONSHIPS)}
consistency.type: ${values(CF1_CONSISTENCY_TYPES)}
consistency.materiality and claim.materiality: ${values(CF1_MATERIALITY)}
consistency.resolution: ${values(CF1_CONSISTENCY_RESOLUTIONS)}
consistency.selectionRelevance: ${values(CF1_SELECTION_RELEVANCE)}
selectedClaim.articleRole: ${values(CF1_ARTICLE_ROLES)}
target.targetType: ${values(CF1_TARGET_TYPES)}
scoreTransform: ${values(CF1_SCORE_TRANSFORMS)}
target.mappingStatus: ${values(CF1_MAPPING_STATUSES)}
card.evidenceRolesNeeded: ${values(CF1_EVIDENCE_ROLES)}

POSTURE RULES
- article_endorsed_substantive normally uses normal and is verdict eligible.
- opponent_substantive normally uses invert and is verdict eligible.
- attribution_provenance and source_identity use none and are not verdict eligible.
- unresolved targets are not verdict eligible.
- Searchable non-weak substantive cards require concrete mustMatch and rejectIfOnly criteria.`;

  return { system, user, responseSchema: CF1_AGENT_DRAFT_SCHEMA };
}
