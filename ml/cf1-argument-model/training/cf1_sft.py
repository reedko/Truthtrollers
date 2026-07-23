"""Shared CF1 supervised-fine-tuning dataset utilities.

This module deliberately has no Hugging Face dependency. Dataset preparation and
validation can therefore run in the repository's ordinary Python environment.
"""

from __future__ import annotations

import copy
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


TASK_INSTRUCTIONS: dict[str, str] = {
    "detect_argument_component": (
        "Classify whether the supplied passage contains a source-annotated argument "
        "component. This is a general public-corpus task, not CF1 materiality scoring."
    ),
    "extract_argument_span": (
        "Extract the source-annotated argumentative text spans and their component "
        "types from the supplied passage. Preserve the text; do not atomize, normalize, "
        "or add propositions."
    ),
    "classify_argument_relation": (
        "Classify the explicitly annotated directed relation from the first public "
        "argument component to the second."
    ),
    "orient": (
        "Infer the article's theme, thesis, thesis status, and decisive thesis hinge. "
        "Ground the answer only in the supplied source units."
    ),
    "detect_assertions": (
        "Classify whether the supplied passage contains a material, externally "
        "checkable assertion. Do not extract or evaluate the assertion in this task."
    ),
    "extract_assertions": (
        "Extract every material atomic factual assertion in the supplied passage. "
        "Each assertion must express one independently testable proposition, preserve "
        "the passage's polarity, and cite only supporting source-unit IDs."
    ),
    "attribute": (
        "Identify who supplies the proposition. Decide attribution independently of "
        "whether the article supports or opposes the proposition. Use unknown when the "
        "local context does not resolve the supplier."
    ),
    "deploy": (
        "Determine how the article deploys the proposition relative to its frozen "
        "orientation. Preserve opponent propositions in their original polarity."
    ),
    "select": (
        "Decide whether this assertion belongs in a compact portfolio of the article's "
        "material argument. Do not change the assertion or its labels."
    ),
    "relate": (
        "Classify the directed argumentative relationship from the first assertion to "
        "the second, using their local contexts and the frozen article orientation."
    ),
}

SYSTEM_MESSAGE = (
    "You are a grounded argument-analysis component. Perform exactly the named task. "
    "Use only the supplied input. Return only one valid JSON object with no markdown "
    "or commentary outside that object."
)

# A conservative initial mix. It prevents the nine orientation rows from being
# repeated as often as the high-volume passage tasks while still exposing them.
DEFAULT_TASK_MIX: dict[str, float] = {
    "orient": 0.02,
    "detect_assertions": 0.24,
    "extract_assertions": 0.20,
    "attribute": 0.14,
    "deploy": 0.16,
    "select": 0.10,
    "relate": 0.14,
}

DEFAULT_PUBLIC_TASK_MIX: dict[str, float] = {
    "detect_argument_component": 0.30,
    "extract_argument_span": 0.40,
    "classify_argument_relation": 0.30,
}

FORBIDDEN_TRAINING_KEYS = {
    "evidencetarget",
    "evidencetargets",
    "evidenceusefulnesshint",
    "warrant",
    "warrants",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number}: expected a JSON object")
            rows.append(value)
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(canonical_json(row))
            handle.write("\n")


def _rename_argument_ids(value: Any) -> Any:
    if isinstance(value, list):
        return [_rename_argument_ids(item) for item in value]
    if not isinstance(value, dict):
        return value
    result: dict[str, Any] = {}
    for key, item in value.items():
        next_key = "candidateId" if key == "argumentUnitId" else key
        result[next_key] = _rename_argument_ids(item)
    return result


