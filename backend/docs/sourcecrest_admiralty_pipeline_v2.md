# SourceCrest Admiralty Pipeline v2

This document updates `backend/docs/admiralty_sourcecrest_generation.md` with the expanded provider-signal model.

## What SourceCrest Displays

SourceCrest displays an Admiralty code:

```text
<source reliability letter><claim credibility number>
```

Examples:

```text
BØ
D4
ØØ
```

The first character is the source or publisher reliability letter:

| Letter | Meaning |
| --- | --- |
| A | Highly reliable |
| B | Usually reliable |
| C | Mixed / context-dependent |
| D | Questionable |
| E | Unreliable |
| Ø | Not assessed / insufficient reliability signal |

The second character is claim-level evidence credibility:

| Number | Meaning |
| --- | --- |
| 1 | Confirmed |
| 2 | Probably true |
| 3 | Possibly true |
| 4 | Doubtful |
| 5 | Probably false |
| Ø | No claim-level assessment |

Publisher-level SourceCrests usually end in `Ø` because publisher enrichment evaluates source reliability, not a specific claim.

## Core Principle

Not every provider is a reliability provider.

Provider results are classified into one or more of these roles:

| Signal class | Meaning | Can directly change source letter? |
| --- | --- | --- |
| `direct_reliability_signal` | Provider gives factuality, credibility, journal-rank, disinformation risk, or source reliability | Yes |
| `contextual_credibility_signal` | Provider gives bias, ownership, nonprofit/corporate/government identity, criticism, or source type | No, except warnings/caps |
| `provenance_signal` | Provider verifies entity/domain/journal existence, age, relationships, footprint, registration, or publication metadata | No, except caps/downgrades/verified-source exceptions |

Identity alone must not upgrade a source to `B`.

Examples:

```text
AllSides-only match -> context only -> no reliability letter
Wikidata-only match -> provenance/context only -> no reliability letter
Wikipedia page without veracity score -> context only -> no reliability letter
Wayback old domain only -> provenance only -> no reliability letter
```

## High-Level Flow

```text
Source scrape / publisher link
  -> enrichPublisherIfNeeded()
  -> provider lookups
  -> mapProviderSignalToAdmiralty()
  -> publisher_external_signals
  -> publisher aggregate fields
  -> evaluateAdmiraltyCode()
  -> admiralty_evaluations
  -> /api/publishers/:id/enrichment
  -> SourceDetailModal / SourceCrest
```

Main files:

```text
backend/src/services/publisherEnrichmentService.js
backend/services/providerSignalMapper.js
backend/src/services/providerSignalPersistenceService.js
backend/services/admiraltyEvaluator.js
backend/services/sourceProviders/sourceProviderRegistry.js
dashboard/src/components/modals/SourceDetailModal.tsx
dashboard/src/components/SourceCrest.tsx
```

## Normalized Provider Signal

All provider results are mapped to this normalized shape:

```json
{
  "provider": "openalex",
  "signal_type": "publication_legitimacy_signal",
  "admiralty_effect_type": "contextual|direct|provenance|cap|downgrade",
  "normalized_score": null,
  "reliability_bucket": null,
  "confidence_delta": 0.15,
  "reliability_delta": 0,
  "cap": null,
  "cap_reason": null,
  "flags": [],
  "evidence_url": null,
  "explanation": "",
  "raw": {}
}
```

This is intentionally separate from the old `publisher_ratings` / `publisher_profiles` tables.

## Persistent Storage

### `publisher_external_signals`

Stores provider attempts and normalized Admiralty effects.

Important columns:

```text
publisher_id
domain
entity_name
provider
signal_type
admiralty_effect_type
normalized_score
reliability_bucket
confidence_delta
reliability_delta
cap
cap_reason
flags
raw_value
matched_name
matched_domain
match_confidence
evidence_url
explanation
retrieved_at
expires_at
error_status
```

This is the table the SourceCrest modal should use to show:

