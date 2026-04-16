"""
rag/ingest.py — Document ingestion pipeline.

Responsibilities:
  1. Load documents (PDF, TXT, DOCX)
  2. Chunk with a hybrid semantic + recursive strategy
  3. Enrich chunks with metadata (doc_id, file_name, page, chunk_index)
  4. Embed chunks via the configured provider
  5. Upsert into the configured vector store
  6. Build / update the BM25 index for hybrid search

Usage::

    from app.rag.ingest import IngestionPipeline
    pipeline = IngestionPipeline()
    result = await pipeline.ingest_file(file_path, original_filename)
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiofiles
from langchain_core.documents import Document
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.config import settings, VectorStore, EmbeddingProvider
from app.models.chat import DocumentType as DT
from app.core.logger import get_logger
from app.rag.utils import (
    get_embeddings,
    get_vector_store,
    load_bm25_index,
    save_bm25_index,
)

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _detect_doc_type(file_name: str) -> DT:
    ext = Path(file_name).suffix.lower()
    return {".pdf": DT.pdf, ".txt": DT.txt, ".docx": DT.docx}.get(ext, DT.unknown)


def _doc_id_from_file(file_path: Path) -> str:
    """Stable document ID: SHA-256 of file bytes (first 64 KB)."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        h.update(f.read(65_536))
    return h.hexdigest()[:32]


def _load_documents(file_path: Path, file_name: str) -> List[Document]:
    """
    Load a file into LangChain Documents.
    Falls back to plain-text loader for unknown types.
    """
    doc_type = _detect_doc_type(file_name)
    path_str = str(file_path)

    if doc_type == DT.pdf:
        loader = PyPDFLoader(path_str)
    elif doc_type == DT.docx:
        try:
            from langchain_community.document_loaders import Docx2txtLoader
        except ModuleNotFoundError as exc:
            raise RuntimeError(
                "DOCX ingestion requires the docx2txt package. "
                "Install it with `pip install docx2txt` and restart the backend."
            ) from exc
        loader = Docx2txtLoader(path_str)
    else:
        # txt or unknown — attempt UTF-8, fall back to latin-1
        try:
            loader = TextLoader(path_str, encoding="utf-8")
        except Exception:
            loader = TextLoader(path_str, encoding="latin-1")

    docs = loader.load()
    log.info("documents_loaded", file=file_name, pages=len(docs))
    return docs


