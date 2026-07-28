from __future__ import annotations

import math
from typing import Any


CONFIDENCE_THRESHOLD = 0.5
ENTITY_LABELS = {"PERSON", "ORG", "GPE", "WORK_OF_ART"}
REFLEXIVES = {
    "itself", "himself", "herself", "themselves",
    "ourselves", "yourself", "yourselves",
}
POSSESSIVES = {"its", "their", "his", "her", "our", "your", "whose"}
PRONOUNS = {
    "i", "me", "mine", "my", "myself", "we", "us", "our", "ours",
    "ourselves", "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself",
    "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
    "who", "whom", "whose", "whoever", "whomever", "what", "whatever",
    "which", "whichever", "this", "that", "these", "those",
}


def reject_resolved_input(payload: dict[str, Any]) -> None:
    coreference = payload.get("coreference")
    if payload.get("resolved") is True or (
            isinstance(coreference, dict)
            and coreference.get("resolved") is True):
        raise ValueError(
            "CF4 S1 is run-once: input is already marked resolved")


def canonical_mention(text: str) -> str:
    text = text.rstrip(" ,;:")
    for suffix in ("'s", "’s", "’", "'"):
        if text.endswith(suffix):
            return text[:-len(suffix)]
    return text


def possessive(text: str) -> str:
    base = canonical_mention(text)
    return base + ("'" if base.casefold().endswith("s") else "'s")


def replacement_text(mention: str, representative: str) -> str:
    return possessive(representative) if mention.casefold() in POSSESSIVES else (
        canonical_mention(representative))


def is_pronoun_result(text: str) -> bool:
    return canonical_mention(text).casefold() in PRONOUNS


def apply_span_resolutions(text: str, rows: list[dict[str, Any]],
                           offset: int = 0) -> str:
    output = text
    scoped = [
        row for row in rows
        if offset <= row["charStart"] and row["charEnd"] <= offset + len(text)
    ]
    for row in sorted(scoped, key=lambda item: item["charStart"], reverse=True):
        start = row["charStart"] - offset
        end = row["charEnd"] - offset
        if output[start:end] != row["originalSpan"]:
            raise ValueError(f"Coreference span drift at {row['charStart']}")
        output = output[:start] + row["replacement"] + output[end:]
    return output


def validate_replacement_log(rows: list[dict[str, Any]]) -> None:
    for row in rows:
        original = row["originalSpan"].casefold()
        replacement = row["replacement"]
        definite = row["ruleFired"] == "DEFINITE_DESCRIPTION"
        if original not in PRONOUNS and not definite:
            raise AssertionError("A non-pronominal mention was replaced")
        if original in REFLEXIVES:
            raise AssertionError("A reflexive mention was replaced")
        if is_pronoun_result(replacement):
            raise AssertionError("A replacement resolved to a pronoun")
        if original in POSSESSIVES:
            expected = possessive(canonical_mention(replacement))
            if replacement != expected:
                raise AssertionError("Possessive morphology was not preserved")


