#!/usr/bin/env python3
"""Compile supplied public AM mappings into a quarantined warm-up corpus.

The source ZIPs are never extracted or modified. This compiler intentionally keeps
public task semantics separate from CF1's specialized task taxonomy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE_ROOT = PROJECT_ROOT / "data/annotation-prompts/stupidity"
DEFAULT_CF_FIXTURES = PROJECT_ROOT.parents[1] / "backend/test/claim-foundry/fixtures"
MAX_MEMBER_BYTES = 64 * 1024 * 1024


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize_document(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def normalized_document_hash(text: str) -> str:
    return sha256_bytes(normalize_document(text).encode("utf-8"))


def unit_id_sort_key(unit_id: str) -> tuple[str, int, str]:
    """Sort U2 before U10 while remaining deterministic for nonstandard IDs."""
    match = re.fullmatch(r"([^0-9]*)([0-9]+)(.*)", unit_id)
    if not match:
        return (unit_id, -1, "")
    prefix, number, suffix = match.groups()
    return (prefix, int(number), suffix)


def read_zip_member(archive: Path, member: str) -> bytes:
    with zipfile.ZipFile(archive) as bundle:
        for info in bundle.infolist():
            member_path = Path(info.filename)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise ValueError(f"Unsafe ZIP member in {archive}: {info.filename}")
            if info.file_size > MAX_MEMBER_BYTES:
                raise ValueError(f"ZIP member exceeds safety limit: {info.filename}")
        try:
            return bundle.read(member)
        except KeyError as exc:
            raise ValueError(f"Missing {member} in {archive}") from exc


def read_jsonl_bytes(value: bytes, label: str) -> list[dict[str, Any]]:
    rows = []
    for line_number, line in enumerate(value.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        parsed = json.loads(line)
        if not isinstance(parsed, dict):
            raise ValueError(f"{label}:{line_number}: expected object")
        rows.append(parsed)
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(canonical_json(row) + "\n")


def validate_source_rows(rows: list[dict[str, Any]], corpus_id: str) -> dict[str, Any]:
    required = {"rowId", "fixtureId", "task", "corpus", "provenance", "input", "output"}
    row_ids: set[str] = set()
    fixture_splits: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        missing = required - set(row)
        if missing:
            raise ValueError(f"{row.get('rowId', '<unknown>')}: missing {sorted(missing)}")
        if row["corpus"].get("id") != corpus_id:
            raise ValueError(f"Unexpected corpus ID in {row['rowId']}")
        if row["rowId"] in row_ids:
            raise ValueError(f"Duplicate source row ID: {row['rowId']}")
        row_ids.add(row["rowId"])
        fixture_splits[row["fixtureId"]].add(row["provenance"]["sourceSplit"])
    crossing = [fixture for fixture, splits in fixture_splits.items() if len(splits) != 1]
    if crossing:
        raise ValueError(f"Source documents cross splits: {crossing[:5]}")
    return {
        "rows": len(rows),
        "documents": len(fixture_splits),
        "byTask": dict(sorted(Counter(row["task"] for row in rows).items())),
        "bySourceSplit": dict(
            sorted(Counter(row["provenance"]["sourceSplit"] for row in rows).items())
        ),
    }


def stable_bucket(fixture_id: str) -> int:
    return int(hashlib.sha256(fixture_id.encode("utf-8")).hexdigest()[:8], 16) % 100


def compiled_split(corpus_id: str, fixture_id: str, source_split: str) -> str:
    bucket = stable_bucket(fixture_id)
    if corpus_id == "argument-annotated-essays-v2":
        if source_split == "test":
            return "test"
        return "validation" if bucket < 10 else "train"
    if bucket < 10:
        return "test"
    if bucket < 20:
        return "validation"
    return "train"


def source_units_by_document(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, str]]]:
    result = {}
    for row in rows:
        if row["task"] != "extract_assertions":
            continue
        units = row["input"].get("sourceUnits", [])
        if units:
            result[row["fixtureId"]] = units
    return result


def connected_assertion_groups(assertions: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group spans sharing a source unit without pretending they are atomic claims."""
    remaining = set(range(len(assertions)))
    groups: list[list[dict[str, Any]]] = []
    while remaining:
        seed = remaining.pop()
        group_indexes = {seed}
        unit_ids = set(assertions[seed].get("groundingUnitIds", []))
        changed = True
        while changed:
            changed = False
            for index in list(remaining):
                assertion_units = set(assertions[index].get("groundingUnitIds", []))
                if unit_ids & assertion_units:
                    remaining.remove(index)
                    group_indexes.add(index)
                    unit_ids.update(assertion_units)
                    changed = True
        groups.append([assertions[index] for index in sorted(group_indexes)])
    return groups


