from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np


BACKEND = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(BACKEND / "src"))

from claimfoundry.cfx.retrieval.assertion_relative import (  # noqa: E402
    AssertionRelativeBlockRetriever,
)


class FakeEmbeddingBackend:
    identity = "fake-semantic-v1"

    def __init__(self) -> None:
        self.encode_batches: list[list[str]] = []

    def encode(self, texts):
        self.encode_batches.append(list(texts))
        rows = []
        for text in texts:
            lowered = text.lower()
            vector = np.asarray([
                1.0 if "physician" in lowered or "doctor" in lowered else 0.0,
                1.0 if "dismiss" in lowered or "turned down" in lowered or "rejected" in lowered else 0.0,
                1.0 if "appeal" in lowered or "petition" in lowered else 0.0,
                1.0 if "harbor" in lowered else 0.0,
            ], dtype=np.float32)
            if not vector.any():
                vector[-1] = 0.01
            vector /= np.linalg.norm(vector)
            rows.append(vector)
        return np.asarray(rows, dtype=np.float32)


def payload(assertion="The harbor authority reduced ferry delays.", blocks=None, **assertion_fields):
    return {
        "assertion": {
            "assertionId": "A1",
            "text": assertion,
            "aliases": assertion_fields.get("aliases", []),
            "requiredConceptGroups": assertion_fields.get("requiredConceptGroups", []),
        },
        "document": {
            "documentId": "D1",
            "blocks": blocks or [{"blockId": "S1", "text": "The harbor authority reduced ferry delays after changing its schedule."}],
        },
        "config": {
            "windowCharacterTarget": assertion_fields.get("windowCharacterTarget", 55),
            "sentenceOverlap": assertion_fields.get("sentenceOverlap", 0),
            "neighborWindowCount": assertion_fields.get("neighborWindowCount", 0),
            "minimumCombinedScore": assertion_fields.get("minimumCombinedScore", 0.18),
            "maximumSeedWindows": assertion_fields.get("maximumSeedWindows", 12),
            "maximumPackets": assertion_fields.get("maximumPackets", 8),
            "enableEmbeddings": assertion_fields.get("enableEmbeddings", False),
            "enableBm25": assertion_fields.get("enableBm25", True),
        },
    }


class AssertionRelativeRetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.retriever = AssertionRelativeBlockRetriever()

    def test_exact_phrase_hit(self):
        result = self.retriever.retrieve(payload())
        self.assertEqual(1, len(result["selectedPackets"]))
        self.assertIn("S1", result["selectedPackets"][0]["blockIds"])
        self.assertGreater(result["selectedPackets"][0]["scoreComponents"]["exactTermOverlap"], 0.8)

    def test_lemmatized_variant_hit(self):
        result = self.retriever.retrieve(payload(
            "The appellate court dismisses the petition.",
            [{"blockId": "S1", "text": "Yesterday the appellate judges dismissed two petitions."}],
        ))
        self.assertEqual(1, result["diagnostics"]["seedWindowCount"])
        self.assertGreater(result["selectedPackets"][0]["scoreComponents"]["lemmaOverlap"], 0.4)

    def test_alias_only_hit(self):
        result = self.retriever.retrieve(payload(
            "The regulator withheld the findings.",
            [{"blockId": "S1", "text": "The Orion memorandum was released Tuesday."}],
            aliases=["Orion memorandum"],
        ))
        self.assertEqual(["Orion memorandum"], result["selectedPackets"][0]["matchedAliases"])

    def test_fuzzy_multiword_alias_hit(self):
        result = self.retriever.retrieve(payload(
            "The regulator withheld the findings.",
            [{"blockId": "S1", "text": "The Northwynd environmental assessment was published."}],
            aliases=["Northwind environmental assessment"],
        ))
        self.assertEqual(1, result["diagnostics"]["seedWindowCount"])
        self.assertGreater(result["selectedPackets"][0]["scoreComponents"]["aliasSimilarity"], 0.92)

    def test_named_entity_plus_predicate_hit(self):
        result = self.retriever.retrieve(payload(
            "Maya Chen suppressed the records.",
            [{"blockId": "S1", "text": "Investigators wrote that Maya Chen suppressed several records."}],
        ))
        components = result["selectedPackets"][0]["scoreComponents"]
        self.assertGreater(components["entityOverlap"], 0)
        self.assertGreater(components["predicateOverlap"], 0)

    def test_semantic_paraphrase_found_through_embeddings(self):
        backend = FakeEmbeddingBackend()
        retriever = AssertionRelativeBlockRetriever(embedding_backend=backend)
        request = payload(
            "The physician dismissed the appeal.",
            [{"blockId": "S1", "text": "The doctor turned down the petition."}],
            enableEmbeddings=True,
            enableBm25=False,
            minimumCombinedScore=0.9,
        )
        result = retriever.retrieve(request)
        self.assertEqual(1, result["diagnostics"]["seedWindowCount"])
        self.assertGreaterEqual(result["selectedPackets"][0]["scoreComponents"]["embeddingSimilarity"], 0.72)

    def test_bm25_lexical_hit_without_exact_phrase(self):
        result = self.retriever.retrieve(payload(
            "Cobalt reactor leakage affected workers.",
            [
                {"blockId": "S1", "text": "A report described workers affected by leakage from the cobalt reactor."},
                {"blockId": "S2", "text": "The annual budget meeting ended at noon."},
            ],
            windowCharacterTarget=70,
            minimumCombinedScore=0.12,
        ))
        self.assertNotIn("cobalt reactor leakage affected workers", result["selectedPackets"][0]["text"].lower())
        self.assertGreater(result["selectedPackets"][0]["scoreComponents"]["bm25"], 0)

    def test_required_concept_group_satisfaction(self):
        result = self.retriever.retrieve(payload(
            "The coastal survey linked erosion to winter storms.",
            [{"blockId": "S1", "text": "A shoreline survey linked erosion to seasonal storms."}],
            aliases=["shoreline survey"],
            requiredConceptGroups=[["coastal survey", "shoreline survey"], ["winter storms", "seasonal storms"]],
        ))
        self.assertEqual(1.0, result["selectedPackets"][0]["scoreComponents"]["conceptGroupScore"])
        self.assertEqual(2, len(result["selectedPackets"][0]["satisfiedConceptGroups"]))

    def test_concept_group_failure_blocks_otherwise_topical_window(self):
        result = self.retriever.retrieve(payload(
            "The coastal survey linked erosion to winter storms.",
            [{"blockId": "S1", "text": "The coastal survey documented severe erosion during summer."}],
            requiredConceptGroups=[["coastal survey"], ["winter storms"]],
        ))
        self.assertEqual([], result["selectedPackets"])

    def test_neighboring_window_inclusion(self):
        result = self.retriever.retrieve(payload(
            "Falcon turbines failed inspection.",
            [
                {"blockId": "S1", "text": "Engineers arrived before sunrise."},
                {"blockId": "S2", "text": "Falcon turbines failed inspection."},
                {"blockId": "S3", "text": "The facility closed that afternoon."},
            ],
            windowCharacterTarget=30,
            neighborWindowCount=1,
            minimumCombinedScore=0.25,
        ))
        packet = result["selectedPackets"][0]
        self.assertEqual(["S1", "S2", "S3"], packet["blockIds"])
        self.assertEqual(2, len(packet["neighborWindowIds"]))

    def test_overlapping_windows_merge(self):
        result = self.retriever.retrieve(payload(
            "River levels increased rapidly.",
            [
                {"blockId": "S1", "text": "River levels increased rapidly after rain."},
                {"blockId": "S2", "text": "Observers said river levels increased rapidly overnight."},
            ],
            windowCharacterTarget=40,
        ))
        self.assertEqual(1, len(result["selectedPackets"]))
        self.assertEqual(2, len(result["selectedPackets"][0]["seedWindowIds"]))

    def test_duplicate_packet_prevention(self):
        result = self.retriever.retrieve(payload(
            "River levels increased rapidly.",
            [
                {"blockId": "S1", "text": "River levels increased rapidly. River levels increased rapidly again."},
                {"blockId": "S2", "text": "River levels increased rapidly overnight."},
            ],
            windowCharacterTarget=35,
            sentenceOverlap=1,
            neighborWindowCount=1,
        ))
        self.assertEqual(len(result["selectedPackets"]), len({row["packetId"] for row in result["selectedPackets"]}))
        self.assertEqual(1, len(result["selectedPackets"]))

    def test_no_hit_document(self):
        result = self.retriever.retrieve(payload(
            "Quantum sensors detected subterranean methane.",
            [{"blockId": "S1", "text": "The orchestra performed a baroque suite."}],
        ))
        self.assertEqual([], result["selectedPackets"])

    def test_maximum_seed_window_cap(self):
        blocks = [{"blockId": f"S{i}", "text": f"Harbor ferries reported delay number {i}."} for i in range(1, 6)]
        result = self.retriever.retrieve(payload(
            "Harbor ferries reported delays.", blocks,
            windowCharacterTarget=40,
            maximumSeedWindows=2,
            neighborWindowCount=0,
            minimumCombinedScore=0,
        ))
        self.assertEqual(2, result["diagnostics"]["seedWindowCount"])

    def test_stable_tie_breaking_prefers_earlier_window(self):
        result = self.retriever.retrieve(payload(
            "Harbor ferries reported delays.",
            [
                {"blockId": "S1", "text": "Harbor ferries reported delays."},
                {"blockId": "S2", "text": "Harbor ferries reported delays."},
            ],
            windowCharacterTarget=35,
            maximumSeedWindows=1,
            neighborWindowCount=0,
        ))
        self.assertEqual(["B0001"], result["selectedPackets"][0]["seedWindowIds"])

    def test_deterministic_repeatability_is_byte_stable(self):
        request = payload(
            "Northwind Labs reported lower emissions.",
            [
                {"blockId": "S1", "text": "A preliminary note was published."},
                {"blockId": "S2", "text": "Northwind Labs reported lower emissions in 2024."},
            ],
            aliases=["Northwind report"],
            neighborWindowCount=1,
        )
        before = json.loads(json.dumps(request))
        first = self.retriever.retrieve(request)
        second = self.retriever.retrieve(request)
        self.assertEqual(json.dumps(first, sort_keys=True), json.dumps(second, sort_keys=True))
        self.assertEqual(before, request)

    def test_embedding_cache_reuse(self):
        backend = FakeEmbeddingBackend()
        with tempfile.TemporaryDirectory() as directory:
            retriever = AssertionRelativeBlockRetriever(
                embedding_backend=backend,
                embedding_cache_directory=directory,
            )
            request = payload(
                "The physician dismissed the appeal.",
                [{"blockId": "S1", "text": "The doctor turned down the petition."}],
                enableEmbeddings=True,
            )
            first = retriever.retrieve(request)
            self.assertEqual(1, retriever.embedding_cache_misses)
            second = retriever.retrieve(request)
            self.assertEqual(1, retriever.embedding_cache_hits)
            self.assertEqual(first, second)
            window_batches = [batch for batch in backend.encode_batches if batch == ["The doctor turned down the petition."]]
            self.assertEqual(1, len(window_batches))

    def test_lexical_only_fallback_is_explicit(self):
        result = self.retriever.retrieve(payload(enableEmbeddings=False))
        self.assertEqual("disabled", result["diagnostics"]["embeddingMode"])
        self.assertEqual(0.0, result["selectedPackets"][0]["scoreComponents"]["embeddingSimilarity"])
        with self.assertRaisesRegex(RuntimeError, "explicit local EmbeddingBackend"):
            self.retriever.retrieve(payload(enableEmbeddings=True))


if __name__ == "__main__":
    unittest.main()
