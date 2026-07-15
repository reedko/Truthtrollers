# CF1 Source Families and StructureProfiles

**Milestone:** 9A-3 amendment
**Status:** Ready for review
**Profile schema:** `cf1.structureProfile.v1`

## Boundary

The acquisition layer obtains source material. A source adapter parses its stable
mechanical format. A StructureProfile supplies reviewed structural hints. Neither a
profile nor its registry fetches pages, calls platform APIs, or replaces parsers.

```text
acquired source
  -> mechanical adapter (HTML / PDF / text)
  -> reviewed StructureProfile hints
  -> deterministic ArticleDocument
```

`sourceKind` is the mechanical input: `html`, `pdf`, or `text`.
`sourceFamily` is the provider-neutral content shape: `article`, `document`,
`plain_text`, `transcript`, `social_post`, or `social_thread`. Future families may
use validated namespaced identifiers without changing a database enum.

Platforms are profile scopes, not families. A YouTube transcript and another
provider's transcript can share the `transcript` family while using different
reviewed profiles.

## StructureProfile contract

```json
{
  "schemaVersion": "cf1.structureProfile.v1",
  "profileId": "cf1sp-default-transcript",
  "profileKey": "default.transcript",
  "version": 1,
  "sourceFamily": "transcript",
  "scope": { "kind": "global", "value": null },
  "rules": [
    {
      "ruleId": "speaker-turn",
      "signal": "transcript.speaker",
      "action": "atom.speaker-turn"
    }
  ],
  "profileHash": "lowercase-sha256"
}
```

The hash covers schema version, identity, version, family, scope, and the complete
ordered rule array. Rules use extensible identifiers rather than closed database
enums. Profiles are bounded to 250 rules and canonical JSON.

The initial provider contains reviewed global defaults. Callers may inject another
valid reviewed profile, but its family and hash must match. Unknown families do not
silently receive a generic profile.

## ArticleDocument reproducibility

Every document records:

- source kind and source family;
- adapter ID and adapter version; and
- StructureProfile ID, version, and hash.

The complete profile payload is resolved separately. A retry must resolve the exact
recorded hash; substituting the latest version is prohibited.

## Static defaults and extensibility

Initial defaults contain only compact structural hints for articles, documents,
plain text, transcripts, social posts, and social threads. Stable parsing mechanics
remain code. Profiles may grow reviewed indicators for boundaries, metadata,
exclusions, and atom hints without creating a new scraping framework.

Reserved atom types include `speaker_turn`, `timestamp`, `social_post`,
`social_reply`, and `thread_separator`. Reserved layout signals include speaker,
timestamp, post/reply identity, thread position, and thread depth.

No transcript or social adapter is implemented in this amendment. Text can record a
transcript profile identity without pretending that it recognized speaker turns.

## Database design

The additive `cf1_structure_profiles` migration stores immutable profile-version
payloads and identities:

- profile ID, key, and version;
- schema version and source family;
- scope and ordered rules JSON;
- profile hash and supersession identity;
- review status and audit timestamps.

It creates no rows, active-profile binding, trigger, lookup path, or live scrape
dependency. Static reviewed defaults remain the only provider in this phase.

A later reviewed milestone may add explicit activation/binding semantics. Draft or
machine-proposed rules must never become active merely because they were inserted.
Automatic learning and automatic activation are expressly out of scope.
