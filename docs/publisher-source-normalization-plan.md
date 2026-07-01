# Publisher and Source Identity Normalization Plan

Status: proposed design and rollout plan. The matching SQL is
`working/add-publisher-source-normalization.sql`. Do not execute the SQL until
Phase 0 live-schema checks are complete.

## Objective

Create one consistent publisher/source identity model for HTML, PDF, scholarly,
social, broadcast, repository, and archive content while preserving current
SourceCrest behavior during migration.

The design must:

- Extract the same structured identity fields from HTML and PDFs.
- Persist publication venue, publishing organization, identifiers, article type,
  distribution context, confidence, method, and evidence.
- Stop treating a journal and its publishing company as the same entity.
- Stop storing publisher/distribution facts directly on `content`.
- Keep existing scrape paths and SourceCrest modal working throughout rollout.
- Avoid a destructive big-bang migration.

## Current State

### Publisher-related tables

| Table | Current purpose | Main issue |
|---|---|---|
| `publishers` | Canonical publisher record plus cached summary scores | Mixes identity with derived enrichment summaries; no entity type. |
| `content_publishers` | Content-to-publisher join | No role, primary marker, confidence, or evidence. Code often replaces all links. |
| `publisher_domains` | Domain aliases | Useful and should remain. |
| `publisher_ratings` | Provider/user ratings | Correct structure, but ratings can attach to the wrong entity. |
| `publisher_profiles` | Entity-level narrative profiles | Currently also used for Facebook DOM; must not hold document-specific PDF/HTML metadata. |
| `publisher_enrichment_runs` | Provider attempt audit | Useful and should remain. |
| `publisher_external_signals` | Normalized external/provider signals | Overlaps older credibility checks and summary columns. |
| `publisher_relationships` | Ownership/related-entity facts | Related entity is often free text instead of a canonical FK. |
| `publisher_credibility_checks` | Legacy risk-provider results | Overlaps the newer external-signal model. |
| `source_identity_cache` | URL-to-publisher resolution cache | Duplicates names/metadata and must remain a disposable cache only. |

### Publisher-like fields currently on `content`

```text
media_source
platform
distribution_channel
linked_url
linked_publisher
social_provenance
```

These fields describe publishing or distribution context, not the intrinsic
content body. Move them to normalized context and relationship tables after a
dual-write transition.

### Information that currently has no durable home

```text
publication venue / journal
article type
DOI
ISSN and eISSN
volume and issue
field-level extraction method
field-level extraction confidence
field-level extraction evidence
extractor version
```

## Critical Identity Rule

For scholarly content, preserve three different things:

1. **Work/content** — the individual article, report, post, or PDF.
2. **Publication venue** — journal, conference, book, report series, or repository.
3. **Publishing organization** — company, society, university, agency, or institution.

Example:

```text
Work:                    an individual case report
Publication venue:       Annals of Clinical Case Studies
Publishing organization: Medtext Publications
```

SCImago rates the journal. A result found using `Annals of Clinical Case Studies`
must attach to the venue entity, not to Medtext Publications. Wikipedia,
Wikidata, corporate ownership, and sanctions checks generally target the
publishing organization.

## Target Data Model

### 1. Evolve `publishers` into canonical source entities

Keep the table name during migration and add `entity_type`:

```text
organization
journal
publication
platform
social_container
repository
government_body
broadcast_channel
other
```

An optional later migration can rename `publishers` to `source_entities`; that
rename is not required to fix the model.

### 2. Add roles to `content_publishers`

One content item may link to several source entities:

```text
primary_source
publishing_organization
publication_venue
platform
distribution_channel
linked_publisher
upstream_source
legacy_unspecified
```

Add:

```text
publisher_role
is_primary
context_id
identity_confidence
extraction_method
evidence_json
```

Relinking must replace only the affected role. It must not delete venue,
platform, linked-source, or other secondary relationships.

### 3. Add `content_publishing_context`

This stores document/distribution context, not entity profiles:

```text
context_type: scholarly | social | broadcast | web | archive
platform
publisher_name_observed
venue_name
venue_type
article_type
volume
issue
publication_year
distribution_channel
linked_url
linked_publisher_observed
social_provenance
extraction_method
extraction_confidence
extractor_version
extraction_evidence
raw_metadata
```

`publisher_name_observed` preserves what the extractor saw. The canonical entity
is linked through `content_publishers`; observed strings are evidence, not identity
keys.

### 4. Normalize publication identifiers

Use `content_publishing_identifiers` instead of comma-separated fields:

```text
identifier_type: doi | issn | eissn | isbn | pmid | pmcid | arxiv | other
identifier_scope: work | venue | edition | unknown
normalized_value
raw_value
extraction_method
extraction_confidence
evidence_quote
```

DOI usually identifies a work. ISSN/eISSN identify a serial venue. The scope
field preserves that distinction until venue identifiers are moved directly to
canonical venue entities.

### 5. Normalize entity relationships

Extend `publisher_relationships` with `related_publisher_id` and typed relations:

