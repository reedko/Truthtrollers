from __future__ import annotations

import re
from typing import Any

EVALUATIVE = {"outrageous", "heartbreaking", "awful", "ridiculous", "unbelievable"}
DOCUMENT_PATTERNS = {
    "study": "study",
    "analysis": "study",
    "dataset": "dataset",
    "data": "dataset",
    "report": "report",
    "act": "law",
    "law": "law",
    "book": "document",
    "paper": "document",
    "journal": "document",
}
CLAUSE_DEPS = {"conj", "relcl", "advcl", "ccomp", "acl", "parataxis"}
NONFINITE_CONTENT_DEPS = {"advcl", "ccomp", "acl", "parataxis"}


def span_text(token: Any) -> str:
    members = sorted(token.subtree, key=lambda item: item.i)
    return token.doc[members[0].i:members[-1].i + 1].text.strip(" ,;:—“”\"")


def is_finite(token: Any) -> bool:
    if "Fin" in token.morph.get("VerbForm"):
        return True
    return any(child.dep_ in {"aux", "auxpass"} and "Fin" in child.morph.get("VerbForm")
               for child in token.children)


def testable(token: Any, allow_nonfinite: bool = False) -> bool:
    if token.pos_ not in {"VERB", "AUX"}:
        return False
    if not is_finite(token) and not allow_nonfinite:
        return False
    text = span_text(token)
    if not text or text.endswith("?") or token.lemma_.lower() in EVALUATIVE:
        return False
    has_signal = bool(token.doc.ents) or bool(re.search(r"\d", text))
    has_object = any(child.dep_ in {"dobj", "attr", "oprd", "pobj", "ccomp", "xcomp", "acomp"}
                     for child in token.children)
    return has_signal or has_object


def structured_form(doc: Any) -> dict[str, str | None]:
    root = next((token for token in doc if token.dep_ == "ROOT"), doc[0])
    subjects = [child for child in root.children
                if child.dep_ in {"nsubj", "nsubjpass", "csubj"}]
    objects = [child for child in root.children
               if child.dep_ in {"dobj", "attr", "oprd", "pobj", "ccomp", "xcomp"}]
    dates = [entity.text for entity in doc.ents if entity.label_ in {"DATE", "TIME"}]
    quantities = [entity.text for entity in doc.ents
                  if entity.label_ in {"CARDINAL", "QUANTITY", "PERCENT", "MONEY"}]
    return {
        "agent": span_text(subjects[0]) if subjects else "unknown",
        "predicate": root.lemma_,
        "object": span_text(objects[0]) if objects else "",
        "time": dates[0] if dates else None,
        "quantity": quantities[0] if quantities else None,
    }


def cited_works(doc: Any, unit_id: str) -> list[dict[str, Any]]:
    works = []
    seen = set()
    for token in doc:
        work_type = DOCUMENT_PATTERNS.get(token.lemma_.lower())
        if not work_type:
            continue
        name = span_text(token)
        key = (name.lower(), work_type)
        if len(name) < 4 or key in seen:
            continue
        seen.add(key)
        works.append({"name": name, "type": work_type, "sourceUnitIds": [unit_id]})
    return works


def candidate_texts(doc: Any, include_root: bool = True) -> list[str]:
    roots = [token for token in doc if token.dep_ == "ROOT"]
    if not include_root:
        roots = []
    roots += [token for token in doc if token.dep_ in CLAUSE_DEPS
              and token.pos_ in {"VERB", "AUX"}]
    entries = []
    for token in roots:
        allow_nonfinite = token.dep_ in NONFINITE_CONTENT_DEPS
        if not testable(token, allow_nonfinite=allow_nonfinite):
            continue
        members = sorted(token.subtree, key=lambda item: item.i)
        if not members:
            continue
        entries.append((members[0].i, members[-1].i, span_text(token)))
    output = []
    for _, _, text in entries:
        if not text or text in output:
            continue
        output.append(text)
    return output
