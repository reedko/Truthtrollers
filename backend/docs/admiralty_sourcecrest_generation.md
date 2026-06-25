# SourceCrest / Admiralty Code Generation

This describes how the current code generates the Admiralty code shown in `SourceCrest`.

An Admiralty code has two parts:

```text
<source reliability letter><claim credibility number>
```

Examples:

```text
BØ
D4
ØØ
```

## Meaning

### Source Reliability Letter

The first character rates the source or publisher.

| Letter | Meaning |
| --- | --- |
| A | Highly reliable source |
| B | Usually reliable source |
| C | Mixed / context-dependent source |
| D | Questionable source |
| E | Unreliable source |
| Ø | Not yet assessed / insufficient source signal |

### Claim Credibility Number

The second character rates evidence for a specific claim.

| Number | Meaning |
| --- | --- |
| 1 | Confirmed by authoritative evidence |
| 2 | Probably true |
| 3 | Possibly true / needs corroboration |
| 4 | Doubtful / contested |
| 5 | Probably false |
| Ø | Claim not yet assessed |

For publisher-level SourceCrests, the number is usually `Ø` because the publisher lookup is about source reliability, not a specific claim.

## High-Level Flow

```text
Publisher enrichment
  -> provider lookups
  -> publisher_profiles / publisher_ratings rows
  -> evaluateAdmiraltyCode()
  -> admiralty_evaluations row
  -> SourceCrest displays admiralty_code
```

The main code paths are:

- `backend/src/services/publisherEnrichmentService.js`
- `backend/services/admiraltyEvaluator.js`
- `dashboard/src/components/SourceCrest.tsx`

## Provider Inputs

### Ad Fontes

The enrichment service searches Ad Fontes pages and extracts:

- `rating_label`
- `bias_score`
- `reliability_score`
- evidence quote / notes

If `reliability_score` is present, it is stored as a publisher rating with:

```text
source = "Ad Fontes"
rating_type = "reliability"
veracity_score = reliability_score
```

During Admiralty evaluation, Ad Fontes also contributes a normalized reliability bucket:

```text
>= 60 -> high
>= 40 -> medium
>= 30 -> mixed
< 30 -> low
```

Effect on the SourceCrest letter:

- High Ad Fontes reliability can improve a `C` source to `B`.
- Low Ad Fontes reliability can downgrade `A/B` to `C`, or `C` to `D`.
- The numeric `veracity_score` can also move the letter:
  - `>= 80`: can lift `C/D` toward `B`.
  - `>= 70`: can lift `C` to `B` or `D` to `C`.
  - `< 40`: can downgrade `A/B` to `C`, or `C` to `D`.
  - `< 25`: becomes `E`.

### SCImago

SCImago is used for academic journals.

The service calls:

```text
https://www.scimagojr.com/journalsearch.php
```

It extracts:

- journal title
- SJR score
- H-index
- country
- subject areas
- best quartile

SCImago quartiles map to `veracity_score` like this:

| Quartile | Stored veracity score |
| --- | --- |
| Q1 | 88 |
| Q2 | 72 |
| Q3 | 55 |
| Q4 | 40 |

The profile is also stored with:

```text
source_type = "academic"
```

Effect on the SourceCrest letter:

- Academic source type starts from a `B` base letter.
- Q1/Q2 scores usually keep or support a strong source letter.
- Q3/Q4 are still academic signals, but weaker.

### AllSides

AllSides currently contributes **bias**, not reliability.

The service extracts:

- bias label
- mapped numeric bias score

Mapping:

| AllSides label | Bias score |
| --- | --- |
| Left | -100 |
| Lean Left | -50 |
| Center | 0 |
| Lean Right | 50 |
| Right | 100 |

Stored as:

```text
source = "AllSides"
rating_type = "bias"
bias_score = ...
veracity_score = null
```

Current effect on SourceCrest:

- It helps show that the publisher was found by a known provider.
- It can increase evaluation confidence because provider matches exist.
- It does **not** directly improve or downgrade the reliability letter, because the current evaluator does not treat political bias as reliability.

That is intentional for now. Bias and reliability are different signals.

### Wikipedia

Wikipedia is used as a profile and reliability-context source.

The service searches for a matching Wikipedia page, fetches the page text, and asks the LLM to extract:

- publisher name
- description
- source type
- country
- ownership notes
- funding notes
- credibility notes
- political notes
- evidence quote
- reliability score, if justified by the page

Stored as:

```text
publisher_profiles.source = "Wikipedia"
publisher_ratings.source = "Wikipedia"
publisher_ratings.rating_type = "veracity"
publisher_ratings.veracity_score = ...
```

Wikipedia scoring works two ways:

1. If the LLM extracts a `reliability_score` from the page context, that score is used.
2. If no LLM score is available, `deriveScoreFromProfile()` may infer a score from stored credibility notes and source type.

Examples from `deriveScoreFromProfile()`:

