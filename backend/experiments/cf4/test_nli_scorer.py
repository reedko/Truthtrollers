from __future__ import annotations

import unittest

from score_phase1 import NLI, union_members, union_text


class UnionTests(unittest.TestCase):
    def test_members_are_unit_ordered_and_capped_at_three(self):
        candidates = [
            {"candidateId": "C4", "assertionText": "four",
             "groundingUnitIds": ["U0004"]},
            {"candidateId": "C2", "assertionText": "two",
             "groundingUnitIds": ["U0002"]},
            {"candidateId": "C3", "assertionText": "three",
             "groundingUnitIds": ["U0003"]},
            {"candidateId": "C1", "assertionText": "one",
             "groundingUnitIds": ["U0001"]},
        ]
        selected = union_members(candidates)
        self.assertEqual([item["candidateId"] for item in selected],
                         ["C1", "C2", "C3"])
        self.assertEqual(union_text(selected), "one. two. three.")


class NliDirectionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.nli = NLI()

    def test_candidate_to_gold_direction_and_probability(self):
        pairs = [
            ("A dog is running through a field.", "An animal is running."),
            ("A dog is running through a field.", "No animal is moving."),
        ]
        entailing, non_entailing = self.nli.probabilities(pairs)
        self.assertGreater(entailing, 0.9)
        self.assertLess(non_entailing, 0.1)


if __name__ == "__main__":
    unittest.main()
