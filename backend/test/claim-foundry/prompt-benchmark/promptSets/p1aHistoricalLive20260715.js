import { serializeStructuredArticle }
  from "../../../../src/claim-foundry/prompts/semanticInventoryPrompt.js";

export const P1A_HISTORICAL_LIVE_20260715 = "P1aHistorical-live-20260715";

const strings = (maxItems = 20, maxLength = 500) => ({
  type: "array", maxItems, items: { type: "string", minLength: 1, maxLength },
});

const namedWork = {
  type: "object", additionalProperties: false,
  required: ["mentionText", "workType", "citationCallout", "source", "confidence",
    "sourceUnitIds", "linkResolved", "year", "peopleOrOrganizations", "identifiers"],
  properties: {
    mentionText: { type: "string", minLength: 1, maxLength: 500 },
    workType: { type: "string", enum: ["study_or_case_series", "cohort_study",
      "review_report", "study_group", "standard_or_manual", "law_or_policy", "dataset",
      "other_document"] },
    citationCallout: { type: ["string", "null"], maxLength: 50 },
    source: { type: "string", enum: ["text_mention"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    sourceUnitIds: strings(12, 20),
    linkResolved: { type: "boolean", enum: [false] },
    year: { type: ["integer", "null"], minimum: 1000, maximum: 2100 },
    peopleOrOrganizations: strings(8, 300),
    identifiers: strings(8, 300),
  },
};

export const P1A_HISTORICAL_LIVE_20260715_SCHEMA = Object.freeze({
  name: "cf1_semantic_inventory_v1", strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["theme", "thesis", "pillars", "namedWorks", "candidateClaims"],
    properties: {
      theme: { type: "object", additionalProperties: false,
        required: ["text", "sourceUnitIds"], properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
        } },
      thesis: { type: "object", additionalProperties: false,
        required: ["text", "sourceUnitIds"], properties: {
          text: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
        } },
      pillars: { type: "array", minItems: 1, maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["label", "text", "importance", "sourceUnitIds"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 140 },
          text: { type: "string", minLength: 1, maxLength: 500 },
          importance: { type: "string", enum: ["load_bearing", "major", "supporting"] },
          sourceUnitIds: strings(12, 20),
        },
      } },
      namedWorks: { type: "array", maxItems: 30, items: namedWork },
      candidateClaims: { type: "array", minItems: 1, maxItems: 20, items: {
        type: "object", additionalProperties: false,
        required: ["claimText", "sourceUnitIds", "articleRole", "articleUse",
          "assertionSource", "materiality", "relatedPillarLabels", "scope",
          "evidenceUsefulnessHint"],
        properties: {
          claimText: { type: "string", minLength: 1, maxLength: 500 },
          sourceUnitIds: strings(12, 20),
          articleRole: { type: "string", enum: ["thesis", "pillar", "pillar_support",
            "opponent_claim", "qualification", "consistency_hinge"] },
          articleUse: { type: "string", enum: ["endorsed", "opponent_to_rebut", "rejected",
            "reported", "background", "qualification", "unclear"] },
          assertionSource: { type: "string", minLength: 1, maxLength: 300 },
          materiality: { type: "string", enum: ["high", "medium", "low"] },
          relatedPillarLabels: strings(4, 140),
          scope: { type: "string", minLength: 1, maxLength: 400 },
          evidenceUsefulnessHint: { type: "string", minLength: 1, maxLength: 240 },
        },
      } },
    },
  },
});

export const P1A_HISTORICAL_LIVE_20260715_SYSTEM = `You are CF1's semantic reader. Read the complete article once and return a compact
argument map plus a broad inventory of evidence-useful factual claims. Use only supplied text.
Theme is the article's argumentative point; thesis is its central conclusion. Pillars are concrete
article-specific propositions needed for the thesis, not section labels. Preserve attribution,
uncertainty, population, comparison, timing, numbers, and causal strength. Include central results,
important qualifications or subgroup results, consequential explanations, opponent claims the article
rebuts, and named studies/documents it relies upon. Exclude navigation and trivia. Do not produce
verification questions, evidence cards, bearing criteria, queries, excerpts, offsets, IDs, a critic,
or a revision trace. Return namedWorks as a separate text-visible inventory; the host associates them
with claims and performs selection and exact provenance work.`;

export const P1A_HISTORICAL_LIVE_20260715_USER = `Return 16-20 candidateClaims for a full article so the host can select 8-10.
Each claim must be a complete, concise proposition directly supported by its sourceUnitIds.
Do not generalize beyond those units. relatedPillarLabels must exactly match pillar labels and express
real argumentative bearing. Keep routine methods and sample counts low-materiality unless evaluating
them could change a central conclusion. Preserve partial named-work descriptions without inventing titles,
authors, years, or identifiers. assertionSource identifies who actually supplies the assertion.
Keep evidence tasks atomic: separate materially different thresholds, populations, subgroup results, and
causal explanations unless the article explicitly reports one indivisible result across them.
Treat each distinct numeric threshold, comparison, reported result, and explanatory interpretation as a
separate candidate even when the article joins them with "and" or "or." Separate an overall distribution
finding from a modal range or percentage. Prefer claims produced by the article's own data and analysis.
Cited studies and reviews are context unless the article's argument truly depends on their result.
Independently inventory every text-visible named or described study, case series, cohort, review, report,
dataset, standard/manual, law, or policy in namedWorks, whether or not it becomes a candidate claim.
Recognize author/organization names followed by citation digits, partial descriptions such as a cohort from
a place or population, citation ranges attached to study groups, named diagnostic standards, and named laws.
mentionText must be the concise visible mention, not the current article title and not an entire assertion.
Preserve an attached citation number or range in citationCallout. Cite the exact sourceUnitIds. Set source to
text_mention and linkResolved to false; no URL or bibliography resolution is required. Do not invent formal
titles, authors, years, or identifiers that are absent from those units. Material limitations
of the article's own analysis should remain candidates; for an empirical article, include at least one
author-stated material limitation when present, ahead of routine validation methods. Do not invent or
privilege any particular limitation.
evidenceUsefulnessHint is one short sentence explaining what kind of external evidence could test it.`;

export function buildP1aHistoricalLive20260715Prompt({ article, structuralBlocks, sourceUnits }) {
  const responseSchema = structuredClone(P1A_HISTORICAL_LIVE_20260715_SCHEMA);
  if (String(article?.text ?? "").length >= 5_000) {
    responseSchema.schema.properties.candidateClaims.minItems = 16;
  }
  return {
    system: P1A_HISTORICAL_LIVE_20260715_SYSTEM,
    user: `${P1A_HISTORICAL_LIVE_20260715_USER}

TITLE: ${article.title}

STRUCTURED ARTICLE:
${serializeStructuredArticle(structuralBlocks, sourceUnits)}`,
    responseSchema,
  };
}
