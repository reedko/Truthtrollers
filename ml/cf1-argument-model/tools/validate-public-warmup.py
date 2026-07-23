#!/usr/bin/env python3
"""Fail-closed validation for the quarantined public AM warm-up corpus."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ALLOWED_TASKS = {
    "detect_argument_component",
    "extract_argument_span",
    "classify_argument_relation",
}
FORBIDDEN_SPECIALIZED_KEYS = {
    "articlesource",
    "articleuse",
    "assertionsource",
    "contentstance",
    "deployment",
    "evidencetarget",
    "role",
    "thesis",
    "thesishinge",
    "warrant",
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: expected object")
        rows.append(value)
    return rows


def normalized_key(key: str) -> str:
    return "".join(character for character in key.lower() if character.isalnum())


def forbidden_paths(value: Any, path: str = "$") -> list[str]:
    findings: list[str] = []
    if isinstance(value, list):
        for index, item in enumerate(value):
            findings.extend(forbidden_paths(item, f"{path}[{index}]"))
    elif isinstance(value, dict):
        for key, item in value.items():
            if normalized_key(key) in FORBIDDEN_SPECIALIZED_KEYS:
                findings.append(f"{path}.{key}")
            findings.extend(forbidden_paths(item, f"{path}.{key}"))
    return findings


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_compiled(root: Path) -> dict[str, Any]:
    split_rows = {
        split: read_jsonl(root / "rows" / f"{split}.jsonl")
        for split in ("train", "validation", "test")
    }
    rows = [row for split in split_rows.values() for row in split]
    all_rows = read_jsonl(root / "rows/all.jsonl")
    report = json.loads((root / "acceptance-report.json").read_text(encoding="utf-8"))

    row_ids = [row["rowId"] for row in rows]
    require(len(row_ids) == len(set(row_ids)), "duplicate compiled row IDs")
    require(set(row_ids) == {row["rowId"] for row in all_rows}, "all.jsonl differs from split rows")
    require(len(rows) == report["accepted"]["total"], "acceptance total differs from rows")

    fixture_splits: dict[str, set[str]] = defaultdict(set)
    for split, current_rows in split_rows.items():
        for row in current_rows:
            require(row["datasetSplit"] == split, f"{row['rowId']}: split mismatch")
            require(row["task"] in ALLOWED_TASKS, f"{row['rowId']}: specialized or unknown task")
            require(row.get("trainingGoldStatus") == "public_mapped", f"{row['rowId']}: gold-status mismatch")
            expected_verified = report["sourceCorpora"][row["corpus"]["id"]][
                "sourceMappedRowsVerifiedAgainstOfficialRelease"
            ]
            require(
                row["provenance"].get("sourceMappedRowVerifiedAgainstOfficialRelease")
                is expected_verified,
                f"{row['rowId']}: source verification lineage mismatch",
            )
            leaks = forbidden_paths({"input": row["input"], "output": row["output"]})
            require(not leaks, f"{row['rowId']}: specialized field leak: {leaks[:3]}")
            fixture_splits[row["fixtureId"]].add(split)
    require(all(len(splits) == 1 for splits in fixture_splits.values()), "documents cross splits")

    relation_labels = Counter(
        row["output"]["relationType"]
        for row in rows
        if row["task"] == "classify_argument_relation"
    )
    require(
        set(relation_labels) <= {"supports", "rebuts", "provides_evidence_for"},
        f"unexpected relation labels: {sorted(relation_labels)}",
    )
    queue_rows = read_jsonl(root / "queues/review.jsonl")
    generic_attacks = [
        row for row in queue_rows
        if row.get("reason") == "generic_attack_cannot_be_mapped_to_rebuts_or_contradicts"
    ]
    require(len(generic_attacks) == report["decisions"]["queued_generic_attack"], "generic-attack queue mismatch")
    ambiguous_negatives = [
        row for row in queue_rows
        if row.get("reason") == "negative_detection_contains_annotated_component_text"
    ]
    require(
        len(ambiguous_negatives)
        == report["decisions"].get("queued_ambiguous_detection_negative", 0),
        "ambiguous detection-negative queue mismatch",
    )
    require(report["productionEligible"] is False, "public corpus must remain production-ineligible")

    return {
        "rows": len(rows),
        "documents": len(fixture_splits),
        "bySplit": {split: len(value) for split, value in split_rows.items()},
        "byTask": dict(sorted(Counter(row["task"] for row in rows).items())),
        "relationLabels": dict(sorted(relation_labels.items())),
        "queuedGenericAttacks": len(generic_attacks),
        "queuedAmbiguousDetectionNegatives": len(ambiguous_negatives),
        "specializedFieldLeaks": 0,
        "documentSplitOverlap": 0,
    }


def validate_prepared(root: Path) -> dict[str, Any]:
    files = {
        "train": root / "train.jsonl",
        "validation": root / "validation.jsonl",
    }
    split_rows = {split: read_jsonl(path) for split, path in files.items() if path.exists()}
    fixture_splits: dict[str, set[str]] = defaultdict(set)
    for split, rows in split_rows.items():
        for row in rows:
            require(row["task"] in ALLOWED_TASKS, f"{row['rowId']}: unexpected prepared task")
            require(row.get("trainingGoldStatus") == "public_mapped", f"{row['rowId']}: prepared gold-status mismatch")
            user_payload = json.loads(row["prompt"][1]["content"])
            require(set(user_payload) == {"task", "instruction", "input"}, f"{row['rowId']}: prompt metadata leak")
            require(user_payload["task"] == row["task"], f"{row['rowId']}: prompt task mismatch")
            require(not forbidden_paths(user_payload), f"{row['rowId']}: specialized prompt-field leak")
            fixture_splits[row["fixtureId"]].add(split)
    require(all(len(splits) == 1 for splits in fixture_splits.values()), "prepared documents cross splits")
    return {
        "rows": sum(len(rows) for rows in split_rows.values()),
        "bySplit": {split: len(rows) for split, rows in split_rows.items()},
        "documentSplitOverlap": 0,
        "promptMetadataLeaks": 0,
        "specializedPromptFieldLeaks": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiled-dir", type=Path, required=True)
    parser.add_argument("--prepared-dir", type=Path)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = {
        "status": "passed",
        "compiled": validate_compiled(args.compiled_dir),
        "prepared": validate_prepared(args.prepared_dir) if args.prepared_dir else None,
    }
    rendered = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
