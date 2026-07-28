from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


REPORT_THRESHOLDS = [0.5, 0.7, 0.9]
TWO_TIER_TAU = 0.7
PHASE_GATE = 0.9


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def metrics(rows, threshold):
    tp = sum(row["human"] and row["score"] >= threshold for row in rows)
    fp = sum(not row["human"] and row["score"] >= threshold for row in rows)
    fn = sum(row["human"] and row["score"] < threshold for row in rows)
    tn = len(rows) - tp - fp - fn
    precision = tp / (tp + fp) if tp + fp else 1.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    specificity = tn / (tn + fp) if tn + fp else 0.0
    balanced = (recall + specificity) / 2
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
    return {"threshold": threshold, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": precision, "recall": recall, "specificity": specificity,
            "balancedAccuracy": balanced, "f1": f1}


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--score", required=True, type=Path)
    cli.add_argument("--labels", required=True, type=Path)
    cli.add_argument("--out-dir", required=True, type=Path)
    args = cli.parse_args()
    score = read(args.score)
    labels = read(args.labels)
    scored = {(fixture["fixtureId"], row["goldId"]): row
              for fixture in score["fixtures"] for row in fixture["matches"]}
    rows = []
    for label in labels["rows"]:
        key = (label["fixtureId"], label["goldId"])
        row = scored[key]
        if row["bestCandidateId"] != label["candidateId"]:
            raise ValueError(f"Candidate drift: {key}")
        rows.append({
            **label,
            "score": row["candidateToGoldEntailment"],
            "goldToCandidate": row["goldToCandidateEntailment"],
            "lexicalCoverage": row["lexicalCoverage"],
            "human": label["assertsGold"],
        })
    prescribed = [metrics(rows, threshold) for threshold in REPORT_THRESHOLDS]
    best = max(prescribed, key=lambda item: (
        item["balancedAccuracy"], item["f1"], item["precision"],
        item["threshold"]))
    f02 = [row for row in rows if row["fixtureId"] == "CF1-F02"]
    triage = []
    for row in f02:
        if row["lexicalCoverage"] > 0.5 and row["score"] < 0.5:
            triage.append({
                **row,
                "classification": ("NLI_FALSE_NEGATIVE" if row["human"]
                                   else "REAL_EXTRACTION_GAP"),
            })
    fixture_human = {}
    for fixture_id in sorted({row["fixtureId"] for row in rows}):
        items = [row for row in rows if row["fixtureId"] == fixture_id]
        recalled = sum(row["human"] for row in items)
        fixture_human[fixture_id] = {
            "recalled": recalled, "total": len(items),
            "recall": recalled / len(items),
        }
    sub_tau = [{
        **row,
        "classification": "FALSE_NEG" if row["human"] else "REAL_GAP",
    } for row in rows if row["score"] < TWO_TIER_TAU]
    fixture_two_tier = {}
    for fixture_id in sorted({row["fixtureId"] for row in rows}):
        items = [row for row in rows if row["fixtureId"] == fixture_id]
        auto = sum(row["score"] >= TWO_TIER_TAU for row in items)
        false_neg = sum(row["score"] < TWO_TIER_TAU and row["human"]
                        for row in items)
        real_gaps = sum(row["score"] < TWO_TIER_TAU and not row["human"]
                        for row in items)
        recall = (auto + false_neg) / len(items)
        fixture_two_tier[fixture_id] = {
            "autoRecalled": auto, "falseNegatives": false_neg,
            "realGaps": real_gaps, "total": len(items),
            "correctedRecalled": auto + false_neg,
            "correctedRecall": recall, "gatePassed": recall >= PHASE_GATE,
        }
    output = {
        "schemaVersion": "cf4.nliCalibration.v1",
        "scorePath": str(args.score),
        "labelsPath": str(args.labels),
        "humanLabelCounts": {
            "yes": sum(row["human"] for row in rows),
            "no": sum(not row["human"] for row in rows),
        },
        "recommendedTau": best["threshold"],
        "selectionRule": "maximum balanced accuracy among 0.5, 0.7, and 0.9",
        "recommendedMetrics": best,
        "prescribedThresholdMetrics": prescribed,
        "humanRecallByFixture": fixture_human,
        "f02Triage": triage,
        "twoTier": {
            "tau": TWO_TIER_TAU,
            "gateThreshold": PHASE_GATE,
            "fixtures": fixture_two_tier,
            "subTauTriage": sub_tau,
            "realGaps": [row for row in sub_tau
                         if row["classification"] == "REAL_GAP"],
            "gatePassed": all(row["gatePassed"]
                              for row in fixture_two_tier.values()),
        },
        "rows": rows,
        "phaseGate": None,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    target = args.out_dir / "nli-calibration.json"
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n",
                      encoding="utf-8")
    render(args.out_dir / "nli-calibration.html", output)
    write_two_tier(args.out_dir, output)
    print(json.dumps({key: output[key] for key in [
        "recommendedTau", "recommendedMetrics", "prescribedThresholdMetrics",
        "humanRecallByFixture"]}, indent=2))


