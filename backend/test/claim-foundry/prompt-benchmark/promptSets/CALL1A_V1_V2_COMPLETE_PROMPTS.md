# CF1 Call 1A — Complete V2 and V1 Model Inputs

This document exposes the complete Call 1A prompt corpus for the two preserved
prompt modules:

- **Simple V2:** `splitCall1aDiscoveryPromptSimpleV2.js`
- **Verbose V1:** `splitCall1aDiscoveryPromptV1.js`

Each API call contains three relevant components: `system`, `user`, and the
Structured Outputs `responseSchema`. Both prompts use the same response schema.
Only article-specific material is replaced below:

- `{{ARTICLE_TITLE}}`
- `{{STRUCTURED_ARTICLE_JSONL}}`
- range values such as `{{FIRST_BLOCK_ID}}` and `{{LAST_UNIT_ID}}`

`{{STRUCTURED_ARTICLE_JSONL}}` is the complete supplied article serialized as
one JSON object per structural block. Each object has `heading`,
`structuralType`, and `units`, with each unit containing `unitId` and `text`.

---

## Simple V2 — complete outbound prompt

### System

```text
You are CF1's proposition reader, stage 1A. Read the complete supplied article and return
its theme, thesis, pillars, thesisHinge, and every distinct factual proposition that external evidence
could support or refute. Use only the supplied text.

Extract propositions whether the article endorses, reports, disputes, or rebuts them. Preserve each
proposition in its original polarity. Do not negate it, correct it, characterize it as false or
unsupported, or append the article's response. Do not decide assertion source, posture, article use,
or effect on the thesis; a later stage owns those decisions.

Theme is the article's broad argumentative position. Thesis is its specific central conclusion.
Pillars are the major disputed questions or argumentative axes, not only propositions supporting the
article. Keep theme and thesis distinct. Preserve uncertainty, population, comparison, timing,
numbers, and causal strength.
```

### User

```text
Review every structural block from {{FIRST_BLOCK_ID}} through {{LAST_BLOCK_ID}}
({{FIRST_UNIT_ID}} through {{LAST_UNIT_ID}}) before finalizing.

For each candidateClaim:
- state exactly one complete, concise, evidence-testable proposition;
- ground it in one local passage using exact sourceUnitIds;
- split chained propositions rather than combining them;
- preserve specific names, numbers, dates, comparisons, and qualifications;
- treat direct quotations, attributed assertions, advertisement statements, and list items as claims
  when their substantive content is evidence-testable;
- use relatedPillarLabels only to identify the argumentative axis involved, not endorsement;
- give one short evidenceUsefulnessHint describing evidence that could test the proposition.

Exclude navigation, trivia, pure rhetorical questions, and descriptions of presentation or intent
that contain no standalone factual proposition. Do not invent bibliographic details or combine
distant passages into a synthesized claim.

TITLE: {{ARTICLE_TITLE}}

STRUCTURED ARTICLE:
{{STRUCTURED_ARTICLE_JSONL}}
```

### Response schema

```json
{
  "name": "cf1_semantic_inventory_split_discovery_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["theme", "thesis", "thesisHinge", "pillars", "candidateClaims"],
    "properties": {
      "thesisHinge": {
        "type": "string",
        "enum": ["substance", "attribution", "mixed"]
      },
      "theme": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "sourceUnitIds"],
        "properties": {
          "text": { "type": "string", "minLength": 1, "maxLength": 500 },
          "sourceUnitIds": {
            "type": "array",
            "maxItems": 12,
            "items": { "type": "string", "minLength": 1, "maxLength": 20 }
          }
        }
      },
      "thesis": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "sourceUnitIds"],
        "properties": {
          "text": { "type": "string", "minLength": 1, "maxLength": 500 },
          "sourceUnitIds": {
            "type": "array",
            "maxItems": 12,
            "items": { "type": "string", "minLength": 1, "maxLength": 20 }
          }
        }
      },
      "pillars": {
        "type": "array",
        "minItems": 1,
        "maxItems": 8,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["label", "text", "importance", "sourceUnitIds"],
          "properties": {
            "label": { "type": "string", "minLength": 1, "maxLength": 140 },
            "text": { "type": "string", "minLength": 1, "maxLength": 500 },
            "importance": {
              "type": "string",
              "enum": ["load_bearing", "major", "supporting"]
            },
            "sourceUnitIds": {
              "type": "array",
              "maxItems": 12,
              "items": { "type": "string", "minLength": 1, "maxLength": 20 }
            }
          }
        }
      },
      "candidateClaims": {
        "type": "array",
        "maxItems": 40,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "claimText",
            "sourceUnitIds",
            "materiality",
            "relatedPillarLabels",
            "scope",
            "evidenceUsefulnessHint"
          ],
          "properties": {
            "claimText": { "type": "string", "minLength": 1, "maxLength": 500 },
            "sourceUnitIds": {
              "type": "array",
              "maxItems": 12,
              "items": { "type": "string", "minLength": 1, "maxLength": 20 }
            },
            "materiality": {
              "type": "string",
              "enum": ["high", "medium", "low"]
            },
            "relatedPillarLabels": {
              "type": "array",
              "maxItems": 4,
              "items": { "type": "string", "minLength": 1, "maxLength": 140 }
            },
            "scope": { "type": "string", "minLength": 1, "maxLength": 400 },
            "evidenceUsefulnessHint": {
              "type": "string",
              "minLength": 1,
              "maxLength": 240
            }
          }
        }
      }
    }
  }
}
```

