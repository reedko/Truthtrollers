# Claim hinge packet and bearing gate design

This design is not wired into live retrieval in this pass. It supports the
review/gating projection export without changing candidate ordering, scraping,
legacy matching, or persistence.

## Claim hinge packet

Before query generation, derive one bounded packet per case claim:

- `case_claim_text`
- `claim_type`: definition, incidence statistic, causal claim, quoted speech,
  existence claim, comparison claim, medical guidance claim, institutional
  action claim, or other
- `disputed_hinge`: the proposition a source must address
- `required_terms`: object, relation, number, named entity, and material qualifiers
- `forbidden_standalone_terms`: function words and misleading fragments such as
  `each`, `there`, `little`, `most`, and `known`
- `acceptable_source_types`: source classes appropriate to the claim type

The packet should constrain query generation before search. A generated query
must contain the disputed object or a recognized synonym and must never consist
only of a forbidden standalone term.

## Pre-search hook

The existing query-generation output already carries `query`, `stanceGoal`,
`evidenceTargetType`, and `bearingRequirement`. The future live hook belongs
between query generation and `EvidenceEngine.retrieveCandidates`.

It should:

1. reject empty, generic, and forbidden-fragment queries;
2. require the claim object, named entity, or statistic;
3. preserve support/refute/nuance diversity;
4. return the remaining queries in their original order;
5. log rejected queries and reasons without silently rewriting prompts.

## Pre-scrape hook

The existing snippet-bearing scorer and candidate selector are the appropriate
hook. Before enabling it live:

1. deterministic rules reject only obvious wrong-sense entertainment,
   inappropriate dictionary pages, and candidates missing the disputed object;
2. clear passes proceed without an extra model call;
3. ambiguous candidates are assessed in one bounded snippet batch per claim;
4. protected primary/origin sources and high scorer disagreement remain eligible;
5. canonical grouping remains auditable and does not erase retrieval provenance;
6. candidate order is unchanged until the selector explicitly allocates live work.

## Projection discipline

The export counts savings only when an obvious reject was actually scraped in
the shadow run. It does not treat cap exclusions, duplicates, or every unselected
candidate as saved work. Projected token avoidance is capped conservatively and
includes the estimated cost of snippet-level `needs_llm` batches.