- provider tried
- match / no match / missing config / error
- direct vs contextual vs provenance
- score, bucket, cap, flags
- explanation
- evidence URL

### `publisher_relationships`

Stores relationships extracted from providers like Wikidata.

Relationship types:

```text
parent_org
owned_by
operated_by
founder
sponsor
publisher_of
brand_of
alias_of
same_as
```

### Publisher Aggregate Fields

The `publishers` table is extended with:

```text
identity_confidence
source_type
source_type_confidence
independent_footprint_score
conflict_of_interest_score
reliability_signal_present
direct_reliability_score
contextual_credibility_score
provenance_score
publication_legitimacy_score
reliability_cap
reliability_cap_reason
reliability_signal_sources
last_enriched_at
```

These are summary fields. The audit trail remains in `publisher_external_signals`.

## Provider Mapping

### Ad Fontes

Type:

```text
direct_reliability_signal + contextual bias
```

Mapping:

| Ad Fontes signal | Admiralty effect |
| --- | --- |
| reliability score present | Direct reliability |
| bias only | Context only |

Reliability score is normalized to 0-100 when needed.

Effect:

```text
high reliability -> can support B
medium -> supports C/B depending other evidence
mixed -> C
low -> D/E pressure
```

### SCImago

Type:

```text
direct_reliability_signal for journals
publication_legitimacy_signal
```

Quartile mapping:

| SCImago quartile | Score |
| --- | --- |
| Q1 | 88 |
| Q2 | 72 |
| Q3 | 55 |
| Q4 | 40 |

Effect:

```text
Q1/Q2 + academic source -> supports B
Q3/Q4 -> weaker academic legitimacy
```

SCImago is only relevant for journals/scholarly sources.

### Wikipedia

Type:

```text
contextual_credibility_signal
direct_reliability_signal only if veracity/reliability score is extracted or derived
```

Wikipedia page existence alone does not produce a reliability letter.

Useful data:

```text
description
source type
country
ownership
funding
credibility notes
political notes
reliability score when justified
```

If no veracity score exists:

```text
Wikipedia profile only -> context only -> no direct reliability
```

### Wikidata

Type:

```text
identity/provenance/contextual signal
```

Wikidata now checks:

```text
official website domain
exact entity name
normalized name / aliases
```

Extracted fields include:

```text
aliases
instance of
official website
parent organization
owned by
operator
founder
industry
country
inception
dissolved / defunct status
external IDs
same-as links
```

Mapping:

```text
identity confidence +
source type confidence +
relationships +
possible conflict/context flags
```

Wikidata must not directly create a reliability score.

Potential cap:

```text
advocacy / lobbying / PR / law firm / marketing / campaign source -> max C unless direct reliability evidence supports higher
```

### AllSides

Type:

```text
contextual_credibility_signal
```

AllSides is bias only.

Mapping:

```text
Left / Lean Left / Center / Lean Right / Right -> bias context
```

Effect:

```text
No direct reliability effect
Can increase audit/context confidence
Can be shown in modal
```

AllSides-only source should remain `Ø` for source reliability unless another provider supplies direct reliability or a verified-source exception applies.

### MBFC

Type:

```text
direct_reliability_signal + bias/context
```

Expected fields:

```text
factual_reporting
credibility_score
bias
country
source_url
```

Mapping:

| MBFC factuality | Normalized score |
| --- | --- |
| Very High / High | 80-90 |
| Mostly Factual | 70-79 |
| Mixed | 45-60 |
| Low | 25-40 |
| Very Low | 10-25 |

Risk classifications:

```text
conspiracy / pseudoscience / questionable / failed fact checks
```

can cap to `D` or `E`.

If MBFC supplies bias only:

```text
context only, no direct reliability effect
```

### NewsGuard

Type:

```text
direct_reliability_signal
```

Status:

```text
optional / credential-gated
```

Mapping:

| NewsGuard score | Source letter pressure |
| --- | --- |
| 90-100 | A/B |
| 70-89 | B |
| 50-69 | C |
| 25-49 | D |
| <25 | E |

