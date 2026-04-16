"""
rag/pipeline.py — End-to-end RAG orchestrator.

Wires together:
  1. HybridRetriever  — vector + BM25 with multi-query expansion
  2. Reranker         — cross-encoder scoring + context compression
  3. LLM generation   — streaming or batch, with conversation memory
  4. Fallback         — graceful answer when no relevant docs found
  5. Source citation  — SourceReference list returned alongside the answer

Two public methods:
  • astream()  → AsyncGenerator[StreamChunk] — token-by-token SSE streaming
  • ainvoke()  → ChatResponse                — full response, no streaming
"""

from __future__ import annotations

import asyncio
import time
from typing import AsyncGenerator, List, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser

from app.config import settings
from app.core.logger import LLMCallTimer, get_logger
from app.models.chat import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    MessageRole,
    SourceReference,
    StreamChunk,
)
from app.rag.reranker import Reranker
from app.rag.retriever import HybridRetriever
from app.rag.utils import format_docs_as_context, get_llm

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """You are a precise, helpful AI assistant that answers questions \
based strictly on the provided context documents.

RULES:
1. Answer ONLY from the provided context. Do NOT use outside knowledge.
2. If the context does not contain enough information, say so clearly.
3. Be concise and factual. Avoid filler phrases.
4. When citing facts, naturally reference the source (e.g. "According to policy.pdf…").
5. If asked a follow-up question, consider the conversation history.

Context:
{context}"""

_FALLBACK_SYSTEM_PROMPT = """You are a helpful AI assistant. The user's question \
could not be answered from the available documents. Respond helpfully from general \
knowledge, and clearly indicate that your answer is not based on the uploaded documents."""

_NO_DOCS_NOTICE = (
    "\n\n---\n*Note: No relevant documents were found in the knowledge base. "
    "This answer is based on general knowledge.*"
)


# ---------------------------------------------------------------------------
# Conversation history → LangChain messages
# ---------------------------------------------------------------------------

