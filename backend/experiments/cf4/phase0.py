from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
from pathlib import Path

from attribution import split_attribution
from coreference import CoreferenceResolver
from parser import Parser


def read_json(path: Path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, value):
    with path.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main() -> None:
    options = argparse.ArgumentParser()
    options.add_argument("--input", required=True, type=Path)
    options.add_argument("--out", required=True, type=Path)
    options.add_argument("--verbs", required=True, type=Path)
    args = options.parse_args()
    payload = read_json(args.input)
    verbs = set(read_json(args.verbs)["verbs"])
    parser = Parser()
    coref = CoreferenceResolver(parser.nlp)
    coref.reset_document()
    cluster_text = " ".join(row["text"] for row in payload["targetCluster"] if row["text"])
    coreference = coref.artifact(cluster_text)
    replacements = {
        row["mention"]: row["antecedent"]
        for row in coreference["spanResolutions"]
    }
    cluster_unit_ids = {row["unitId"] for row in payload["targetCluster"]}
    byline = ", ".join(payload["article"]["authors"]) or "unknown"
    rows = []
    for group, items in [
        ("target_cluster", payload["targetCluster"]),
        ("cf3_attribution_frames", payload["attributionFrameInventory"]),
    ]:
        for item in items:
            parsed = parser.parse(item["text"])
            grounded_in_cluster = bool(cluster_unit_ids.intersection(
                item.get("groundingUnitIds", [])))
            item_replacements = replacements if (group == "target_cluster"
                                                  or grounded_in_cluster) else {}
            rows.append({
                "group": group,
                "itemId": item.get("unitId", item.get("itemId")),
                "inputText": item["text"],
                "groundingUnitIds": item.get("groundingUnitIds", [item.get("unitId")]),
                "parse": parsed.artifact(),
                "split": split_attribution(parsed, verbs, item_replacements, byline),
            })
    args.out.mkdir(parents=True, exist_ok=True)
    write_json(args.out / "s1_parse.json", {
        "schemaVersion": "cf4.s1Parse.v1",
        "coreference": coreference,
        "rows": [{"group": row["group"], "itemId": row["itemId"], "parse": row["parse"]}
                 for row in rows],
    })
    write_json(args.out / "s2_attribution.json", {
        "schemaVersion": "cf4.s2Attribution.v1",
        "rows": [{key: value for key, value in row.items() if key != "parse"} for row in rows],
    })
    write_json(args.out / "provenance.json", {
        "schemaVersion": "cf4.phase0Provenance.v1",
        "python": platform.python_version(),
        "packages": {name: importlib.metadata.version(name)
                     for name in ["spacy", "en-core-web-trf", "fastcoref", "torch", "transformers"]},
        "parserModel": "en_core_web_trf",
        "coreferenceModel": "biu-nlp/f-coref (fastcoref default)",
        "inputPath": str(args.input),
        "reportingVerbsPath": str(args.verbs),
    })


if __name__ == "__main__":
    main()
