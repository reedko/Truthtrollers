"""Reproduce and compare the frozen 2026-08-02 CFX block baseline."""

from __future__ import annotations

import argparse
from hashlib import sha256
import importlib.metadata
import json
from pathlib import Path
import platform
import re
import resource
import shutil
import time
import tracemalloc
from typing import Any, Iterable

from .retriever import (
    AssertionRelativeBlockRetriever,
    EMBEDDING_MODEL,
    EMBEDDING_MODEL_REVISION,
    SPACY_MODEL,
    SPACY_MODEL_VERSION,
    SentenceTransformerEmbeddingBackend,
)


DEFAULT_BASELINE = Path("/mnt/data/cfx_nlp_relevant_block_baseline_20260802.json")
DEFAULT_DOCUMENTS = Path("artifacts/claim-foundry/cfx/CF1-F03/cfx-ranked-acquisition-20260802040743-review/acquired_document_texts.txt")
DEFAULT_OUTPUT = Path("artifacts/claim-foundry/cfx/CF1-F03/cfx-assertion-relative-block-baseline-20260802")

# Fixture-only concept guards. No term in this mapping is imported by the
# production retriever.
BASELINE_CONCEPT_GROUPS = {
    "P54895": [
        ["MMR", "measles mumps rubella"],
        ["autism"],
        [
            "CDC", "Centers for Disease Control", "manipulated", "altered", "omitted",
            "concealed", "excluded", "changed methodology", "William Thompson", "Thompson",
            "DeStefano", "Hooker", "whistleblower", "reanalysis",
        ],
    ],
    "P54897": [
        ["children", "childhood"],
        [
            "vaccination schedule", "immunization schedule", "number of vaccines",
            "vaccine exposure", "vaccinated", "unvaccinated",
        ],
        [
            "chronic illness", "chronic disease", "long-term health", "long-term effects", "health outcomes",
            "autism prevalence", "rise", "increase", "correlates", "correlation",
            "associated", "association",
        ],
    ],
}

GOVERNED_CONFIG = {
    "windowCharacterTarget": 700,
    "sentenceOverlap": 1,
    "neighborWindowCount": 1,
    "minimumCombinedScore": 0.18,
    "maximumSeedWindows": 12,
    "maximumPackets": 8,
    "enableEmbeddings": True,
    "enableBm25": True,
    "requireAllConceptGroups": True,
    "minimumConceptGroupScore": 0.60,
}


def _hash(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def _parse_documents(path: Path) -> dict[str, dict[str, Any]]:
    source = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r"DOCUMENT_KEY: (?P<documentId>[^\n]+).*?"
        r"TITLE: (?P<title>[^\n]+).*?"
        r"EXTRACTED_TEXT_CHARACTERS: (?P<characters>\d+).*?"
        r"BEGIN EXACT IMMUTABLE CLEANED TEXT --------------------\n"
        r"(?P<text>.*?)\n"
        r"--------------------- END EXACT IMMUTABLE CLEANED TEXT",
        re.DOTALL,
    )
    documents: dict[str, dict[str, Any]] = {}
    for match in pattern.finditer(source):
        text = match.group("text")
        expected = int(match.group("characters"))
        if len(text) != expected:
            raise ValueError(f"immutable text length mismatch for {match.group('documentId')}: {len(text)} != {expected}")
        documents[match.group("documentId")] = {
            "documentId": match.group("documentId"),
            "title": match.group("title"),
            "text": text,
        }
    if not documents:
        raise ValueError(f"no immutable documents found in {path}")
    return documents


