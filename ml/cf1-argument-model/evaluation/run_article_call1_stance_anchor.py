#!/usr/bin/env python3
"""Run the tuned CF1 adapter against one full article using Call 1 V1.

This is an isolated evaluation harness. It does not alter the row-level evaluator,
training examples, adapters, or production Claim Foundry code.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROMPT_VERSION = "cf1.call1.stance-anchor.v1"

SYSTEM_PROMPT = """You map the factual argument in an article.

Use only the supplied article and its source-unit identifiers.

Preserve every assertion in its original polarity. If the article introduces an
opponent's assertion in order to dispute it, return the assertion as originally made.
Do not replace it with the article's rebuttal.

Judge what an assertion means before identifying who supplied it. Never infer an
assertion's relationship to the stance anchor from its source, ideology, presumed
truth, or your own knowledge."""

USER_TEMPLATE = """ARTICLE METADATA

Title: {title}
Author or byline: {authors}
Publication: {publisher}
Publication date: {published_at}

FINAL PORTFOLIO SIZE

Select exactly {portfolio_size} assertions.

ARTICLE

{numbered_units}

TASK

Return the structured result in the order below.

1. STANCE ANCHOR

State the article's central directional position as one atomic assertion.

The stance anchor is the only proposition used when assigning thesisEffect.

It must:

- contain one subject and one independently evaluable predicate;
- preserve the direction of the article's central position;
- exclude supporting reasons, examples, qualifications, and lists;
- not begin with "the article argues" or "the author believes";
- be short enough to compare directly with one candidate assertion.

2. CANDIDATE ASSERTIONS

Read the complete article before finalizing this inventory.

Return the distinct factual assertions used in the article's material argument. This
is a discovery inventory, not the final portfolio. Do not stop merely because enough
assertions have been found to fill the final portfolio.

For each assertion return:

- candidateId: a stable identifier such as C001;
- assertionText: one independently testable factual proposition;
- groundingUnitIds: the source units that ground the proposition and preserve the
  local context needed to understand it.

Remove frames such as "according to X" or "X says" unless whether X made the
statement is itself what must be verified.

If different parts could receive different evidentiary verdicts, return them as
separate assertions.

Do not return rhetoric, opinions, presentation descriptions, section summaries, or
filler.

3. STANCE RELATION AND ARTICLE TREATMENT

For every candidate, return its candidateId, thesisEffect, and articleTreatment.

For thesisEffect, assume the candidate assertion is true and compare its meaning only
with stanceAnchor:

- strengthens: it makes stanceAnchor more credible;
- weakens: it makes stanceAnchor less credible;
- no_effect: it does neither.

Do not use source identity, presumed ideology, real-world consensus, or your own view
of whether the assertion is true.

For articleTreatment use:

- adopted: the article uses the assertion as part of its own case;
- challenged: the article introduces the assertion to dispute, reject, or discredit it;
- reported: the article reports it without clearly adopting or challenging it.

thesisEffect and articleTreatment are separate judgments. Preserve the assertion's
original polarity regardless of either judgment.

4. ASSERTION SOURCES

After completing every stance judgment, identify the source of every candidate.

Return:

- candidateId;
- sourceName: the exact person, institution, study, document, legal party, or article
  byline that supplies the complete substantive assertion;
- sourceUnitIds: the units that identify that source.

Use the supplied article byline only when the proposition is supplied by the article's
narrative voice and no external source supplies it. Evidence cited for a proposition
is not automatically its source. Use unknown only when the supplied article genuinely
does not identify the supplier.

5. ARGUMENT PILLARS

Now organize the candidate assertions into the article's distinct load-bearing factual
questions.

For each pillar return:

- pillarId: a stable identifier such as P01;
- pillarQuestion: the specific evidence-resolvable question connecting its member
  assertions to stanceAnchor;
- importance: major or supporting;
- memberCandidateIds: every candidate that bears directly on that question.

A major pillar is one that would materially affect stanceAnchor if resolved against
the article. Do not create pillars from topics alone. Assertions sharing a subject do
not necessarily answer the same factual question. A candidate may belong to more than
one pillar when it genuinely bears on both.

6. FINAL PORTFOLIO

Return exactly {portfolio_size} unique candidate IDs in selectedCandidateIds.

Select the portfolio by comparing all candidates together. It should:

- cover every major pillar that has a viable candidate;
- favor clear, grounded, consequential assertions;
- retain important assertions the article challenges;
- represent materially different parts of the argument;
- avoid assertions resolved by substantially the same evidence;
- exclude rhetoric, incidental details, weakly grounded assertions, and nonclaims.

