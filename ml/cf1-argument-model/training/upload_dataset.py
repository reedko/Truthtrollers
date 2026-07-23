#!/usr/bin/env python3
"""Optionally publish a prepared CF1 SFT dataset to a private HF repository."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared-dir", type=Path, required=True)
    parser.add_argument("--repo-id", required=True, help="namespace/dataset-name")
    parser.add_argument(
        "--include-validation",
        action="store_true",
        help="Upload held-out gold completions as validation. Off by default.",
    )
    parser.add_argument("--public", action="store_true", help="Default is a private repo")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        from datasets import DatasetDict, load_dataset
    except ImportError as exc:
        raise SystemExit("Install requirements-train.txt before uploading") from exc

    if not os.environ.get("HF_TOKEN"):
        raise SystemExit("HF_TOKEN is not set")
    train_path = args.prepared_dir / "train.jsonl"
    validation_path = args.prepared_dir / "validation.jsonl"
    if not train_path.is_file():
        raise SystemExit(f"Missing {train_path}")

    data_files = {"train": str(train_path)}
    if args.include_validation:
        if not validation_path.is_file():
            raise SystemExit(f"Missing {validation_path}")
        data_files["validation"] = str(validation_path)

    loaded = load_dataset("json", data_files=data_files)
    dataset = DatasetDict({name: split for name, split in loaded.items()})
    dataset.push_to_hub(
        args.repo_id,
        private=not args.public,
        token=os.environ["HF_TOKEN"],
    )
    print(f"Uploaded {', '.join(dataset.keys())} to {args.repo_id}")


if __name__ == "__main__":
    main()
