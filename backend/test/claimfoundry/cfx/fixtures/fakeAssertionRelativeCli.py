#!/usr/bin/env python3
"""Deterministic stand-in for assertion_relative.cli, used only by tests.

Mirrors cli.py's argument surface (--input, --output, --embedding-model-cache,
--embedding-cache, --lexical-only) with no ML dependencies, so the Node
packet-selection bridge can be exercised in sandboxes where retriever.py's
pinned spaCy/sentence-transformers stack is unavailable or incompatible with
the installed Python interpreter. This script implements no retrieval logic
of its own: it only replays canned responses supplied by the test.

Modes, selected via CFX_FAKE_CLI_MODE (default "respond"):
  respond   - look up a canned result by "<assertionId>::<documentId>" in the
              JSON file at CFX_FAKE_CLI_RESPONSES_PATH and write it verbatim.
  fail      - write to stderr and exit non-zero.
  hang      - sleep long enough to trigger the caller's bounded timeout.
  bad-json  - write invalid JSON to the output path and exit zero.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--embedding-model-cache")
    parser.add_argument("--embedding-cache")
    parser.add_argument("--lexical-only", action="store_true")
    args = parser.parse_args()

    mode = os.environ.get("CFX_FAKE_CLI_MODE", "respond")

    if mode == "hang":
        time.sleep(60)
        return

    if mode == "fail":
        sys.stderr.write("simulated packet-selection failure\n")
        sys.exit(3)

    if mode == "bad-json":
        with open(args.output, "w", encoding="utf-8") as handle:
            handle.write("{not valid json")
        return

    with open(args.input, encoding="utf-8") as handle:
        payload = json.load(handle)

    responses_path = os.environ["CFX_FAKE_CLI_RESPONSES_PATH"]
    with open(responses_path, encoding="utf-8") as handle:
        responses = json.load(handle)

    key = f"{payload['assertion']['assertionId']}::{payload['document']['documentId']}"
    if key not in responses:
        sys.stderr.write(f"no canned response for {key}\n")
        sys.exit(4)

    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(responses[key], handle)


if __name__ == "__main__":
    main()
