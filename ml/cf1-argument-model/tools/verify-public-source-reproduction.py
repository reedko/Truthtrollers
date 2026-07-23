#!/usr/bin/env python3
"""Re-run supplied mapping converters against official public source releases."""

from __future__ import annotations

import argparse
import glob
import hashlib
import io
import json
import subprocess
import tempfile
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE_ROOT = PROJECT_ROOT / "data/annotation-prompts/stupidity"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_paths(paths: list[Path], root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def read_jsonl(value: bytes) -> list[dict[str, Any]]:
    return [json.loads(line) for line in value.decode("utf-8").splitlines() if line.strip()]


def load_converter(archive: Path, member: str) -> tuple[dict[str, Any], bytes]:
    with zipfile.ZipFile(archive) as bundle:
        source = bundle.read(member)
    namespace: dict[str, Any] = {"__name__": f"verified_{member.replace('.', '_')}"}
    exec(compile(source, f"{archive}!/{member}", "exec"), namespace)
    return namespace, source


def git_commit(root: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def verify_microtexts(archive: Path, official_root: Path) -> dict[str, Any]:
    namespace, converter_source = load_converter(archive, "convert_microtexts.py")
    official_files = sorted((official_root / "corpus/en").glob("*.xml"))
    if len(official_files) != 112:
        raise ValueError(f"Expected 112 official Microtexts XML files, found {len(official_files)}")
    report: Counter[str] = Counter()
    generated_rows = []
    generated_queue = []
    for path in official_files:
        rows, queued = namespace["convert"](str(path), report)
        generated_rows.extend(rows)
        generated_queue.extend(queued)
    with zipfile.ZipFile(archive) as bundle:
        mapped_bytes = bundle.read("public_argmicrotexts_mapped.jsonl")
        queued_bytes = bundle.read("public_argmicrotexts_queued.jsonl")
    supplied_rows = read_jsonl(mapped_bytes)
    supplied_queue = read_jsonl(queued_bytes)
    rows_match = [canonical_json(row) for row in generated_rows] == [
        canonical_json(row) for row in supplied_rows
    ]
    queue_match = [canonical_json(row) for row in generated_queue] == [
        canonical_json(row) for row in supplied_queue
    ]
    return {
        "officialUrl": "https://github.com/peldszus/arg-microtexts",
        "officialGitCommit": git_commit(official_root),
        "officialEnglishXmlSha256": sha256_paths(official_files, official_root),
        "converterSha256": sha256_bytes(converter_source),
        "mappedMemberSha256": sha256_bytes(mapped_bytes),
        "officialDocuments": len(official_files),
        "generatedRows": len(generated_rows),
        "suppliedRows": len(supplied_rows),
        "generatedQueued": len(generated_queue),
        "suppliedQueued": len(supplied_queue),
        "mappedRowsExactMatch": rows_match,
        "queuedRowsExactMatch": queue_match,
        "verified": rows_match and queue_match,
    }


def safe_extract_zip_bytes(value: bytes, destination: Path) -> None:
    with zipfile.ZipFile(io.BytesIO(value)) as bundle:
        for info in bundle.infolist():
            member = Path(info.filename)
            if member.is_absolute() or ".." in member.parts:
                raise ValueError(f"Unsafe official ZIP member: {info.filename}")
            if info.is_dir():
                continue
            target = destination / member
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(info))


def verify_aaec(archive: Path, official_zip: Path) -> dict[str, Any]:
    namespace, converter_source = load_converter(archive, "convert_aaec.py")
    with zipfile.ZipFile(official_zip) as outer:
        brat_bytes = outer.read("ArgumentAnnotatedEssays-2.0/brat-project-final.zip")
        prompts_bytes = outer.read("ArgumentAnnotatedEssays-2.0/prompts.csv")
        splits_bytes = outer.read("ArgumentAnnotatedEssays-2.0/train-test-split.csv")
    with tempfile.TemporaryDirectory(prefix="cf1-aaec-source-verify-") as temp_value:
        temp = Path(temp_value)
        safe_extract_zip_bytes(brat_bytes, temp)
        meta = temp / "meta"
        meta.mkdir()
        (meta / "prompts.csv").write_bytes(prompts_bytes)
        (meta / "train-test-split.csv").write_bytes(splits_bytes)
        namespace["AAEC"] = str(temp / "brat-project-final")
        namespace["META"] = str(meta)
        prompts, splits = namespace["load_meta"]()
        documents = sorted(
            Path(path).stem
            for path in glob.glob(str(temp / "brat-project-final" / "*.ann"))
        )
        report: Counter[str] = Counter()
        generated_rows = []
        generated_queue = []
        for document in documents:
            rows, queued = namespace["convert"](document, prompts, splits, report)
            generated_rows.extend(rows)
            generated_queue.extend(queued)
    with zipfile.ZipFile(archive) as bundle:
        mapped_bytes = bundle.read("public_aaec_mapped.jsonl")
    supplied_rows = read_jsonl(mapped_bytes)
    rows_match = [canonical_json(row) for row in generated_rows] == [
        canonical_json(row) for row in supplied_rows
    ]
    return {
        "officialUrl": "https://tudatalib.ulb.tu-darmstadt.de/handle/tudatalib/2422",
        "officialZipSha256": sha256_file(official_zip),
        "officialBratZipSha256": sha256_bytes(brat_bytes),
        "converterSha256": sha256_bytes(converter_source),
        "mappedMemberSha256": sha256_bytes(mapped_bytes),
        "officialDocuments": len(documents),
        "generatedRows": len(generated_rows),
        "suppliedRows": len(supplied_rows),
        "converterQueuedRows": len(generated_queue),
        "mappedRowsExactMatch": rows_match,
        "verified": rows_match and len(documents) == 402,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--microtexts-archive", type=Path, default=DEFAULT_ARCHIVE_ROOT / "files.zip")
    parser.add_argument("--aaec-archive", type=Path, default=DEFAULT_ARCHIVE_ROOT / "files (1).zip")
    parser.add_argument("--official-microtexts-root", type=Path, required=True)
    parser.add_argument("--official-aaec-zip", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    microtexts = verify_microtexts(args.microtexts_archive, args.official_microtexts_root)
    aaec = verify_aaec(args.aaec_archive, args.official_aaec_zip)
    result = {
        "schemaVersion": "cf1.publicSourceReproduction.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "allMappedRowsVerified": microtexts["verified"] and aaec["verified"],
        "sources": {
            "arg-microtexts": microtexts,
            "argument-annotated-essays-v2": aaec,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    if not result["allMappedRowsVerified"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
