"""
rag/reranker.py — Cross-encoder reranking and context compression.

Two-stage post-retrieval processing:
  Stage 1 — Rerank:   Score every candidate chunk against the query with a
                       cross-encoder model (FlashRank, no API key required).
                       Optional upgrade: Cohere Rerank API.
  Stage 2 — Compress: Trim chunks that are below a relevance threshold and
                       fit within a token budget before sending to the LLM.

Usage::

    from app.rag.reranker import Reranker
    reranker = Reranker()
    top_docs, sources = await reranker.rerank_and_compress(query, candidates)
"""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.documents import Document

from app.config import settings
from app.core.logger import get_logger
from app.models.chat import SourceReference

log = get_logger(__name__)

# Minimum relevance score (0–1) to keep a chunk after reranking.
# Chunks below this threshold are silently dropped.
_RELEVANCE_THRESHOLD = 0.05

# Approximate chars-per-token ratio for budget calculation (safe for English).
_CHARS_PER_TOKEN = 4

# Max tokens sent to the LLM as context (leave headroom for prompt + answer).
_MAX_CONTEXT_TOKENS = 3_000


# ---------------------------------------------------------------------------
# FlashRank reranker (CPU, no API key)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_flashrank_ranker() -> Any:
    """
    Lazy-load the FlashRank cross-encoder.
    Cached after first call — model weights stay in memory.
    """
    try:
        from flashrank import Ranker

        log.info("reranker_init", backend="flashrank")
        # ms-marco-MiniLM-L-12-v2 — fast, accurate, ~120 MB
        return Ranker(model_name="ms-marco-MiniLM-L-12-v2", cache_dir="/tmp/flashrank")
    except ImportError:
        log.warning("flashrank_not_installed", fallback="score_passthrough")
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_source_reference(doc: Document, score: float) -> SourceReference:
    """Convert a LangChain Document + score into a SourceReference schema object."""
    meta = doc.metadata
    excerpt = doc.page_content.strip()[:400]
    # Append ellipsis if truncated
    if len(doc.page_content.strip()) > 400:
        excerpt += "…"

    return SourceReference(
        document_id=meta.get("doc_id", "unknown"),
        file_name=meta.get("file_name", "unknown"),
        page=meta.get("page"),
        chunk_index=meta.get("chunk_index", 0),
        score=round(min(max(score, 0.0), 1.0), 4),
        excerpt=excerpt,
        metadata={
            k: v
            for k, v in meta.items()
            if k not in {"doc_id", "file_name", "page", "chunk_index", "chunk_id"}
        },
    )


def _token_budget_trim(docs: List[Document], max_tokens: int) -> List[Document]:
    """
    Greedily include documents until the character-budget is exhausted.
    Preserves ranking order (most relevant first).
    """
    budget = max_tokens * _CHARS_PER_TOKEN
    kept: List[Document] = []
    used = 0
    for doc in docs:
        length = len(doc.page_content)
        if used + length > budget:
            # Try to fit a truncated version if it's the first doc
            if not kept and length > 200:
                truncated_chars = budget - used
                truncated = Document(
                    page_content=doc.page_content[:truncated_chars] + "…",
                    metadata=doc.metadata,
                )
                kept.append(truncated)
            break
        kept.append(doc)
        used += length
    return kept


# ---------------------------------------------------------------------------
# Reranker
# ---------------------------------------------------------------------------

class Reranker:
    """
    Reranks retrieval candidates with a cross-encoder and optionally
    compresses the context to fit within the LLM's token budget.

    Falls back gracefully if FlashRank is unavailable (passes candidates
    through ranked by their original retrieval score).
    """

    def __init__(self) -> None:
        self._ranker = _get_flashrank_ranker()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def rerank_and_compress(
        self,
        query: str,
        candidates: List[Document],
        top_n: Optional[int] = None,
    ) -> Tuple[List[Document], List[SourceReference]]:
        """
        Rerank candidates against the query, then compress to token budget.

        Args:
            query:      The user's question.
            candidates: Documents from hybrid retrieval (pre-ranked by RRF).
            top_n:      Max docs to keep after reranking.
                        Defaults to settings.rerank_top_n.

        Returns:
            (compressed_docs, source_references)
              compressed_docs    — trimmed list of Documents for LLM context
              source_references  — all reranked docs as citation metadata
                                   (not truncated by token budget)
        """
        n = top_n or settings.rerank_top_n

        if not candidates:
            log.debug("reranker_skip_empty")
            return [], []

        log.debug("reranker_start", candidates=len(candidates), top_n=n)

        # Run in thread pool — cross-encoder inference is CPU-bound
        loop = asyncio.get_event_loop()
        scored_docs: List[Tuple[Document, float]] = await loop.run_in_executor(
            None, self._rerank_sync, query, candidates
        )

        # Filter by threshold
        above_threshold = [
            (doc, score)
            for doc, score in scored_docs
            if score >= _RELEVANCE_THRESHOLD
        ]

        if not above_threshold:
            log.info("reranker_all_below_threshold", threshold=_RELEVANCE_THRESHOLD)
            # Fall back to top candidates regardless of threshold
            above_threshold = scored_docs[:n]

        # Keep top_n for LLM context
        top = above_threshold[:n]

        # Build source references (pre-compression, full set up to top_n)
        sources = [_build_source_reference(doc, score) for doc, score in top]

        # Compress docs to token budget
        top_docs = [doc for doc, _ in top]
        compressed = _token_budget_trim(top_docs, _MAX_CONTEXT_TOKENS)

        log.info(
            "reranker_done",
            candidates_in=len(candidates),
            after_threshold=len(above_threshold),
            after_compression=len(compressed),
        )

        return compressed, sources

    # ------------------------------------------------------------------
    # Private (sync — called via run_in_executor)
    # ------------------------------------------------------------------

    def _rerank_sync(
        self,
        query: str,
        candidates: List[Document],
    ) -> List[Tuple[Document, float]]:
        """
        Score each candidate against the query.

        Uses FlashRank cross-encoder when available, otherwise falls back
        to a 1/rank score so the retrieval order is preserved.
        """
        if self._ranker is not None:
            return self._flashrank_rerank(query, candidates)
        return self._passthrough_rank(candidates)

    def _flashrank_rerank(
        self,
        query: str,
        candidates: List[Document],
    ) -> List[Tuple[Document, float]]:
        """Score with FlashRank ms-marco cross-encoder."""
        from flashrank import RerankRequest

        passages = [
            {"id": i, "text": doc.page_content}
            for i, doc in enumerate(candidates)
        ]
        request = RerankRequest(query=query, passages=passages)
        results = self._ranker.rerank(request)

        # FlashRank returns results sorted by score descending
        id_to_doc = {i: doc for i, doc in enumerate(candidates)}
        scored = []
        for res in results:
            doc = id_to_doc[res["id"]]
            # FlashRank scores are logits; normalise to [0,1] via sigmoid
            raw_score: float = res["score"]
            import math
            normalised = 1.0 / (1.0 + math.exp(-raw_score))
            scored.append((doc, normalised))

        return scored  # already sorted

    def _passthrough_rank(
        self,
        candidates: List[Document],
    ) -> List[Tuple[Document, float]]:
        """
        Fallback: assign 1/rank scores so ordering from RRF is preserved.
        Used when FlashRank is not installed.
        """
        log.debug("reranker_passthrough")
        return [
            (doc, 1.0 / (rank + 1))
            for rank, doc in enumerate(candidates)
        ]
