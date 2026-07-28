from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


MODEL = "MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli"
TAU = 0.70


def read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path: Path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8")


def words(text):
    return {word for word in re.sub(r"[^\w\s]", " ", text.casefold()).split()
            if len(word) > 2}


def lexical(gold, candidate):
    target = words(gold)
    return len(target & words(candidate)) / max(1, len(target))


def normalized(text):
    return " ".join(re.sub(r"[^\w\s]", " ", str(text).casefold()).split())


def unit_position(unit_id):
    match = re.search(r"\d+", str(unit_id))
    return int(match.group()) if match else 10**9


def _unit_position_key(candidate):
    return (
        min((unit_position(unit) for unit in candidate["groundingUnitIds"]),
            default=10**9),
        candidate["candidateId"],
    )


def union_members(candidates, gold_text, limit=3):
    selected = sorted(
        candidates,
        key=lambda candidate: (
            -lexical(gold_text, candidate["assertionText"]),
            *_unit_position_key(candidate),
        ),
    )[:limit]
    return sorted(selected, key=_unit_position_key)


def union_text(candidates):
    return " ".join(
        candidate["assertionText"].rstrip(" .") + "."
        for candidate in candidates
    )


class NLI:
    def __init__(self):
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL)
        self.model = AutoModelForSequenceClassification.from_pretrained(MODEL)
        self.model.eval()
        labels = {int(key): value.casefold()
                  for key, value in self.model.config.id2label.items()}
        self.entailment_index = next(
            (key for key, value in labels.items() if "entail" in value), 0)

    def probabilities(self, pairs, batch_size=8):
        output = []
        for start in range(0, len(pairs), batch_size):
            batch = pairs[start:start + batch_size]
            encoded = self.tokenizer(
                [pair[0] for pair in batch], [pair[1] for pair in batch],
                padding=True, truncation=True, max_length=512,
                return_tensors="pt")
            with torch.inference_mode():
                logits = self.model(**encoded).logits
                values = torch.softmax(logits, dim=-1)[:, self.entailment_index]
            output.extend(float(value) for value in values)
        return output


def source_score(candidate, expected):
    actual = candidate.get("assertionSource") or {}
    return {
        "expectedSource": expected,
        "candidateSource": {
            "name": actual.get("name"),
            "kind": actual.get("kind"),
        },
        "sourceNameMatch": normalized(actual.get("name")) == normalized(expected["name"]),
        "sourceKindMatch": actual.get("kind") == expected["kind"],
    }


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--run-dir", required=True, type=Path)
    cli.add_argument("--gold-dir", required=True, type=Path)
    args = cli.parse_args()
    seal = read(args.gold_dir / "SEALED.json")
    fixtures = []
    jobs = []
    for sealed in seal["keys"]:
        gold_path = Path(sealed["path"])
        if hashlib.sha256(gold_path.read_bytes()).hexdigest() != sealed["sha256"]:
            raise ValueError(f"Gold seal mismatch: {sealed['fixtureId']}")
        gold = read(gold_path)
        candidates = read(args.run_dir / sealed["fixtureId"]
                          / "s3_candidates.json")["candidates"]
        rows = []
        for item in gold["assertions"]:
            grounded = [candidate for candidate in candidates
                        if set(candidate["groundingUnitIds"])
                        & set(item["groundingUnitIds"])]
            members = union_members(grounded, item["testableAssertion"])
            comparisons = []
            for candidate in grounded:
                comparison = {"candidate": candidate}
                comparisons.append(comparison)
                jobs.extend([
                    (candidate["assertionText"], item["testableAssertion"], comparison,
                     "candidateToGold"),
                    (item["testableAssertion"], candidate["assertionText"], comparison,
                     "goldToCandidate"),
                ])
            row = {
                "gold": item,
                "comparisons": comparisons,
                "unionMembers": members,
                "unionText": union_text(members),
                "unionEntailment": 0.0,
            }
            if members:
                jobs.append((
                    row["unionText"], item["testableAssertion"], row,
                    "unionEntailment",
                ))
            rows.append(row)
        fixtures.append({
            "fixtureId": sealed["fixtureId"],
            "candidateCount": len(candidates),
            "rows": rows,
        })
    nli = NLI()
    values = nli.probabilities([(job[0], job[1]) for job in jobs])
    for job, value in zip(jobs, values, strict=True):
        job[2][job[3]] = value
    for fixture in fixtures:
        for row in fixture["rows"]:
            for comparison in row["comparisons"]:
                comparison["bidirectionalEntailment"] = min(
                    comparison["candidateToGold"],
                    comparison["goldToCandidate"])
            row["best"] = max(
                row["comparisons"],
                key=lambda item: item["candidateToGold"],
                default=None)
    results = []
    for fixture in fixtures:
        matches = []
        for row in fixture["rows"]:
            gold = row["gold"]
            best = row["best"]
            candidate = best["candidate"] if best else None
            best_single = best["candidateToGold"] if best else 0
            union = row["unionEntailment"]
            recalled = best_single >= TAU or union >= TAU
            recall_reason = (
                "BEST_SINGLE" if best_single >= TAU
                else "UNION" if union >= TAU
                else "NONE"
            )
            matches.append({
                "goldId": gold["goldId"],
                "testableAssertion": gold["testableAssertion"],
                "groundingUnitIds": gold["groundingUnitIds"],
                "crux": gold["crux"],
                "mustAppearOpponent": gold["mustAppearOpponent"],
                "recalled": recalled,
                "recallReason": recall_reason,
                "bestCandidateId": candidate["candidateId"] if candidate else None,
                "bestCandidateText": candidate["assertionText"] if candidate else None,
                "bestSingleEntailment": best_single,
                "unionEntailment": union,
                "unionMemberCandidateIds": [
                    item["candidateId"] for item in row["unionMembers"]
                ],
                "unionText": row["unionText"],
                "candidateToGoldEntailment": best["candidateToGold"] if best else 0,
                "goldToCandidateEntailment": best["goldToCandidate"] if best else 0,
                "bidirectionalEntailment": best["bidirectionalEntailment"] if best else 0,
                "lexicalCoverage": lexical(
                    gold["testableAssertion"],
                    candidate["assertionText"]) if candidate else 0,
                **(source_score(candidate, gold["expectedSource"])
                   if candidate else {
                       "expectedSource": gold["expectedSource"],
                       "candidateSource": None,
                       "sourceNameMatch": False,
                       "sourceKindMatch": False,
                   }),
            })
        recalled = sum(item["recalled"] for item in matches)
        results.append({
            "fixtureId": fixture["fixtureId"],
            "candidateCount": fixture["candidateCount"],
            "recalled": recalled,
            "total": len(matches),
            "recall": recalled / len(matches),
            "matches": matches,
        })
    output = {
        "schemaVersion": "cf4.phase1UnionEntailmentScore.v2",
        "model": MODEL,
        "deterministicDecode": True,
        "threshold": TAU,
        "recallMetric": (
            "bestSingleEntailment >= threshold OR unionEntailment >= threshold; "
            "union selects the top <=3 grounding-overlap candidates ranked by "
            "lexical overlap with the gold assertion, then concatenates the "
            "selected candidates in unit order"
        ),
        "unionCandidateCap": 3,
        "goldToCandidateRole": "non-gating over-breadth/atomicity diagnostic",
        "phaseGate": 0.90,
        "decision": (
            "PHASE_1_GATE_PASS"
            if all(item["recall"] >= 0.90 for item in results)
            else "PHASE_1_GATE_FAIL"
        ),
        "fixtures": results,
    }
    old_score = args.run_dir / "score.json"
    old_report = args.run_dir / "report.html"
    if old_score.exists() and read(old_score).get("schemaVersion") == "cf4.phase1Score.v1":
        shutil.copy2(old_score, args.run_dir / "score-lexical-v1.json")
    if (old_score.exists()
            and read(old_score).get("schemaVersion") == "cf4.phase1EntailmentScore.v1"):
        shutil.copy2(old_score, args.run_dir / "score-best-single-v1.json")
        if old_report.exists():
            shutil.copy2(old_report, args.run_dir / "report-best-single-v1.html")
    if old_report.exists() and not (args.run_dir / "report-lexical-v1.html").exists():
        shutil.copy2(old_report, args.run_dir / "report-lexical-v1.html")
    write(old_score, output)
    write(args.run_dir / "score-entailment.json", output)
    write(args.run_dir / "score-union.json", output)
    render(args.run_dir, output)
    print(output["decision"], *(f"{item['fixtureId']}:{item['recall']:.1%}"
                                for item in results))


