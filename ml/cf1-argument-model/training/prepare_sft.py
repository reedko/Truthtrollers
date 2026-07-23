#!/usr/bin/env python3
"""Render finalized CF1 task rows into Hugging Face SFT JSONL."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from cf1_sft import (
    read_jsonl,
    render_row,
    resample_task_fixture,
    sha256_file,
    summarize_rows,
    task_mix_for_rows,
    write_jsonl,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FINAL_ROOT = (
    PROJECT_ROOT / "data/final/argument-drafts-v1-assistant-adjudicated"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fold", default="CF1-F03", help="CF1-F01..F09, or all")
    parser.add_argument(
        "--train-file",
        type=Path,
        help="Use an external canonical task-row JSONL instead of a CF1 fold.",
    )
    parser.add_argument(
        "--validation-file",
        type=Path,
        help="Optional external validation JSONL; requires --train-file.",
    )
    parser.add_argument("--dataset-name", help="Manifest label for external data")
    parser.add_argument("--final-root", type=Path, default=DEFAULT_FINAL_ROOT)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--balance",
        choices=("none", "task-fixture"),
        default="none",
        help="Optional reproducible resampling; source gold is never modified.",
    )
    parser.add_argument("--sample-count", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def source_paths(args: argparse.Namespace) -> tuple[Path, Path | None]:
    if args.train_file:
        return args.train_file, args.validation_file
    if args.validation_file:
        raise SystemExit("--validation-file requires --train-file")
    if args.fold == "all":
        return args.final_root / "rows/training-all.jsonl", None
    fold_dir = args.final_root / "folds" / args.fold
    if not fold_dir.is_dir():
        raise SystemExit(f"Unknown fold: {args.fold}")
    return fold_dir / "train.jsonl", fold_dir / "evaluate.jsonl"


def main() -> None:
    args = parse_args()
    train_source, eval_source = source_paths(args)
    source_train_rows = read_jsonl(train_source)
    rendered_train = [render_row(row) for row in source_train_rows]
    rendered_eval = [render_row(row) for row in read_jsonl(eval_source)] if eval_source else []

    train_ids = [row["rowId"] for row in rendered_train]
    eval_ids = [row["rowId"] for row in rendered_eval]
    if len(train_ids) != len(set(train_ids)):
        raise SystemExit("Duplicate training row IDs")
    if len(eval_ids) != len(set(eval_ids)):
        raise SystemExit("Duplicate validation row IDs")
    train_fixtures = {row["fixtureId"] for row in rendered_train}
    eval_fixtures = {row["fixtureId"] for row in rendered_eval}
    overlap = train_fixtures & eval_fixtures
    if overlap:
        raise SystemExit(f"Documents cross training/validation: {sorted(overlap)[:5]}")

    if args.balance == "task-fixture":
        count = args.sample_count or len(rendered_train)
        task_mix = task_mix_for_rows(rendered_train)
        rendered_train = resample_task_fixture(
            rendered_train, count, args.seed, task_mix
        )
    elif args.sample_count:
        raise SystemExit("--sample-count requires --balance task-fixture")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    train_output = args.output_dir / "train.jsonl"
    eval_output = args.output_dir / "validation.jsonl"
    write_jsonl(train_output, rendered_train)
    if rendered_eval:
        write_jsonl(eval_output, rendered_eval)

    manifest = {
        "schemaVersion": "cf1.sftDatasetManifest.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "fold": None if args.train_file else args.fold,
        "datasetName": args.dataset_name or ("external" if args.train_file else args.fold),
        "balance": args.balance,
        "seed": args.seed,
        "taskMix": task_mix_for_rows(rendered_train) if args.balance == "task-fixture" else None,
        "source": {
            "trainPath": str(train_source.resolve()),
            "trainSha256": sha256_file(train_source),
            "validationPath": str(eval_source.resolve()) if eval_source else None,
            "validationSha256": sha256_file(eval_source) if eval_source else None,
        },
        "rendered": {
            "train": summarize_rows(rendered_train),
            "validation": summarize_rows(rendered_eval),
            "trainSha256": sha256_file(train_output),
            "validationSha256": sha256_file(eval_output) if rendered_eval else None,
        },
        "guarantees": {
            "evaluationKeysIncluded": False,
            "evidenceTargetsIncluded": False,
            "warrantsIncluded": False,
            "annotationOnlyOutputIdsIncluded": False,
        },
    }
    manifest_path = args.output_dir / "dataset-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "outputDir": str(args.output_dir),
                "train": {
                    "total": manifest["rendered"]["train"]["total"],
                    "byTask": manifest["rendered"]["train"]["byTask"],
                },
                "validation": {
                    "total": manifest["rendered"]["validation"]["total"],
                    "byTask": manifest["rendered"]["validation"]["byTask"],
                },
                "trainSha256": manifest["rendered"]["trainSha256"],
                "validationSha256": manifest["rendered"]["validationSha256"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
