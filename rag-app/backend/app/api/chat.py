"""
api/chat.py — FastAPI router for chat endpoints.

Endpoints:
  POST /api/chat/stream  — Server-Sent Events (SSE) streaming response
  POST /api/chat         — Batch (non-streaming) response
  GET  /api/chat/health  — Quick liveness check for this router

The pipeline is instantiated once as a module-level singleton and injected
via FastAPI's dependency system to allow easy mocking in tests.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.core.logger import get_logger
from app.models.chat import ChatRequest, ChatResponse, StreamChunk
from app.rag.pipeline import RAGPipeline

log = get_logger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


# ---------------------------------------------------------------------------
# Dependency — singleton pipeline
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_pipeline() -> RAGPipeline:
    """
    Lazy singleton: created on first request, reused for every subsequent call.
    Keeps model weights and vector store connections in memory.
    """
    log.info("pipeline_init")
    return RAGPipeline()


def get_pipeline() -> RAGPipeline:
    """FastAPI dependency wrapper (allows override in tests)."""
    return _get_pipeline()


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

def _sse_event(data: str, event: str = "message") -> str:
    """Format a single SSE frame."""
    return f"event: {event}\ndata: {data}\n\n"


async def _stream_rag_response(
    request: ChatRequest,
    pipeline: RAGPipeline,
) -> AsyncGenerator[str, None]:
    """
    Async generator that converts StreamChunk objects into SSE frames.

    Protocol:
      • Each token delta  → event: message,  data: <StreamChunk JSON>
      • Final chunk       → event: done,      data: <StreamChunk JSON>
      • Error             → event: error,     data: <StreamChunk JSON>
    """
    try:
        async for chunk in pipeline.astream(request):
            if chunk.error:
                payload = chunk.model_dump_json()
                yield _sse_event(payload, event="error")
                return

            if chunk.done:
                payload = chunk.model_dump_json()
                yield _sse_event(payload, event="done")
                return

            payload = chunk.model_dump_json()
            yield _sse_event(payload, event="message")

    except Exception as exc:
        log.error("sse_generator_error", error=str(exc), exc_info=True)
        error_chunk = StreamChunk(done=True, error=str(exc))
        yield _sse_event(error_chunk.model_dump_json(), event="error")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post(
    "/stream",
    summary="Streaming chat (SSE)",
    description=(
        "Send a question and receive a streamed RAG response via Server-Sent Events. "
        "Each SSE frame carries a `StreamChunk` JSON object. "
        "The final frame (event: done) includes source citations."
    ),
    response_class=StreamingResponse,
)
async def chat_stream(
    request: ChatRequest,
    http_request: Request,
    pipeline: RAGPipeline = Depends(get_pipeline),
) -> StreamingResponse:
    """
    SSE streaming endpoint.

    The client should use the EventSource API or a fetch-based SSE reader.
    Example JS:

        const res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ query: "...", history: [] }),
        });
        const reader = res.body.getReader();
    """
    log.info(
        "chat_stream_request",
        session=str(request.session_id),
        query_len=len(request.query),
        history_turns=len(request.history),
    )

    return StreamingResponse(
        _stream_rag_response(request, pipeline),
        media_type="text/event-stream",
        headers={
            # Prevent proxy buffering — critical for real-time streaming
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",        # nginx: disable proxy buffering
            "Connection": "keep-alive",
            "X-Session-ID": str(request.session_id),
        },
    )


@router.post(
    "",
    summary="Batch chat (non-streaming)",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    description=(
        "Send a question and receive the full RAG response in one JSON object. "
        "Use this for non-streaming clients or server-to-server calls."
    ),
)
async def chat_batch(
    request: ChatRequest,
    pipeline: RAGPipeline = Depends(get_pipeline),
) -> ChatResponse:
    """
    Non-streaming chat endpoint.

    Returns the complete answer, source references, and metadata in a single
    response. Suitable for REST clients that don't support SSE.
    """
    log.info(
        "chat_batch_request",
        session=str(request.session_id),
        query_len=len(request.query),
        history_turns=len(request.history),
    )

    try:
        # Force streaming=False (batch mode)
        request_copy = request.model_copy(update={"stream": False})
        response = await pipeline.ainvoke(request_copy)
        return response

    except Exception as exc:
        log.error(
            "chat_batch_error",
            session=str(request.session_id),
            error=str(exc),
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RAG pipeline error: {str(exc)}",
        )


@router.get(
    "/health",
    summary="Chat router health check",
    include_in_schema=False,
)
async def chat_health() -> dict:
    return {"status": "ok", "router": "chat"}