class CoreferenceResolver:
    def __init__(self, nlp: Any, threshold: float = CONFIDENCE_THRESHOLD) -> None:
        from fastcoref import FCoref

        self.model = FCoref(device="cpu")
        self.nlp = nlp
        self.threshold = threshold

    def reset_document(self) -> None:
        # Retained for Phase 0 compatibility. Resolution is document-scoped and
        # deliberately has no cross-document state.
        return None

    @staticmethod
    def _sentence_index(doc: Any, start: int) -> int:
        for index, sentence in enumerate(doc.sents):
            if sentence.start_char <= start < sentence.end_char:
                return index
        return -1

    @staticmethod
    def _confidence(prediction: Any, left: tuple[int, int],
                    right: tuple[int, int]) -> float:
        try:
            logit = float(prediction.get_logit(left, right))
        except (KeyError, TypeError, ValueError):
            return 0.0
        if logit >= 0:
            return 1.0 / (1.0 + math.exp(-logit))
        exponent = math.exp(logit)
        return exponent / (1.0 + exponent)

    def _profile(self, doc: Any, text: str,
                 span: tuple[int, int]) -> dict[str, Any]:
        start, end = span
        parsed = doc.char_span(start, end, alignment_mode="expand")
        words = [token for token in parsed
                 if not token.is_space and not token.is_punct] if parsed else []
        nominal = any(token.pos_ in {"NOUN", "PROPN"} for token in words)
        pronoun = bool(words) and all(token.pos_ == "PRON" for token in words)
        proper = any(token.pos_ == "PROPN" for token in words) or any(
            entity.label_ in ENTITY_LABELS
            and entity.start_char < end and entity.end_char > start
            for entity in doc.ents
        )
        definite = nominal and bool(words) and words[0].lower_ == "the"
        proper_name = None
        head = parsed.root if parsed else None
        if head is not None and head.pos_ == "PROPN":
            head_index = words.index(head)
            left = head_index
            right = head_index + 1
            while left and words[left - 1].pos_ == "PROPN":
                left -= 1
            while right < len(words) and words[right].pos_ == "PROPN":
                right += 1
            if left and words[left - 1].lower_ == "the":
                left -= 1
            proper_name = text[words[left].idx:words[right - 1].idx
                               + len(words[right - 1])]
        elif head is not None:
            head_entities = [
                entity.text for entity in doc.ents
                if entity.label_ in ENTITY_LABELS
                and start <= entity.start_char and entity.end_char <= end
                and entity.start_char <= head.idx
                and head.idx + len(head) <= entity.end_char
            ]
            if head_entities:
                proper_name = min(head_entities, key=lambda value: (
                    len(value.split()), len(value)))
        same_last_name = {
            entity.text.casefold()
            for entity in doc.ents
            if proper_name
            and entity.label_ in ENTITY_LABELS
            and entity.text.casefold().split()[-1]
            == proper_name.casefold().split()[-1]
            and len(entity.text.split()) > 1
        }
        proper_name_unambiguous = bool(proper_name) and (
            len(proper_name.split()) > 1 or len(same_last_name) <= 1)
        tier = 3 if proper else 2 if definite else 1 if nominal else 0
        return {
            "text": text[start:end],
            "canonicalText": (proper_name if proper_name
                              else canonical_mention(text[start:end])),
            "properName": proper_name,
            "properNameUnambiguous": proper_name_unambiguous,
            "hasAppositive": any(token.dep_ == "appos" for token in words),
            "startChar": start,
            "endChar": end,
            "sentenceIndex": self._sentence_index(doc, start),
            "isPronoun": pronoun,
            "isDefiniteDescription": definite and not proper,
            "isNominal": nominal,
            "containsPronoun": any(token.pos_ == "PRON" for token in words),
            "tier": tier,
            "tokenCount": len(words),
        }

    @staticmethod
    def _representative(profiles: list[dict[str, Any]]) -> dict[str, Any] | None:
        clean = [
            profile for profile in profiles
            if profile["isNominal"] and not profile["containsPronoun"]
        ]
        proper = [
            profile for profile in clean
            if profile.get("properName")
            and profile.get("properNameUnambiguous", True)
            and not is_pronoun_result(profile["properName"])
        ]
        if proper:
            return min(proper, key=lambda row: (
                len(row["canonicalText"].split()),
                len(row["canonicalText"]),
                row.get("startChar", 0)))
        definite = [
            profile for profile in clean
            if profile["isDefiniteDescription"]
        ]
        if definite:
            return min(definite, key=lambda row: (
                row["tokenCount"], len(row["canonicalText"]),
                row.get("startChar", 0)))
        return None

    def artifact(self, text: str) -> dict[str, Any]:
        prediction = self.model.predict(texts=[text])[0]
        doc = self.nlp(text)
        replacement_log = []
        diagnostics = []
        clusters = []
        for cluster_id, raw_spans in enumerate(
                prediction.get_clusters(as_strings=False)):
            spans = [tuple(span) for span in raw_spans if span and None not in span]
            profiles = [self._profile(doc, text, span) for span in spans]
            representative = self._representative(profiles)
            clusters.append({
                "clusterId": cluster_id,
                "mentions": profiles,
                "representative": (representative["canonicalText"]
                                   if representative else None),
            })
            for profile, span in zip(profiles, spans, strict=True):
                definite_target = profile["isDefiniteDescription"]
                if not profile["isPronoun"] and not definite_target:
                    continue
                diagnostic = {
                    "code": "CF4_UNRESOLVED_REFERENT",
                    "sentenceIndex": profile["sentenceIndex"],
                    "charStart": span[0],
                    "charEnd": span[1],
                    "originalSpan": profile["text"],
                    "clusterId": cluster_id,
                }
                if profile["text"].casefold() in REFLEXIVES:
                    diagnostics.append({**diagnostic, "reason": "REFLEXIVE"})
                    continue
                if representative is None:
                    diagnostics.append({**diagnostic, "reason": "NO_NOMINAL"})
                    continue
                if (representative["startChar"] <= span[0]
                        and span[1] <= representative["endChar"]):
                    diagnostics.append({
                        **diagnostic, "reason": "REPRESENTATIVE_OVERLAP"})
                    continue
                preceding = [item for item in profiles
                             if item["endChar"] <= profile["startChar"]
                             and item is not profile]
                nearest = max(preceding, key=lambda row: row["endChar"],
                              default=None)
                if (not definite_target and nearest
                        and nearest["sentenceIndex"] == profile["sentenceIndex"]):
                    diagnostics.append({**diagnostic, "reason": "SAME_SENTENCE"})
                    continue
                identity = representative["canonicalText"].casefold()
                identity = (identity[4:] if identity.startswith("the ")
                            else identity)
                anchors = [
                    item for item in profiles
                    if item.get("properName")
                    and item["properName"].casefold().removeprefix("the ")
                    == identity
                ] or [representative]
                confidence = max(
                    self._confidence(
                        prediction, span,
                        (anchor["startChar"], anchor["endChar"]))
                    for anchor in anchors)
                if confidence < self.threshold:
                    diagnostics.append({
                        **diagnostic, "reason": "BELOW_CONFIDENCE",
                        "confidence": confidence,
                    })
                    continue
                replacement = replacement_text(
                    profile["text"], representative["canonicalText"])
                replacement_log.append({
                    "sentenceIndex": profile["sentenceIndex"],
                    "charStart": span[0],
                    "charEnd": span[1],
                    "originalSpan": profile["text"],
                    "replacement": replacement,
                    "clusterId": cluster_id,
                    "ruleFired": ("POSSESSIVE_PRONOUN" if
                                  profile["text"].casefold() in POSSESSIVES
                                  else "DEFINITE_DESCRIPTION" if definite_target
                                  else "PERSONAL_PRONOUN"),
                    "finding": ("CF4_DEFINITE_DESC_RESOLVED"
                                if definite_target else None),
                    "confidence": confidence,
                })
        accepted = []
        priority = sorted(replacement_log, key=lambda row: (
            row["ruleFired"] == "DEFINITE_DESCRIPTION", -row["confidence"]))
        for row in priority:
            overlaps = any(
                row["charStart"] < kept["charEnd"]
                and row["charEnd"] > kept["charStart"] for kept in accepted)
            if overlaps:
                diagnostics.append({
                    "code": "CF4_UNRESOLVED_REFERENT",
                    "sentenceIndex": row["sentenceIndex"],
                    "charStart": row["charStart"], "charEnd": row["charEnd"],
                    "originalSpan": row["originalSpan"],
                    "clusterId": row["clusterId"],
                    "reason": "OVERLAPPING_RESOLUTION",
                })
            else:
                accepted.append(row)
        replacement_log = sorted(accepted, key=lambda row: row["charStart"])
        validate_replacement_log(replacement_log)
        surfaces: dict[str, set[str]] = {}
        for row in replacement_log:
            surfaces.setdefault(row["originalSpan"], set()).add(row["replacement"])
        return {
            "mode": "DOCUMENT",
            "confidenceThreshold": self.threshold,
            "clusters": clusters,
            "replacementLog": replacement_log,
            "unambiguousReplacements": {
                mention: next(iter(replacements))
                for mention, replacements in surfaces.items()
                if len(replacements) == 1
            },
            "diagnostics": diagnostics,
            "resolvedText": apply_span_resolutions(text, replacement_log),
        }