def _drop_explanatory_fields(value: Any) -> Any:
    if isinstance(value, list):
        return [_drop_explanatory_fields(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: _drop_explanatory_fields(item)
        for key, item in value.items()
        if key not in {"basis", "notes"}
    }


def project_input(row: dict[str, Any]) -> dict[str, Any]:
    """Return the runtime-shaped input, without adjudication metadata."""
    return _drop_explanatory_fields(_rename_argument_ids(copy.deepcopy(row["input"])))


def project_output(row: dict[str, Any]) -> dict[str, Any]:
    """Remove annotation bookkeeping that a runtime model must not invent."""
    task = row["task"]
    output = copy.deepcopy(row["output"])

    if task == "detect_assertions":
        return {"classification": output["classification"]}
    if task == "detect_argument_component":
        return {"classification": output["classification"]}
    if task == "extract_assertions":
        return {
            "assertions": [
                {
                    "proposition": item["proposition"],
                    "groundingUnitIds": item["groundingUnitIds"],
                    "scopeQualifiers": item.get("scopeQualifiers", []),
                }
                for item in output["assertions"]
            ]
        }
    if task == "relate":
        return {"relationType": output["relationType"]}
    if task == "classify_argument_relation":
        return {"relationType": output["relationType"]}
    if task == "extract_argument_span":
        return {
            "components": [
                {
                    "text": item["text"],
                    "groundingUnitIds": item["groundingUnitIds"],
                    "componentType": item["componentType"],
                }
                for item in output["components"]
            ]
        }
    if task == "attribute":
        return {
            "kind": output["kind"],
            "name": output["name"],
            "sourceUnitIds": output.get("sourceUnitIds", []),
        }
    if task == "deploy":
        return {
            "contentStance": output["contentStance"],
            "deployment": output["deployment"],
            "role": output["role"],
        }
    if task == "select":
        return {"include": output["include"]}
    if task == "orient":
        return {key: value for key, value in output.items() if key != "notes"}
    return _drop_explanatory_fields(output)


def _find_forbidden_keys(value: Any, path: str = "$") -> list[str]:
    findings: list[str] = []
    if isinstance(value, list):
        for index, item in enumerate(value):
            findings.extend(_find_forbidden_keys(item, f"{path}[{index}]"))
    elif isinstance(value, dict):
        for key, item in value.items():
            normalized = "".join(character for character in key.lower() if character.isalnum())
            if normalized in FORBIDDEN_TRAINING_KEYS:
                findings.append(f"{path}.{key}")
            findings.extend(_find_forbidden_keys(item, f"{path}.{key}"))
    return findings


def render_row(row: dict[str, Any]) -> dict[str, Any]:
    task = row.get("task")
    if task not in TASK_INSTRUCTIONS:
        raise ValueError(f"{row.get('rowId', '<unknown>')}: unsupported task {task!r}")

    projected_input = project_input(row)
    projected_output = project_output(row)
    forbidden = _find_forbidden_keys({"input": projected_input, "output": projected_output})
    if forbidden:
        raise ValueError(
            f"{row.get('rowId', '<unknown>')}: evidence/warrant fields leaked into SFT row: "
            + ", ".join(forbidden)
        )

    user_payload = {
        "task": task,
        "instruction": TASK_INSTRUCTIONS[task],
        "input": projected_input,
    }
    return {
        "rowId": row["rowId"],
        "fixtureId": row["fixtureId"],
        "task": task,
        "trainingGoldStatus": row.get("trainingGoldStatus", "user_accepted_gold"),
        "corpusId": row.get("corpus", {}).get("id", "cf1"),
        "prompt": [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": canonical_json(user_payload)},
        ],
        "completion": [
            {"role": "assistant", "content": canonical_json(projected_output)}
        ],
    }


def task_mix_for_rows(rows: Iterable[dict[str, Any]]) -> dict[str, float]:
    tasks = {row["task"] for row in rows}
    public_tasks = set(DEFAULT_PUBLIC_TASK_MIX)
    cf1_tasks = set(DEFAULT_TASK_MIX)
    if tasks and tasks <= public_tasks:
        return DEFAULT_PUBLIC_TASK_MIX
    if tasks and tasks <= cf1_tasks:
        return DEFAULT_TASK_MIX
    raise ValueError(
        "Cannot apply one balancing policy to mixed public and CF1 tasks; "
        "train them as separate stages"
    )


def summarize_rows(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = list(rows)
    return {
        "total": len(rows),
        "byTask": dict(sorted(Counter(row["task"] for row in rows).items())),
        "byFixture": dict(sorted(Counter(row["fixtureId"] for row in rows).items())),
        "byTaskFixture": {
            f"{task}|{fixture}": count
            for (task, fixture), count in sorted(
                Counter((row["task"], row["fixtureId"]) for row in rows).items()
            )
        },
    }


def resample_task_fixture(
    rows: list[dict[str, Any]],
    sample_count: int,
    seed: int,
    task_mix: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Sample tasks by configured mass and fixtures uniformly within each task.

    Sampling is explicit and materialized, making a managed training run exactly
    reproducible. The unbalanced source rows remain the authority.
    """
    if sample_count <= 0:
        raise ValueError("sample_count must be positive")
    task_mix = task_mix or DEFAULT_TASK_MIX
    groups: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        groups[row["task"]][row["fixtureId"]].append(row)

    tasks = [task for task in task_mix if task in groups]
    if not tasks:
        raise ValueError("No configured tasks are present in the source rows")
    weights = [task_mix[task] for task in tasks]
    if any(weight < 0 for weight in weights) or sum(weights) <= 0:
        raise ValueError("task mix weights must be nonnegative and sum to more than zero")

    rng = random.Random(seed)
    sampled: list[dict[str, Any]] = []
    occurrences: Counter[str] = Counter()
    for ordinal in range(sample_count):
        task = rng.choices(tasks, weights=weights, k=1)[0]
        fixture = rng.choice(sorted(groups[task]))
        source = rng.choice(groups[task][fixture])
        occurrences[source["rowId"]] += 1
        item = copy.deepcopy(source)
        item["sampleId"] = f"{source['rowId']}#S{occurrences[source['rowId']]:04d}"
        item["sampleOrdinal"] = ordinal
        sampled.append(item)
    return sampled