def native_component_types(rows: list[dict[str, Any]], corpus_id: str) -> dict[str, str]:
    result = {}
    for row in rows:
        if row["task"] != "deployment":
            continue
        proposition = row["input"].get("proposition")
        if not proposition:
            continue
        label = row["provenance"].get("sourceLabel", "")
        if corpus_id == "argument-annotated-essays-v2":
            component = label.split(":", 1)[0]
            mapped = {
                "MajorClaim": "major_claim",
                "Claim": "claim",
                "Premise": "premise",
            }.get(component, "argument_component")
        else:
            mapped = "argumentative_discourse_unit"
        result[proposition] = mapped
    return result


def public_row(
    source: dict[str, Any],
    task: str,
    ordinal: int,
    inp: dict[str, Any],
    out: dict[str, Any],
    rule: str,
    source_row_ids: list[str],
    source_verified: bool,
) -> dict[str, Any]:
    fixture_id = source["fixtureId"]
    source_split = source["provenance"]["sourceSplit"]
    corpus_id = source["corpus"]["id"]
    return {
        "schemaVersion": "cf1.publicWarmupTaskRow.v1",
        "rowId": f"warmup:{corpus_id}:{source['provenance']['sourceDocumentId']}:{task}:{ordinal:04d}",
        "fixtureId": fixture_id,
        "task": task,
        "datasetSplit": compiled_split(corpus_id, fixture_id, source_split),
        "trainingGoldStatus": "public_mapped",
        "corpus": source["corpus"],
        "provenance": {
            **source["provenance"],
            "mappingRule": rule,
            "sourceRowIds": source_row_ids,
            "sourceMappedRowVerifiedAgainstOfficialRelease": source_verified,
        },
        "input": inp,
        "output": out,
    }


