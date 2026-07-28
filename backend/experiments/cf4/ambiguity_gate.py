from __future__ import annotations

from typing import Any

CORE_DEPS = {"nsubj", "nsubjpass", "dobj", "attr", "oprd", "poss", "pobj"}
MODIFIER_DEPS = {"det", "amod", "nummod", "compound", "poss"}
UNRESOLVABLE_REASONS = {"NO_NOMINAL", "BELOW_CONFIDENCE"}
DEFERRED_REASONS = {"SAME_SENTENCE", "REPRESENTATIVE_OVERLAP", "OVERLAPPING_RESOLUTION",
                     "REFLEXIVE"}


def _is_core(token: Any, local_root: Any) -> bool:
    if token is local_root:
        return True
    if token.dep_ in CORE_DEPS:
        return True
    if token.dep_ in MODIFIER_DEPS and token.head is not token:
        return _is_core(token.head, local_root)
    return False


def _local_root(span_tokens: list[Any]) -> Any:
    in_span = set(span_tokens)
    for token in span_tokens:
        if token.head is token or token.head not in in_span:
            return token
    return span_tokens[0]


def gate_decision(doc: Any, span_start_char: int, span_end_char: int,
                   diagnostics: list[dict[str, Any]]) -> dict[str, Any]:
    """Decide whether an unresolved referent inside [span_start_char, span_end_char)
    is essential to the assertion's meaning.

    Drop only when an unresolved mention is BOTH in a core grammatical role
    (subject/object/possessive of the span's own local predicate, walking up
    determiner/modifier chains) AND the coreference system found it genuinely
    unresolvable (no candidate antecedent at all, or below-confidence) rather
    than merely deferred by a conservative safeguard (same-sentence exclusion,
    representative overlap, reflexive).
    """
    span = doc.char_span(span_start_char, span_end_char, alignment_mode="expand")
    if span is None or len(span) == 0:
        return {"drop": False, "blocking": []}
    span_tokens = list(span)
    local_root = _local_root(span_tokens)
    span_index = {token.i for token in span_tokens}
    blocking = []
    for diag in diagnostics:
        if not (span_start_char <= diag["charStart"] and diag["charEnd"] <= span_end_char):
            continue
        if diag["reason"] not in UNRESOLVABLE_REASONS:
            continue
        mention = doc.char_span(diag["charStart"], diag["charEnd"], alignment_mode="expand")
        if mention is None or len(mention) == 0:
            continue
        token = mention[0]
        if token.i not in span_index:
            continue
        if _is_core(token, local_root):
            blocking.append(diag)
    return {"drop": bool(blocking), "blocking": blocking}