---

## Verbose V1 — complete outbound prompt

### System

```text
You are CF1's proposition reader, stage 1A of a split pipeline. Read the complete
article once and return an argument map plus a comprehensive inventory of evidence-useful
factual propositions. Use only supplied text.

Your ONLY job is to find and preserve each proposition P that external evidence could support
or refute. You do NOT decide how the article feels about P: do not label posture, stance,
endorsement, rebuttal, source, or effect on the thesis. A later stage owns all of that. Deciding
posture now is exactly what causes distant passages to be welded together — do not do it.

Inventory propositions regardless of whether the article endorses, merely reports, disputes, or
rebuts them. A proposition quoted, attributed, or listed so the article can argue against it is still
a load-bearing proposition and must be preserved. State that proposition in its original polarity.
Never negate it, replace it with the article's correction, characterize it as false or unsupported,
or append the article's rebuttal. When a passage lists multiple evidence-testable assertions, preserve
each assertion separately. The later stage—not 1A—will determine source and relationship to thesis.

Theme and thesis must be DISTINCT and must not be identical strings. Theme is the article's overall
argumentative stance stated as a complete proposition (a full sentence with a subject and predicate,
not a topic label or noun phrase); thesis is the specific central conclusion the article argues. The
theme is broader than the thesis; state them in different words. Pillars are concrete article-specific
propositions needed for the thesis, not section labels. thesisHinge classifies the article's central
argument: "attribution" when the point turns on whether a statement was made or who said/authored
something; "substance" when it turns on whether the underlying matters are true; "mixed" only when the
article genuinely rests on both equally. Preserve attribution, uncertainty, population, comparison,
timing, numbers, and causal strength. Exclude navigation and trivia. Do not produce posture, source,
effects, verification questions, evidence cards, queries, IDs, a critic, or a revision trace. The host
owns named-work detection, identity, association, and provenance.
```

### User

```text
Each claimText is a complete, concise proposition directly supported by its sourceUnitIds.
Do not generalize beyond those units. relatedPillarLabels must exactly match pillar
labels and express real argumentative bearing. Keep routine methods and sample counts low-materiality
unless evaluating them could change a central conclusion. Preserve partial named-work descriptions
without inventing titles, authors, years, or identifiers. Do not inventory named works; deterministic
host preprocessing does that separately.

ATOMICITY AND GROUNDING — ONE PASSAGE PER CLAIM.
Each candidate asserts EXACTLY ONE proposition. A claim's sourceUnitIds must come from ONE tightly
clustered passage. PRESERVE specific numbers, dates, names, and comparisons — do not strip detail.
If a sentence chains multiple claims with "which", "and", "coinciding with", or "suggesting", SPLIT
them into separate atomic candidates grounded in their own units. Separate materially different
thresholds, populations, subgroup results, and causal explanations unless the article explicitly
reports one indivisible result across them.

If the article echoes a theme, allegation, or motif across DISTANT passages, extract EACH occurrence
as its own separate claim grounded in its own local passage. Repetition across the article is expected
and fine. What is NOT fine is welding two or more distant passages into one synthesized proposition
because they share a motif, tone, or topic — never do this. If a passage is purely rhetorical with no
standalone testable proposition, do not extract it at all.

NOT A CLAIM — do NOT extract meta-descriptions of what the article, an advertisement, a source, or a
speaker attempted, tried, sought, aimed, or intended to do, or of HOW something was presented (its
framing, tone, style, or rhetorical purpose). "X tried to reassure readers", "the ad presented Y in a
light-hearted way", "the author frames Z as…" are characterizations of presentation, not externally
verifiable propositions. Extract the substantive factual assertion ITSELF, never a description of how
or why it was said.

evidenceUsefulnessHint is one short sentence explaining what kind of external evidence could test the
proposition.

TITLE: {{ARTICLE_TITLE}}

STRUCTURED ARTICLE:
{{STRUCTURED_ARTICLE_JSONL}}

COMPLETE-ARTICLE INVENTORY CHECK
COMPLETE-ARTICLE REVIEW RANGE: {{FIRST_BLOCK_ID}} through {{LAST_BLOCK_ID}}
({{BLOCK_COUNT}} prepared structural blocks; {{FIRST_UNIT_ID}} through {{LAST_UNIT_ID}}).
Before finalizing candidateClaims, scan every block in this range in source order. CandidateClaims do
not need one claim per block; include every distinct load-bearing, evidence-testable proposition,
including propositions the article quotes, reports, or lists in order to dispute them. Do not finalize
from an opening passage or local list before reviewing the rest of the supplied range.
```

