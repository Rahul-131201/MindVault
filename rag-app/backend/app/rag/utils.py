"""
rag/utils.py — Shared factory functions for RAG components.

Provides lazy, cached singletons for:
  - Embeddings (OpenAI or HuggingFace)
  - Vector store (FAISS, Pinecone, Weaviate)
  - LLM (OpenAI, Groq, Together)
  - BM25 index persistence (load / save)

All factories read from `settings` so swapping providers is purely an env-var change.
"""

from __future__ import annotations

import json
import os
import pickle
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_core.vectorstores import VectorStore as LCVectorStore

from app.config import (
    EmbeddingProvider,
    LLMProvider,
    VectorStore,
    settings,
)
from app.core.logger import get_logger

log = get_logger(__name__)

# Path for persisting the BM25 corpus alongside the FAISS index
_BM25_INDEX_PATH = Path(settings.faiss_index_path) / "bm25_corpus.json"


# ---------------------------------------------------------------------------
# Embeddings factory
# ---------------------------------------------------------------------------

@lru_cache(maxsize=2)
def get_embeddings(provider: Optional[EmbeddingProvider] = None) -> Embeddings:
    """
    Return a cached embeddings instance based on EMBEDDING_PROVIDER.

    Supported:
      - openai    → OpenAIEmbeddings (text-embedding-3-small by default)
      - huggingface → HuggingFaceEmbeddings (sentence-transformers, CPU)
    """
    provider = provider or settings.embedding_provider

    if provider == EmbeddingProvider.openai:
        try:
            from langchain_openai import OpenAIEmbeddings

            log.info("embeddings_init", provider="openai", model=settings.openai_embedding_model)
            return OpenAIEmbeddings(
                model=settings.openai_embedding_model,
                openai_api_key=settings.openai_api_key,
            )
        except Exception as e:
            log.warning("openai_embeddings_failed", error=str(e))
            log.info("falling_back_to_huggingface")
            provider = EmbeddingProvider.huggingface

    if provider == EmbeddingProvider.huggingface:
        from langchain_huggingface import HuggingFaceEmbeddings

        log.info("embeddings_init", provider="huggingface", model=settings.hf_embedding_model)
        return HuggingFaceEmbeddings(
            model_name=settings.hf_embedding_model,
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True},
        )

    raise ValueError(f"Unknown embedding provider: {provider}")


# ---------------------------------------------------------------------------
# Vector store factory
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_vector_store() -> LCVectorStore:
    """
    Return a cached vector store instance based on VECTOR_STORE.

    Supported:
      - faiss    → local FAISS (loads existing index if present)
      - pinecone → Pinecone serverless (free tier compatible)
      - weaviate → Weaviate cloud (free sandbox compatible)
    """
    emb = get_embeddings()
    store = settings.vector_store

    # ---- FAISS ------------------------------------------------------------
    if store == VectorStore.faiss:
        from langchain_community.vectorstores import FAISS

        index_path = str(settings.faiss_index_path)
        index_file = Path(index_path) / "index.faiss"

        if index_file.exists():
            log.info("vectorstore_load", provider="faiss", path=index_path)
            return FAISS.load_local(
                index_path,
                emb,
                allow_dangerous_deserialization=True,  # local file — trusted
            )
        else:
            log.info("vectorstore_create", provider="faiss", path=index_path)
            # Bootstrap with a dummy doc so FAISS initialises its internal index
            vs = FAISS.from_texts(["__init__"], emb, metadatas=[{"init": True}])
            vs.save_local(index_path)
            return vs

    # ---- Pinecone ---------------------------------------------------------
    if store == VectorStore.pinecone:
        from pinecone import Pinecone, ServerlessSpec
        from langchain_pinecone import PineconeVectorStore

        pc = Pinecone(api_key=settings.pinecone_api_key)
        existing = [idx.name for idx in pc.list_indexes()]

        if settings.pinecone_index_name not in existing:
            log.info("pinecone_create_index", name=settings.pinecone_index_name)
            # Dimension depends on embedding model:
            # text-embedding-3-small → 1536, all-MiniLM-L6-v2 → 384
            dim = _infer_embedding_dim(emb)
            pc.create_index(
                name=settings.pinecone_index_name,
                dimension=dim,
                metric="cosine",
                spec=ServerlessSpec(
                    cloud="aws",
                    region=settings.pinecone_environment,
                ),
            )

        log.info("vectorstore_init", provider="pinecone", index=settings.pinecone_index_name)
        return PineconeVectorStore(
            index_name=settings.pinecone_index_name,
            embedding=emb,
            pinecone_api_key=settings.pinecone_api_key,
        )

    # ---- Weaviate ---------------------------------------------------------
    if store == VectorStore.weaviate:
        import weaviate
        from langchain_weaviate import WeaviateVectorStore

        client = weaviate.connect_to_weaviate_cloud(
            cluster_url=settings.weaviate_url,
            auth_credentials=weaviate.auth.AuthApiKey(settings.weaviate_api_key),
        )
        log.info("vectorstore_init", provider="weaviate", class_name=settings.weaviate_class_name)
        return WeaviateVectorStore(
            client=client,
            index_name=settings.weaviate_class_name,
            text_key="text",
            embedding=emb,
        )

    raise ValueError(f"Unknown vector store: {store}")


