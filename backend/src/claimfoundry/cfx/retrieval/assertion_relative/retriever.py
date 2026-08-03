"""Deterministic high-recall source-block retrieval.

This module ranks source windows relative to one immutable assertion.  It does
not infer bearing, stance, truth, source quality, or evidence claims, and it
contains no network or model-API path.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from hashlib import sha256
import json
import math
from pathlib import Path
import re
from typing import Any, Protocol, Sequence
import unicodedata

import numpy as np
from rapidfuzz import fuzz
from rank_bm25 import BM25Okapi
import spacy
from spacy.language import Language
from spacy.tokens import Doc
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


SPACY_MODEL = "en_core_web_sm"
SPACY_MODEL_VERSION = "3.8.0"
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"


@dataclass(frozen=True)
class RetrievalWeights:
    embeddingSimilarity: float = 0.25
    bm25: float = 0.20
    tfidfUnigram: float = 0.15
    tfidfBigram: float = 0.10
    entityOverlap: float = 0.10
    predicateOverlap: float = 0.07
    exactOrLemmaOverlap: float = 0.05
    nounChunkOverlap: float = 0.03
    aliasSimilarity: float = 0.05

    def validate(self) -> None:
        values = list(asdict(self).values())
        if any(value < 0 for value in values):
            raise ValueError("retrieval weights must be non-negative")
        if not math.isclose(sum(values), 1.0, rel_tol=0, abs_tol=1e-9):
            raise ValueError("retrieval weights must sum to 1.0")


@dataclass(frozen=True)
class RetrievalConfig:
    windowCharacterTarget: int = 700
    sentenceOverlap: int = 1
    neighborWindowCount: int = 1
    minimumCombinedScore: float = 0.18
    maximumSeedWindows: int = 12
    maximumPackets: int = 8
    enableEmbeddings: bool = True
    enableBm25: bool = True
    requireAllConceptGroups: bool = True
    minimumConceptGroupScore: float = 0.60
    exactTermStrongHit: float = 0.82
    aliasStrongHit: float = 0.92
    embeddingStrongHit: float = 0.72
    fuzzyConceptThreshold: float = 0.92
    weights: RetrievalWeights = field(default_factory=RetrievalWeights)

    @classmethod
    def from_mapping(cls, value: dict[str, Any] | None) -> "RetrievalConfig":
        if not value:
            result = cls()
        else:
            known = {field_name for field_name in cls.__dataclass_fields__}
            unknown = sorted(set(value) - known)
            if unknown:
                raise ValueError(f"unknown retrieval config fields: {', '.join(unknown)}")
            values = dict(value)
            if "weights" in values and isinstance(values["weights"], dict):
                values["weights"] = RetrievalWeights(**values["weights"])
            result = cls(**values)
        result.validate()
        return result

    def validate(self) -> None:
        if self.windowCharacterTarget < 1:
            raise ValueError("windowCharacterTarget must be positive")
        if self.sentenceOverlap < 0 or self.neighborWindowCount < 0:
            raise ValueError("overlap and neighbor counts must be non-negative")
        if self.maximumSeedWindows < 1 or self.maximumPackets < 1:
            raise ValueError("seed and packet caps must be positive")
        for name in (
            "minimumCombinedScore", "exactTermStrongHit", "aliasStrongHit",
            "embeddingStrongHit", "fuzzyConceptThreshold", "minimumConceptGroupScore",
        ):
            score = getattr(self, name)
            if score < 0 or score > 1:
                raise ValueError(f"{name} must be between 0 and 1")
        self.weights.validate()


class EmbeddingBackend(Protocol):
    @property
    def identity(self) -> str: ...

    def encode(self, texts: Sequence[str]) -> np.ndarray: ...


class SentenceTransformerEmbeddingBackend:
    """Pinned, local-files-only Sentence Transformer backend."""

    def __init__(self, cache_folder: str | Path | None = None) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:  # pragma: no cover - environment guard
            raise RuntimeError(
                "Embeddings requested but sentence-transformers==3.0.1 is unavailable. "
                "Install the pinned requirements or set enableEmbeddings=false explicitly."
            ) from error
        self._model = SentenceTransformer(
            EMBEDDING_MODEL,
            revision=EMBEDDING_MODEL_REVISION,
            cache_folder=str(cache_folder) if cache_folder else None,
            local_files_only=True,
        )

    @property
    def identity(self) -> str:
        return f"{EMBEDDING_MODEL}@{EMBEDDING_MODEL_REVISION}"

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        return np.asarray(
            self._model.encode(
                list(texts),
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            ),
            dtype=np.float32,
        )


_NLP: Language | None = None


def _load_nlp() -> Language:
    global _NLP
    if _NLP is None:
        try:
            _NLP = spacy.load(SPACY_MODEL)
        except OSError as error:  # pragma: no cover - environment guard
            raise RuntimeError(
                f"Required spaCy pipeline {SPACY_MODEL}=={SPACY_MODEL_VERSION} is unavailable."
            ) from error
        installed = _NLP.meta.get("version")
        if installed != SPACY_MODEL_VERSION:
            raise RuntimeError(
                f"spaCy model version mismatch: expected {SPACY_MODEL_VERSION}, found {installed}."
            )
        _NLP.max_length = max(_NLP.max_length, 5_000_000)
    return _NLP


def _normalized(value: str) -> str:
    return re.sub(
        r"\s+", " ",
        unicodedata.normalize("NFKC", str(value or "")).replace("’", "'").replace("‘", "'").lower(),
    ).strip()


def _round(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 6)


def _unique(values: Sequence[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def _content_tokens(doc: Doc, *, lemmas: bool) -> list[str]:
    values: list[str] = []
    for token in doc:
        if token.is_space or token.is_punct or token.is_stop:
            continue
        value = token.lemma_ if lemmas and token.lemma_ else token.text
        normalized = _normalized(value)
        if len(normalized) > 1 or any(character.isdigit() for character in normalized):
            values.append(normalized)
    return values


def _entities(doc: Doc) -> list[str]:
    allowed = {"PERSON", "ORG", "GPE", "LOC", "FAC", "LAW", "WORK_OF_ART", "DATE", "TIME", "EVENT", "NORP"}
    return _unique([_normalized(entity.text) for entity in doc.ents if entity.label_ in allowed])


def _noun_chunks(doc: Doc) -> list[str]:
    return _unique([
        " ".join(
            _normalized(token.lemma_ or token.text)
            for token in chunk
            if not token.is_stop and not token.is_punct and not token.is_space
        ).strip()
        for chunk in doc.noun_chunks
    ])


def _predicates(doc: Doc) -> list[str]:
    return _unique([
        _normalized(token.lemma_ or token.text)
        for token in doc
        if token.pos_ in {"VERB", "AUX"} and token.dep_ not in {"aux", "auxpass"}
    ])


def _ratio_overlap(query: Sequence[str], candidate: Sequence[str]) -> float:
    wanted = set(query)
    if not wanted:
        return 0.0
    return _round(len(wanted.intersection(candidate)) / len(wanted))


def _phrase_present(phrase: str, text: str) -> bool:
    normalized = _normalized(phrase)
    if not normalized:
        return False
    return re.search(rf"(?<!\w){re.escape(normalized)}(?!\w)", text) is not None


def _fuzzy_phrase_score(phrase: str, text: str) -> float:
    if _phrase_present(phrase, text):
        return 1.0
    return _round(fuzz.partial_ratio(_normalized(phrase), text) / 100.0)


def _tfidf_scores(query: str, windows: Sequence[str], ngram: int) -> list[float]:
    if not windows:
        return []
    try:
        matrix = TfidfVectorizer(
            ngram_range=(ngram, ngram),
            lowercase=True,
            strip_accents="unicode",
            token_pattern=r"(?u)\b\w[\w'-]+\b",
        ).fit_transform([query, *windows])
    except ValueError:
        return [0.0] * len(windows)
    return [_round(value) for value in cosine_similarity(matrix[0:1], matrix[1:]).ravel()]


def _bm25_scores(query_tokens: Sequence[str], window_tokens: Sequence[Sequence[str]]) -> list[float]:
    if not query_tokens or not window_tokens or not any(window_tokens):
        return [0.0] * len(window_tokens)
    # BM25Okapi assigns an IDF of exactly zero when a term occurs in half of a
    # two-document corpus. Two neutral empty sentinels prevent that small-corpus
    # degeneracy without changing candidate ordering or introducing terms.
    corpus = [list(tokens) for tokens in window_tokens]
    corpus.extend([[], []])
    raw = np.asarray(BM25Okapi(corpus).get_scores(list(query_tokens))[:len(window_tokens)], dtype=np.float64)
    if raw.size == 0 or np.allclose(raw, 0):
        return [0.0] * len(window_tokens)
    low = float(raw.min())
    high = float(raw.max())
    if math.isclose(low, high, abs_tol=1e-12):
        return [1.0] * len(window_tokens)
    return [_round((float(value) - low) / (high - low)) for value in raw]


def _cosine_scores(query: np.ndarray, candidates: np.ndarray) -> list[float]:
    query_vector = query.reshape(1, -1)
    values = cosine_similarity(query_vector, candidates).ravel()
    return [_round(max(0.0, float(value))) for value in values]


def _canonical_document(blocks: Sequence[dict[str, str]]) -> tuple[str, list[dict[str, Any]]]:
    parts: list[str] = []
    spans: list[dict[str, Any]] = []
    cursor = 0
    for index, block in enumerate(blocks):
        if index:
            parts.append("\n\n")
            cursor += 2
        text = str(block.get("text", ""))
        start = cursor
        parts.append(text)
        cursor += len(text)
        spans.append({"blockId": str(block["blockId"]), "charStart": start, "charEnd": cursor})
    return "".join(parts), spans


def _build_windows(blocks: Sequence[dict[str, str]], target: int, overlap: int, nlp: Language) -> tuple[str, list[dict[str, Any]]]:
    document_text, block_spans = _canonical_document(blocks)
    sentences: list[dict[str, Any]] = []
    for block in block_spans:
        block_text = document_text[block["charStart"]:block["charEnd"]]
        parsed = nlp(block_text)
        for sentence in parsed.sents:
            start = block["charStart"] + sentence.start_char
            end = block["charStart"] + sentence.end_char
            if end > start:
                sentences.append({"blockId": block["blockId"], "charStart": start, "charEnd": end})
    windows: list[dict[str, Any]] = []
    start_index = 0
    while start_index < len(sentences):
        end_index = start_index
        while end_index + 1 < len(sentences) and sentences[end_index]["charEnd"] - sentences[start_index]["charStart"] < target:
            end_index += 1
        selected = sentences[start_index:end_index + 1]
        char_start = selected[0]["charStart"]
        char_end = selected[-1]["charEnd"]
        windows.append({
            "windowId": f"B{len(windows) + 1:04d}",
            "windowIndex": len(windows),
            "blockIds": _unique([sentence["blockId"] for sentence in selected]),
            "charStart": char_start,
            "charEnd": char_end,
            "text": document_text[char_start:char_end],
        })
        if end_index >= len(sentences) - 1:
            break
        start_index = max(start_index + 1, end_index + 1 - overlap)
    return document_text, windows


class AssertionRelativeBlockRetriever:
    def __init__(
        self,
        *,
        nlp: Language | None = None,
        embedding_backend: EmbeddingBackend | None = None,
        embedding_cache_directory: str | Path | None = None,
    ) -> None:
        self.nlp = nlp or _load_nlp()
        self.embedding_backend = embedding_backend
        self.embedding_cache_directory = Path(embedding_cache_directory) if embedding_cache_directory else None
        self.embedding_cache_hits = 0
        self.embedding_cache_misses = 0

    def _window_embeddings(self, document_id: str, windows: Sequence[dict[str, Any]]) -> np.ndarray:
        assert self.embedding_backend is not None
        content_hash = sha256(
            json.dumps(
                {"documentId": document_id, "model": self.embedding_backend.identity, "windows": [(row["windowId"], row["text"]) for row in windows]},
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        cache_file = self.embedding_cache_directory / f"{content_hash}.json" if self.embedding_cache_directory else None
        if cache_file and cache_file.exists():
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            self.embedding_cache_hits += 1
            return np.asarray(payload["embeddings"], dtype=np.float32)
        embeddings = self.embedding_backend.encode([row["text"] for row in windows])
        self.embedding_cache_misses += 1
        if cache_file:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "cacheVersion": 1,
                "documentId": document_id,
                "model": self.embedding_backend.identity,
                "contentHash": content_hash,
                "windowIds": [row["windowId"] for row in windows],
                "embeddings": embeddings.tolist(),
            }
            temporary = cache_file.with_suffix(".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            temporary.replace(cache_file)
        return embeddings

    def retrieve(self, payload: dict[str, Any]) -> dict[str, Any]:
        assertion = payload["assertion"]
        document = payload["document"]
        config = RetrievalConfig.from_mapping(payload.get("config"))
        aliases = _unique([str(value).strip() for value in assertion.get("aliases", []) if str(value).strip()])
        concept_groups = [
            _unique([str(value).strip() for value in group if str(value).strip()])
            for group in assertion.get("requiredConceptGroups", [])
        ]
        concept_groups = [group for group in concept_groups if group]
        document_text, windows = _build_windows(
            document.get("blocks", []), config.windowCharacterTarget, config.sentenceOverlap, self.nlp,
        )
        if not windows:
            return self._empty_output(assertion["assertionId"], document["documentId"], len(document_text), config)

        assertion_doc = self.nlp(str(assertion["text"]))
        alias_docs = list(self.nlp.pipe(aliases))
        window_docs = list(self.nlp.pipe([row["text"] for row in windows]))
        query_surface = _unique(_content_tokens(assertion_doc, lemmas=False))
        query_lemmas = _unique(_content_tokens(assertion_doc, lemmas=True))
        query_entities = _unique([*_entities(assertion_doc), *[entity for doc in alias_docs for entity in _entities(doc)]])
        query_chunks = _noun_chunks(assertion_doc)
        query_predicates = _predicates(assertion_doc)
        window_surface = [_unique(_content_tokens(doc, lemmas=False)) for doc in window_docs]
        window_lemmas = [_unique(_content_tokens(doc, lemmas=True)) for doc in window_docs]
        window_entities = [_entities(doc) for doc in window_docs]
        window_chunks = [_noun_chunks(doc) for doc in window_docs]
        window_predicates = [_predicates(doc) for doc in window_docs]

        query_for_vector = " ".join([str(assertion["text"]), *aliases])
        texts = [row["text"] for row in windows]
        unigram_scores = _tfidf_scores(query_for_vector, texts, 1)
        bigram_scores = _tfidf_scores(query_for_vector, texts, 2)
        bm25_scores = _bm25_scores(query_lemmas, window_lemmas) if config.enableBm25 else [0.0] * len(windows)
        embedding_scores = [0.0] * len(windows)
        embedding_mode = "disabled"
        if config.enableEmbeddings:
            if self.embedding_backend is None:
                raise RuntimeError(
                    "enableEmbeddings=true requires an explicit local EmbeddingBackend; "
                    "use SentenceTransformerEmbeddingBackend or set enableEmbeddings=false."
                )
            query_embedding = self.embedding_backend.encode([query_for_vector])[0]
            embedding_scores = _cosine_scores(query_embedding, self._window_embeddings(document["documentId"], windows))
            embedding_mode = self.embedding_backend.identity

        scored: list[dict[str, Any]] = []
        for index, window in enumerate(windows):
            normalized_text = _normalized(window["text"])
            exact_overlap = _ratio_overlap(query_surface, window_surface[index])
            lemma_overlap = _ratio_overlap(query_lemmas, window_lemmas[index])
            entity_overlap = _ratio_overlap(query_entities, window_entities[index])
            predicate_overlap = _ratio_overlap(query_predicates, window_predicates[index])
            noun_chunk_overlap = 0.0
            matched_chunks: list[str] = []
            if query_chunks:
                for chunk in query_chunks:
                    if max((_fuzzy_phrase_score(chunk, candidate) for candidate in window_chunks[index]), default=0.0) >= 0.90:
                        matched_chunks.append(chunk)
                noun_chunk_overlap = _round(len(matched_chunks) / len(query_chunks))
            alias_scores = {alias: _fuzzy_phrase_score(alias, normalized_text) for alias in aliases}
            matched_aliases = sorted(alias for alias, score in alias_scores.items() if score >= 0.90)
            alias_similarity = max(alias_scores.values(), default=0.0)
            strong_alias_similarity = max(
                (score for alias, score in alias_scores.items() if len(_normalized(alias).split()) >= 2),
                default=0.0,
            )
            satisfied_groups: list[list[str]] = []
            for group in concept_groups:
                if any(_fuzzy_phrase_score(term, normalized_text) >= config.fuzzyConceptThreshold for term in group):
                    satisfied_groups.append(group)
            concept_score = _round(len(satisfied_groups) / len(concept_groups)) if concept_groups else 1.0
            components = {
                "tfidfUnigram": unigram_scores[index],
                "tfidfBigram": bigram_scores[index],
                "bm25": bm25_scores[index],
                "embeddingSimilarity": embedding_scores[index],
                "exactTermOverlap": exact_overlap,
                "lemmaOverlap": lemma_overlap,
                "entityOverlap": entity_overlap,
                "nounChunkOverlap": noun_chunk_overlap,
                "predicateOverlap": predicate_overlap,
                "aliasSimilarity": alias_similarity,
                "conceptGroupScore": concept_score,
            }
            weights = config.weights
            combined = _round(
                components["embeddingSimilarity"] * weights.embeddingSimilarity
                + components["bm25"] * weights.bm25
                + components["tfidfUnigram"] * weights.tfidfUnigram
                + components["tfidfBigram"] * weights.tfidfBigram
                + components["entityOverlap"] * weights.entityOverlap
                + components["predicateOverlap"] * weights.predicateOverlap
                + ((components["exactTermOverlap"] + components["lemmaOverlap"]) / 2) * weights.exactOrLemmaOverlap
                + components["nounChunkOverlap"] * weights.nounChunkOverlap
                + components["aliasSimilarity"] * weights.aliasSimilarity
            )
            matched_terms = sorted(_unique([
                *[term for term in query_surface if term in window_surface[index]],
                *[term for term in query_lemmas if term in window_lemmas[index]],
                *[term for group in satisfied_groups for term in group if _fuzzy_phrase_score(term, normalized_text) >= config.fuzzyConceptThreshold],
            ]))
            strong_hits = []
            if exact_overlap >= config.exactTermStrongHit:
                strong_hits.append("strong_exact_term_overlap")
            if strong_alias_similarity >= config.aliasStrongHit:
                strong_hits.append("strong_alias_similarity")
            if embedding_scores[index] >= config.embeddingStrongHit:
                strong_hits.append("strong_embedding_similarity")
            concept_allowed = (
                not concept_groups
                or (concept_score == 1.0 if config.requireAllConceptGroups else concept_score >= config.minimumConceptGroupScore)
            )
            # With explicit concept guards, strong single-component hits do not
            # bypass the governed combined-score floor. This prevents a generic
            # alias or semantically nearby passage from becoming a seed alone.
            strong_override = bool(strong_hits) and not concept_groups
            selected = concept_allowed and (combined >= config.minimumCombinedScore or strong_override)
            scored.append({
                **window,
                "combinedScore": combined,
                "scoreComponents": components,
                "matchedTerms": matched_terms,
                "matchedEntities": sorted(set(query_entities).intersection(window_entities[index])),
                "matchedPredicates": sorted(set(query_predicates).intersection(window_predicates[index])),
                "matchedAliases": matched_aliases,
                "satisfiedConceptGroups": satisfied_groups,
                "selectionEligible": selected,
                "strongHits": strong_hits,
            })

        seeds = sorted(
            [row for row in scored if row["selectionEligible"]],
            key=lambda row: (-row["combinedScore"], row["windowIndex"]),
        )[:config.maximumSeedWindows]
        seed_indices = {row["windowIndex"] for row in seeds}
        included_indices = set(seed_indices)
        for seed in seeds:
            for distance in range(1, config.neighborWindowCount + 1):
                if seed["windowIndex"] - distance >= 0:
                    included_indices.add(seed["windowIndex"] - distance)
                if seed["windowIndex"] + distance < len(scored):
                    included_indices.add(seed["windowIndex"] + distance)
        selected = [scored[index] for index in sorted(included_indices)]
        merged_packets = self._merge_packets(selected, seed_indices, document_text)
        packets = sorted(
            sorted(merged_packets, key=lambda packet: (-packet["combinedScore"], packet["charStart"]))[:config.maximumPackets],
            key=lambda packet: packet["charStart"],
        )
        for packet_index, packet in enumerate(packets, start=1):
            packet["packetId"] = f"PACKET-{packet_index:04d}"
        retained = sum(packet["charEnd"] - packet["charStart"] for packet in packets)
        return {
            "assertionId": assertion["assertionId"],
            "documentId": document["documentId"],
            "selectedPackets": packets,
            "diagnostics": {
                "windowCount": len(windows),
                "seedWindowCount": len(seeds),
                "packetCount": len(packets),
                "retainedCharacterCount": retained,
                "documentCharacterCount": len(document_text),
                "retainedCharacterRatio": _round(retained / len(document_text)) if document_text else 0.0,
                "modelCalls": 0,
                "embeddingMode": embedding_mode,
                "seedRanking": [
                    {
                        "windowId": row["windowId"],
                        "combinedScore": row["combinedScore"],
                        "scoreComponents": row["scoreComponents"],
                        "matchedTerms": row["matchedTerms"],
                    }
                    for row in seeds
                ],
                "topWindowScores": [
                    {
                        "windowId": row["windowId"],
                        "combinedScore": row["combinedScore"],
                        "selectionEligible": row["selectionEligible"],
                        "scoreComponents": row["scoreComponents"],
                        "matchedTerms": row["matchedTerms"],
                    }
                    for row in sorted(scored, key=lambda value: (-value["combinedScore"], value["windowIndex"]))[:12]
                ],
            },
        }

    def _merge_packets(self, selected: list[dict[str, Any]], seed_indices: set[int], document_text: str) -> list[dict[str, Any]]:
        groups: list[list[dict[str, Any]]] = []
        for window in selected:
            if not groups or window["windowIndex"] > groups[-1][-1]["windowIndex"] + 1:
                groups.append([window])
            else:
                groups[-1].append(window)
        packets: list[dict[str, Any]] = []
        for index, group in enumerate(groups):
            seeds = [row for row in group if row["windowIndex"] in seed_indices]
            neighbors = [row for row in group if row["windowIndex"] not in seed_indices]
            best = sorted(seeds or group, key=lambda row: (-row["combinedScore"], row["windowIndex"]))[0]
            char_start = min(row["charStart"] for row in group)
            char_end = max(row["charEnd"] for row in group)
            packets.append({
                "packetId": f"PACKET-{index + 1:04d}",
                "blockIds": _unique([block_id for row in group for block_id in row["blockIds"]]),
                "charStart": char_start,
                "charEnd": char_end,
                "text": document_text[char_start:char_end],
                "seedWindowIds": [row["windowId"] for row in seeds],
                "neighborWindowIds": [row["windowId"] for row in neighbors],
                "combinedScore": best["combinedScore"],
                "scoreComponents": best["scoreComponents"],
                "matchedTerms": sorted(_unique([term for row in group for term in row["matchedTerms"]])),
                "matchedEntities": sorted(_unique([term for row in group for term in row["matchedEntities"]])),
                "matchedPredicates": sorted(_unique([term for row in group for term in row["matchedPredicates"]])),
                "matchedAliases": sorted(_unique([term for row in group for term in row["matchedAliases"]])),
                "satisfiedConceptGroups": [
                    group_value for group_value in best["satisfiedConceptGroups"]
                ],
                "selectionReason": ";".join([
                    f"seeds:{','.join(row['windowId'] for row in seeds)}",
                    f"neighbors:{','.join(row['windowId'] for row in neighbors)}",
                    f"bestCombinedScore:{best['combinedScore']:.6f}",
                    *(best["strongHits"] or ["minimumCombinedScore"]),
                ]),
            })
        return packets

    @staticmethod
    def _empty_output(assertion_id: str, document_id: str, document_characters: int, config: RetrievalConfig) -> dict[str, Any]:
        return {
            "assertionId": assertion_id,
            "documentId": document_id,
            "selectedPackets": [],
            "diagnostics": {
                "windowCount": 0,
                "seedWindowCount": 0,
                "packetCount": 0,
                "retainedCharacterCount": 0,
                "documentCharacterCount": document_characters,
                "retainedCharacterRatio": 0.0,
                "modelCalls": 0,
                "embeddingMode": "enabled_without_windows" if config.enableEmbeddings else "disabled",
            },
        }
