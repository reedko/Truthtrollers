import { CF1_AGENT_DRAFT_SCHEMA } from "./agentDraftSchema.js";
import {
  CF1_ARTICLE_ROLES, CF1_ARTICLE_STANCES, CF1_ARTICLE_USES, CF1_ASSERTION_FORMS,
  CF1_CLUSTER_RELATIONSHIPS, CF1_CONSISTENCY_RESOLUTIONS, CF1_CONSISTENCY_TYPES,
  CF1_EVIDENCE_ROLES, CF1_MAPPING_STATUSES, CF1_MATERIALITY, CF1_PILLAR_IMPORTANCE,
  CF1_RECONCILIATION_RELATIONSHIPS, CF1_SCORE_TRANSFORMS, CF1_SELECTION_RELEVANCE,
  CF1_SEMANTIC_FUNCTIONS, CF1_TARGET_TYPES,
} from "../contract.js";

const values = (items) => items.join(" | ");

export function buildSynthesisPrompt({ article, observations }) {
  const system = `You are Claim Foundry CF1 performing the single whole-article synthesis for a long article.
Use only the supplied compact observations and their source-unit grounding. Do not browse, search, fetch, add outside facts, or judge truth.
Resolve the article's global meaning, attribution, pillars, internal consistency, compelling selected claims, evidence-facing targets, and Evidence Need Cards.`;
  const user = `ARTICLE METADATA
Title: ${article.title}
Publisher: ${article.publisher ?? "unknown"}
Authors: ${article.authors.length ? article.authors.join("; ") : "unknown"}
Published: ${article.publishedAt ?? "unknown"}

BATCH OBSERVATIONS
${JSON.stringify(observations)}

Produce the complete CF1AgentDraft used by the normal path.

Requirements:
- Annotate every original block exactly once using its supplied B### ID.
- Reconcile batch-local candidate IDs into unique response-local raw assertion IDs.
- Build one global theme, the actual thesis or an explicit grounded absence, material pillars, clusters, opponents, and qualifications.
- Examine cross-batch internal consistency, including late assertions that qualify or conflict with earlier ones.
- Select claims by material bearing on the article's central case, not by batch quota or article order.
- Preserve sourceUnitIds from observations; never invent or substitute a unit ID.
- Create Phase 3 targets only for selected claims and exactly one Evidence Need Card per target.
- Aim for 8–12 selected claims only when supported. Otherwise explain the lower or higher count in selectionCountException.
- Use unique temporary IDs and ensure every reference resolves inside this response.
- Do not output offsets, package/run IDs, hashes, timestamps, verification, telemetry, or persistence fields.

ENUMS
semanticFunction: ${values(CF1_SEMANTIC_FUNCTIONS)}
articleStance: ${values(CF1_ARTICLE_STANCES)}
assertionForm: ${values(CF1_ASSERTION_FORMS)}
articleUse: ${values(CF1_ARTICLE_USES)}
reconciliation.relationship: ${values(CF1_RECONCILIATION_RELATIONSHIPS)}
pillar.importance: ${values(CF1_PILLAR_IMPORTANCE)}
cluster.relationship: ${values(CF1_CLUSTER_RELATIONSHIPS)}
consistency.type: ${values(CF1_CONSISTENCY_TYPES)}
materiality: ${values(CF1_MATERIALITY)}
consistency.resolution: ${values(CF1_CONSISTENCY_RESOLUTIONS)}
consistency.selectionRelevance: ${values(CF1_SELECTION_RELEVANCE)}
selectedClaim.articleRole: ${values(CF1_ARTICLE_ROLES)}
target.targetType: ${values(CF1_TARGET_TYPES)}
scoreTransform: ${values(CF1_SCORE_TRANSFORMS)}
target.mappingStatus: ${values(CF1_MAPPING_STATUSES)}
card.evidenceRolesNeeded: ${values(CF1_EVIDENCE_ROLES)}

POSTURE
Endorsed substantive targets use normal; opponent substantive targets use invert. Attribution/source identity targets use none and are not verdict eligible. Unresolved targets are not verdict eligible.`;
  return { system, user, responseSchema: CF1_AGENT_DRAFT_SCHEMA };
}
