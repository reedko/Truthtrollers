from __future__ import annotations

import unittest
from pathlib import Path

from coreference import (
    CoreferenceResolver,
    apply_span_resolutions,
    possessive,
    reject_resolved_input,
    replacement_text,
    validate_replacement_log,
)


def log(text, original, replacement, start=0):
    char_start = text.index(original, start)
    return {
        "sentenceIndex": 0,
        "charStart": char_start,
        "charEnd": char_start + len(original),
        "originalSpan": original,
        "replacement": replacement,
        "clusterId": 0,
        "ruleFired": "TEST",
        "confidence": 1.0,
    }


class CoreferenceTests(unittest.TestCase):
    def test_document_level_runner_has_no_external_chunk_loop(self):
        source = Path(__file__).with_name("phase1.py").read_text(encoding="utf-8")
        self.assertNotIn("coreferenceChunks", source)
        self.assertIn('coreference = coref.artifact(document_text)', source)

    def test_already_resolved_input_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "S1 is run-once"):
            reject_resolved_input({"resolved": True})
        with self.assertRaisesRegex(ValueError, "S1 is run-once"):
            reject_resolved_input({"coreference": {"resolved": True}})

    def test_raw_input_is_accepted(self):
        self.assertIsNone(reject_resolved_input({
            "fixtureId": "CF1-F02", "units": [],
        }))

    def test_unclassified_non_pronominal_replacement_is_rejected(self):
        row = log("aluminum injected", "aluminum", "It")
        with self.assertRaises(AssertionError):
            validate_replacement_log([row])

    def test_model_linked_definite_description_is_allowed_and_idempotent(self):
        text = "The CDC said the agency revised the study."
        row = log(text, "the agency", "the CDC")
        row["ruleFired"] = "DEFINITE_DESCRIPTION"
        validate_replacement_log([row])
        resolved = apply_span_resolutions(text, [row])
        self.assertEqual("The CDC said the CDC revised the study.", resolved)
        self.assertEqual(resolved, apply_span_resolutions(resolved, []))

    def test_replacement_cannot_be_pronoun(self):
        row = log("It was old", "It", "It")
        with self.assertRaises(AssertionError):
            validate_replacement_log([row])

    def test_reflexives_are_rejected_by_hard_invariant(self):
        row = log("Australia itself", "itself", "Australia")
        with self.assertRaises(AssertionError):
            validate_replacement_log([row])

    def test_possessive_morphology(self):
        self.assertEqual("The Great Barrier Reef's",
                         replacement_text("its", "The Great Barrier Reef"))
        self.assertEqual("the oceans'", possessive("the oceans"))
        self.assertEqual("parents'", replacement_text("their", "parents’"))

    def test_f06_initial_pronoun_regression(self):
        text = "It was 25 million years old."
        row = log(text, "It", "The Great Barrier Reef")
        self.assertEqual("The Great Barrier Reef was 25 million years old.",
                         apply_span_resolutions(text, [row]))

    def test_f06_possessive_regression(self):
        text = "Warnings about its plight continued."
        row = log(text, "its", "The Great Barrier Reef's")
        self.assertEqual(
            "Warnings about The Great Barrier Reef's plight continued.",
            apply_span_resolutions(text, [row]))

    def test_non_pronominal_and_reflexive_golden_cases_unchanged(self):
        for text in [
            "the government of Australia itself",
            "corals must eject their algae",
            "thimerosal-containing vaccines",
            "aluminum injected intramuscularly",
        ]:
            self.assertEqual(text, apply_span_resolutions(text, []))

    def test_span_application_is_idempotent_when_s1_emits_no_second_pass_log(self):
        text = "It was old."
        first = apply_span_resolutions(
            text, [log(text, "It", "The Great Barrier Reef")])
        self.assertEqual(first, apply_span_resolutions(first, []))

    def test_representative_is_shortest_self_identifying_definite_np(self):
        profiles = [
            {"text": "reef", "isNominal": True, "containsPronoun": False,
             "canonicalText": "reef", "isDefiniteDescription": False,
             "properName": None, "tier": 1, "tokenCount": 1},
            {"text": "barrier reef", "isNominal": True, "containsPronoun": False,
             "canonicalText": "barrier reef", "isDefiniteDescription": False,
             "properName": None, "tier": 1, "tokenCount": 2},
            {"text": "the reef", "isNominal": True, "containsPronoun": False,
             "canonicalText": "the reef", "isDefiniteDescription": True,
             "properName": None, "tier": 2, "tokenCount": 2},
        ]
        selected = CoreferenceResolver._representative(profiles)
        self.assertEqual("the reef", selected["text"])

    def test_short_proper_name_beats_appositive(self):
        profiles = [
            {"text": "Antoniou", "isNominal": True,
             "isDefiniteDescription": False, "containsPronoun": False,
             "canonicalText": "Antoniou", "properName": "Antoniou",
             "properNameUnambiguous": True, "tokenCount": 1, "startChar": 20},
            {"text": "Antoniou, professor emeritus at King's College London",
             "isNominal": True, "isDefiniteDescription": False,
             "containsPronoun": False, "canonicalText": "Antoniou",
             "properName": "Antoniou", "properNameUnambiguous": True,
             "hasAppositive": True, "tokenCount": 8, "startChar": 50},
        ]
        selected = CoreferenceResolver._representative(profiles)
        self.assertEqual("Antoniou", selected["canonicalText"])
        self.assertNotIn("professor emeritus", selected["canonicalText"])

    def test_representative_is_stable_for_cluster_order(self):
        profiles = [
            {"text": "Antoniou, professor emeritus", "isNominal": True,
             "isDefiniteDescription": False, "containsPronoun": False,
             "canonicalText": "Antoniou", "properName": "Antoniou",
             "properNameUnambiguous": True, "tokenCount": 3, "startChar": 50},
            {"text": "Antoniou", "isNominal": True,
             "isDefiniteDescription": False, "containsPronoun": False,
             "canonicalText": "Antoniou", "properName": "Antoniou",
             "properNameUnambiguous": True, "tokenCount": 1, "startChar": 20},
        ]
        forward = CoreferenceResolver._representative(profiles)
        reverse = CoreferenceResolver._representative(list(reversed(profiles)))
        self.assertEqual(forward["canonicalText"], reverse["canonicalText"])

    def test_pronoun_like_entity_surface_cannot_be_representative(self):
        profiles = [
            {"text": "US", "isNominal": True,
             "isDefiniteDescription": False, "containsPronoun": False,
             "canonicalText": "US", "properName": "US",
             "properNameUnambiguous": True, "tokenCount": 1},
        ]
        self.assertIsNone(CoreferenceResolver._representative(profiles))

    def test_embedded_location_cannot_beat_proper_head_name(self):
        profiles = [
            {"text": "The Great Barrier Reef of Australia",
             "isNominal": True, "isDefiniteDescription": False,
             "containsPronoun": False,
             "canonicalText": "The Great Barrier Reef",
             "properName": "The Great Barrier Reef",
             "properNameUnambiguous": True, "tokenCount": 6},
            {"text": "the reef", "isNominal": True,
             "isDefiniteDescription": True, "containsPronoun": False,
             "canonicalText": "the reef", "properName": None,
             "tokenCount": 2},
        ]
        selected = CoreferenceResolver._representative(profiles)
        self.assertEqual("The Great Barrier Reef", selected["canonicalText"])

    def test_pronoun_bearing_nominal_cannot_be_representative(self):
        profiles = [
            {"text": "parents", "isNominal": True, "containsPronoun": False,
             "canonicalText": "parents", "isDefiniteDescription": False,
             "properName": None, "tier": 1, "tokenCount": 1},
            {"text": "parents and their children", "isNominal": True,
             "containsPronoun": True, "canonicalText": "parents and their children",
             "isDefiniteDescription": False, "properName": None,
             "tier": 1, "tokenCount": 4},
        ]
        selected = CoreferenceResolver._representative(profiles)
        self.assertIsNone(selected)

    def test_possessive_strips_trailing_appositive_punctuation(self):
        self.assertEqual("London's", possessive("London,"))


if __name__ == "__main__":
    unittest.main()
