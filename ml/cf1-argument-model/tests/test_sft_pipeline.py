from __future__ import annotations

import json
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "training"))
sys.path.insert(0, str(PROJECT_ROOT / "evaluation"))

from cf1_sft import (  # noqa: E402
    project_output,
    render_row,
    resample_task_fixture,
    task_mix_for_rows,
)
from score_predictions import extraction_counts, set_f1  # noqa: E402


PUBLIC_COMPILER_PATH = PROJECT_ROOT / "tools/compile-public-argument-warmup.py"
PUBLIC_COMPILER_SPEC = importlib.util.spec_from_file_location(
    "compile_public_argument_warmup", PUBLIC_COMPILER_PATH
)
assert PUBLIC_COMPILER_SPEC and PUBLIC_COMPILER_SPEC.loader
PUBLIC_COMPILER = importlib.util.module_from_spec(PUBLIC_COMPILER_SPEC)
PUBLIC_COMPILER_SPEC.loader.exec_module(PUBLIC_COMPILER)


class SftRendererTests(unittest.TestCase):
    def test_annotation_only_ids_are_not_completion_targets(self) -> None:
        row = {
            "rowId": "F:extract:1",
            "fixtureId": "F",
            "task": "extract_assertions",
            "input": {"sourceUnits": [{"unitId": "U1", "text": "A is B."}]},
            "output": {
                "assertions": [
                    {
                        "argumentUnitId": "AU999",
                        "proposition": "A is B.",
                        "groundingUnitIds": ["U1"],
                        "scopeQualifiers": [],
                    }
                ]
            },
        }
        rendered = render_row(row)
        completion = rendered["completion"][0]["content"]
        self.assertNotIn("AU999", completion)
        self.assertNotIn("argumentUnitId", completion)
        self.assertIn("A is B", completion)

    def test_relation_id_is_not_a_completion_target(self) -> None:
        row = {
            "rowId": "F:relate:1",
            "fixtureId": "F",
            "task": "relate",
            "input": {"from": {}, "to": {}, "orientation": {}},
            "output": {
                "relationId": "REL999",
                "relationType": "supports",
                "basis": "The first supports the second.",
            },
        }
        self.assertEqual(
            project_output(row),
            {"relationType": "supports"},
        )

    def test_evidence_target_leak_is_rejected(self) -> None:
        row = {
            "rowId": "F:select:1",
            "fixtureId": "F",
            "task": "select",
            "input": {"evidenceTarget": "forbidden"},
            "output": {"include": True, "basis": "material"},
        }
        with self.assertRaisesRegex(ValueError, "leaked"):
            render_row(row)

    def test_balancing_is_seeded_and_fixture_aware(self) -> None:
        rows = []
        for fixture, count in (("F1", 20), ("F2", 2)):
            for index in range(count):
                rows.append(
                    {
                        "rowId": f"{fixture}:{index}",
                        "fixtureId": fixture,
                        "task": "attribute",
                        "prompt": [],
                        "completion": [],
                    }
                )
        first = resample_task_fixture(rows, 100, 7, {"attribute": 1.0})
        second = resample_task_fixture(rows, 100, 7, {"attribute": 1.0})
        self.assertEqual(
            [item["sampleId"] for item in first],
            [item["sampleId"] for item in second],
        )
        fixture_counts = {
            fixture: sum(item["fixtureId"] == fixture for item in first)
            for fixture in ("F1", "F2")
        }
        self.assertLess(abs(fixture_counts["F1"] - fixture_counts["F2"]), 30)

    def test_public_tasks_render_without_cf1_semantic_relabeling(self) -> None:
        row = {
            "rowId": "public:extract:1",
            "fixtureId": "public:doc1",
            "task": "extract_argument_span",
            "trainingGoldStatus": "public_mapped",
            "corpus": {"id": "public-example"},
            "input": {"sourceUnits": [{"unitId": "S1", "text": "A component."}]},
            "output": {
                "components": [
                    {
                        "text": "A component.",
                        "groundingUnitIds": ["S1"],
                        "componentType": "premise",
                    }
                ]
            },
        }
        rendered = render_row(row)
        self.assertEqual(rendered["trainingGoldStatus"], "public_mapped")
        self.assertEqual(rendered["corpusId"], "public-example")
        self.assertIn('"task":"extract_argument_span"', rendered["prompt"][1]["content"])
        self.assertNotIn("material atomic factual assertion", rendered["prompt"][1]["content"])
        self.assertEqual(
            json.loads(rendered["completion"][0]["content"]), row["output"]
        )

    def test_public_and_cf1_rows_cannot_share_one_balancing_policy(self) -> None:
        rows = [
            {"task": "extract_argument_span"},
            {"task": "extract_assertions"},
        ]
        with self.assertRaisesRegex(ValueError, "separate stages"):
            task_mix_for_rows(rows)


