from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from attribution import split_attribution
from candidates import candidate_texts, cited_works, structured_form, testable
from coreference import (
    CoreferenceResolver,
    apply_span_resolutions,
    reject_resolved_input,
)
from parser import ParsedText, Parser


def load(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write(path: Path, value):
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def normalized(text: str) -> str:
    return " ".join("".join(char.lower() if char.isalnum() else " "
                            for char in text).split())


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--input", required=True, type=Path)
    cli.add_argument("--out", required=True, type=Path)
    cli.add_argument("--verbs", required=True, type=Path)
    args = cli.parse_args()
    payload = load(args.input)
    reject_resolved_input(payload)
    args.out.mkdir(parents=True, exist_ok=True)
    parser = Parser()
    coref = CoreferenceResolver(parser.nlp)
    verbs = set(load(args.verbs)["verbs"])
    byline = ", ".join(payload["article"]["authors"]) or "unknown"
    pieces = []
    ranges = []
    cursor = 0
    for unit in payload["units"]:
        if pieces:
            cursor += 1
        start = cursor
        pieces.append(unit["text"])
        cursor += len(unit["text"])
        ranges.append((unit["unitId"], start, cursor))
    document_text = " ".join(pieces)
    coreference = coref.artifact(document_text)
    resolved_units = {
        unit_id: apply_span_resolutions(
            document_text[start:end], coreference["replacementLog"], start)
        for unit_id, start, end in ranges
    }
    logs_by_unit = {
        unit_id: [
            row for row in coreference["replacementLog"]
            if start <= row["charStart"] < end
        ]
        for unit_id, start, end in ranges
    }
    parsed_units = []
    candidates = []
    docs = list(parser.nlp.pipe(
        (resolved_units[unit["unitId"]] for unit in payload["units"]),
        batch_size=12))
    for unit, doc in zip(payload["units"], docs, strict=True):
        parsed = type("Parsed", (), {"doc": doc})()
        split = split_attribution(parsed, verbs, {}, byline)
        content_doc = parser.nlp(split["content"])
        parsed_units.append({
            "unitId": unit["unitId"],
            "parse": ParsedText(text=resolved_units[unit["unitId"]], doc=doc).artifact(),
            "coreferenceApplied": logs_by_unit[unit["unitId"]],
            "split": split,
        })
        texts = [(text, False) for text in candidate_texts(content_doc)]
        for text in candidate_texts(doc, include_root=False):
            if all(text != existing for existing, _ in texts):
                texts.append((text, True))
        root_covered = any(testable(token) for token in content_doc
                            if token.dep_ == "ROOT")
        if not root_covered and any(token.pos_ == "VERB" for token in content_doc):
            if all(split["content"] != existing for existing, _ in texts):
                texts = [(split["content"], False)] + texts
        primary_seen = set()
        supplemental_seen = set()
        for text, supplemental in texts:
            key = normalized(text)
            if not key:
                continue
            if supplemental:
                if key in primary_seen or key in supplemental_seen:
                    continue
                supplemental_seen.add(key)
            else:
                if key in primary_seen:
                    continue
                primary_seen.add(key)
            candidate_doc = parser.nlp(text)
            candidates.append({
                "candidateId": f"C{len(candidates) + 1:04d}",
                "assertionText": text,
                "groundingUnitIds": [unit["unitId"]],
                "assertionSource": {
                    **split["source"],
                    "sourceUnitIds": [unit["unitId"]],
                },
                "attributionPattern": split["pattern"],
                "citedWorks": cited_works(content_doc, unit["unitId"]),
                "structuredForm": structured_form(candidate_doc),
            })
    write(args.out / "s1_parse.json", {
        "schemaVersion": "cf4.s1Parse.v2",
        "resolved": True,
        "coreference": coreference,
        "units": parsed_units,
    })
    write(args.out / "s2_attribution.json", {
        "schemaVersion": "cf4.s2Attribution.v1",
        "units": [{"unitId": unit["unitId"], "split": parsed["split"]}
                  for unit, parsed in zip(payload["units"], parsed_units, strict=True)],
    })
    write(args.out / "s3_candidates.json", {
        "schemaVersion": "cf4.s3Candidates.v1",
        "fixtureId": payload["fixtureId"],
        "candidates": candidates,
    })
    write(args.out / "s8_derived.json", {
        "schemaVersion": "cf4.s8Derived.v1",
        "rows": [{"candidateId": row["candidateId"], "citedWorks": row["citedWorks"],
                  "structuredForm": row["structuredForm"]} for row in candidates],
    })
    write(args.out / "manifest.json", {
        "schemaVersion": "cf4.phase1Manifest.v1",
        "fixtureId": payload["fixtureId"],
        "inputSha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
        "unitCount": len(payload["units"]),
        "candidateCount": len(candidates),
    })


if __name__ == "__main__":
    main()