| Signal | Score |
| --- | --- |
| Explicit disinformation / fake news / propaganda | 20 |
| Retractions / misconduct / rigor concerns | 38 |
| Partisan / advocacy / lobbying / industry-funded | 50 |
| Award-winning / trusted / respected / recognized for accuracy | 72-78 |
| Government / academic / scientific institution | 70-76 |
| Nonprofit / NGO / charity / foundation | 58 |
| Trade association / industry group / lobby | 44 |

Effect on SourceCrest:

- Wikipedia profile/source type can help identify the publisher.
- Wikipedia-derived `veracity_score` can move the source reliability letter.
- Wikipedia profile presence alone does not automatically make a source reliable.

### Wikidata

Wikidata has now been added to publisher enrichment.

The existing provider uses the public Wikidata SPARQL endpoint:

```text
https://query.wikidata.org/sparql
```

It looks up the publisher by official website domain using common URI variants:

```text
https://domain
http://domain
https://www.domain
http://www.domain
```

It extracts:

- Wikidata entity label
- Wikidata entity URL
- country
- instance/source type when available

Stored as:

```text
publisher_profiles.source = "Wikidata"
publisher_profiles.source_type = ...
publisher_profiles.country = ...
```

Current effect on SourceCrest:

- Helps identify the publisher.
- Helps set source type, such as journalism, academic, government, or advocacy.
- Helps avoid `Ø` when the system has identity but weak page scraping.
- Does **not** create a reliability score by itself.

That last point matters: Wikidata is an identity/profile database, not a reliability ratings provider.

## How Provider Rows Become the Letter

The Admiralty evaluator receives:

```js
existingSourceRatings
providerResults
sourceIdentity
sourceLineage
```

It builds `sourceSignals`, including:

```text
sourceType
resolutionLevel
lineageType
sourceDepth
publicationContext
veracityScore
mbfcReliability
adfontesReliability
allsidesFound
wikipediaFound
wikidataFound
```

Then `deriveSourceLetter()` calculates the letter.

### Base Letter By Source Type

| Source type | Base letter |
| --- | --- |
| primary | A |
| government | B |
| academic | B |
| journalism | B |
| reference | B |
| corporate | C |
| opinion | C |
| advocacy | D |
| social | D |
| platform | D |
| unknown | Ø |

### Important Rule

The evaluator currently requires a real reliability signal before assigning a non-`Ø` letter.

Identity/profile data can identify a source, but it is not automatically a rating.

In code:

```text
If there is no veracity score, MBFC reliability, Ad Fontes reliability, or OpenSources flag:
  return Ø
```

This means:

- Wikipedia/Wikidata identity alone should not produce `B`.
- AllSides bias alone should not produce `B`.
- A source type like `journalism` alone should not produce `B`.
- A reliability score or reliability provider signal is needed.

## How The Number Is Generated

The number comes from claim-level evidence, not publisher enrichment.

Inputs include:

```text
Google Fact Check matches
supporting evidence count
refuting evidence count
primary source count
authoritative source count
scientific consensus match
```

Rules:

- No claim evidence -> `Ø`
- Google Fact Check false / misleading / debunked -> `5`
- Google Fact Check true / correct / confirmed -> `2`
- Mixed / partial ratings -> `3`
- Strong primary or authoritative sources can improve to `2`
- Scientific consensus can improve to `1`
- Refuting evidence can push to `4`

For publisher-level SourceCrests, this usually remains:

```text
Ø
```

## Examples

### Wikipedia Foundation Type Case

If Wikipedia says:

```text
The foundation is a 501(c)(3) charity and has received high ratings from Charity Navigator.
```

Current expected behavior:

1. Wikipedia profile should store:
   - source type: nonprofit / foundation / corporate fallback
   - credibility notes mentioning high Charity Navigator ratings
2. Wikipedia-derived reliability score should be created if extraction catches the credibility signal.
3. Admiralty should use that veracity score to generate a non-`Ø` source letter.

If it still produces `ØØ`, likely failures are:

- Wikipedia profile was stored but no `publisher_ratings` veracity score was created.
- The Wikipedia extraction did not capture the Charity Navigator sentence as a credibility signal.
- The publisher SourceCrest is using an older cached `ØØ` machine evaluation.
- The source is displaying a content-level code with no content evaluation instead of the publisher cached code.

### AllSides-Only Case

If the only match is:

```text
AllSides: Lean Left
```

Expected SourceCrest:

```text
ØØ or cached prior code
```

Reason:

AllSides bias is not reliability.

### SCImago Q1 Journal

If SCImago returns:

```text
Q1
```

Expected behavior:

```text
source_type = academic
veracity_score = 88
source letter likely B
number usually Ø unless claim-level evidence exists
```

Likely code:

```text
BØ
```

## Current Design Caveats

1. The SourceCrest letter is only as good as the stored provider rows.
2. Wikipedia and Wikidata can identify a publisher, but reliability still depends on extracted scores or explicit rating signals.
3. AllSides is intentionally not treated as reliability.
4. Wikidata is useful for identity and source type, but it should not be used as a reliability score by itself.
5. Publisher-level SourceCrests usually have `Ø` as the second character because there is no specific claim being assessed.