If credentials/config are missing:

```text
provider_unavailable / missing_config
```

The modal should still show that the provider was skipped/unavailable.

### OpenAlex

Type:

```text
publication_legitimacy_signal
provenance_signal
contextual_credibility_signal
```

Use for:

```text
works
journals
authors
institutions
publishers
scholarly sources
```

Mapping:

```text
confirmed indexed journal/source -> provenance + identity confidence
confirmed work/DOI/source match -> stronger publication legitimacy
claimed scholarly source with no match -> warning/cap
```

OpenAlex presence alone does not create `B`.

### Crossref

Type:

```text
publication_legitimacy_signal
provenance_signal
```

Use for:

```text
DOI
ISSN
journal metadata
publisher/member metadata
funder/license metadata
```

Mapping:

```text
DOI/title/publisher match -> strong publication legitimacy
ISSN/journal match -> strong provenance
publisher mismatch -> flag and cap C
claimed journal/article with no footprint -> cap C/D when combined with OpenAlex/SCImago miss
```

Crossref does not automatically make a publisher reliable.

### Internet Archive Wayback CDX

Type:

```text
domain footprint provenance_signal
```

Expected fields:

```text
first_seen
capture_count
latest_capture
archive URL
```

Mapping:

| Domain footprint | Effect |
| --- | --- |
| >5 years and >100 captures | provenance +15 |
| >2 years and >20 captures | provenance +8 |
| no/few captures for obscure source | weak_domain_footprint flag, possible cap C/D |

Wayback does not directly create reliability.

### RDAP

Type:

```text
domain registration provenance_signal
```

Expected fields:

```text
domain creation date
registrar
status
nameservers
registrant org where available
privacy redaction
```

Mapping:

| Domain age | Effect |
| --- | --- |
| >5 years | provenance +10 |
| 1-5 years | provenance +5 |
| <1 year | young_domain flag, possible cap C |

Private registration alone is not negative.

### OpenCorporates

Type:

```text
identity/provenance_signal
```

Status:

```text
optional / credential-gated
```

Mapping:

```text
active matching legal entity -> identity confidence
dissolved/inactive -> warning/cap
officer/ownership mismatch -> entity_mismatch flag
```

Corporate existence is not reliability.

### IRS TEOS

Type:

```text
identity/provenance_signal
contextual_credibility_signal
```

Use when a source claims nonprofit status.

Mapping:

```text
verified active nonprofit -> identity confidence
revoked/nonmatching claim -> warning/cap
```

Nonprofit status is not reliability by itself.

### SEC EDGAR

Type:

```text
identity/provenance_signal
```

Use when source claims to be:

```text
public company
issuer
investment entity
regulated business
```

Mapping:

```text
EDGAR match -> identity confidence
filing mismatch / missing claimed issuer -> warning
```

EDGAR does not directly increase reliability.

### GDELT

Type:

```text
independent_footprint_signal
contextual signal
```

Mapping:

```text
diverse independent mentions -> independent footprint +10 to +20
no independent footprint for obscure purported publisher -> low_independent_footprint flag
```

GDELT does not directly assign reliability.

## Admiralty Calculation v2

The evaluator separates signals into:

```text
direct
contextual
provenance
caps
downgrades
```

It computes:

```text
direct_reliability_score
identity_confidence
independent_footprint_score
publication_legitimacy_score
conflict_of_interest_score
applicable_caps
warnings
```

Then:

```text
1. Derive provisional source letter from direct reliability score.
2. If no direct reliability signal exists, look for verified-source exception.
3. If neither exists, source letter remains Ø.
4. Apply caps and downgrades.
5. Store explanation and warnings.
```

## Verified-Source Exceptions

These may produce a non-`Ø` letter without an ordinary reliability-provider score:

```text
official government source
official university source
official primary-source document
confirmed peer-reviewed journal/source with Crossref/OpenAlex/ISSN/SCImago support
```

