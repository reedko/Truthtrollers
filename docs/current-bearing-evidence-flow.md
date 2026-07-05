# Current Claim Extraction and Bearing Evidence Flow

## Important distinction

The current system does **not** use bearing to detect case claims.

Case-claim extraction happens first. Bearing is used later to decide which
retrieved sources and source assertions address those already-extracted claims.
If case extraction omits a proposition, bearing never searches for it.

## Current flow

1. **Extract page text.** The scraper produces the case document text.
2. **Extract case claims with an LLM.** `ClaimExtractor` loads the active claim
   extraction prompt and `max_claims` from the database. It asks for a reasoning
   stack containing a thesis, pillars, supporting/evidence claims, and background
   claims. The result is deduplicated and capped.
3. **Persist and characterize claims.** Claims are assigned roles and attribution
   claims may be separated into attribution text and an object proposition.
4. **Create evaluation targets.** A visible claim may receive attribution,
   substantive, inference, and study-identity targets.
5. **Generate evidence queries.** Existing target queries, LLM-generated queries,
   and deterministic anchored queries are combined into support, refute, and
   nuance lanes.
6. **Retrieve candidates.** Enabled search providers return URLs, titles, and
   snippets. Results are merged and URL-deduplicated.
7. **Estimate pre-scrape bearing.** A deterministic scorer and, when available,
   the snippet-bearing LLM score candidates against the evaluation target.
8. **Rank and scrape candidates.** The adaptive loop processes candidates until
   its source/attempt limits or bearing-success condition is reached.
9. **Extract source assertions.** Successfully fetched content is evaluated
   against the assigned target. Quotes receive stance and post-scrape bearing.
10. **Build and persist the evidence packet.** Accepted source assertions become
    claim links. Failed fetches with useful snippets may become provisional
    document-level links.

## Thompson claim in content 16498

The case extractor produced this substantive claim:

> Data linking the MMR vaccine to autism had been manipulated by the CDC.

It did **not** preserve “CDC officials ordered scientists to destroy evidence” as
a separate atomic claim. Consequently, no query pack was generated specifically
for destruction of data or evidence.

The broader manipulation claim received these nine queries:

1. `data linking the MMR vaccine to autism had been manipulated by the CDC.`
2. `CDC Statement: 2004 MMR and Autism Study | Vaccine Safety | CDC data linking the MMR vaccine to autism had been manipulated by the CDC.`
3. `William Thompson MMR vaccine autism manipulation CDC`
4. `data manipulation MMR vaccine autism CDC 2004 study`
5. `CDC Statement: 2004 MMR and Autism Study data manipulation`
6. `CDC MMR vaccine autism study integrity`
7. `2004 MMR vaccine autism study CDC findings`
8. `response William Thompson mmr cdc data statement`
9. `response William Thompson CDC Statement: 2004 MMR and Autism Study | Vaccine Safety | CDC 2016 mmr cdc data`

These queries found the CDC study page, PubMed record, and Hooker reanalysis.
The exact study was subsequently ranked out or inadequately evaluated; that is a
retrieval-selection problem distinct from the earlier extraction omission.

## Why the destroyed-data claim disappeared

Claude's citation-queue repair did not change the case-extraction prompt. The
loss can nevertheless occur because the LLM extraction is selective and somewhat
variable, its output is capped, and related allegations can be collapsed into a
broader proposition during extraction/deduplication. Here, “manipulated” absorbed
but did not faithfully preserve the separately testable allegation that officials
ordered evidence destroyed.

The same risk applies to an allegation such as:

> *Vaxxed* was removed from the Tribeca Film Festival because of pharmaceutical
> industry pressure.

Unless that proposition survives case extraction as an atomic, source-grounded
claim, the bearing pipeline cannot recover it later.

