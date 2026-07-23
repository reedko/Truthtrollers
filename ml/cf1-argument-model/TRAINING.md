# CF1 supervised model training

This directory contains the reproducible path from the finalized CF1 annotations
to a LoRA adapter and held-out scores.

The authoritative annotations remain under:

```text
data/final/argument-drafts-v1-assistant-adjudicated/
```

Generated SFT data and adapters belong under `work/` and are ignored by Git.

## Two-stage policy

Public argument-mining data and CF1 gold are deliberately **not blended into one
training split**:

1. public data may warm up a base model on generic component detection, span
   extraction, and explicit argument relations;
2. CF1 gold then specializes that adapter on CF1's atomic assertions, attribution,
   deployment, selection, orientation, and relation taxonomy.

The CF1 stage comes last. Public labels are never silently translated into CF1
stance, deployment, role, or materiality labels.

The supplied public archives are currently quarantined for research evaluation.
The mapped rows have been reproduced exactly from the official source releases,
but their licenses remain restrictive. Do not publish or deploy an adapter trained
on them until usage rights for the intended deployment are resolved.

## What is and is not uploaded

Uploading the dataset to Hugging Face is optional. Local JSONL can be used directly
by `SFTTrainer` or copied onto managed training storage.

The upload command publishes only `train.jsonl` by default. It does **not** upload:

- evaluation-key targets;
- prohibited-interpretation tests;
- evidence targets or warrants;
- held-out validation completions.

Use a private dataset repository. Add `--include-validation` only when the selected
training service genuinely requires a validation split.

## Environment

Use Python 3.10 through 3.12 in the actual GPU environment. The current repository
host uses Python 3.14, for which compatible PyTorch wheels may not be available.

```bash
python3.11 -m venv .venv-cf1-ml
source .venv-cf1-ml/bin/activate
pip install -r ml/cf1-argument-model/requirements-train.txt
```

## Selected pilot model

The initial pilot is pinned to:

```text
mistralai/Mistral-Nemo-Instruct-2407
revision 04d8a90549d23fc6bd7f642064003592df51e9b3
```

Runnable tracked configurations:

- `configs/mistral-nemo-public-warmup.json`
- `configs/mistral-nemo-cf1-f03-control.json`
- `configs/mistral-nemo-cf1-f03-from-public.json`

The revision pin prevents a later upstream model update from silently changing the
benchmark.

## 1. Compile and validate the public warm-up corpus

The compiler reads the supplied ZIP members without extracting them, removes the
duplicate Microtexts member, preserves document-level splits, queues ambiguous
AAEC attacks, and excludes inferred CF-like labels:

Official-source reproduction can be repeated first when the official releases are
available locally:

```bash
python ml/cf1-argument-model/tools/verify-public-source-reproduction.py \
  --official-microtexts-root /PATH/TO/arg-microtexts \
  --official-aaec-zip /PATH/TO/ArgumentAnnotatedEssays-2.0.zip \
  --output ml/cf1-argument-model/work/public-warmup/official-source-reproduction.json
```

```bash
python ml/cf1-argument-model/tools/compile-public-argument-warmup.py \
  --source-verification-report ml/cf1-argument-model/work/public-warmup/official-source-reproduction.json \
  --output-dir ml/cf1-argument-model/work/public-warmup/controlled-v1

python ml/cf1-argument-model/training/prepare_sft.py \
  --train-file ml/cf1-argument-model/work/public-warmup/controlled-v1/rows/train.jsonl \
  --validation-file ml/cf1-argument-model/work/public-warmup/controlled-v1/rows/validation.jsonl \
  --dataset-name public-am-controlled-v1 \
  --output-dir ml/cf1-argument-model/work/sft/public-am-controlled-v1

python ml/cf1-argument-model/tools/validate-public-warmup.py \
  --compiled-dir ml/cf1-argument-model/work/public-warmup/controlled-v1 \
  --prepared-dir ml/cf1-argument-model/work/sft/public-am-controlled-v1 \
  --output ml/cf1-argument-model/work/public-warmup/controlled-v1/validation-report.json
```

The held-out public `test.jsonl` is not passed to `prepare_sft.py` and remains
evaluation-only.

## 2. Train the quarantined public warm-up adapter

Copy `configs/sft-lora-public-warmup.example.json` to
`work/configs/public-warmup.json` and select a base model. The example already
points at the prepared public train and validation files and writes to
`work/adapters/public-am-controlled-v1`.

```bash
python ml/cf1-argument-model/training/train_lora.py \
  --config ml/cf1-argument-model/work/configs/public-warmup.json
```

