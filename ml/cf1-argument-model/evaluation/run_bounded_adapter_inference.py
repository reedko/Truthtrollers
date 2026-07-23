#!/usr/bin/env python3
"""Run the CF1 adapter over bounded local extraction prompts in GPU batches."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--adapter", required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-input-tokens", type=int, default=4096)
    parser.add_argument("--max-new-tokens", type=int, default=768)
    parser.add_argument("--fix-mistral-regex", action="store_true")
    parser.add_argument("--merge-system-into-user", action="store_true")
    parser.add_argument("--load-in-4bit", action="store_true")
    return parser.parse_args()


def merge_system_into_user(prompt: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if (
        len(prompt) >= 2
        and prompt[0].get("role") == "system"
        and prompt[1].get("role") == "user"
    ):
        return [
            {
                "role": "user",
                "content": f"{prompt[0]['content']}\n\n{prompt[1]['content']}",
            },
            *prompt[2:],
        ]
    return prompt


def parse_json_object(text: str) -> tuple[dict[str, Any] | None, str | None]:
    stripped = text.strip()
    try:
        value = json.loads(stripped)
        if isinstance(value, dict):
            return value, None
    except json.JSONDecodeError:
        pass
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        try:
            value = json.loads(stripped[start : end + 1])
            if isinstance(value, dict):
                return value, None
        except json.JSONDecodeError as exc:
            return None, str(exc)
    return None, "no valid JSON object found"


def main() -> None:
    args = parse_args()
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    rows = [
        json.loads(line)
        for line in args.input.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    tokenizer_kwargs: dict[str, Any] = {"revision": args.revision}
    if args.fix_mistral_regex:
        tokenizer_kwargs["fix_mistral_regex"] = True
    tokenizer = AutoTokenizer.from_pretrained(args.model, **tokenizer_kwargs)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"

    model_kwargs: dict[str, Any] = {
        "revision": args.revision,
        "torch_dtype": "auto",
        "device_map": "auto",
    }
    if args.load_in_4bit:
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
    model = AutoModelForCausalLM.from_pretrained(args.model, **model_kwargs)
    model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()

    prepared: list[dict[str, Any]] = []
    for index, row in enumerate(rows):
        prompt = row["prompt"]
        if args.merge_system_into_user:
            prompt = merge_system_into_user(prompt)
        prompt_text = tokenizer.apply_chat_template(
            prompt, tokenize=False, add_generation_prompt=True
        )
        input_tokens = len(tokenizer(prompt_text, add_special_tokens=False)["input_ids"])
        prepared.append(
            {
                "index": index,
                "row": row,
                "promptText": prompt_text,
                "inputTokens": input_tokens,
            }
        )

    too_long = [
        item for item in prepared if item["inputTokens"] > args.max_input_tokens
    ]
    runnable = [
        item for item in prepared if item["inputTokens"] <= args.max_input_tokens
    ]
    runnable.sort(key=lambda item: item["inputTokens"])
    results: list[dict[str, Any]] = []
    for item in too_long:
        results.append(
            {
                "rowId": item["row"]["rowId"],
                "fixtureId": item["row"]["fixtureId"],
                "task": item["row"]["task"],
                "passage": item["row"].get("passage"),
                "inputTokens": item["inputTokens"],
                "prediction": None,
                "predictionText": "",
                "error": (
                    f"input_too_long:{item['inputTokens']}>{args.max_input_tokens}"
                ),
                "_index": item["index"],
            }
        )

    started = time.perf_counter()
    batch_count = (len(runnable) + args.batch_size - 1) // args.batch_size
    for offset in range(0, len(runnable), args.batch_size):
        batch = runnable[offset : offset + args.batch_size]
        encoded = tokenizer(
            [item["promptText"] for item in batch],
            return_tensors="pt",
            padding=True,
            truncation=False,
        )
        encoded = {key: value.to(model.device) for key, value in encoded.items()}
        batch_started = time.perf_counter()
        with torch.inference_mode():
            generated = model.generate(
                **encoded,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )
        elapsed = time.perf_counter() - batch_started
        input_width = encoded["input_ids"].shape[1]
        for item, sequence in zip(batch, generated):
            prediction_text = tokenizer.decode(
                sequence[input_width:], skip_special_tokens=True
            )
            prediction, parse_error = parse_json_object(prediction_text)
            results.append(
                {
                    "rowId": item["row"]["rowId"],
                    "fixtureId": item["row"]["fixtureId"],
                    "task": item["row"]["task"],
                    "passage": item["row"].get("passage"),
                    "inputTokens": item["inputTokens"],
                    "prediction": prediction,
                    "predictionText": prediction_text,
                    "error": (
                        f"invalid_json:{parse_error}" if parse_error else None
                    ),
                    "_index": item["index"],
                }
            )
        batch_number = (offset // args.batch_size) + 1
        print(
            f"batch {batch_number}/{batch_count}: {len(batch)} passages "
            f"in {elapsed:.1f}s",
            flush=True,
        )

    total_elapsed = time.perf_counter() - started
    results.sort(key=lambda item: item["_index"])
    for result in results:
        result.pop("_index", None)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(
            json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n"
            for result in results
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "rows": len(results),
                "valid": sum(not item.get("error") for item in results),
                "failed": sum(bool(item.get("error")) for item in results),
                "elapsedSeconds": round(total_elapsed, 3),
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
