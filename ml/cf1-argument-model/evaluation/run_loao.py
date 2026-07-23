#!/usr/bin/env python3
"""Prepare or execute leave-one-article-out CF1 adapter runs."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-config", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--fold", action="append", dest="folds")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--balance", choices=("none", "task-fixture"), default="none")
    return parser.parse_args()


def run(command: list[str], dry_run: bool) -> None:
    print(" ".join(command), flush=True)
    if not dry_run:
        subprocess.run(command, check=True)


def main() -> None:
    args = parse_args()
    folds = args.folds or [f"CF1-F{number:02d}" for number in range(1, 10)]
    base_config = json.loads(args.base_config.read_text(encoding="utf-8"))
    prepare_script = PROJECT_ROOT / "training/prepare_sft.py"
    train_script = PROJECT_ROOT / "training/train_lora.py"
    inference_script = PROJECT_ROOT / "evaluation/run_inference.py"
    score_script = PROJECT_ROOT / "evaluation/score_predictions.py"

    for fold in folds:
        fold_root = args.work_dir / fold
        prepared = fold_root / "dataset"
        adapter = fold_root / "adapter"
        predictions = fold_root / "predictions.jsonl"
        score = fold_root / "score.json"
        config_path = fold_root / "train-config.json"
        fold_root.mkdir(parents=True, exist_ok=True)

        prepare_command = [
            sys.executable,
            str(prepare_script),
            "--fold",
            fold,
            "--output-dir",
            str(prepared),
            "--balance",
            args.balance,
        ]
        run(prepare_command, args.dry_run)
        if args.prepare_only:
            continue

        config = {
            **base_config,
            "train_file": str(prepared / "train.jsonl"),
            "validation_file": str(prepared / "validation.jsonl"),
            "output_dir": str(adapter),
        }
        config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        run([sys.executable, str(train_script), "--config", str(config_path)], args.dry_run)
        run(
            [
                sys.executable,
                str(inference_script),
                "--model",
                config["model_name_or_path"],
                "--adapter",
                str(adapter),
                "--input",
                str(prepared / "validation.jsonl"),
                "--output",
                str(predictions),
                "--max-input-tokens",
                str(config.get("max_length", 8192)),
                *( ["--load-in-4bit"] if config.get("qlora_4bit", True) else [] ),
            ],
            args.dry_run,
        )
        run(
            [
                sys.executable,
                str(score_script),
                "--predictions",
                str(predictions),
                "--output",
                str(score),
            ],
            args.dry_run,
        )


if __name__ == "__main__":
    main()