def _chunk_documents(
    docs: List[Document],
    doc_id: str,
    file_name: str,
) -> List[Document]:
    """
    Hybrid chunking strategy:
      • Primary: RecursiveCharacterTextSplitter (respects paragraph / sentence boundaries)
      • Chunks are enriched with metadata for downstream filtering and citation

    A true semantic chunker (embedding-based) is also available as an optional
    upgrade — wired here as a comment so you can swap it in with one line.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        separators=["\n\n", "\n", ". ", "! ", "? ", ", ", " ", ""],
        length_function=len,
        is_separator_regex=False,
    )

    # Optional semantic splitter upgrade (requires langchain_experimental):
    # from langchain_experimental.text_splitter import SemanticChunker
    # splitter = SemanticChunker(get_embeddings(), breakpoint_threshold_type="percentile")

    chunks: List[Document] = []
    for page_idx, doc in enumerate(docs):
        page_num: Optional[int] = doc.metadata.get("page")  # populated by PyPDFLoader
        splits = splitter.split_documents([doc])
        for chunk_idx, chunk in enumerate(splits):
            chunk.metadata.update(
                {
                    "doc_id": doc_id,
                    "file_name": file_name,
                    "page": page_num if page_num is not None else page_idx,
                    "chunk_index": chunk_idx,
                    "chunk_id": f"{doc_id}_{page_idx}_{chunk_idx}",
                }
            )
            chunks.append(chunk)

    log.info("documents_chunked", file=file_name, total_chunks=len(chunks))
    return chunks


# ---------------------------------------------------------------------------
# Ingestion result
# ---------------------------------------------------------------------------

class IngestionResult:
    __slots__ = ("doc_id", "file_name", "doc_type", "chunk_count", "error")

    def __init__(
        self,
        doc_id: str,
        file_name: str,
        doc_type: DT,
        chunk_count: int = 0,
        error: Optional[str] = None,
    ) -> None:
        self.doc_id = doc_id
        self.file_name = file_name
        self.doc_type = doc_type
        self.chunk_count = chunk_count
        self.error = error

    @property
    def success(self) -> bool:
        return self.error is None


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class IngestionPipeline:
    """
    Stateless ingestion pipeline.  Instantiate once (e.g. as a FastAPI
    dependency or app-level singleton) and call `ingest_file` for each upload.
    """

    def __init__(self) -> None:
        log.info("pipeline_init_start")
        self._embeddings = get_embeddings()
        self._vector_store = get_vector_store()
        log.info("pipeline_init_done", 
                 embeddings=type(self._embeddings).__name__,
                 vector_store=type(self._vector_store).__name__)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def ingest_file(
        self,
        file_path: Path,
        original_filename: str,
    ) -> IngestionResult:
        """
        Full async ingest: load → chunk → embed → upsert → BM25 update.

        Heavy I/O (embedding + vector store upsert) runs in a thread pool
        so it doesn't block the event loop.
        """
        doc_type = _detect_doc_type(original_filename)
        doc_id = _doc_id_from_file(file_path)

        log.info(
            "ingest_start",
            doc_id=doc_id,
            file=original_filename,
            type=doc_type.value,
        )

        try:
            # Step 1 & 2: load + chunk (CPU-bound, run in thread)
            docs, chunks = await asyncio.get_event_loop().run_in_executor(
                None,
                self._load_and_chunk,
                file_path,
                original_filename,
                doc_id,
            )

            if not chunks:
                raise ValueError("No text content extracted from document")

            # Step 3 & 4: embed + upsert (network I/O, run in thread)
            await asyncio.get_event_loop().run_in_executor(
                None,
                self._embed_and_upsert,
                chunks,
            )

            # Step 5: update BM25 index (fast, in-process)
            await asyncio.get_event_loop().run_in_executor(
                None,
                self._update_bm25,
                chunks,
            )

            result = IngestionResult(
                doc_id=doc_id,
                file_name=original_filename,
                doc_type=doc_type,
                chunk_count=len(chunks),
            )
            log.info(
                "ingest_complete",
                doc_id=doc_id,
                chunks=len(chunks),
                file=original_filename,
            )
            return result

        except Exception as exc:
            log.error(
                "ingest_failed",
                doc_id=doc_id,
                file=original_filename,
                error=str(exc),
                exc_info=True,
            )
            return IngestionResult(
                doc_id=doc_id,
                file_name=original_filename,
                doc_type=doc_type,
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # Private (sync — called via run_in_executor)
    # ------------------------------------------------------------------

    def _load_and_chunk(
        self,
        file_path: Path,
        file_name: str,
        doc_id: str,
    ) -> Tuple[List[Document], List[Document]]:
        docs = _load_documents(file_path, file_name)
        chunks = _chunk_documents(docs, doc_id, file_name)
        return docs, chunks

    def _embed_and_upsert(self, chunks: List[Document]) -> None:
        """
        Add chunks to the vector store in parallel batches.

        Optimisations vs. naive single add_texts():
          • Chunks split into EMBED_BATCH_SIZE groups (reduces per-call overhead)
          • Embeddings pre-computed once via embed_documents() (single API call
            per batch rather than one-call-per-chunk)
          • FAISS save_local() called once at the end, not per-batch
        """
        EMBED_BATCH_SIZE = 200  # OpenAI allows up to 2048 texts per call

        texts = [c.page_content for c in chunks]
        metadatas = [c.metadata for c in chunks]
        ids = [c.metadata["chunk_id"] for c in chunks]

        total = len(texts)
        is_faiss = settings.vector_store == VectorStore.faiss

        # Delete pre-existing chunks for this document (enables re-ingestion / upsert)
        if is_faiss:
            from langchain_community.vectorstores import FAISS as _FAISS
            assert isinstance(self._vector_store, _FAISS)
            existing_ids = [
                id_ for id_ in ids
                if id_ in self._vector_store.docstore._dict
            ]
            if existing_ids:
                self._vector_store.delete(existing_ids)
                log.info("deleted_existing_chunks", count=len(existing_ids))

        log.info("embed_start", total_chunks=total, batch_size=EMBED_BATCH_SIZE)

        # Pre-embed all texts in large batches (one API call per batch)
        all_embeddings: List[List[float]] = []
        for i in range(0, total, EMBED_BATCH_SIZE):
            batch_texts = texts[i : i + EMBED_BATCH_SIZE]
            try:
                batch_embeddings = self._embeddings.embed_documents(batch_texts)
            except Exception as exc:
                log.warning(
                    "embed_batch_failed",
                    start=i,
                    end=i + len(batch_texts),
                    total=total,
                    error=str(exc),
                )
                if settings.embedding_provider == EmbeddingProvider.openai:
                    log.info("falling_back_to_huggingface_embeddings")
                    self._embeddings = get_embeddings(EmbeddingProvider.huggingface)
                    batch_embeddings = self._embeddings.embed_documents(batch_texts)
                else:
                    raise

            all_embeddings.extend(batch_embeddings)
            log.debug("embed_batch_done", start=i, end=i + len(batch_texts), total=total)

        # Upsert in batches of 100 (safe for all vector stores)
        UPSERT_BATCH = 100

        for i in range(0, total, UPSERT_BATCH):
            sl = slice(i, i + UPSERT_BATCH)
            if is_faiss:
                # FAISS.add_embeddings() skips redundant re-embedding
                self._vector_store.add_embeddings(
                    list(zip(texts[sl], all_embeddings[sl])),
                    metadatas=metadatas[sl],
                    ids=ids[sl],
                )
            else:
                self._vector_store.add_texts(
                    texts[sl],
                    metadatas=metadatas[sl],
                    ids=ids[sl],
                )

        # Persist once (FAISS only — cloud stores handle this server-side)
        if is_faiss:
            self._vector_store.save_local(str(settings.faiss_index_path))

        log.info("vector_upsert_done", count=total)

    def _update_bm25(self, chunks: List[Document]) -> None:
        """
        Rebuild the BM25 index by appending new corpus entries.
        The index is persisted to disk so it survives restarts.
        """
        index_data = load_bm25_index()
        existing_corpus: List[str] = index_data.get("corpus", [])
        existing_metadata: List[Dict[str, Any]] = index_data.get("metadata", [])

        new_texts = [c.page_content for c in chunks]
        new_meta = [c.metadata for c in chunks]

        combined_corpus = existing_corpus + new_texts
        combined_meta = existing_metadata + new_meta

        save_bm25_index({"corpus": combined_corpus, "metadata": combined_meta})
        log.debug("bm25_index_updated", total_docs=len(combined_corpus))