# ---------------------------------------------------------------------------
# LLM factory
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_llm(streaming: bool = False) -> BaseChatModel:
    """
    Return a cached LLM instance based on LLM_PROVIDER.

    Supported:
      - openai  → ChatOpenAI (gpt-4o by default)
      - groq    → ChatGroq   (llama3-70b by default)
      - together → ChatTogether

    Args:
        streaming: Set True for token-by-token streaming (SSE endpoint).
    """
    provider = settings.llm_provider

    common_kwargs: Dict[str, Any] = {
        "streaming": streaming,
        "temperature": 0.2,   # low temperature → factual, reproducible answers
    }

    # Use the configured provider; only fall back if it fails
    if provider == LLMProvider.openai:
        try:
            from langchain_openai import ChatOpenAI

            log.info("llm_init", provider="openai", model=settings.openai_model)
            return ChatOpenAI(
                model=settings.openai_model,
                openai_api_key=settings.openai_api_key,
                max_tokens=2048,
                **common_kwargs,
            )
        except Exception as e:
            log.warning("openai_llm_failed", error=str(e))
            log.info("falling_back_to_groq")
            provider = LLMProvider.groq

    if provider == LLMProvider.groq:
        from langchain_groq import ChatGroq

        log.info("llm_init", provider="groq", model=settings.groq_model)
        return ChatGroq(
            model_name=settings.groq_model,
            groq_api_key=settings.groq_api_key,
            max_tokens=2048,
            **common_kwargs,
        )

    if provider == LLMProvider.together:
        from langchain_together import ChatTogether

        log.info("llm_init", provider="together", model=settings.together_model)
        return ChatTogether(
            model=settings.together_model,
            together_api_key=settings.together_api_key,
            max_tokens=2048,
            **common_kwargs,
        )

    raise ValueError(f"Unknown LLM provider: {provider}")


# ---------------------------------------------------------------------------
# BM25 index persistence
# ---------------------------------------------------------------------------

def load_bm25_index() -> Dict[str, Any]:
    """
    Load the BM25 corpus + metadata from disk.
    Returns an empty dict if no index has been built yet.
    """
    if _BM25_INDEX_PATH.exists():
        try:
            with open(_BM25_INDEX_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            log.debug("bm25_loaded", docs=len(data.get("corpus", [])))
            return data
        except (json.JSONDecodeError, OSError) as exc:
            log.warning("bm25_load_failed", error=str(exc))
    return {"corpus": [], "metadata": []}


def save_bm25_index(data: Dict[str, Any]) -> None:
    """Persist the BM25 corpus + metadata to disk (JSON — human-inspectable)."""
    _BM25_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_BM25_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    log.debug("bm25_saved", docs=len(data.get("corpus", [])))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _infer_embedding_dim(emb: Embeddings) -> int:
    """
    Infer the embedding dimension by encoding a test string.
    Used only when creating a new Pinecone index.
    """
    vec = emb.embed_query("test")
    return len(vec)


def format_docs_as_context(docs: list, max_chars: int = 6000) -> str:
    """
    Concatenate retrieved document chunks into a single context string
    for the LLM prompt, respecting a character budget.
    """
    parts = []
    total = 0
    for doc in docs:
        text = doc.page_content.strip()
        if total + len(text) > max_chars:
            # Truncate last chunk to fit within budget
            remaining = max_chars - total
            if remaining > 100:
                parts.append(text[:remaining] + "…")
            break
        parts.append(text)
        total += len(text)
    return "\n\n---\n\n".join(parts)
