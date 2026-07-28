from __future__ import annotations

import re
from typing import Any


SUBJECT_DEPS = {"nsubj", "nsubjpass", "csubj"}
PERSON_LABELS = {"PERSON"}
ORG_LABELS = {"ORG", "GPE", "NORP"}
WORK_NOUNS = {"study", "report", "analysis", "summary", "act", "document"}


def subtree_text(token: Any) -> str:
    tokens = sorted(token.subtree, key=lambda item: item.i)
    return token.doc[tokens[0].i:tokens[-1].i + 1].text.strip(" ,;:")


def source_kind(source: str, doc: Any) -> str:
    lowered = source.lower()
    if any(noun in lowered.split() for noun in WORK_NOUNS):
        return "study" if "study" in lowered or "analysis" in lowered else "document"
    labels = {entity.label_ for entity in doc.ents if entity.text in source or source in entity.text}
    if labels & PERSON_LABELS:
        return "person"
    if labels & ORG_LABELS:
        return "institution"
    return "unknown"


def canonical_source(source: str, doc: Any) -> tuple[str, str]:
    kind = source_kind(source, doc)
    if kind == "person":
        people = [entity.text for entity in doc.ents
                  if entity.label_ == "PERSON" and entity.text in source]
        if people:
            return max(people, key=len), kind
    return source, kind


def apply_replacements(text: str, replacements: dict[str, str]) -> tuple[str, list[dict[str, str]]]:
    applied = []
    output = text
    for mention, antecedent in sorted(replacements.items(), key=lambda item: -len(item[0])):
        pattern = re.compile(rf"(?<!\w){re.escape(mention)}(?!\w)")
        if pattern.search(output):
            output = pattern.sub(lambda _match: antecedent, output)
            applied.append({"mention": mention, "antecedent": antecedent})
    return output, applied


def split_attribution(parsed: Any, reporting_verbs: set[str],
                      replacements: dict[str, str], byline: str) -> dict[str, Any]:
    doc = parsed.doc
    for token in reversed(doc):
        if token.lemma_.lower() not in reporting_verbs:
            continue
        if token.dep_ in {"relcl", "acl", "amod"}:
            continue
        subjects = [child for child in token.children if child.dep_ in SUBJECT_DEPS]
        if not subjects and token.dep_ == "conj":
            subjects = [child for child in token.head.children if child.dep_ in SUBJECT_DEPS]
        contents = (
            [child for child in token.children if child.dep_ == "ccomp"]
            or [child for child in token.children if child.dep_ == "xcomp"]
            or [child for child in token.children if child.dep_ == "advcl"]
        )
        if contents and (subjects or token.tag_ == "VBN"):
            passive = any(subject.dep_ == "nsubjpass" for subject in subjects)
            agents = [child for child in token.children if child.dep_ == "agent"]
            source = subtree_text(agents[0]) if passive and agents else (
                subtree_text(subjects[0]) if subjects and not passive else "unknown")
            content = subtree_text(contents[0])
            trailing = [sent.text.strip() for sent in doc.sents
                        if sent.start_char > contents[0].idx]
            if trailing:
                content = f"{content} {' '.join(trailing)}"
            resolved, applied = apply_replacements(content, replacements)
            source_name, kind = canonical_source(source, doc)
            return {
                "pattern": ("PASSIVE_REPORTING_CONTENT" if passive
                            else "SUBJ_REPORTING_VERB_CCOMP"),
                "reportingVerb": token.text,
                "sourceSpan": source,
                "source": ({"name": None, "kind": "unknown"} if source == "unknown"
                           else {"name": source_name, "kind": kind}),
                "contentSpan": content,
                "content": resolved,
                "coreferenceApplied": applied,
                "attributionChain": [],
            }
    lowered = doc.text.lower()
    if "according to " in lowered:
        according = next((token for token in doc if token.lemma_.lower() == "accord"), None)
        if according:
            to_token = next((child for child in according.children if child.text.lower() == "to"), None)
            source_token = next(iter(to_token.children), None) if to_token else None
            if source_token:
                source = subtree_text(source_token)
                comma = doc.text.find(",")
                content = doc.text[comma + 1:].strip() if comma >= 0 else doc.text
                resolved, applied = apply_replacements(content, replacements)
                return {
                    "pattern": "ACCORDING_TO",
                    "reportingVerb": "according to",
                    "sourceSpan": source,
                    "source": {"name": source, "kind": source_kind(source, doc)},
                    "contentSpan": content,
                    "content": resolved,
                    "coreferenceApplied": applied,
                    "attributionChain": [],
                }
    return {
        "pattern": "ARTICLE_VOICE_FALLBACK",
        "reportingVerb": None,
        "sourceSpan": byline,
        "source": {"name": byline, "kind": "article_voice"},
        "contentSpan": doc.text,
        "content": apply_replacements(doc.text, replacements)[0],
        "coreferenceApplied": apply_replacements(doc.text, replacements)[1],
        "attributionChain": [],
    }
