"""
core/logger.py — Structured logging with structlog + stdlib logging.

Features:
- JSON output in production, pretty console output in development
- Automatic request-id / correlation-id binding per FastAPI request
- LLM call tracing helpers (tokens, latency, provider)
- One-line setup: `from app.core.logger import get_logger; log = get_logger(__name__)`
"""

from __future__ import annotations

import logging
import sys
import time
import uuid
from contextvars import ContextVar
from typing import Any

import structlog
from structlog.types import EventDict, WrappedLogger

from app.config import settings

# ---------------------------------------------------------------------------
# Context variable — stores per-request correlation id
# ---------------------------------------------------------------------------
_request_id_var: ContextVar[str] = ContextVar("request_id", default="")


def set_request_id(request_id: str | None = None) -> str:
    """Set (or auto-generate) a correlation id for the current async context."""
    rid = request_id or str(uuid.uuid4())
    _request_id_var.set(rid)
    return rid


def get_request_id() -> str:
    return _request_id_var.get()


# ---------------------------------------------------------------------------
# Custom structlog processors
# ---------------------------------------------------------------------------

def _add_request_id(
    logger: WrappedLogger, method: str, event_dict: EventDict
) -> EventDict:
    """Inject the current request_id into every log record."""
    rid = _request_id_var.get()
    if rid:
        event_dict["request_id"] = rid
    return event_dict


def _add_app_context(
    logger: WrappedLogger, method: str, event_dict: EventDict
) -> EventDict:
    """Inject static application metadata."""
    event_dict.setdefault("app", "rag-backend")
    event_dict.setdefault("env", settings.environment.value)
    return event_dict


def _drop_color_message_key(
    logger: WrappedLogger, method: str, event_dict: EventDict
) -> EventDict:
    """Remove uvicorn's 'color_message' key — redundant in JSON logs."""
    event_dict.pop("color_message", None)
    return event_dict


# ---------------------------------------------------------------------------
# Shared processor chain
# ---------------------------------------------------------------------------

_SHARED_PROCESSORS: list[Any] = [
    structlog.contextvars.merge_contextvars,
    _add_request_id,
    _add_app_context,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
    structlog.processors.StackInfoRenderer(),
    _drop_color_message_key,
]


# ---------------------------------------------------------------------------
# Setup — call once at application startup
# ---------------------------------------------------------------------------

def setup_logging() -> None:
    """
    Configure structlog + stdlib logging.
    Call this once from main.py before the app starts serving requests.
    """
    log_level = logging.getLevelName(settings.log_level.upper())

    # ---- stdlib logging ---------------------------------------------------
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )

    # Silence overly verbose third-party loggers
    for noisy in ("httpx", "httpcore", "openai", "urllib3", "multipart"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # ---- structlog --------------------------------------------------------
    if settings.is_production:
        # JSON — machine-readable, ingested by Datadog / CloudWatch / Loki
        renderer: Any = structlog.processors.JSONRenderer()
    else:
        # Pretty console — human-readable during development
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[
            *_SHARED_PROCESSORS,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=_SHARED_PROCESSORS,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.ExceptionRenderer(),
            renderer,
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level)


# ---------------------------------------------------------------------------
# Factory — use this in every module
# ---------------------------------------------------------------------------

def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger for `name`."""
    return structlog.get_logger(name)


# ---------------------------------------------------------------------------
# LLM tracing helpers
# ---------------------------------------------------------------------------

class LLMCallTimer:
    """
    Context manager that logs LLM call duration, provider, model, and token
    usage.

    Usage::

        async with LLMCallTimer(log, provider="openai", model="gpt-4o"):
            response = await llm.ainvoke(messages)
    """

    def __init__(
        self,
        logger: structlog.stdlib.BoundLogger,
        provider: str,
        model: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        self._log = logger
        self._provider = provider
        self._model = model
        self._extra = extra or {}
        self._start: float = 0.0

    def __enter__(self) -> "LLMCallTimer":
        self._start = time.perf_counter()
        self._log.debug(
            "llm_call_start",
            provider=self._provider,
            model=self._model,
            **self._extra,
        )
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        elapsed_ms = round((time.perf_counter() - self._start) * 1000, 2)
        if exc_type:
            self._log.error(
                "llm_call_failed",
                provider=self._provider,
                model=self._model,
                elapsed_ms=elapsed_ms,
                error=str(exc_val),
            )
        else:
            self._log.info(
                "llm_call_success",
                provider=self._provider,
                model=self._model,
                elapsed_ms=elapsed_ms,
                **self._extra,
            )


# ---------------------------------------------------------------------------
# FastAPI middleware helper — bind request_id on every request
# ---------------------------------------------------------------------------

async def log_request_middleware(request: Any, call_next: Any) -> Any:
    """
    Starlette middleware that:
    1. Reads X-Request-ID header or generates a new UUID
    2. Binds it to the async context so all logs within the request carry it
    3. Adds X-Request-ID to the response headers
    """
    from fastapi import Request, Response  # local import to avoid circular deps

    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    set_request_id(rid)

    # Also bind to structlog contextvars (thread/task safe)
    structlog.contextvars.clear_contextvars()
    structlog.contextvars.bind_contextvars(request_id=rid)

    start = time.perf_counter()
    response: Response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)

    log = get_logger("http")
    log.info(
        "http_request",
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        elapsed_ms=elapsed_ms,
    )

    response.headers["X-Request-ID"] = rid
    return response
