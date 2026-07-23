#!/usr/bin/env python3
"""Run deterministic generation over prepared CF1 validation rows."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--adapter")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-input-tokens", type=int, default=8192)
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--fix-mistral-regex", action="store_true")
    parser.add_argument("--merge-system-into-user", action="store_true")
    parser.add_argument("--load-in-4bit", action="store_true")
    parser.add_argument("--trust-remote-code", action="store_true")
    return parser.parse_args()


def merge_system_into_user(prompt: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mirror the training-time adaptation for templates that drop system turns."""
    if (
        len(prompt) < 2
        or prompt[0].get("role") != "system"
        or prompt[1].get("role") != "user"
    ):
        return prompt
    merged = {
        "role": "user",
        "content": f"{prompt[0]['content']}\n\n{prompt[1]['content']}",
    }
    return [merged, *prompt[2:]]


def parse_json_object(text: str) -> tuple[dict[str, Any] | None, str | None]:
    text = text.strip()
    try:
        value = json.loads(text)
        if isinstance(value, dict):
            return value, None
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            value = json.loads(text[start : end + 1])
            if isinstance(value, dict):
                return value, None
        except json.JSONDecodeError as exc:
            return None, str(exc)
    return None, "no valid JSON object found"


def main() -> None:
    args = parse_args()
    try:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    except ImportError as exc:
        raise SystemExit("Install requirements-train.txt in the inference environment") from exc

    tokenizer_kwargs: dict[str, Any] = {
        "revision": args.revision,
        "trust_remote_code": args.trust_remote_code,
    }
    if args.fix_mistral_regex:
        tokenizer_kwargs["fix_mistral_regex"] = True
    tokenizer = AutoTokenizer.from_pretrained(args.model, **tokenizer_kwargs)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model_kwargs: dict[str, Any] = {
        "revision": args.revision,
        "torch_dtype": "auto",
        "trust_remote_code": args.trust_remote_code,
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
    if args.adapter:
        model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.input.open("r", encoding="utf-8") as source, args.output.open(
        "w", encoding="utf-8"
    ) as destination:
        for line_number, line in enumerate(source, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            expected = json.loads(row["completion"][0]["content"])
            prompt = row["prompt"]
            if args.merge_system_into_user:
                prompt = merge_system_into_user(prompt)
            prompt_text = tokenizer.apply_chat_template(
                prompt, tokenize=False, add_generation_prompt=True
            )
            encoded = tokenizer(prompt_text, return_tensors="pt", truncation=False)
            input_tokens = int(encoded["input_ids"].shape[-1])
            result: dict[str, Any] = {
                "rowId": row["rowId"],
                "fixtureId": row["fixtureId"],
                "task": row["task"],
                "expected": expected,
                "inputTokens": input_tokens,
            }
            if input_tokens > args.max_input_tokens:
                result.update(
                    {
                        "prediction": None,
                        "predictionText": "",
                        "error": (
                            f"input_too_long:{input_tokens}>{args.max_input_tokens}; "
                            "input was not silently truncated"
                        ),
                    }
                )
            else:
                encoded = {key: value.to(model.device) for key, value in encoded.items()}
                with torch.inference_mode():
                    generated = model.generate(
                        **encoded,
                        max_new_tokens=args.max_new_tokens,
                        do_sample=False,
                        pad_token_id=tokenizer.pad_token_id,
                        eos_token_id=tokenizer.eos_token_id,
                    )
                new_tokens = generated[0, encoded["input_ids"].shape[-1] :]
                prediction_text = tokenizer.decode(new_tokens, skip_special_tokens=True)
                prediction, parse_error = parse_json_object(prediction_text)
                result.update(
                    {
                        "prediction": prediction,
                        "predictionText": prediction_text,
                        "error": f"invalid_json:{parse_error}" if parse_error else None,
                    }
                )
            destination.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
            print(f"[{line_number}] {row['rowId']}: {result.get('error') or 'ok'}", flush=True)


if __name__ == "__main__":
    main()