def render(run_dir, output):
    sections = []
    for fixture in output["fixtures"]:
        body = []
        for row in fixture["matches"]:
            source = row["candidateSource"] or {}
            body.append(
                "<tr><td>{}</td><td>{}</td><td>{}</td><td>{:.3f}</td><td>{:.3f}</td>"
                "<td>{}</td><td>{:.3f}</td>"
                "<td>{:.3f}</td><td>{:.3f}</td><td>{}/{}</td><td>{}</td><td>{}</td>"
                "<td>{}</td><td>{}</td></tr>"
                .format(
                    html.escape(row["goldId"]), "✓" if row["recalled"] else "✗",
                    html.escape(row["recallReason"]),
                    row["bestSingleEntailment"], row["unionEntailment"],
                    html.escape(", ".join(row["unionMemberCandidateIds"])
                                if row["recallReason"] == "UNION" else "—"),
                    row["goldToCandidateEntailment"],
                    row["bidirectionalEntailment"], row["lexicalCoverage"],
                    "✓" if row["sourceNameMatch"] else "✗",
                    "✓" if row["sourceKindMatch"] else "✗",
                    html.escape(json.dumps(row["expectedSource"], ensure_ascii=False)),
                    html.escape(json.dumps(source, ensure_ascii=False)),
                    html.escape(row["testableAssertion"]),
                    html.escape(row["bestCandidateText"] or "—"),
                ))
        sections.append(
            f"<h2>{fixture['fixtureId']}</h2><p>{fixture['recalled']}/"
            f"{fixture['total']} recalled ({fixture['recall']:.1%})</p><table>"
            "<tr><th>Gold</th><th>Recall</th><th>Reason</th>"
            "<th>Best single</th><th>Union</th><th>Union member IDs</th><th>G→C</th>"
            "<th>Bi-NLI</th><th>Lexical</th><th>Source name/kind</th>"
            "<th>Expected source</th><th>Candidate source</th>"
            "<th>Gold assertion</th><th>Candidate</th></tr>"
            + "".join(body) + "</table>")
    document = (
        "<!doctype html><html><head><meta charset='utf-8'><title>CF4 entailment score"
        "</title><style>body{font:14px system-ui;margin:2rem}table{border-collapse:"
        "collapse}td,th{border:1px solid #ccc;padding:.45rem;vertical-align:top}"
        "th{background:#eee}</style></head><body><h1>CF4 Phase 1 — "
        f"{output['decision']}</h1><p>Model: {html.escape(output['model'])}; "
        f"candidate→gold threshold: {output['threshold']:.2f}"
        "</p>" + "".join(sections) + "</body></html>")
    (run_dir / "report.html").write_text(document, encoding="utf-8")
    (run_dir / "report-entailment.html").write_text(document, encoding="utf-8")
    (run_dir / "report-union.html").write_text(document, encoding="utf-8")


if __name__ == "__main__":
    main()