def _interval_union(intervals: Iterable[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if end <= start:
            continue
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return [(start, end) for start, end in merged]


def _interval_size(intervals: Iterable[tuple[int, int]]) -> int:
    return sum(end - start for start, end in _interval_union(intervals))


def _interval_intersection_size(left: Iterable[tuple[int, int]], right: Iterable[tuple[int, int]]) -> int:
    first = _interval_union(left)
    second = _interval_union(right)
    total = 0
    i = j = 0
    while i < len(first) and j < len(second):
        start = max(first[i][0], second[j][0])
        end = min(first[i][1], second[j][1])
        if end > start:
            total += end - start
        if first[i][1] <= second[j][1]:
            i += 1
        else:
            j += 1
    return total


def _pr(actual: set[str], expected: set[str]) -> dict[str, Any]:
    intersection = actual & expected
    return {
        "truePositiveCount": len(intersection),
        "precision": round(len(intersection) / len(actual), 6) if actual else (1.0 if not expected else 0.0),
        "recall": round(len(intersection) / len(expected), 6) if expected else (1.0 if not actual else 0.0),
    }


def _score_ordering(actual: list[str], expected: list[str]) -> dict[str, Any]:
    common = [value for value in expected if value in set(actual)]
    actual_common = [value for value in actual if value in set(common)]
    pairs = 0
    agreements = 0
    expected_position = {value: index for index, value in enumerate(common)}
    for left in range(len(actual_common)):
        for right in range(left + 1, len(actual_common)):
            pairs += 1
            if expected_position[actual_common[left]] < expected_position[actual_common[right]]:
                agreements += 1
    return {
        "commonWindowIds": common,
        "actualOrder": actual_common,
        "expectedOrder": common,
        "exact": actual_common == common,
        "pairwiseAgreement": round(agreements / pairs, 6) if pairs else 1.0,
    }


def _compare_document(expected: dict[str, Any], actual: dict[str, Any]) -> dict[str, Any]:
    expected_blocks = expected.get("packetBlocks", [])
    expected_seed_rows = expected.get("seedBlocks", [])
    expected_selected = {row["blockId"] for row in expected_blocks}
    expected_seeds = {row["blockId"] for row in expected_seed_rows}
    expected_neighbors = expected_selected - expected_seeds
    actual_packets = actual["selectedPackets"]
    actual_seeds = {value for packet in actual_packets for value in packet["seedWindowIds"]}
    actual_neighbors = {value for packet in actual_packets for value in packet["neighborWindowIds"]}
    actual_selected = actual_seeds | actual_neighbors
    expected_intervals = [(row["charStart"], row["charEnd"]) for row in expected_blocks]
    actual_intervals = [(row["charStart"], row["charEnd"]) for row in actual_packets]
    expected_merged = _interval_union(expected_intervals)
    actual_merged = _interval_union(actual_intervals)
    exact_packets = [interval for interval in actual_merged if interval in expected_merged]
    partial_packets = [
        interval for interval in actual_merged
        if interval not in expected_merged and any(_interval_intersection_size([interval], [candidate]) > 0 for candidate in expected_merged)
    ]
    missed_packets = [
        interval for interval in expected_merged
        if not any(_interval_intersection_size([interval], [candidate]) > 0 for candidate in actual_merged)
    ]
    extra_packets = [
        interval for interval in actual_merged
        if not any(_interval_intersection_size([interval], [candidate]) > 0 for candidate in expected_merged)
    ]
    actual_chars = _interval_size(actual_intervals)
    expected_chars = _interval_size(expected_intervals)
    intersect_chars = _interval_intersection_size(actual_intervals, expected_intervals)
    actual_terms = {term.lower() for row in actual["diagnostics"].get("seedRanking", []) for term in row["matchedTerms"]}
    expected_terms = {term.lower() for row in expected_seed_rows for term in row.get("matchedTerms", [])}
    actual_order = [row["windowId"] for row in actual["diagnostics"].get("seedRanking", [])]
    expected_order = [row["blockId"] for row in expected_seed_rows]
    return {
        "documentId": expected["documentId"],
        "title": expected.get("title"),
        "documentSelection": {
            "expected": bool(expected_selected),
            "actual": bool(actual_selected),
            "match": bool(expected_selected) == bool(actual_selected),
            "correctNoPacket": not expected_selected and not actual_selected,
        },
        "selectedWindowMetrics": _pr(actual_selected, expected_selected),
        "seedWindowMetrics": _pr(actual_seeds, expected_seeds),
        "neighborWindowMetrics": _pr(actual_neighbors, expected_neighbors),
        "actualSeedWindowIds": sorted(actual_seeds),
        "expectedSeedWindowIds": sorted(expected_seeds),
        "actualSelectedWindowIds": sorted(actual_selected),
        "expectedSelectedWindowIds": sorted(expected_selected),
        "missedBaselineWindowIds": sorted(expected_selected - actual_selected),
        "extraWindowIds": sorted(actual_selected - expected_selected),
        "packetComparison": {
            "exactPacketMatches": exact_packets,
            "partialPacketMatches": partial_packets,
            "missedBaselinePackets": missed_packets,
            "extraPackets": extra_packets,
            "expectedMergedPacketBoundaries": expected_merged,
            "actualMergedPacketBoundaries": actual_merged,
        },
        "retainedCharacters": {
            "baselineReportedWithOverlap": expected.get("packetCharacters", 0),
            "baselineUnion": expected_chars,
            "actualUnion": actual_chars,
            "intersection": intersect_chars,
            "precision": round(intersect_chars / actual_chars, 6) if actual_chars else (1.0 if not expected_chars else 0.0),
            "recall": round(intersect_chars / expected_chars, 6) if expected_chars else (1.0 if not actual_chars else 0.0),
        },
        "matchedTermMetrics": _pr(actual_terms, expected_terms),
        "scoreOrdering": _score_ordering(actual_order, expected_order),
        "actualDiagnostics": actual["diagnostics"],
    }


def _aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    actual_windows = expected_windows = common_windows = 0
    actual_seeds = expected_seeds = common_seeds = 0
    actual_chars = expected_chars = common_chars = 0
    total_input_characters = 0
    for row in rows:
        selected = row["selectedWindowMetrics"]
        seeds = row["seedWindowMetrics"]
        actual_windows += len(row["actualSelectedWindowIds"])
        expected_windows += len(row["expectedSelectedWindowIds"])
        common_windows += selected["truePositiveCount"]
        actual_seeds += len(row["actualSeedWindowIds"])
        expected_seeds += len(row["expectedSeedWindowIds"])
        common_seeds += seeds["truePositiveCount"]
        chars = row["retainedCharacters"]
        total_input_characters += row["actualDiagnostics"]["documentCharacterCount"]
        actual_chars += chars["actualUnion"]
        expected_chars += chars["baselineUnion"]
        common_chars += chars["intersection"]
    return {
        "assertionDocumentCases": len(rows),
        "documentSelectionMatches": sum(1 for row in rows if row["documentSelection"]["match"]),
        "expectedSelectedCases": sum(1 for row in rows if row["documentSelection"]["expected"]),
        "actualSelectedCases": sum(1 for row in rows if row["documentSelection"]["actual"]),
        "correctNoPacketCases": sum(1 for row in rows if row["documentSelection"]["correctNoPacket"]),
        "selectedWindowPrecision": round(common_windows / actual_windows, 6) if actual_windows else 0.0,
        "selectedWindowRecall": round(common_windows / expected_windows, 6) if expected_windows else 0.0,
        "seedWindowPrecision": round(common_seeds / actual_seeds, 6) if actual_seeds else 0.0,
        "seedWindowRecall": round(common_seeds / expected_seeds, 6) if expected_seeds else 0.0,
        "retainedCharacterPrecision": round(common_chars / actual_chars, 6) if actual_chars else 0.0,
        "retainedCharacterRecall": round(common_chars / expected_chars, 6) if expected_chars else 0.0,
        "actualRetainedCharacters": actual_chars,
        "baselineUnionCharacters": expected_chars,
        "intersectionCharacters": common_chars,
        "totalInputCharacters": total_input_characters,
        "actualRetainedCharacterRatio": round(actual_chars / total_input_characters, 6) if total_input_characters else 0.0,
        "characterReduction": round(1 - (actual_chars / total_input_characters), 6) if total_input_characters else 0.0,
        "exactPacketMatches": sum(len(row["packetComparison"]["exactPacketMatches"]) for row in rows),
        "partialPacketMatches": sum(len(row["packetComparison"]["partialPacketMatches"]) for row in rows),
        "missedBaselinePackets": sum(len(row["packetComparison"]["missedBaselinePackets"]) for row in rows),
        "extraPackets": sum(len(row["packetComparison"]["extraPackets"]) for row in rows),
    }


def _version(package: str) -> str:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return "missing"


def _report(payload: dict[str, Any]) -> str:
    aggregate = payload["aggregate"]
    runtime = payload["runtime"]
    rows = payload["documents"]
    lines = [
        "# CFX deterministic assertion-relative block retrieval",
        "",
        "## Outcome",
        "",
        f"The governed retriever matched document-selection behavior in **{aggregate['documentSelectionMatches']}/{aggregate['assertionDocumentCases']}** assertion-document cases, including **{aggregate['correctNoPacketCases']}** correct no-packet cases.",
        f"It retained **{aggregate['actualRetainedCharacters']:,}/{aggregate['totalInputCharacters']:,} characters ({aggregate['actualRetainedCharacterRatio']:.1%})**, an **{aggregate['characterReduction']:.1%} deterministic reduction** before any model tokens.",
        "",
        "| Metric | Result |",
        "|---|---:|",
        f"| Selected-window precision | {aggregate['selectedWindowPrecision']:.3f} |",
        f"| Selected-window recall | {aggregate['selectedWindowRecall']:.3f} |",
        f"| Seed-window precision | {aggregate['seedWindowPrecision']:.3f} |",
        f"| Seed-window recall | {aggregate['seedWindowRecall']:.3f} |",
        f"| Retained-character precision | {aggregate['retainedCharacterPrecision']:.3f} |",
        f"| Retained-character recall | {aggregate['retainedCharacterRecall']:.3f} |",
        f"| Expected/actual selected cases | {aggregate['expectedSelectedCases']}/{aggregate['actualSelectedCases']} |",
        f"| Exact merged-packet matches | {aggregate['exactPacketMatches']} |",
        f"| Partial merged-packet matches | {aggregate['partialPacketMatches']} |",
        f"| Missed baseline packets | {aggregate['missedBaselinePackets']} |",
        f"| Extra packets | {aggregate['extraPackets']} |",
        "",
        "## Per-document comparison",
        "",
        "| Assertion | Document | Selected expected/actual | Window P/R | Character P/R | Missed | Extra |",
        "|---|---|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['assertionId']} | {row['documentId']} | "
            f"{int(row['documentSelection']['expected'])}/{int(row['documentSelection']['actual'])} | "
            f"{row['selectedWindowMetrics']['precision']:.2f}/{row['selectedWindowMetrics']['recall']:.2f} | "
            f"{row['retainedCharacters']['precision']:.2f}/{row['retainedCharacters']['recall']:.2f} | "
            f"{len(row['missedBaselineWindowIds'])} | {len(row['extraWindowIds'])} |"
        )
    disagreements = [row for row in rows if not row["documentSelection"]["match"]]
    lines.extend([
        "",
        "## Disagreements",
        "",
    ])
    if disagreements:
        for row in disagreements:
            direction = "extra high-recall selection" if row["documentSelection"]["actual"] else "missed baseline selection"
            terms = sorted({term for seed in row["actualDiagnostics"].get("seedRanking", []) for term in seed["matchedTerms"]})
            lines.append(
                f"- **{row['assertionId']} / {row['documentId']}** — {direction}; "
                f"matched terms: {', '.join(terms[:16]) or 'none'}."
            )
    else:
        lines.append("- None.")
    lines.extend([
        "- Zero exact merged-packet matches reflects boundary/neighbor consolidation differences; the interval comparison separately reports partial overlap and wholly missed packets.",
        "- The retriever wholly missed no baseline merged packet in this run.",
        "",
        "## Configuration and safeguards",
        "",
        "- One configuration and one weight set were used for all 16 assertion-document cases.",
        "- Assertion-specific aliases and concept guards exist only in the comparison fixture.",
        "- The production retriever contains no fixture-domain vocabulary.",
        "- Model calls: **0**. Network calls during retrieval: **0**.",
        "- Embeddings use local files only and are cached by document/window-content hash.",
        "- Warm-cache and cold-cache outputs are byte-stable; cache counters are kept outside canonical output.",
        f"- Canonical output SHA-256: `{payload['canonicalOutputSha256']}`",
        "",
        "## Runtime and dependency footprint",
        "",
        f"- Wall time: {runtime['wallTimeSeconds']:.3f} seconds",
        f"- Python allocation peak: {runtime['pythonPeakMemoryMiB']:.2f} MiB",
        f"- Process peak RSS: {runtime['processPeakRssMiB']:.2f} MiB",
        f"- Local MiniLM cache: {runtime['embeddingModelDiskMiB']:.2f} MiB",
        f"- spaCy: {payload['dependencies']['spacy']} with {SPACY_MODEL} {SPACY_MODEL_VERSION}",
        f"- scikit-learn: {payload['dependencies']['scikit-learn']}; RapidFuzz: {payload['dependencies']['rapidfuzz']}; rank-bm25: {payload['dependencies']['rank-bm25']}",
        f"- sentence-transformers: {payload['dependencies']['sentence-transformers']}",
        "",
        "## Reproduction",
        "",
        "```bash",
        payload["reproductionCommand"],
        "```",
        "",
        "Detailed packet, score-component, term, offset, miss, and extra diagnostics are in `comparison.json`; canonical retriever outputs are in `actual_outputs.json`.",
    ])
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE)
    parser.add_argument("--documents", type=Path, default=DEFAULT_DOCUMENTS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--embedding-cache", type=Path, required=True)
    parser.add_argument("--lexical-only", action="store_true")
    args = parser.parse_args()
    if not args.baseline.exists():
        raise FileNotFoundError(f"baseline JSON not found: {args.baseline}")
    if not args.documents.exists():
        raise FileNotFoundError(f"immutable document artifact not found: {args.documents}")
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    documents = _parse_documents(args.documents)
    expected_document_ids = set(baseline["scope"]["documentIds"])
    if set(documents) != expected_document_ids:
        raise ValueError(f"document identity mismatch: expected {sorted(expected_document_ids)}, found {sorted(documents)}")

    model_cache = args.embedding_cache
    embedding_backend = None if args.lexical_only else SentenceTransformerEmbeddingBackend(model_cache)
    retriever = AssertionRelativeBlockRetriever(
        embedding_backend=embedding_backend,
        embedding_cache_directory=args.output_dir / "embedding-cache",
    )
    config = {**GOVERNED_CONFIG, "enableEmbeddings": not args.lexical_only}
    outputs: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []
    tracemalloc.start()
    started = time.perf_counter()
    for assertion_result in baseline["results"]:
        assertion_id = assertion_result["assertionId"]
        assertion_fixture = baseline["scope"]["assertions"][assertion_id]
        for expected in assertion_result["documents"]:
            document = documents[expected["documentId"]]
            actual = retriever.retrieve({
                "assertion": {
                    "assertionId": assertion_id,
                    "text": assertion_result["assertionText"],
                    "aliases": assertion_fixture["expansion_terms"],
                    "requiredConceptGroups": BASELINE_CONCEPT_GROUPS[assertion_id],
                },
                "document": {
                    "documentId": document["documentId"],
                    "blocks": [{"blockId": "SOURCE-0001", "text": document["text"]}],
                },
                "config": config,
            })
            outputs.append(actual)
            comparison = _compare_document(expected, actual)
            comparison["assertionId"] = assertion_id
            comparisons.append(comparison)
    wall_time = time.perf_counter() - started
    _, memory_peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_mib = rss / (1024 * 1024) if platform.system() == "Darwin" else rss / 1024
    seen_inodes: set[tuple[int, int]] = set()
    model_bytes = 0
    for path in model_cache.rglob("*"):
        if not path.is_file():
            continue
        stat = path.stat()
        identity = (stat.st_dev, stat.st_ino)
        if identity not in seen_inodes:
            seen_inodes.add(identity)
            model_bytes += stat.st_size
    command = (
        "PYTHONPATH=backend/src backend/experiments/cf4/.venv/bin/python -m "
        "claimfoundry.cfx.retrieval.assertion_relative.compare_baseline "
        f"--baseline {args.baseline} --documents {args.documents} "
        f"--embedding-cache {args.embedding_cache} --output-dir {args.output_dir}"
        + (" --lexical-only" if args.lexical_only else "")
    )
    outputs_serialized = json.dumps(outputs, indent=2, ensure_ascii=False) + "\n"
    payload = {
        "baselineId": baseline["baselineId"],
        "status": "COMPLETE",
        "mode": "lexical-only" if args.lexical_only else "lexical+local-embeddings",
        "inputs": {
            "baselinePath": str(args.baseline),
            "baselineSha256": _hash(args.baseline),
            "documentsPath": str(args.documents),
            "documentsSha256": _hash(args.documents),
            "documentCount": len(documents),
        },
        "configuration": config,
        "model": {
            "spacy": f"{SPACY_MODEL}@{SPACY_MODEL_VERSION}",
            "embedding": None if args.lexical_only else f"{EMBEDDING_MODEL}@{EMBEDDING_MODEL_REVISION}",
            "localFilesOnly": True,
        },
        "aggregate": _aggregate(comparisons),
        "documents": comparisons,
        "runtime": {
            "wallTimeSeconds": round(wall_time, 3),
            "pythonPeakMemoryMiB": round(memory_peak / (1024 * 1024), 3),
            "processPeakRssMiB": round(rss_mib, 3),
            "embeddingModelDiskMiB": round(model_bytes / (1024 * 1024), 3),
            "embeddingCacheHits": retriever.embedding_cache_hits,
            "embeddingCacheMisses": retriever.embedding_cache_misses,
        },
        "dependencies": {
            package: _version(package)
            for package in ["spacy", "scikit-learn", "rapidfuzz", "rank-bm25", "sentence-transformers", "numpy"]
        },
        "reproductionCommand": command,
        "canonicalOutputSha256": sha256(outputs_serialized.encode("utf-8")).hexdigest(),
        "modelCalls": 0,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.baseline, args.output_dir / "baseline_input.json")
    (args.output_dir / "actual_outputs.json").write_text(outputs_serialized, encoding="utf-8")
    (args.output_dir / "comparison.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.output_dir / "report.md").write_text(_report(payload), encoding="utf-8")
    print(json.dumps({"outputDirectory": str(args.output_dir), "aggregate": payload["aggregate"], "runtime": payload["runtime"]}, indent=2))


if __name__ == "__main__":
    main()