Do not select an assertion because it appears early or comes from a prominent source.

Return valid JSON only, with exactly this top-level shape:

{{
  "stanceAnchor": "string",
  "candidateAssertions": [
    {{
      "candidateId": "C001",
      "assertionText": "string",
      "groundingUnitIds": ["U0001"]
    }}
  ],
  "candidateRelations": [
    {{
      "candidateId": "C001",
      "thesisEffect": "strengthens | weakens | no_effect",
      "articleTreatment": "adopted | challenged | reported"
    }}
  ],
  "candidateSources": [
    {{
      "candidateId": "C001",
      "sourceName": "string",
      "sourceUnitIds": ["U0001"]
    }}
  ],
  "pillars": [
    {{
      "pillarId": "P01",
      "pillarQuestion": "string",
      "importance": "major | supporting",
      "memberCandidateIds": ["C001"]
    }}
  ],
  "selectedCandidateIds": ["C001"]
}}

Do not add Markdown or commentary outside the JSON object."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--revision", default="main")
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--article", required=True, type=Path)
    parser.add_argument("--numbered-source", required=True, type=Path)
    parser.add_argument(
        "--comparison-prompt",
        type=Path,
        help=(
            "Optional prompt containing 'System message' and 'User message' sections. "
            "Its placeholders are replaced without otherwise editing its text."
        ),
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--portfolio-size", type=int, default=12)
    parser.add_argument("--max-input-tokens", type=int, default=32768)
    parser.add_argument("--max-new-tokens", type=int, default=8192)
    parser.add_argument("--load-in-4bit", action="store_true")
    parser.add_argument("--fix-mistral-regex", action="store_true")
    parser.add_argument("--trust-remote-code", action="store_true")
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Write the exact merged prompt and request metadata without loading a model.",
    )
    return parser.parse_args()


