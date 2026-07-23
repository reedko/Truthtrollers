#!/usr/bin/env python3
"""Score row-level CF1 predictions without using evaluation-key language."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--proposition-threshold", type=float, default=0.68)
    return parser.parse_args()


def normalize_text(value: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(value).lower()))


def text_similarity(left: Any, right: Any) -> float:
    normalized_left = normalize_text(left)
    normalized_right = normalize_text(right)
    sequence_score = SequenceMatcher(None, normalized_left, normalized_right).ratio()
    left_tokens = set(normalized_left.split())
    right_tokens = set(normalized_right.split())
    if not left_tokens and not right_tokens:
        token_score = 1.0
    elif not left_tokens or not right_tokens:
        token_score = 0.0
    else:
        overlap = len(left_tokens & right_tokens)
        precision = overlap / len(right_tokens)
        recall = overlap / len(left_tokens)
        token_score = 2 * precision * recall / (precision + recall) if overlap else 0.0
    return max(sequence_score, token_score)


def set_f1(expected: list[Any], predicted: list[Any]) -> float:
    expected_set = {normalize_text(value) for value in expected}
    predicted_set = {normalize_text(value) for value in predicted}
    if not expected_set and not predicted_set:
        return 1.0
    if not expected_set or not predicted_set:
        return 0.0
    overlap = len(expected_set & predicted_set)
    precision = overlap / len(predicted_set)
    recall = overlap / len(expected_set)
    return 2 * precision * recall / (precision + recall) if overlap else 0.0


def extraction_counts(
    expected: dict[str, Any], predicted: dict[str, Any], threshold: float
) -> tuple[int, int, int, list[float]]:
    gold = expected.get("assertions", [])
    guesses = predicted.get("assertions", [])
    candidates: list[tuple[float, int, int]] = []
    for gold_index, gold_item in enumerate(gold):
        for guess_index, guess_item in enumerate(guesses):
            similarity = text_similarity(
                gold_item.get("proposition", ""), guess_item.get("proposition", "")
            )
            if similarity >= threshold:
                candidates.append((similarity, gold_index, guess_index))
    matched_gold: set[int] = set()
    matched_guesses: set[int] = set()
    grounding_scores: list[float] = []
    for _, gold_index, guess_index in sorted(candidates, reverse=True):
        if gold_index in matched_gold or guess_index in matched_guesses:
            continue
        matched_gold.add(gold_index)
        matched_guesses.add(guess_index)
        grounding_scores.append(
            set_f1(
                gold[gold_index].get("groundingUnitIds", []),
                guesses[guess_index].get("groundingUnitIds", []),
            )
        )
    true_positive = len(matched_gold)
    return true_positive, len(guesses) - true_positive, len(gold) - true_positive, grounding_scores


def safe_equal(expected: dict[str, Any], predicted: dict[str, Any], field: str) -> bool:
    return normalize_text(expected.get(field, "")) == normalize_text(predicted.get(field, ""))


def main() -> None:
    args = parse_args()
    rows = [json.loads(line) for line in args.predictions.read_text(encoding="utf-8").splitlines() if line]
    totals = Counter()
    field_hits: dict[str, Counter] = defaultdict(Counter)
    extraction = Counter()
    grounding_scores: list[float] = []
    errors: Counter[str] = Counter()

    task_fields = {
        "detect_assertions": ["classification"],
        "attribute": ["kind", "name"],
        "deploy": ["contentStance", "deployment", "role"],
        "select": ["include"],
        "relate": ["relationType"],
        "orient": ["thesisStatus"],
    }

    for row in rows:
        task = row["task"]
        totals[task] += 1
        prediction = row.get("prediction")
        if not isinstance(prediction, dict):
            errors[task] += 1
            continue
        expected = row["expected"]
        if task == "extract_assertions":
            tp, fp, fn, scores = extraction_counts(
                expected, prediction, args.proposition_threshold
            )
            extraction.update({"tp": tp, "fp": fp, "fn": fn})
            grounding_scores.extend(scores)
        else:
            for field in task_fields.get(task, []):
                field_hits[f"{task}.{field}"]["total"] += 1
                if safe_equal(expected, prediction, field):
                    field_hits[f"{task}.{field}"]["correct"] += 1
            if task == "attribute":
                field_hits["attribute.sourceUnitIds"]["total"] += 1
                unit_score = set_f1(
                    expected.get("sourceUnitIds", []), prediction.get("sourceUnitIds", [])
                )
                field_hits["attribute.sourceUnitIds"]["sumMilli"] += round(unit_score * 1000)
            if task == "orient":
                for field in ("theme", "thesis"):
                    field_hits[f"orient.{field}Similarity"]["total"] += 1
                    field_hits[f"orient.{field}Similarity"]["sumMilli"] += round(
                        text_similarity(expected.get(field, ""), prediction.get(field, "")) * 1000
                    )

    metric_fields: dict[str, float] = {}
    for name, counts in sorted(field_hits.items()):
        if counts["total"]:
            numerator = counts.get("correct", counts.get("sumMilli", 0) / 1000)
            metric_fields[name] = numerator / counts["total"]

    tp, fp, fn = extraction["tp"], extraction["fp"], extraction["fn"]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    extraction_f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    report = {
        "schemaVersion": "cf1.rowLevelEvaluation.v1",
        "predictionRows": len(rows),
        "byTask": dict(sorted(totals.items())),
        "parseOrGenerationErrors": dict(sorted(errors.items())),
        "jsonSuccessRate": (len(rows) - sum(errors.values())) / len(rows) if rows else 0.0,
        "fieldMetrics": metric_fields,
        "extraction": {
            "truePositive": tp,
            "falsePositive": fp,
            "falseNegative": fn,
            "precision": precision,
            "recall": recall,
            "f1": extraction_f1,
            "matchedGroundingUnitF1": (
                sum(grounding_scores) / len(grounding_scores) if grounding_scores else 0.0
            ),
            "propositionSimilarityThreshold": args.proposition_threshold,
        },
        "limitations": [
            "This report scores held-out supervised rows, not full end-to-end article recall.",
            "Evaluation-key coverage and prohibited interpretations require graph assembly and are not model inputs.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
