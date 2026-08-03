"""JSON-file command line adapter for the deterministic retriever."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .retriever import AssertionRelativeBlockRetriever, SentenceTransformerEmbeddingBackend


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--embedding-model-cache", type=Path)
    parser.add_argument("--embedding-cache", type=Path)
    parser.add_argument("--lexical-only", action="store_true")
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    config = dict(payload.get("config", {}))
    config["enableEmbeddings"] = not args.lexical_only
    payload["config"] = config
    backend = None
    if not args.lexical_only:
        if args.embedding_model_cache is None:
            raise SystemExit("--embedding-model-cache is required unless --lexical-only is explicit")
        backend = SentenceTransformerEmbeddingBackend(args.embedding_model_cache)
    retriever = AssertionRelativeBlockRetriever(
        embedding_backend=backend,
        embedding_cache_directory=args.embedding_cache,
    )
    result = retriever.retrieve(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
