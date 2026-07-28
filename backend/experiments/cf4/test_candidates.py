from __future__ import annotations

import unittest

import spacy

from candidates import candidate_texts


class CandidateGenerationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nlp = spacy.load("en_core_web_trf")

    def test_nonfinite_result_advcl_is_additive(self):
        doc = self.nlp(
            "He said it was bad, describing severe damage to the animals' gut."
        )
        texts = candidate_texts(doc)
        self.assertTrue(any("He said" in text for text in texts))
        self.assertTrue(any("describing severe damage" in text for text in texts))

    def test_nested_finite_result_clause_is_emitted(self):
        doc = self.nlp(
            "He told them, accurately predicting that carbon dioxide at 450 ppm "
            "would bring about the reef's demise."
        )
        texts = candidate_texts(doc)
        self.assertTrue(any("450 ppm" in text and "demise" in text
                            for text in texts))

    def test_full_unit_supplement_excludes_root_wrapper(self):
        doc = self.nlp("He said it was bad, describing severe gut damage.")
        texts = candidate_texts(doc, include_root=False)
        self.assertFalse(any(text.startswith("He said") for text in texts))
        self.assertTrue(any("describing severe gut damage" in text
                            for text in texts))

    def test_candidate_generation_is_idempotent(self):
        text = (
            "He told them, accurately predicting that carbon dioxide at 450 ppm "
            "would bring about the reef's demise."
        )
        first = candidate_texts(self.nlp(text))
        second = {
            child
            for candidate in first
            for child in candidate_texts(self.nlp(candidate))
        }
        self.assertEqual(set(first), second)


if __name__ == "__main__":
    unittest.main()