Requirements:

```text
high identity confidence
strong provenance
no major conflict flags
clear explanation
```

## Cap Rules

Caps apply after provisional scoring.

Examples:

```text
law firm / legal intake / claimant marketing / PR / campaign / advocacy source -> max C unless direct reliability supports higher
self-published PDF with weak footprint -> max D
claimed journal/article with no Crossref/OpenAlex/ISSN/SCImago footprint -> max C/D
entity appears only in document itself or host domain -> max D or Ø
unknown publisher with no direct reliability -> Ø
bias-only provider data -> no direct effect
Wikidata-only match -> no direct effect
Wikipedia-only page existence -> no direct effect
strong negative MBFC/NewsGuard/OpenSources -> D/E allowed
```

## API Behavior

### `POST /api/publishers/:publisherId/enrich`

Runs enrichment and returns updated Admiralty information.

Expected behavior:

```text
Run stale or forced provider checks.
Persist ratings/profiles where older code expects them.
Persist normalized provider signals.
Update publisher aggregate signal fields.
Re-evaluate Admiralty code.
Return admiraltyUpdates and provider results.
```

### `GET /api/publishers/:publisherId/enrichment`

Returns all SourceCrest modal data:

```json
{
  "publisher": {},
  "ratings": [],
  "profiles": [],
  "externalSignals": [],
  "admiraltyCode": "BØ"
}
```

`externalSignals` should include successful matches and failed/unavailable provider attempts so the UI can show:

```text
Provider tried
No match
Missing config
Error
Direct/context/provenance classification
Score/bucket/cap/flags
Explanation
Evidence URL
```

## SourceCrest Modal Display Requirements

The modal should show:

```text
Admiralty code
provider status rows
direct reliability signals used
contextual signals used
provenance signals used
signals ignored for direct reliability
caps applied
final source letter
reason for Ø
provider errors/unavailable
```

Provider rows should not disappear when a provider has no match.

The user should be able to tell:

```text
We tried MBFC and found no match.
NewsGuard was not configured.
Wikidata matched the entity but did not affect reliability.
AllSides returned bias only.
Wayback found a long-lived domain.
Crossref/OpenAlex found no scholarly footprint.
```

## Nations Vaccine Claim / Law-Firm PDF Behavior

For a PDF hosted by `dispartilaw.com` that mentions Nations Vaccine Claim:

Expected behavior:

```text
Publisher/host resolves to Disparti Law Group unless independent evidence proves Nations Vaccine Claim is the publisher.
Nations Vaccine Claim can be stored as related brand/sponsor/mentioned entity.
Source type should likely be legal advocacy / claimant intake / law-firm marketing.
If no direct reliability signal, weak independent footprint, no journal legitimacy, and interested-party hosting:
  reliability_signal_present = false
  cap_reason includes weak footprint and interested-party/legal-marketing context
  final publisher SourceCrest should be ØØ or DØ depending policy
  never BØ
```

## Regression Expectations

Required behavior:

```text
AllSides-only source -> no reliability letter
Wikidata-only source -> no reliability letter
Wikipedia profile without veracity score -> no reliability letter
MBFC high factuality -> reliability_signal_present true, likely B
MBFC low factuality -> D/E or cap
Crossref/OpenAlex confirmed journal + SCImago Q1 -> B or better according to policy
Claimed journal with no Crossref/OpenAlex/SCImago -> cap C/D
Old domain with Wayback only -> provenance improves, reliability remains Ø without direct signal
Young/dead domain + self-published PDF -> cap D/Ø
Government official domain -> verified-source exception can produce B/A with explanation
Law firm marketing PDF -> no B without direct reliability signal
```

## Audit Example

Example explanation:

```text
Wikidata identified the entity and Wayback confirmed a historical domain footprint, but no direct reliability provider score was found. AllSides supplied bias only. Because identity evidence is not reliability evidence, the source letter remains Ø.
```