def render(path, output):
    rows = output["rows"]
    width, height, pad = 760, 280, 35
    dots = []
    for index, row in enumerate(rows):
        x = pad + row["score"] * (width - 2 * pad)
        y = 85 if row["human"] else 210
        jitter = ((index % 7) - 3) * 4
        color = "#18794e" if row["human"] else "#c9362b"
        dots.append(
            f"<circle cx='{x:.1f}' cy='{y+jitter}' r='5' fill='{color}'>"
            f"<title>{row['fixtureId']} {row['goldId']}: {row['score']:.4f}</title>"
            "</circle>")
    ticks = "".join(
        f"<line x1='{pad+t*(width-2*pad):.1f}' y1='40' "
        f"x2='{pad+t*(width-2*pad):.1f}' y2='240' stroke='#ddd'/>"
        f"<text x='{pad+t*(width-2*pad):.1f}' y='260' text-anchor='middle'>{t}</text>"
        for t in [0, .5, .7, .9, 1])
    metric_rows = "".join(
        f"<tr><td>{item['threshold']:.1f}</td><td>{item['precision']:.1%}</td>"
        f"<td>{item['recall']:.1%}</td><td>{item['balancedAccuracy']:.1%}</td>"
        f"<td>{item['f1']:.3f}</td>"
        f"<td>{item['tp']}/{item['fp']}/{item['fn']}/{item['tn']}</td></tr>"
        for item in output["prescribedThresholdMetrics"])
    triage = "".join(
        f"<tr><td>{row['goldId']}</td><td>{row['score']:.4f}</td>"
        f"<td>{row['lexicalCoverage']:.3f}</td><td>{row['classification']}</td>"
        f"<td>{html.escape(row['reason'])}</td></tr>"
        for row in output["f02Triage"])
    document = f"""<!doctype html><html><head><meta charset="utf-8">
<title>CF4 NLI calibration</title><style>body{{font:14px system-ui;margin:2rem}}
table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:.5rem}}
th{{background:#eee}}</style></head><body><h1>CF4 NLI ruler calibration</h1>
<p>No phase gate set. Recommended τ={output['recommendedTau']:.4f} by maximum F1.</p>
<svg viewBox="0 0 {width} {height}" width="{width}"><text x="5" y="88">Human yes</text>
<text x="5" y="213">Human no</text>{ticks}{''.join(dots)}</svg>
<h2>Candidate thresholds</h2><table><tr><th>τ</th><th>Precision</th>
<th>Recall</th><th>Balanced accuracy</th><th>F1</th>
<th>TP/FP/FN/TN</th></tr>{metric_rows}</table>
<h2>F02 lexical&gt;.5 and NLI&lt;.5 triage</h2><table><tr><th>Gold</th>
<th>NLI</th><th>Lexical</th><th>Class</th><th>Reason</th></tr>{triage}</table>
</body></html>"""
    path.write_text(document, encoding="utf-8")


def write_two_tier(out_dir, calibration):
    result = {
        "schemaVersion": "cf4.phase1TwoTierRecall.v1",
        "definition": (
            "candidateToGold>=tau is automatic recall; sub-tau FALSE_NEG is "
            "human-corrected recall; REAL_GAP is a miss"),
        **calibration["twoTier"],
        "decision": ("PROCEED_TO_PHASE_2" if calibration["twoTier"]["gatePassed"]
                     else "STOP_PHASE_1_GATE_FAILED"),
    }
    text = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    (out_dir / "score-two-tier.json").write_text(text, encoding="utf-8")
    (out_dir / "score.json").write_text(text, encoding="utf-8")
    triage = "".join(
        f"<tr><td>{row['fixtureId']} {row['goldId']}</td>"
        f"<td>{row['score']:.4f}</td><td>{row['lexicalCoverage']:.3f}</td>"
        f"<td>{row['classification']}</td><td>{html.escape(row['reason'])}</td></tr>"
        for row in result["subTauTriage"]
    )
    summaries = "".join(
        f"<tr><td>{fixture}</td><td>{row['autoRecalled']}</td>"
        f"<td>{row['falseNegatives']}</td><td>{row['realGaps']}</td>"
        f"<td>{row['correctedRecalled']}/{row['total']} "
        f"({row['correctedRecall']:.1%})</td>"
        f"<td>{'✓' if row['gatePassed'] else '✗'}</td></tr>"
        for fixture, row in result["fixtures"].items()
    )
    gaps = "".join(
        f"<li>{row['fixtureId']} {row['goldId']}: {html.escape(row['reason'])}</li>"
        for row in result["realGaps"]
    )
    document = f"""<!doctype html><html><head><meta charset="utf-8">
<title>CF4 two-tier recall</title><style>body{{font:14px system-ui;margin:2rem}}
table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:.5rem;
vertical-align:top}}th{{background:#eee}}</style></head><body>
<h1>CF4 Phase 1 — {result['decision']}</h1><p>τ={result['tau']:.2f};
fixture gate={result['gateThreshold']:.0%}. FALSE_NEG counts as corrected recall.</p>
<table><tr><th>Fixture</th><th>Auto</th><th>False neg</th><th>Real gaps</th>
<th>Corrected recall</th><th>Gate</th></tr>{summaries}</table>
<h2>All sub-τ triage</h2><table><tr><th>Gold</th><th>NLI</th><th>Lexical</th>
<th>Class</th><th>Reason</th></tr>{triage}</table>
<h2>Extraction backlog: REAL_GAP only</h2><ul>{gaps}</ul></body></html>"""
    (out_dir / "report-two-tier.html").write_text(document, encoding="utf-8")
    (out_dir / "report.html").write_text(document, encoding="utf-8")


if __name__ == "__main__":
    main()
