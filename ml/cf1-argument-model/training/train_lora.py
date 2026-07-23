#!/usr/bin/env python3
"""Train a CF1 multi-task LoRA/QLoRA adapter with TRL."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    return parser.parse_args()


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("model_name_or_path") in (None, "", "REPLACE_ME"):
        raise SystemExit("Set model_name_or_path in the training config")
    return config


def merge_system_into_user(example: dict) -> dict:
    """Adapt system+user prompts for chat templates that do not preserve system turns."""
    prompt = example.get("prompt")
    if (
        not isinstance(prompt, list)
        or len(prompt) < 2
        or prompt[0].get("role") != "system"
        or prompt[1].get("role") != "user"
    ):
        return example
    merged = {
        "role": "user",
        "content": f"{prompt[0]['content']}\n\n{prompt[1]['content']}",
    }
    return {**example, "prompt": [merged, *prompt[2:]]}


def assert_completion_boundaries(dataset, tokenizer) -> None:
    """Fail closed when completion-only masking would start at the wrong token."""
    for split_name, split in dataset.items():
        for index, example in enumerate(split):
            prompt_ids = tokenizer.apply_chat_template(
                example["prompt"],
                add_generation_prompt=True,
                tokenize=True,
                return_dict=False,
            )
            full_ids = tokenizer.apply_chat_template(
                example["prompt"] + example["completion"],
                tokenize=True,
                return_dict=True,
            )["input_ids"]
            if full_ids[: len(prompt_ids)] != prompt_ids:
                row_id = example.get("rowId", f"{split_name}:{index}")
                raise ValueError(
                    f"{row_id}: prompt/completion token boundary mismatch"
                )


def main() -> None:
    args = parse_args()
    config = load_config(args.config)
    try:
        import torch
        from datasets import load_dataset
        from peft import LoraConfig, PeftModel, prepare_model_for_kbit_training
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        from trl import SFTConfig, SFTTrainer
    except ImportError as exc:
        raise SystemExit("Install requirements-train.txt in a supported training environment") from exc

    data_files = {"train": config["train_file"]}
    validation_file = config.get("validation_file")
    if validation_file:
        data_files["validation"] = validation_file
    dataset = load_dataset("json", data_files=data_files)
    if config.get("merge_system_into_user", False):
        dataset = dataset.map(merge_system_into_user)

    model_id = config["model_name_or_path"]
    tokenizer_kwargs = {
        "revision": config.get("model_revision", "main"),
        "trust_remote_code": config.get("trust_remote_code", False),
    }
    if "fix_mistral_regex" in config:
        tokenizer_kwargs["fix_mistral_regex"] = config["fix_mistral_regex"]
    tokenizer = AutoTokenizer.from_pretrained(model_id, **tokenizer_kwargs)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    if config.get("validate_completion_boundaries", True):
        assert_completion_boundaries(dataset, tokenizer)

    model_kwargs = {
        "revision": config.get("model_revision", "main"),
        "trust_remote_code": config.get("trust_remote_code", False),
        "torch_dtype": "auto",
    }
    if config.get("qlora_4bit", True):
        compute_dtype_name = config.get("bnb_compute_dtype", "bfloat16")
        compute_dtype = getattr(torch, compute_dtype_name)
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type=config.get("bnb_quant_type", "nf4"),
            bnb_4bit_use_double_quant=config.get("bnb_double_quant", True),
            bnb_4bit_compute_dtype=compute_dtype,
        )
        model_kwargs["device_map"] = "auto"

    model = AutoModelForCausalLM.from_pretrained(model_id, **model_kwargs)
    model.config.use_cache = False

    parent_adapter = config.get("adapter_name_or_path")
    if parent_adapter:
        if config.get("qlora_4bit", True):
            model = prepare_model_for_kbit_training(
                model,
                use_gradient_checkpointing=config.get("gradient_checkpointing", True),
            )
        model = PeftModel.from_pretrained(model, parent_adapter, is_trainable=True)
        lora = None
    else:
        lora = LoraConfig(
            task_type="CAUSAL_LM",
            r=config.get("lora_r", 16),
            lora_alpha=config.get("lora_alpha", 32),
            lora_dropout=config.get("lora_dropout", 0.05),
            bias="none",
            target_modules=config.get("target_modules", "all-linear"),
        )

    has_validation = "validation" in dataset
    sft_args = SFTConfig(
        output_dir=config["output_dir"],
        num_train_epochs=config.get("num_train_epochs", 2),
        max_steps=config.get("max_steps", -1),
        per_device_train_batch_size=config.get("per_device_train_batch_size", 1),
        per_device_eval_batch_size=config.get("per_device_eval_batch_size", 1),
        gradient_accumulation_steps=config.get("gradient_accumulation_steps", 16),
        learning_rate=config.get("learning_rate", 2e-4),
        warmup_ratio=config.get("warmup_ratio", 0.05),
        lr_scheduler_type=config.get("lr_scheduler_type", "cosine"),
        max_length=config.get("max_length", 8192),
        completion_only_loss=True,
        packing=config.get("packing", False),
        gradient_checkpointing=config.get("gradient_checkpointing", True),
        bf16=config.get("bf16", True),
        fp16=config.get("fp16", False),
        logging_steps=config.get("logging_steps", 10),
        save_strategy="steps",
        save_steps=config.get("save_steps", 100),
        save_total_limit=config.get("save_total_limit", 2),
        eval_strategy="steps" if has_validation else "no",
        eval_steps=config.get("eval_steps", 100) if has_validation else None,
        report_to=config.get("report_to", "none"),
        seed=config.get("seed", 42),
        dataset_num_proc=config.get("dataset_num_proc", 1),
    )
    trainer = SFTTrainer(
        model=model,
        args=sft_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset.get("validation"),
        processing_class=tokenizer,
        peft_config=lora,
    )
    trainer.train(resume_from_checkpoint=config.get("resume_from_checkpoint"))
    trainer.save_model(config["output_dir"])
    tokenizer.save_pretrained(config["output_dir"])

    run_manifest = {
        "schemaVersion": "cf1.loraRunManifest.v1",
        "config": config,
        "parentAdapter": parent_adapter,
        "trainRows": len(dataset["train"]),
        "validationRows": len(dataset.get("validation", [])),
    }
    output = Path(config["output_dir"])
    output.mkdir(parents=True, exist_ok=True)
    (output / "cf1-run-manifest.json").write_text(
        json.dumps(run_manifest, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
