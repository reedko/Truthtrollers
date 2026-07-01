# VeriStrata Open Publisher Legal-Entity Provenance Dataset

Status: Public beta dataset in preparation  
Maintainer: VeriStrata  
Planned publication: 2026  
Planned update frequency: Quarterly

## Purpose

This dataset links online publishers and source domains to verified legal entities so that journalists, researchers, educators, civil-society organizations, and members of the public can inspect publisher identity, ownership provenance, and organizational status.

The dataset supports VeriStrata's community truth-sourcing work. Legal-entity information is treated as identity and provenance evidence only. An active registration is not proof that a publisher is reliable, and an absent or inactive registration is not, by itself, proof that a publisher is unreliable.

## Planned downloads

- `publisher-legal-entities.csv` — tabular publisher-to-entity mappings.
- `publisher-legal-entities.json` — the same mappings with structured provenance and match-review fields.
- `metadata.json` — dataset version, generation date, schema version, record count, and license information.

These files will be linked here when the first public-beta export is ready.

## Planned record fields

Records may include:

- VeriStrata publisher identifier and canonical name
- Publisher domain and known aliases
- Legal-entity name
- Jurisdiction and company number
- Entity status
- Incorporation and dissolution dates, when available
- Match confidence and review status
- OpenCorporates company URL
- Source and retrieval timestamps

Ambiguous matches will be marked for review rather than presented as confirmed identities.

## Methodology

VeriStrata submits low-volume searches using publisher names, domains, and, when available, jurisdiction hints. Candidate legal entities are compared conservatively against publisher identity evidence. Confirmed mappings retain their record-level provenance URL so users can inspect the supporting source.

Corrections and improvements to the publisher legal-entity mappings will be included in subsequent open releases.

## License

The publisher legal-entity provenance database will be released under the [Open Database License 1.0 (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).

OpenCorporates database material is provided [from OpenCorporates](https://opencorporates.com/) and is subject to the OpenCorporates attribution and share-alike requirements. Where a record is derived from OpenCorporates, the export will retain a direct link to the corresponding OpenCorporates company page whenever available.

The ODbL applies to the database and database rights. It does not imply that third-party trademarks, publisher content, or independently licensed ratings are covered by the same license.

## Attribution

When reusing OpenCorporates-derived records, attribute them with a visible hyperlink reading **from OpenCorporates**, preferably linking to the specific OpenCorporates company record included in the export.

Suggested dataset citation:

> VeriStrata Open Publisher Legal-Entity Provenance Dataset, incorporating data from OpenCorporates, licensed under ODbL 1.0.

## Limitations

Legal-entity registries vary by jurisdiction and may be incomplete, delayed, or contain errors. Publisher-to-entity matching can also be uncertain when organizations use trade names, subsidiaries, fiscal sponsors, or similarly named entities. Users should verify important conclusions against the cited registry record and other primary evidence.

## Contact

Questions, correction requests, and provenance issues may be sent to `admin@truthtrollers.com`.