def transform_corpus(
    rows: list[dict[str, Any]], corpus_id: str, source_verified: bool = False
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], Counter[str]]:
    accepted: list[dict[str, Any]] = []
    queued: list[dict[str, Any]] = []
    report: Counter[str] = Counter()
    units_by_fixture = source_units_by_document(rows)
    component_types = native_component_types(rows, corpus_id)
    by_fixture: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_fixture[row["fixtureId"]].append(row)

    for fixture_id, fixture_rows in sorted(by_fixture.items()):
        counters: Counter[str] = Counter()
        extraction_rows = [row for row in fixture_rows if row["task"] == "extract_assertions"]
        if len(extraction_rows) != 1:
            raise ValueError(f"{fixture_id}: expected one extraction source row")
        extraction = extraction_rows[0]
        normalized_components = [
            normalize_document(item.get("proposition", ""))
            for item in extraction["output"].get("assertions", [])
            if item.get("proposition")
        ]
        unit_order = {
            unit["unitId"]: index for index, unit in enumerate(units_by_fixture[fixture_id])
        }
        unit_lookup = {unit["unitId"]: unit for unit in units_by_fixture[fixture_id]}
        groups = connected_assertion_groups(extraction["output"].get("assertions", []))
        for group in groups:
            counters["extract_argument_span"] += 1
            grounding = sorted(
                {unit_id for item in group for unit_id in item.get("groundingUnitIds", [])},
                key=lambda unit_id: unit_order.get(unit_id, 10**9),
            )
            source_units = [unit_lookup[unit_id] for unit_id in grounding if unit_id in unit_lookup]
            components = [
                {
                    "text": item["proposition"],
                    "groundingUnitIds": item.get("groundingUnitIds", []),
                    "componentType": component_types.get(
                        item["proposition"], "argument_component"
                    ),
                }
                for item in group
            ]
            accepted.append(
                public_row(
                    extraction,
                    "extract_argument_span",
                    counters["extract_argument_span"],
                    {"sourceUnits": source_units},
                    {"components": components},
                    "annotated-component-span-local-window-v1",
                    [extraction["rowId"]],
                    source_verified,
                )
            )
            if corpus_id == "arg-microtexts":
                counters["detect_argument_component"] += 1
                accepted.append(
                    public_row(
                        extraction,
                        "detect_argument_component",
                        counters["detect_argument_component"],
                        {"sourceUnits": source_units},
                        {"classification": "argument_component_present"},
                        "annotated-adu-presence-v1",
                        [extraction["rowId"]],
                        source_verified,
                    )
                )

        for row in fixture_rows:
            if row["task"] == "detect_assertions":
                counters["detect_argument_component"] += 1
                source_label = row["output"]["classification"]
                if (
                    corpus_id == "argument-annotated-essays-v2"
                    and source_label == "no_material_assertion"
                ):
                    window = normalize_document(
                        " ".join(
                            unit.get("text", "")
                            for unit in row["input"].get("sourceUnits", [])
                        )
                    )
                    matched = [
                        proposition
                        for proposition in normalized_components
                        if proposition and proposition in window
                    ]
                    if matched:
                        counters["detect_argument_component"] -= 1
                        queued.append(
                            {
                                "queueId": f"queue:{row['rowId']}",
                                "fixtureId": fixture_id,
                                "sourceRowId": row["rowId"],
                                "sourceLabel": source_label,
                                "reason": "negative_detection_contains_annotated_component_text",
                                "matchedNormalizedPropositions": matched,
                                "input": row["input"],
                            }
                        )
                        report["queued_ambiguous_detection_negative"] += 1
                        continue
                classification = (
                    "argument_component_present"
                    if source_label == "material_assertion_present"
                    else "no_argument_component"
                )
                accepted.append(
                    public_row(
                        row,
                        "detect_argument_component",
                        counters["detect_argument_component"],
                        row["input"],
                        {"classification": classification},
                        "annotated-component-presence-v1",
                        [row["rowId"]],
                        source_verified,
                    )
                )
            elif row["task"] == "relate":
                source_label = row["provenance"].get("sourceLabel", "")
                if corpus_id == "argument-annotated-essays-v2" and source_label == "attacks":
                    queued.append(
                        {
                            "queueId": f"queue:{row['rowId']}",
                            "fixtureId": fixture_id,
                            "sourceRowId": row["rowId"],
                            "sourceLabel": source_label,
                            "reason": "generic_attack_cannot_be_mapped_to_rebuts_or_contradicts",
                            "input": row["input"],
                        }
                    )
                    report["queued_generic_attack"] += 1
                    continue
                counters["classify_argument_relation"] += 1
                accepted.append(
                    public_row(
                        row,
                        "classify_argument_relation",
                        counters["classify_argument_relation"],
                        row["input"],
                        {"relationType": row["output"]["relationType"]},
                        "explicit-source-relation-preserved-v1",
                        [row["rowId"]],
                        source_verified,
                    )
                )

        report["excluded_orientation"] += sum(
            row["task"] == "orientation" for row in fixture_rows
        )
        report["excluded_inferred_deployment"] += sum(
            row["task"] == "deployment" for row in fixture_rows
        )

    report.update(Counter(row["task"] for row in accepted))
    return accepted, queued, report


def cf_document_hashes(fixtures_root: Path) -> dict[str, str]:
    hashes = {}
    for path in sorted(fixtures_root.glob("CF1-F*/article.json")):
        article = json.loads(path.read_text(encoding="utf-8"))
        hashes[normalized_document_hash(article.get("text", ""))] = path.parent.name
    return hashes


