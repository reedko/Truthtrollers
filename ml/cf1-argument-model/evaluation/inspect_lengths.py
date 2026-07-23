#!/usr/bin/env python3
"""Measure rendered sequence lengths before choosing a model/context limit."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    index = min(len(values) - 1, math.ceil(fraction * len(values)) - 1)
    return sorted(values)[index]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--fix-mistral-regex", action="store_true")
    parser.add_argument("--input", type=Path, required=True)
    args = parser.parse_args()
    try:
        from transformers import AutoTokenizer
    except ImportError as exc:
        raise SystemExit("Install requirements-train.txt before token profiling") from exc

    tokenizer = AutoTokenizer.from_pretrained(
        args.model,
        revision=args.revision,
        fix_mistral_regex=args.fix_mistral_regex,
    )
    lengths: dict[str, list[int]] = defaultdict(list)
    for line in args.input.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        messages = row["prompt"] + row["completion"]
        rendered = tokenizer.apply_chat_template(messages, tokenize=False)
        encoded = tokenizer(rendered, add_special_tokens=False)
        lengths[row["task"]].append(len(encoded["input_ids"]))
    report = {}
    for task, values in sorted(lengths.items()):
        report[task] = {
            "rows": len(values),
            "min": min(values),
            "p50": percentile(values, 0.50),
            "p95": percentile(values, 0.95),
            "p99": percentile(values, 0.99),
            "max": max(values),
        }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