class PublicWarmupCompilerTests(unittest.TestCase):
    @staticmethod
    def _source_row(
        task: str,
        ordinal: int,
        inp: dict,
        out: dict,
        source_label: str,
    ) -> dict:
        corpus_id = "argument-annotated-essays-v2"
        return {
            "schemaVersion": "cf1.publicMappedTaskRow.v1",
            "rowId": f"pub:{corpus_id}:essay001:{task}:{ordinal:03d}",
            "fixtureId": f"pub:{corpus_id}:essay001",
            "task": task,
            "corpus": {"id": corpus_id, "version": "test"},
            "provenance": {
                "sourceDocumentId": "essay001",
                "sourceSplit": "train",
                "annotationOrigin": "human",
                "sourceLabel": source_label,
            },
            "input": inp,
            "output": out,
        }

    def test_transform_quarantines_generic_attack_and_inferred_labels(self) -> None:
        units = [
            {"unitId": "S1", "text": "First component."},
            {"unitId": "S2", "text": "Second component."},
        ]
        endpoint1 = {
            "candidateId": "T1",
            "proposition": "First component.",
            "localContext": [units[0]],
        }
        endpoint2 = {
            "candidateId": "T2",
            "proposition": "Second component.",
            "localContext": [units[1]],
        }
        rows = [
            self._source_row(
                "extract_assertions",
                1,
                {"sourceUnits": units},
                {
                    "assertions": [
                        {
                            "proposition": "First component.",
                            "groundingUnitIds": ["S1"],
                        },
                        {
                            "proposition": "Second component.",
                            "groundingUnitIds": ["S2"],
                        },
                    ]
                },
                "brat-T-spans",
            ),
            self._source_row(
                "detect_assertions",
                1,
                {"sourceUnits": [{"unitId": "S0", "text": "Unannotated context."}]},
                {"classification": "no_material_assertion"},
                "brat-span-presence",
            ),
            self._source_row(
                "detect_assertions",
                2,
                {"sourceUnits": [units[0]]},
                {"classification": "no_material_assertion"},
                "brat-span-presence",
            ),
            self._source_row(
                "relate",
                1,
                {"from": endpoint1, "to": endpoint2},
                {"relationType": "supports"},
                "supports",
            ),
            self._source_row(
                "relate",
                2,
                {"from": endpoint2, "to": endpoint1},
                {"relationType": "rebuts"},
                "attacks",
            ),
            self._source_row(
                "deployment",
                1,
                endpoint1,
                {"contentStance": "supports_thesis"},
                "Premise:For",
            ),
            self._source_row(
                "orientation",
                1,
                {"sourceUnits": units},
                {"thesis": "First component."},
                "MajorClaim+prompt",
            ),
        ]
        accepted, queued, report = PUBLIC_COMPILER.transform_corpus(
            rows, "argument-annotated-essays-v2"
        )
        tasks = [row["task"] for row in accepted]
        self.assertEqual(tasks.count("extract_argument_span"), 2)
        self.assertEqual(tasks.count("detect_argument_component"), 1)
        self.assertEqual(tasks.count("classify_argument_relation"), 1)
        self.assertNotIn("deployment", tasks)
        self.assertNotIn("orientation", tasks)
        self.assertEqual(
            {item["reason"] for item in queued},
            {
                "generic_attack_cannot_be_mapped_to_rebuts_or_contradicts",
                "negative_detection_contains_annotated_component_text",
            },
        )
        self.assertEqual(report["queued_generic_attack"], 1)
        self.assertEqual(report["queued_ambiguous_detection_negative"], 1)
        self.assertEqual(report["excluded_inferred_deployment"], 1)
        self.assertEqual(report["excluded_orientation"], 1)

    def test_numeric_unit_sort_is_stable(self) -> None:
        ids = ["S10", "S2", "S1", "other"]
        self.assertEqual(
            sorted(ids, key=PUBLIC_COMPILER.unit_id_sort_key),
            ["S1", "S2", "S10", "other"],
        )


class ScoringTests(unittest.TestCase):
    def test_set_f1(self) -> None:
        self.assertEqual(set_f1(["U1", "U2"], ["U2", "U1"]), 1.0)
        self.assertEqual(set_f1([], []), 1.0)

    def test_extraction_matches_propositions_and_scores_grounding(self) -> None:
        expected = {
            "assertions": [
                {
                    "proposition": "The study found no association.",
                    "groundingUnitIds": ["U1"],
                }
            ]
        }
        predicted = {
            "assertions": [
                {
                    "proposition": "No association was found by the study.",
                    "groundingUnitIds": ["U1"],
                }
            ]
        }
        tp, fp, fn, grounding = extraction_counts(expected, predicted, 0.45)
        self.assertEqual((tp, fp, fn), (1, 0, 0))
        self.assertEqual(grounding, [1.0])


if __name__ == "__main__":
    unittest.main()
