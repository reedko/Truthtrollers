from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

# Same model as score_phase1.py, for consistency across CF4 NLI checks.
MODEL = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"
REDUNDANCY_THRESHOLD = 0.9


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--input", required=True, type=Path,
                      help="JSON file with a top-level array of sub-thesis strings")
    args = cli.parse_args()
    sub_theses = read(args.input)

    tokenizer = AutoTokenizer.from_pretrained(MODEL)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL)
    model.eval()
    labels = {int(key): value.casefold() for key, value in model.config.id2label.items()}
    entailment_index = next((key for key, value in labels.items() if "entail" in value), 0)

    pairs = []
    for i in range(len(sub_theses)):
        for j in range(len(sub_theses)):
            if i != j:
                pairs.append((i, j))

    def entailment(premise: str, hypothesis: str) -> float:
        encoded = tokenizer([premise], [hypothesis], padding=True, truncation=True,
                             max_length=512, return_tensors="pt")
        with torch.inference_mode():
            logits = model(**encoded).logits
            probs = torch.softmax(logits, dim=-1)
        return float(probs[0, entailment_index])

    scores = {}
    for i, j in pairs:
        scores[(i, j)] = entailment(sub_theses[i], sub_theses[j])

    redundant_pairs = []
    findings = []
    seen = set()
    for i in range(len(sub_theses)):
        for j in range(i + 1, len(sub_theses)):
            forward = scores[(i, j)]
            backward = scores[(j, i)]
            if forward >= REDUNDANCY_THRESHOLD and backward >= REDUNDANCY_THRESHOLD:
                key = (i, j)
                if key in seen:
                    continue
                seen.add(key)
                redundant_pairs.append({
                    "indexA": i, "indexB": j,
                    "subThesisA": sub_theses[i], "subThesisB": sub_theses[j],
                    "entailAtoB": forward, "entailBtoA": backward,
                })
                findings.append({
                    "code": "CF4_SUBTHESES_REDUNDANT",
                    "indexA": i, "indexB": j,
                })

    print(json.dumps({
        "threshold": REDUNDANCY_THRESHOLD,
        "subThesesCount": len(sub_theses),
        "redundantPairs": redundant_pairs,
        "findings": findings,
    }))


if __name__ == "__main__":
    main()
