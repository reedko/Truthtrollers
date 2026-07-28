from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"
THRESHOLD = 0.9


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--input", required=True, type=Path)
    args = cli.parse_args()
    items = json.loads(args.input.read_text(encoding="utf-8"))
    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL)
    model.eval()
    labels = {
        int(key): value.casefold()
        for key, value in model.config.id2label.items()
    }
    entailment_index = next(
        (key for key, value in labels.items() if "entail" in value), 0)

    def entailment(premise: str, hypothesis: str) -> float:
        encoded = tokenizer(
            [premise], [hypothesis],
            padding=True, truncation=True, max_length=512,
            return_tensors="pt")
        with torch.inference_mode():
            logits = model(**encoded).logits
            probabilities = torch.softmax(logits, dim=-1)
        return float(probabilities[0, entailment_index])

    redundant_pairs = []
    for left in range(len(items)):
        for right in range(left + 1, len(items)):
            forward = entailment(items[left], items[right])
            backward = entailment(items[right], items[left])
            if forward >= THRESHOLD and backward >= THRESHOLD:
                redundant_pairs.append({
                    "indexA": left,
                    "indexB": right,
                    "itemA": items[left],
                    "itemB": items[right],
                    "entailAtoB": forward,
                    "entailBtoA": backward,
                })
    print(json.dumps({
        "threshold": THRESHOLD,
        "itemsCount": len(items),
        "redundantPairs": redundant_pairs,
        "findings": [{
            "code": "CF4_STANCE_ASSERTIONS_REDUNDANT",
            "indexA": item["indexA"],
            "indexB": item["indexB"],
        } for item in redundant_pairs],
    }))


if __name__ == "__main__":
    main()