def extract_numbered_units(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    marker = "## Numbered source units"
    if marker in text:
        text = text.split(marker, 1)[1]
    first = re.search(r"(?m)^\[U\d{4}\]", text)
    if not first:
        raise ValueError(f"No numbered source units found in {path}")
    return text[first.start() :].strip()


def assemble_external_prompt(
    path: Path,
    article: dict[str, Any],
    numbered_units: str,
    portfolio_size: int,
) -> tuple[str, str, str]:
    raw = path.read_text(encoding="utf-8")
    system_marker = "System message"
    user_marker = "User message"
    if system_marker not in raw or user_marker not in raw:
        raise ValueError(
            f"{path} must contain separate 'System message' and 'User message' headings"
        )
    after_system = raw.split(system_marker, 1)[1]
    system_text, user_text = after_system.split(user_marker, 1)
    system_text = system_text.strip()
    user_text = user_text.strip()
    replacements = {
        "{{ARTICLE_TITLE}}": article.get("title") or "unknown",
        "{{ARTICLE_AUTHOR}}": ", ".join(article.get("authors") or []) or "unknown",
        "{{PUBLICATION}}": article.get("publisher") or "unknown",
        "{{PUBLICATION_DATE}}": article.get("publishedAt") or "unknown",
        "{{PORTFOLIO_SIZE}}": str(portfolio_size),
        "{{ARTICLE_WITH_SOURCE_UNIT_IDS}}": numbered_units,
    }
    for placeholder, value in replacements.items():
        user_text = user_text.replace(placeholder, str(value))
    unresolved = sorted(set(re.findall(r"\{\{[^{}]+\}\}", user_text)))
    if unresolved:
        raise ValueError(f"Unresolved prompt placeholders: {', '.join(unresolved)}")
    return system_text, user_text, raw


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


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_response(
    response: dict[str, Any] | None,
    known_units: set[str],
    portfolio_size: int,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    if response is None:
        return {"valid": False, "errors": ["response_not_json"], "warnings": []}

    candidates = response.get("candidateAssertions")
    relations = response.get("candidateRelations")
    sources = response.get("candidateSources")
    pillars = response.get("pillars")
    selected = response.get("selectedCandidateIds")
    thesis = response.get("thesis")
    anchor = response.get("stanceAnchor")
    if not anchor and isinstance(thesis, dict):
        anchor = thesis.get("thesisAssertion")
    if not isinstance(anchor, str) or not anchor.strip():
        errors.append("missing_stance_anchor")
    for name, value in (
        ("candidateAssertions", candidates),
        ("candidateRelations", relations),
        ("candidateSources", sources),
        ("pillars", pillars),
        ("selectedCandidateIds", selected),
    ):
        if not isinstance(value, list):
            errors.append(f"{name}_not_array")

    if errors:
        return {"valid": False, "errors": errors, "warnings": warnings}

    candidate_ids = [
        row.get("candidateId") for row in candidates if isinstance(row, dict)
    ]
    candidate_set = {value for value in candidate_ids if isinstance(value, str)}
    if len(candidate_ids) != len(candidate_set):
        errors.append("duplicate_or_missing_candidate_ids")

    for group_name, rows in (("relation", relations), ("source", sources)):
        ids = [row.get("candidateId") for row in rows if isinstance(row, dict)]
        if set(ids) != candidate_set:
            errors.append(f"{group_name}_candidate_id_set_mismatch")

    if len(selected) != portfolio_size:
        errors.append(f"selected_count:{len(selected)}!={portfolio_size}")
    if len(selected) != len(set(selected)):
        errors.append("duplicate_selected_ids")
    unknown_selected = sorted(set(selected) - candidate_set)
    if unknown_selected:
        errors.append(f"unknown_selected_ids:{','.join(unknown_selected)}")

    valid_effects = {"strengthens", "weakens", "no_effect"}
    valid_treatments = {"adopted", "challenged", "reported"}
    for row in relations:
        if row.get("thesisEffect") not in valid_effects:
            errors.append(f"invalid_thesis_effect:{row.get('candidateId')}")
        if row.get("articleTreatment") not in valid_treatments:
            errors.append(f"invalid_article_treatment:{row.get('candidateId')}")

    referenced_units: set[str] = set()
    for row in candidates:
        referenced_units.update(row.get("groundingUnitIds") or [])
    for row in sources:
        referenced_units.update(row.get("sourceUnitIds") or [])
    unknown_units = sorted(referenced_units - known_units)
    if unknown_units:
        errors.append(f"unknown_source_units:{','.join(unknown_units[:20])}")

    major_pillars = [
        row for row in pillars if isinstance(row, dict) and row.get("importance") == "major"
    ]
    for pillar in major_pillars:
        members = set(pillar.get("memberCandidateIds") or [])
        invalid_members = sorted(members - candidate_set)
        if invalid_members:
            errors.append(
                f"pillar_unknown_members:{pillar.get('pillarId')}:{','.join(invalid_members)}"
            )
        if members and not members.intersection(selected):
            warnings.append(f"major_pillar_uncovered:{pillar.get('pillarId')}")

    normalized = [
        re.sub(r"\W+", " ", str(row.get("assertionText", "")).lower()).strip()
        for row in candidates
    ]
    duplicates = [text for text, count in Counter(normalized).items() if text and count > 1]
    if duplicates:
        warnings.append(f"exact_normalized_duplicates:{len(duplicates)}")

    return {"valid": not errors, "errors": errors, "warnings": warnings}


def h(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def render_report(
    output_path: Path,
    response: dict[str, Any] | None,
    validation: dict[str, Any],
    provenance: dict[str, Any],
    raw_text: str,
) -> None:
    response = response or {}
    thesis = response.get("thesis")
    anchor = response.get("stanceAnchor")
    if not anchor and isinstance(thesis, dict):
        anchor = thesis.get("thesisAssertion")
    candidates = response.get("candidateAssertions") or []
    relations = {
        row.get("candidateId"): row
        for row in response.get("candidateRelations") or []
        if isinstance(row, dict)
    }
    sources = {
        row.get("candidateId"): row
        for row in response.get("candidateSources") or []
        if isinstance(row, dict)
    }
    pillars = response.get("pillars") or []
    selected = set(response.get("selectedCandidateIds") or [])
    pillar_for: dict[str, list[str]] = {}
    for pillar in pillars:
        for candidate_id in pillar.get("memberCandidateIds") or []:
            pillar_for.setdefault(candidate_id, []).append(pillar.get("pillarId", ""))

    rows = []
    for candidate in candidates:
        candidate_id = candidate.get("candidateId")
        relation = relations.get(candidate_id, {})
        source = sources.get(candidate_id, {})
        rows.append(
            "<tr>"
            f"<td>{'✓' if candidate_id in selected else ''}</td>"
            f"<td>{h(candidate_id)}</td>"
            f"<td>{h(candidate.get('assertionText'))}</td>"
            f"<td>{h(relation.get('thesisEffect'))}</td>"
            f"<td>{h(relation.get('articleTreatment'))}</td>"
            f"<td>{h(source.get('sourceName'))}</td>"
            f"<td>{h(', '.join(pillar_for.get(candidate_id, [])))}</td>"
            f"<td>{h(', '.join(candidate.get('groundingUnitIds') or []))}</td>"
            "</tr>"
        )

    pillar_rows = []
    for pillar in pillars:
        members = pillar.get("memberCandidateIds") or []
        selected_members = [value for value in members if value in selected]
        pillar_rows.append(
            "<tr>"
            f"<td>{h(pillar.get('pillarId'))}</td>"
            f"<td>{h(pillar.get('importance'))}</td>"
            f"<td>{h(pillar.get('pillarQuestion'))}</td>"
            f"<td>{h(', '.join(members))}</td>"
            f"<td>{h(', '.join(selected_members))}</td>"
            "</tr>"
        )

    summary = {
        "candidates": len(candidates),
        "selected": len(selected),
        "strengthens": sum(
            1 for row in relations.values() if row.get("thesisEffect") == "strengthens"
        ),
        "weakens": sum(
            1 for row in relations.values() if row.get("thesisEffect") == "weakens"
        ),
        "challenged": sum(
            1 for row in relations.values() if row.get("articleTreatment") == "challenged"
        ),
        "unknownSources": sum(
            1
            for row in sources.values()
            if str(row.get("sourceName", "")).strip().lower() == "unknown"
        ),
        "pillars": len(pillars),
        "challengedScan": len(response.get("challengedPropositionScan") or []),
    }

    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>CF1 tuned-model Call 1 stance-anchor review</title>
<style>
body{{font-family:ui-sans-serif,system-ui,sans-serif;margin:28px;color:#17202a}}
table{{border-collapse:collapse;width:100%;margin:16px 0}}th,td{{border:1px solid #ccd3da;padding:7px;vertical-align:top;text-align:left}}
th{{background:#edf2f6;position:sticky;top:0}}code,pre{{font-family:ui-monospace,SFMono-Regular,monospace}}
.cards{{display:flex;flex-wrap:wrap;gap:10px}}.card{{border:1px solid #ccd3da;border-radius:8px;padding:10px 14px;background:#f8fafb}}
.bad{{color:#a40000}}.good{{color:#0b6b32}}details{{margin:14px 0}}pre{{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f6f8;padding:14px;border-radius:8px}}
</style></head><body>
<h1>CF1 tuned-model Call 1 stance-anchor review</h1>
<p><strong>Prompt:</strong> {h(PROMPT_VERSION)} · <strong>Model:</strong> {h(provenance.get('model'))}</p>
<h2>Stance comparison target</h2><blockquote>{h(anchor)}</blockquote>
<div class="cards">{''.join(f'<div class="card"><strong>{h(key)}</strong><br>{h(value)}</div>' for key, value in summary.items())}</div>
<h2>Validation</h2>
<p class="{'good' if validation.get('valid') else 'bad'}"><strong>{'VALID' if validation.get('valid') else 'INVALID'}</strong></p>
<pre>{h(json.dumps(validation, indent=2, ensure_ascii=False))}</pre>
<h2>Candidate inventory</h2>
<table><thead><tr><th>Sel.</th><th>ID</th><th>Assertion</th><th>Effect if true</th><th>Article treatment</th><th>Source</th><th>Pillars</th><th>Grounding</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table>
<h2>Pillars</h2>
<table><thead><tr><th>ID</th><th>Importance</th><th>Question</th><th>Members</th><th>Selected</th></tr></thead>
<tbody>{''.join(pillar_rows)}</tbody></table>
<details><summary>Provenance</summary><pre>{h(json.dumps(provenance, indent=2, ensure_ascii=False))}</pre></details>
<details><summary>Parsed response</summary><pre>{h(json.dumps(response, indent=2, ensure_ascii=False))}</pre></details>
<details><summary>Raw model output</summary><pre>{h(raw_text)}</pre></details>
</body></html>"""
    output_path.write_text(document, encoding="utf-8")


def main() -> None:
    args = parse_args()

    article = json.loads(args.article.read_text(encoding="utf-8"))
    numbered_units = extract_numbered_units(args.numbered_source)
    known_units = set(re.findall(r"(?m)^\[(U\d{4})\]", numbered_units))
    external_prompt_source: str | None = None
    if args.comparison_prompt:
        system_prompt, user_prompt, external_prompt_source = assemble_external_prompt(
            args.comparison_prompt,
            article,
            numbered_units,
            args.portfolio_size,
        )
        prompt_version = "cf1.call1.challenged-scan.comparison.v1"
    else:
        system_prompt = SYSTEM_PROMPT
        user_prompt = USER_TEMPLATE.format(
            title=article.get("title") or "unknown",
            authors=", ".join(article.get("authors") or []) or "unknown",
            publisher=article.get("publisher") or "unknown",
            published_at=article.get("publishedAt") or "unknown",
            portfolio_size=args.portfolio_size,
            numbered_units=numbered_units,
        )
        prompt_version = PROMPT_VERSION
    messages = [
        {
            "role": "user",
            "content": f"{system_prompt}\n\n{user_prompt}",
        }
    ]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    merged_prompt = messages[0]["content"]
    request: dict[str, Any] = {
        "promptVersion": prompt_version,
        "model": args.model,
        "revision": args.revision,
        "adapter": str(args.adapter),
        "portfolioSize": args.portfolio_size,
        "messages": messages,
        "mergedPromptSha256": sha256_text(merged_prompt),
        "articleContentHash": article.get("contentHash"),
        "numberedSourceSha256": sha256_text(numbered_units),
        "maxNewTokens": args.max_new_tokens,
        "doSample": False,
    }
    (args.output_dir / "prompt.txt").write_text(merged_prompt, encoding="utf-8")
    if external_prompt_source is not None:
        (args.output_dir / "comparison-prompt-source.txt").write_text(
            external_prompt_source, encoding="utf-8"
        )
    (args.output_dir / "request.json").write_text(
        json.dumps(request, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    if args.prepare_only:
        print(
            json.dumps(
                {
                    "outputDir": str(args.output_dir),
                    "promptVersion": prompt_version,
                    "promptCharacters": len(merged_prompt),
                    "mergedPromptSha256": request["mergedPromptSha256"],
                    "preparedOnly": True,
                },
                indent=2,
            )
        )
        return

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

    prompt_text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    encoded = tokenizer(prompt_text, return_tensors="pt", truncation=False)
    input_tokens = int(encoded["input_ids"].shape[-1])
    if input_tokens > args.max_input_tokens:
        raise SystemExit(
            f"Input has {input_tokens} tokens; limit is {args.max_input_tokens}. "
            "The harness will not truncate the article."
        )

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
    model = PeftModel.from_pretrained(model, args.adapter)
    model.eval()
    encoded = {key: value.to(model.device) for key, value in encoded.items()}

    request.update(
        {
        "promptTextSha256": sha256_text(prompt_text),
        "inputTokens": input_tokens,
        }
    )
    (args.output_dir / "request.json").write_text(
        json.dumps(request, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    started = time.perf_counter()
    with torch.inference_mode():
        generated = model.generate(
            **encoded,
            max_new_tokens=args.max_new_tokens,
            do_sample=False,
            pad_token_id=tokenizer.pad_token_id,
            eos_token_id=tokenizer.eos_token_id,
        )
    elapsed = time.perf_counter() - started
    new_tokens = generated[0, encoded["input_ids"].shape[-1] :]
    raw_text = tokenizer.decode(new_tokens, skip_special_tokens=True)
    response, parse_error = parse_json_object(raw_text)
    validation = validate_response(response, known_units, args.portfolio_size)
    if parse_error:
        validation["parseError"] = parse_error
        validation["valid"] = False

    provenance = {
        **{key: value for key, value in request.items() if key != "messages"},
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "elapsedSeconds": round(elapsed, 3),
        "outputTokens": int(new_tokens.shape[-1]),
        "rawOutputSha256": sha256_text(raw_text),
    }
    (args.output_dir / "raw-response.txt").write_text(raw_text, encoding="utf-8")
    (args.output_dir / "response.json").write_text(
        json.dumps(response, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (args.output_dir / "validation.json").write_text(
        json.dumps(validation, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (args.output_dir / "provenance.json").write_text(
        json.dumps(provenance, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    render_report(
        args.output_dir / "report.html",
        response,
        validation,
        provenance,
        raw_text,
    )
    print(
        json.dumps(
            {
                "outputDir": str(args.output_dir),
                "valid": validation.get("valid"),
                "inputTokens": input_tokens,
                "outputTokens": provenance["outputTokens"],
                "elapsedSeconds": provenance["elapsedSeconds"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