```text
publishes
owns
operates
part_of
imprint_of
successor_of
```

Keep the existing free-text related name for audit/backward compatibility, but
prefer the FK whenever the related entity is resolved.

### 6. Treat URL identity as cache, not truth

`source_identity_cache` may cache the selected primary entity and structured
metadata, but normalized publisher/context tables remain authoritative. A forced
rescrape or manual confirmation must be able to supersede cached output.

## Unified Extraction Contract

HTML and PDF adapters return the same shape:

```js
{
  version: "source-identity-v1",
  document: {
    article_type: null,
    publication_year: null,
    volume: null,
    issue: null,
    identifiers: []
  },
  entities: {
    publishing_organization: {
      name: null,
      entity_type: "organization",
      method: null,
      confidence: 0,
      evidence: null
    },
    publication_venue: {
      name: null,
      entity_type: "journal",
      venue_type: "journal",
      method: null,
      confidence: 0,
      evidence: null
    }
  },
  context: {
    context_type: "web",
    platform: "web"
  },
  candidates: [],
  warnings: []
}
```

Each selected field and candidate carries its own method, confidence, and bounded
evidence snippet. Never store the entire document as extraction evidence.

## Non-PDF `extractPublisher` Plan

### New HTML adapter

Create:

```js
extractHtmlPublishingIdentity($, sourceUrl)
```

It collects all candidates before selecting publisher, venue, identifiers, and
document metadata.

### Publishing-organization precedence

1. JSON-LD `publisher.name`, including arrays and `@graph`.
2. `citation_publisher`.
3. `dc.publisher` / `DC.publisher`.
4. `prism.publisher`.
5. Explicit visible `Publisher:` labels.
6. Copyright/footer organization after junk filtering.
7. Domain-derived organization as low-confidence fallback.

`og:site_name` is a site/container hint, not explicit publisher evidence. It must
not outrank structured publisher metadata.

### Publication-venue precedence

1. `citation_journal_title`.
2. `prism.publicationName`.
3. JSON-LD `isPartOf`, `Periodical`, and `PublicationIssue` hierarchy.
4. `dc.source` / `DC.source`.
5. Visible Journal, Published in, Source, Revista, or Periódico labels.
6. `og:site_name` as a lower-confidence venue/site candidate.

### Document metadata

- DOI: citation/prism/DC meta, JSON-LD identifier/sameAs, canonical DOI URL, then
  bounded text regex.
- ISSN/eISSN: citation/prism meta and JSON-LD `issn`.
- Article type: JSON-LD `@type`, `dc.type`, `prism.aggregationType`,
  `citation_article_type`, then explicit labels.
- Volume, issue, and year: citation/prism meta first, then JSON-LD.

### Special adapters

- Facebook and other social extraction remains separate and emits typed platform,
  channel, poster, and linked-source candidates.
- PubMed, BVS, repositories, and aggregators are hosts, not automatically the
  publication venue or publishing organization.
- Existing repository/social exceptions remain, but produce typed candidates
  rather than overwriting one publisher string.

### Compatibility wrapper

Keep current callers operational:

```js
export async function extractPublisher($, sourceUrl = "") {
  const identity = await extractHtmlPublishingIdentity($, sourceUrl);
  return chooseLegacyPrimaryPublisher(identity);
}
```

The legacy selector returns:

1. Confirmed publishing organization.
2. Otherwise the venue with `role='journal'`, `confidence='proxy'`.
3. Otherwise a safe domain fallback.

New callers consume the complete identity. Remove the wrapper only after every
scrape path migrates.

## PDF Extraction Plan

Create:

```js
extractPdfPublishingIdentity({ info, metadata, text, sourceUrl })
```

Use the same structured output contract. Priority:

1. Explicit publisher/journal labels and structured PDF/XMP metadata.
2. DOI/ISSN-anchored metadata.
3. Repeated first-page/header/footer venue evidence.
4. Copyright organization.
5. `Creator`/`Producer` only as low-confidence candidates after software and
   personal-name filtering.

Parse a PDF once and forward the resulting identity. The evidence engine must
not download the PDF again through `resolveSourceIdentity` after already parsing
it.

## Persistence Plan

Expand `persistPublishers`, but do not add document fields to `publishers`.
Make it a compatibility façade:

```js
persistPublishers(query, contentId, legacyPublisherOrIdentity, options)
```

For legacy input it preserves current behavior. For structured input it delegates
to transactional `persistSourceIdentity`, which:

1. Upserts organization and venue as separate canonical entities.
2. Upserts domains and typed entity relationships.
3. Upserts `content_publishing_context`.
4. Upserts normalized identifiers.
5. Links entities to content with roles.
6. Selects exactly one primary identity for legacy consumers.
7. Stores field-level extraction provenance.
8. Invalidates or refreshes stale source-identity cache entries.

Return:

```js
{
  publisherId,
  primaryEntityId,
  publishingOrganizationId,
  publicationVenueId,
  contextId,
  linkedEntities
}
```