def deduplicate_documents(
    rows: list[dict[str, Any]], cf_hashes: dict[str, str]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    by_fixture: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_fixture[row["fixtureId"]].append(row)
    seen: dict[str, str] = {}
    kept = []
    duplicates = []
    for fixture_id, fixture_rows in sorted(by_fixture.items()):
        source_units: dict[str, str] = {}
        for row in fixture_rows:
            for unit in row["input"].get("sourceUnits", []):
                source_units[unit["unitId"]] = unit["text"]
            for endpoint in (row["input"].get("from"), row["input"].get("to")):
                if endpoint:
                    for unit in endpoint.get("localContext", []):
                        source_units[unit["unitId"]] = unit["text"]
        document_text = "\n".join(
            source_units[key] for key in sorted(source_units, key=unit_id_sort_key)
        )
        document_hash = normalized_document_hash(document_text)
        if document_hash in cf_hashes:
            duplicates.append(
                {
                    "fixtureId": fixture_id,
                    "reason": "exact_normalized_duplicate_of_cf_fixture",
                    "duplicateOf": cf_hashes[document_hash],
                }
            )
            continue
        if document_hash in seen:
            duplicates.append(
                {
                    "fixtureId": fixture_id,
                    "reason": "exact_normalized_duplicate_public_document",
                    "duplicateOf": seen[document_hash],
                }
            )
            continue
        seen[document_hash] = fixture_id
        kept.extend(fixture_rows)
    return kept, duplicates, {"uniqueDocuments": len(seen), "duplicatesRemoved": len(duplicates)}


def markdown_report(report: dict[str, Any]) -> str:
    source_status = (
        "Official source releases were independently replayed; every supplied mapped row reproduced exactly."
        if report["checks"]["officialSourceReproductionVerified"]
        else "Official source-row reproduction has not been verified for this compilation."
    )
    lines = [
        "# Controlled public argument-mining warm-up corpus",
        "",
        f"Generated: {report['createdAt']}",
        "",
        "Status: **research warm-up only; not production-cleared**",
        "",
        "## Accepted rows",
        "",
        f"- Total: {report['accepted']['total']}",
    ]
    for task, count in report["accepted"]["byTask"].items():
        lines.append(f"- `{task}`: {count}")
    lines += ["", "## Splits", ""]
    for split, count in report["accepted"]["bySplit"].items():
        lines.append(f"- {split}: {count}")
    lines += ["", "## Exclusions and queues", ""]
    for reason, count in report["decisions"].items():
        lines.append(f"- `{reason}`: {count}")
    lines += [
        "",
        "## Governing boundaries",
        "",
        "- Public task names remain distinct from CF1 task names.",
        "- Generic AAEC attacks are queued, not mapped to CF1 rebuttal labels.",
        "- AAEC negative windows containing duplicate annotated component text are queued as ambiguous.",
        "- Inferred public orientation, deployment, role, and stance rows are excluded.",
        "- Public component spans are not represented as atomic factual assertions.",
        "- The duplicate Microtexts member present in both supplied ZIPs is included once.",
        f"- {source_status}",
        "- Corpus licenses require resolution before any production-bound training.",
        "",
    ]
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--microtexts-archive", type=Path, default=DEFAULT_ARCHIVE_ROOT / "files.zip")
    parser.add_argument("--aaec-archive", type=Path, default=DEFAULT_ARCHIVE_ROOT / "files (1).zip")
    parser.add_argument("--cf-fixtures", type=Path, default=DEFAULT_CF_FIXTURES)
    parser.add_argument(
        "--source-verification-report",
        type=Path,
        help="Optional report from verify-public-source-reproduction.py.",
    )
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    verification = None
    if args.source_verification_report:
        verification = json.loads(
            args.source_verification_report.read_text(encoding="utf-8")
        )
        if not verification.get("allMappedRowsVerified"):
            raise SystemExit("Official-source verification report did not pass")
    micro_bytes = read_zip_member(args.microtexts_archive, "public_argmicrotexts_mapped.jsonl")
    duplicate_micro_bytes = read_zip_member(args.aaec_archive, "public_argmicrotexts_mapped.jsonl")
    if sha256_bytes(micro_bytes) != sha256_bytes(duplicate_micro_bytes):
        raise SystemExit("Microtexts members differ between supplied archives")
    aaec_bytes = read_zip_member(args.aaec_archive, "public_aaec_mapped.jsonl")

    source_sets = [
        (
            "arg-microtexts",
            read_jsonl_bytes(micro_bytes, "public_argmicrotexts_mapped.jsonl"),
            args.microtexts_archive,
            "CC-BY-NC-SA-4.0",
        ),
        (
            "argument-annotated-essays-v2",
            read_jsonl_bytes(aaec_bytes, "public_aaec_mapped.jsonl"),
            args.aaec_archive,
            "academic-and-research-use-only (not production-cleared)",
        ),
    ]

    all_rows = []
    all_queued = []
    source_reports = {}
    decisions: Counter[str] = Counter()
    for corpus_id, source_rows, archive, license_name in source_sets:
        source_validation = validate_source_rows(source_rows, corpus_id)
        mapped_sha = sha256_bytes(
            micro_bytes if corpus_id == "arg-microtexts" else aaec_bytes
        )
        source_verification = (
            verification.get("sources", {}).get(corpus_id) if verification else None
        )
        source_verified = bool(
            source_verification
            and source_verification.get("verified")
            and source_verification.get("mappedMemberSha256") == mapped_sha
        )
        if verification and not source_verified:
            raise SystemExit(f"Verification report does not match {corpus_id}")
        transformed, queued, counts = transform_corpus(
            source_rows, corpus_id, source_verified
        )
        all_rows.extend(transformed)
        all_queued.extend(queued)
        decisions.update(counts)
        source_reports[corpus_id] = {
            "archive": str(archive.resolve()),
            "archiveSha256": sha256_file(archive),
            "mappedMemberSha256": mapped_sha,
            "reportedLicense": license_name,
            "productionEligible": False,
            "sourceMappedRowsVerifiedAgainstOfficialRelease": source_verified,
            "officialSourceReproduction": source_verification,
            "sourceValidation": source_validation,
        }

    deduplicated, duplicate_records, duplicate_summary = deduplicate_documents(
        all_rows, cf_document_hashes(args.cf_fixtures)
    )
    all_queued.extend(duplicate_records)
    decisions["duplicate_documents_removed"] += len(duplicate_records)

    row_ids = [row["rowId"] for row in deduplicated]
    if len(row_ids) != len(set(row_ids)):
        raise SystemExit("Compiled row IDs are not unique")
    fixture_splits: dict[str, set[str]] = defaultdict(set)
    for row in deduplicated:
        fixture_splits[row["fixtureId"]].add(row["datasetSplit"])
    crossing = [fixture for fixture, splits in fixture_splits.items() if len(splits) != 1]
    if crossing:
        raise SystemExit(f"Compiled documents cross splits: {crossing[:5]}")

    by_split = {
        split: [row for row in deduplicated if row["datasetSplit"] == split]
        for split in ("train", "validation", "test")
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for split, rows in by_split.items():
        write_jsonl(args.output_dir / "rows" / f"{split}.jsonl", rows)
    write_jsonl(args.output_dir / "rows/all.jsonl", deduplicated)
    write_jsonl(args.output_dir / "queues/review.jsonl", all_queued)

    report = {
        "schemaVersion": "cf1.publicWarmupAcceptance.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "research_warmup_only",
        "productionEligible": False,
        "sourceCorpora": source_reports,
        "accepted": {
            "total": len(deduplicated),
            "documents": len(fixture_splits),
            "byTask": dict(sorted(Counter(row["task"] for row in deduplicated).items())),
            "bySplit": {split: len(rows) for split, rows in by_split.items()},
            "byCorpus": dict(
                sorted(Counter(row["corpus"]["id"] for row in deduplicated).items())
            ),
        },
        "decisions": dict(sorted(decisions.items())),
        "queued": len(all_queued),
        "deduplication": duplicate_summary,
        "checks": {
            "sourceRowIdsUnique": True,
            "compiledRowIdsUnique": True,
            "documentSplitsDisjoint": True,
            "microtextsDuplicateMemberIncludedOnce": True,
            "cfExactDocumentDuplicatesRemoved": True,
            "genericAttacksExcluded": True,
            "inferredSpecializedLabelsExcluded": True,
            "officialSourceReproductionVerified": all(
                source["sourceMappedRowsVerifiedAgainstOfficialRelease"]
                for source in source_reports.values()
            ),
        },
    }
    report_path = args.output_dir / "acceptance-report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (args.output_dir / "ACCEPTANCE_REPORT.md").write_text(
        markdown_report(report), encoding="utf-8"
    )
    artifact_hashes = {
        str(path.relative_to(args.output_dir)): sha256_file(path)
        for path in sorted(args.output_dir.rglob("*"))
        if path.is_file() and path.name != "artifact-hashes.json"
    }
    (args.output_dir / "artifact-hashes.json").write_text(
        json.dumps(artifact_hashes, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