def _build_lc_messages(
    system_prompt: str,
    history: List[ChatMessage],
    query: str,
) -> list:
    """Convert chat history + current query into LangChain message objects."""
    messages: list = [SystemMessage(content=system_prompt)]

    # Include the most recent N turns from history
    recent = history[-(settings.max_chat_history * 2):]  # user+assistant pairs
    for msg in recent:
        if msg.role == MessageRole.user:
            messages.append(HumanMessage(content=msg.content))
        elif msg.role == MessageRole.assistant:
            messages.append(AIMessage(content=msg.content))

    messages.append(HumanMessage(content=query))
    return messages


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class RAGPipeline:
    """
    Stateless RAG pipeline — safe to instantiate once as an app-level singleton.

    Usage (streaming)::

        pipeline = RAGPipeline()
        async for chunk in pipeline.astream(request):
            yield chunk  # StreamChunk

    Usage (batch)::

        response = await pipeline.ainvoke(request)  # ChatResponse
    """

    def __init__(self) -> None:
        self._retriever = HybridRetriever()
        self._reranker = Reranker()
        # Two LLM instances: streaming for SSE, non-streaming for batch
        self._llm_stream = get_llm(streaming=True)
        self._llm_batch = get_llm(streaming=False)

    # ------------------------------------------------------------------
    # Streaming entry point (SSE)
    # ------------------------------------------------------------------

    async def astream(self, request: ChatRequest) -> AsyncGenerator[StreamChunk, None]:
        """
        Yield StreamChunk objects token by token.

        The final chunk (done=True) carries the source references so the
        frontend can render citations after the full answer is received.
        """
        start = time.perf_counter()
        sources: List[SourceReference] = []
        fallback = False

        try:
            # ---- Retrieve & rerank ----------------------------------------
            candidates, expansions = await self._retriever.retrieve(
                query=request.query,
                top_k=request.top_k,
                filters=request.filters,
            )

            compressed_docs, sources = await self._reranker.rerank_and_compress(
                query=request.query,
                candidates=candidates,
            )

            fallback = len(compressed_docs) == 0

            # ---- Build prompt ---------------------------------------------
            if fallback:
                system_prompt = _FALLBACK_SYSTEM_PROMPT
                log.info("pipeline_fallback", session=str(request.session_id))
            else:
                context = format_docs_as_context(compressed_docs)
                system_prompt = _SYSTEM_PROMPT.format(context=context)

            messages = _build_lc_messages(
                system_prompt, request.history, request.query
            )

            # ---- Stream tokens --------------------------------------------
            log.info(
                "pipeline_stream_start",
                session=str(request.session_id),
                docs=len(compressed_docs),
                fallback=fallback,
            )

            with LLMCallTimer(
                log,
                provider=settings.llm_provider.value,
                model=self._get_model_name(),
            ):
                async for chunk in self._llm_stream.astream(messages):
                    token: str = chunk.content or ""  # type: ignore[union-attr]
                    if token:
                        yield StreamChunk(delta=token)

            # Append fallback notice if no docs
            if fallback:
                yield StreamChunk(delta=_NO_DOCS_NOTICE)

            # Final chunk with metadata
            elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
            log.info(
                "pipeline_stream_done",
                session=str(request.session_id),
                elapsed_ms=elapsed_ms,
                sources=len(sources),
            )
            yield StreamChunk(done=True, sources=sources, fallback=fallback)

        except Exception as exc:
            log.error(
                "pipeline_stream_error",
                session=str(request.session_id),
                error=str(exc),
                exc_info=True,
            )
            yield StreamChunk(
                done=True,
                error=f"An error occurred: {str(exc)}",
                fallback=True,
            )

    # ------------------------------------------------------------------
    # Batch entry point (non-streaming)
    # ------------------------------------------------------------------

    async def ainvoke(self, request: ChatRequest) -> ChatResponse:
        """
        Execute the full RAG pipeline and return a complete ChatResponse.
        Use this for non-streaming clients or background jobs.
        """
        start = time.perf_counter()

        # ---- Retrieve & rerank --------------------------------------------
        candidates, expansions = await self._retriever.retrieve(
            query=request.query,
            top_k=request.top_k,
            filters=request.filters,
        )

        compressed_docs, sources = await self._reranker.rerank_and_compress(
            query=request.query,
            candidates=candidates,
        )

        fallback = len(compressed_docs) == 0

        # ---- Build prompt -------------------------------------------------
        if fallback:
            system_prompt = _FALLBACK_SYSTEM_PROMPT
            log.info("pipeline_fallback", session=str(request.session_id))
        else:
            context = format_docs_as_context(compressed_docs)
            system_prompt = _SYSTEM_PROMPT.format(context=context)

        messages = _build_lc_messages(
            system_prompt, request.history, request.query
        )

        # ---- Generate -----------------------------------------------------
        with LLMCallTimer(
            log,
            provider=settings.llm_provider.value,
            model=self._get_model_name(),
        ):
            response = await self._llm_batch.ainvoke(messages)

        answer: str = response.content  # type: ignore[union-attr]
        if fallback:
            answer += _NO_DOCS_NOTICE

        elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
        log.info(
            "pipeline_invoke_done",
            session=str(request.session_id),
            elapsed_ms=elapsed_ms,
            sources=len(sources),
            fallback=fallback,
        )

        return ChatResponse(
            session_id=request.session_id,
            answer=answer,
            sources=sources,
            query_expansions=expansions,
            fallback=fallback,
            latency_ms=elapsed_ms,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _get_model_name(self) -> str:
        """Return the active model name for logging."""
        from app.config import LLMProvider

        mapping = {
            LLMProvider.openai: settings.openai_model,
            LLMProvider.groq: settings.groq_model,
            LLMProvider.together: settings.together_model,
        }
        return mapping.get(settings.llm_provider, "unknown")