This stage is optional. A CF1-only baseline must be trained as a control before a
public-warm-started adapter is considered useful.

## 3. Prepare one held-out CF1 fold

This example trains on F01, F02, and F04-F09 while holding out all F03 task rows:

```bash
python ml/cf1-argument-model/training/prepare_sft.py \
  --fold CF1-F03 \
  --output-dir ml/cf1-argument-model/work/sft/CF1-F03
```

The default preserves the natural row distribution. To test explicit task/fixture
resampling without modifying the gold source:

```bash
python ml/cf1-argument-model/training/prepare_sft.py \
  --fold CF1-F03 \
  --balance task-fixture \
  --seed 42 \
  --output-dir ml/cf1-argument-model/work/sft/CF1-F03-balanced
```

## 4. Inspect token lengths before choosing a context limit

```bash
python ml/cf1-argument-model/evaluation/inspect_lengths.py \
  --model YOUR_MODEL_ID \
  --input ml/cf1-argument-model/work/sft/CF1-F03/train.jsonl
```

Do not silently truncate the orientation examples. Set `max_length` only after this
report has been examined for the selected tokenizer.

## 5. Train the CF1 specialization stage

Copy `configs/sft-lora.example.json`, set `model_name_or_path`, and adjust the GPU
settings. Then run:

```bash
python ml/cf1-argument-model/training/train_lora.py \
  --config ml/cf1-argument-model/work/configs/CF1-F03.json
```

TRL receives conversational prompt/completion examples and computes loss only on
the assistant completion. PEFT trains a causal-language-model LoRA adapter. The
example configuration enables 4-bit QLoRA and therefore expects a supported CUDA
Linux environment.

For the public-warm-started arm, copy
`configs/sft-lora-cf1-specialization.example.json`, set the same base model used by
the public stage, and set `adapter_name_or_path` to the public adapter. The trainer
loads that adapter as trainable and continues optimization at the lower configured
learning rate:

```bash
python ml/cf1-argument-model/training/train_lora.py \
  --config ml/cf1-argument-model/work/configs/CF1-F03-from-public.json
```

Run the same CF1 fold from the unmodified base model as the control. Public warm-up
is accepted only if it improves held-out CF1 evaluation without increasing
prohibited interpretations.

The renderer intentionally removes annotation-only IDs and explanatory `basis`
prose from completion targets. The adapter learns the proposition and semantic
labels, not fixture bookkeeping or gold-review rationales.

## 6. Optional private Hub upload

```bash
export HF_TOKEN=YOUR_PRIVATE_TOKEN
python ml/cf1-argument-model/training/upload_dataset.py \
  --prepared-dir ml/cf1-argument-model/work/sft/CF1-F03 \
  --repo-id YOUR_ACCOUNT/cf1-f03-train
```

No upload is performed by any preparation or training command automatically.

## 7. Held-out inference and scoring

```bash
python ml/cf1-argument-model/evaluation/run_inference.py \
  --model YOUR_MODEL_ID \
  --adapter ml/cf1-argument-model/work/adapters/CF1-F03 \
  --input ml/cf1-argument-model/work/sft/CF1-F03/validation.jsonl \
  --output ml/cf1-argument-model/work/eval/CF1-F03/predictions.jsonl \
  --load-in-4bit

python ml/cf1-argument-model/evaluation/score_predictions.py \
  --predictions ml/cf1-argument-model/work/eval/CF1-F03/predictions.jsonl \
  --output ml/cf1-argument-model/work/eval/CF1-F03/score.json
```

The first scoring layer measures row-level generalization. Full article recall,
evaluation-key coverage, and prohibited interpretations require assembling model
predictions into a fixture graph; they remain evaluation-only and are never shown
to the model.

## 8. Leave-one-article-out orchestration

Prepare every fold without starting GPU work:

```bash
python ml/cf1-argument-model/evaluation/run_loao.py \
  --base-config ml/cf1-argument-model/configs/sft-lora.example.json \
  --work-dir ml/cf1-argument-model/work/loao \
  --prepare-only
```

After a one-fold smoke test succeeds, remove `--prepare-only` to run the configured
training, inference, and row-level scoring sequence for all nine folds.

## References

- [TRL SFTTrainer](https://huggingface.co/docs/trl/sft_trainer)
- [PEFT LoRA](https://huggingface.co/docs/peft/package_reference/lora)
- [Datasets local JSON loading](https://huggingface.co/docs/datasets/en/loading)
- [Datasets Hub upload](https://huggingface.co/docs/datasets/main/process)
