"""
rag/retriever.py — Hybrid retrieval with multi-query expansion.

Pipeline:
  1. Multi-query expansion  — LLM generates N alternative phrasings of the user query
  2. Vector search          — semantic similarity via the configured vector store
  3. BM25 keyword search    — exact/term match via rank-bm25
  4. Score fusion           — weighted Reciprocal Rank Fusion (RRF) merge
  5. Metadata filtering     — optional pre-filter on vector side + post-filter on BM25

The result is a de-duplicated, ranked list of Document objects ready for reranking.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from rank_bm25 import BM25Okapi

from app.config import settings
from app.core.logger import get_logger
from app.rag.utils import get_embeddings, get_llm, get_vector_store, load_bm25_index

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Multi-query prompt
# ---------------------------------------------------------------------------

_MULTI_QUERY_PROMPT = ChatPromptTemplate.from_template(
    """You are an expert at reformulating search queries to improve document retrieval.

Given the user query below, generate {n} alternative phrasings that capture the same
intent but use different vocabulary, perspectives, or levels of specificity.
Return ONLY the queries, one per line, with no numbering, bullets, or extra text.

Original query: {query}

Alternative queries:"""
)


# ---------------------------------------------------------------------------
# Reciprocal Rank Fusion
# ---------------------------------------------------------------------------

def _reciprocal_rank_fusion(
    ranked_lists: List[List[Tuple[Document, float]]],
    vector_weight: float = settings.vector_weight,
    bm25_weight: float = settings.bm25_weight,
    k: int = 60,
) -> List[Tuple[Document, float]]:
    """
    Merge multiple ranked lists with weighted RRF.

    RRF score = Σ (weight_i / (k + rank_i))

    Args:
        ranked_lists: Each element is a list of (Document, score) tuples,
                      highest score first.
        vector_weight: Weight applied to vector-search lists.
        bm25_weight:   Weight applied to BM25 lists.
        k:             RRF constant (default 60 per the original paper).

    Returns:
        Merged and sorted list of (Document, fused_score) tuples.
    """
    # Weights cycle: first list(s) are vector results, last is BM25
    weights = [vector_weight] * (len(ranked_lists) - 1) + [bm25_weight]

    scores: Dict[str, float] = {}
    doc_map: Dict[str, Document] = {}

    for rank_list, weight in zip(ranked_lists, weights):
        for rank, (doc, _score) in enumerate(rank_list, start=1):
            chunk_id = doc.metadata.get("chunk_id", doc.page_content[:64])
            scores[chunk_id] = scores.get(chunk_id, 0.0) + weight / (k + rank)
            doc_map[chunk_id] = doc

    merged = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    return [(doc_map[cid], score) for cid, score in merged]


# ---------------------------------------------------------------------------
# BM25 search helper
# ---------------------------------------------------------------------------

def _bm25_search(
    query: str,
    top_k: int,
    filters: Optional[Dict[str, Any]] = None,
) -> List[Tuple[Document, float]]:
    """
    Run BM25 keyword search against the persisted corpus.

    Returns a list of (Document, normalised_score) tuples.
    """
    index_data = load_bm25_index()
    corpus: List[str] = index_data.get("corpus", [])
    metadata: List[Dict[str, Any]] = index_data.get("metadata", [])

    if not corpus:
        log.debug("bm25_empty_corpus")
        return []

    tokenized_corpus = [doc.lower().split() for doc in corpus]
    bm25 = BM25Okapi(tokenized_corpus)

    tokenized_query = query.lower().split()
    raw_scores: List[float] = bm25.get_scores(tokenized_query).tolist()

    # Pair each doc with its score + metadata
    paired = list(zip(corpus, metadata, raw_scores))

    # Apply metadata filters
    if filters:
        paired = [
            (text, meta, score)
            for text, meta, score in paired
            if all(meta.get(k) == v for k, v in filters.items())
        ]

    # Sort descending and take top_k
    paired.sort(key=lambda x: x[2], reverse=True)
    top = paired[:top_k]

    if not top:
        return []

    # Normalise scores to [0, 1]
    max_score = top[0][2] or 1.0
    results = []
    for text, meta, score in top:
        doc = Document(page_content=text, metadata=meta)
        results.append((doc, score / max_score))

    return results


# ---------------------------------------------------------------------------
# Retriever
# ---------------------------------------------------------------------------

class HybridRetriever:
    """
    Combines vector similarity search and BM25 keyword search via RRF.

    Usage::

        retriever = HybridRetriever()
        docs, expansions = await retriever.retrieve(
            query="What is the refund policy?",
            top_k=10,
            filters={"file_name": "policy.pdf"},
        )
    """

    def __init__(self) -> None:
        self._embeddings = get_embeddings()
        self._vector_store = get_vector_store()
        # Use a non-streaming LLM for query expansion (fast, low cost)
        self._llm = get_llm(streaming=False)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        query: str,
        top_k: Optional[int] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Tuple[List[Document], List[str]]:
        """
        Execute full hybrid retrieval for a query.

        Args:
            query:   The user's question.
            top_k:   Number of candidates to fetch (before reranking).
                     Defaults to settings.retrieval_top_k.
            filters: Optional metadata filter dict.

        Returns:
            (documents, query_expansions)
              documents        — de-duplicated, RRF-ranked Document list
              query_expansions — alternative queries generated by LLM
        """
        k = top_k or settings.retrieval_top_k

        # Step 1: expand query
        expanded_queries = await self._expand_queries(query)
        all_queries = [query] + expanded_queries

        log.debug(
            "retrieval_start",
            query=query[:80],
            expansions=len(expanded_queries),
            top_k=k,
        )

        # Step 2: run vector + BM25 searches in parallel for each query
        ranked_lists = await self._parallel_search(all_queries, k, filters)

        # Step 3: fuse with RRF
        fused = _reciprocal_rank_fusion(ranked_lists)

        # Step 4: deduplicate by chunk_id, keep top_k
        seen: set[str] = set()
        unique: List[Document] = []
        for doc, _score in fused:
            cid = doc.metadata.get("chunk_id", doc.page_content[:64])
            if cid not in seen:
                seen.add(cid)
                unique.append(doc)
            if len(unique) >= k:
                break

        log.info(
            "retrieval_done",
            total_candidates=len(unique),
            query_count=len(all_queries),
        )
        return unique, expanded_queries

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    async def _expand_queries(self, query: str) -> List[str]:
        """Use the LLM to generate alternative query phrasings."""
        if settings.multi_query_count <= 0:
            return []

        try:
            chain = _MULTI_QUERY_PROMPT | self._llm | StrOutputParser()
            raw: str = await chain.ainvoke(
                {"query": query, "n": settings.multi_query_count}
            )
            expansions = [
                line.strip()
                for line in raw.strip().splitlines()
                if line.strip() and line.strip() != query
            ][: settings.multi_query_count]
            log.debug("query_expansion", count=len(expansions))
            return expansions
        except Exception as exc:
            # Non-fatal — fall back to original query only
            log.warning("query_expansion_failed", error=str(exc))
            return []

    async def _parallel_search(
        self,
        queries: List[str],
        top_k: int,
        filters: Optional[Dict[str, Any]],
    ) -> List[List[Tuple[Document, float]]]:
        """
        Run vector search + BM25 for every query concurrently.

        Returns a flat list of ranked result lists (one per search call)
        to be fused by RRF.
        """
        loop = asyncio.get_event_loop()

        async def vector_search(q: str) -> List[Tuple[Document, float]]:
            try:
                # similarity_search_with_relevance_scores returns (doc, score) pairs
                results = await loop.run_in_executor(
                    None,
                    lambda: self._vector_store.similarity_search_with_relevance_scores(
                        q,
                        k=top_k,
                        filter=filters,  # supported by Pinecone/Weaviate; ignored by FAISS
                    ),
                )
                return results
            except Exception as exc:
                log.warning("vector_search_failed", query=q[:60], error=str(exc))
                return []

        async def bm25_search(q: str) -> List[Tuple[Document, float]]:
            try:
                return await loop.run_in_executor(
                    None, _bm25_search, q, top_k, filters
                )
            except Exception as exc:
                log.warning("bm25_search_failed", query=q[:60], error=str(exc))
                return []

        # Launch all searches concurrently
        tasks = []
        for q in queries:
            tasks.append(vector_search(q))
            tasks.append(bm25_search(q))

        results = await asyncio.gather(*tasks)
        # Filter out empty result lists
        return [r for r in results if r]