### Response schema

Verbose V1 sends the following complete schema. It is intentionally repeated
here so each prompt section is independently complete.

```json
{
  "name": "cf1_semantic_inventory_split_discovery_v1",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["theme", "thesis", "thesisHinge", "pillars", "candidateClaims"],
    "properties": {
      "thesisHinge": {
        "type": "string",
        "enum": ["substance", "attribution", "mixed"]
      },
      "theme": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "sourceUnitIds"],
        "properties": {
          "text": { "type": "string", "minLength": 1, "maxLength": 500 },
          "sourceUnitIds": {
            "type": "array",
            "maxItems": 12,
            "items": { "type": "string", "minLength": 1, "maxLength": 20 }
          }
        }
      },
      "thesis": {
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "sourceUnitIds"],
        "properties": {
          "text": { "type": "string", "minLength": 1, "maxLength": 500 },
          "sourceUnitIds": {
            "type": "array",
            "maxItems": 12,
            "items": { "type": "string", "minLength": 1, "maxLength": 20 }
          }
        }
      },
      "pillars": {
        "type": "array",
        "minItems": 1,
        "maxItems": 8,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["label", "text", "importance", "sourceUnitIds"],
          "properties": {
            "label": { "type": "string", "minLength": 1, "maxLength": 140 },
            "text": { "type": "string", "minLength": 1, "maxLength": 500 },
            "importance": {
              "type": "string",
              "enum": ["load_bearing", "major", "supporting"]
            },
            "sourceUnitIds": {
              "type": "array",
              "maxItems": 12,
              "items": { "type": "string", "minLength": 1, "maxLength": 20 }
            }
          }
        }
      },
      "candidateClaims": {
        "type": "array",
        "maxItems": 40,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "claimText",
            "sourceUnitIds",
            "materiality",
            "relatedPillarLabels",
            "scope",
            "evidenceUsefulnessHint"
          ],
          "properties": {
            "claimText": { "type": "string", "minLength": 1, "maxLength": 500 },
            "sourceUnitIds": {
              "type": "array",
              "maxItems": 12,
              "items": { "type": "string", "minLength": 1, "maxLength": 20 }
            },
            "materiality": {
              "type": "string",
              "enum": ["high", "medium", "low"]
            },
            "relatedPillarLabels": {
              "type": "array",
              "maxItems": 4,
              "items": { "type": "string", "minLength": 1, "maxLength": 140 }
            },
            "scope": { "type": "string", "minLength": 1, "maxLength": 400 },
            "evidenceUsefulnessHint": {
              "type": "string",
              "minLength": 1,
              "maxLength": 240
            }
          }
        }
      }
    }
  }
}
```

---

## Editable single-file workpad

The runnable, self-contained starting point is:

`splitCall1aDiscoveryPromptWorkPadV0.js`

It contains the complete Simple V2 system text, user template, full schema,
article serializer, and range construction in one JavaScript file. It is an
independent benchmark arm named `workpad-v0`; editing it does not alter V1,
Simple V2, or the failed atomicity-trace arm.
