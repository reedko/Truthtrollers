"""Deterministic, assertion-relative source-block retrieval."""

from .retriever import (
    AssertionRelativeBlockRetriever,
    EmbeddingBackend,
    RetrievalConfig,
    RetrievalWeights,
    SentenceTransformerEmbeddingBackend,
)

__all__ = [
    "AssertionRelativeBlockRetriever",
    "EmbeddingBackend",
    "RetrievalConfig",
    "RetrievalWeights",
    "SentenceTransformerEmbeddingBackend",
]