Use a database transaction. Partial context/entity/identifier writes are not
acceptable.

## Scrape-Path Integration

| Path | Required change |
|---|---|
| Popup Add HTML | Run the HTML adapter once and persist the complete identity. |
| Popup Add PDF | Consume `pdfMeta.identity`; fix the currently dropped PDF publisher result. |
| Evidence HTML | Persist the full HTML identity, not only `{name}`. |
| Evidence PDF | Use the PDF already parsed; do not refetch for identity. |
| Extension rescrape HTML | Forward compact metadata HTML and persist the complete identity. |
| Extension rescrape PDF | Return/forward full `pdfIdentity`, not only publisher text. |
| Source resolver | Accept structured identity hints and skip fetch when supplied. |
| Social linked source | Create/reuse linked content and persist its own context. |

All paths converge on:

```text
extract adapter
  -> normalize and arbitrate candidates
  -> persistSourceIdentity
  -> enrich the correct entity/entities
  -> evaluate SourceCrest
```

## SourceCrest Modal Requirements

The modal currently assumes one publisher ID. Preserve existing fields/actions
while adding source context.

### API compatibility

Keep:

```text
publisher
ratings
profiles
admiraltyCode
```

Add:

```json
{
  "primarySource": {},
  "publishingOrganization": {},
  "publicationVenue": {},
  "distribution": {},
  "publishingContext": {},
  "identifiers": [],
  "extractionEvidence": {}
}
```

### Modal behavior

- Display the primary SourceCrest as today.
- Show separate Venue, Publisher, and Distributed via rows.
- Show DOI/ISSN and extraction method/confidence.
- Label each provider result with the entity it rated.
- SCImago refresh targets the venue entity.
- Wikipedia/Wikidata, ownership, corporate, and sanctions enrichment normally
  target the organization.
- Platform/channel context does not inherit linked-article reliability.
- Force refresh enriches the selected entity without changing identity links.
- Open tab and re-scrape refreshes extraction evidence and proposes identity
  changes without deleting secondary relationships.
- Manual confirmation records user, timestamp, prior value, method=`manual`, and
  evidence/audit details.

### Primary SourceCrest policy

- Scholarly article: venue is the default rated primary entity when confidently
  identified; organization remains secondary.
- Ordinary web article: publishing organization is normally primary.
- Social post: post/container and linked article remain distinct; show the linked
  article's SourceCrest separately.
- Repository record: prefer resolved venue/organization; otherwise show the
  repository explicitly as a proxy with that status visible.

## Migration Rollout

### Phase 0 — Live inventory

- Capture `SHOW CREATE TABLE` for every publisher/source table and `content`.
- Inventory stored procedures and all reads/writes.
- Verify MySQL/MariaDB version and collation support.
- Freeze the identity contract and confidence vocabulary.
- Build fixtures from real HTML, PDF, repository, and social sources.

### Phase 1 — Additive schema

- Run the matching proposed SQL only after review.
- Add context, identifier, entity-type, and role columns.
- Do not drop or reinterpret existing columns.

### Phase 2 — Extractors and dual writes

- Implement HTML and PDF adapters.
- Keep legacy extraction wrappers.
- Upgrade `persistPublishers` to dual-write.
- Integrate every scrape path and source resolver.

### Phase 3 — SourceCrest migration

- Extend enrichment APIs with role/context data.
- Update SourceCrest modal without removing legacy response fields.
- Compare legacy and normalized identity/crest output in telemetry.

### Phase 4 — Backfill

- Backfill social/broadcast/web/archive contexts from `content`.
- Re-extract stored HTML/PDF only when context is absent or low-confidence.
- Deduplicate with normalized aliases, domains, DOI/ISSN, and review queues.
- Never merge entities using fuzzy name alone.

### Phase 5 — Cutover and cleanup

- Switch reads to normalized tables.
- Stop legacy writes.
- Run parity tests for SourceCrest, evidence, references, and modal actions.
- Drop old `content` provenance columns only after a stable release, backup, and
  verified rollback path.

## Required Tests

1. HTML/PDF extraction precedence, rejection, evidence, and confidence tests.
2. Same source through every scrape path produces the same normalized identity.
3. Transaction, idempotency, role-link, and identifier-deduplication tests.
4. SCImago journal result never attaches to the publishing company.
5. Linked-PDF metadata remains on linked content, not a social-post record.
6. SourceCrest old/new API and modal compatibility tests.
7. Backfill dry-run counts and conflict reports.
8. Migration tests against production MariaDB and development MySQL versions.

## Immediate Work Order

1. Verify live schema and revise SQL if needed.
2. Apply additive schema in development.
3. Implement unified identity contract.
4. Implement HTML adapter and legacy wrapper.
5. Implement PDF adapter and legacy wrapper.
6. Implement transactional persistence behind `persistPublishers`.
7. Fix Popup Add and evidence-engine PDF paths.
8. Dual-write all paths.
9. Extend SourceCrest APIs/modal.
10. Backfill, compare, cut over, and later remove legacy fields.
