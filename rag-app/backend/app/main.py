"""
main.py — FastAPI application factory and entry point.

Responsibilities:
  - Create the FastAPI app with metadata
  - Register CORS middleware (reads allowed origins from settings)
  - Add per-request logging middleware (correlation IDs)
  - Register all API routers
  - Lifespan: warm up singletons on startup, release on shutdown
  - Global exception handler for unhandled errors
  - /health endpoint
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.chat import router as chat_router
from app.api.ingest import router as ingest_router
from app.config import settings
from app.core.logger import get_logger, log_request_middleware, setup_logging
from app.models.chat import HealthResponse

# ---------------------------------------------------------------------------
# Bootstrap logging immediately — before any other import side-effects
# ---------------------------------------------------------------------------
setup_logging()
log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    FastAPI lifespan context manager.

    Startup:
      - Log configuration summary
      - Pre-warm embeddings + vector store so the first request is fast

    Shutdown:
      - Flush logs
      - (Add DB connection pool cleanup here if needed)
    """
    # ---- Startup ----------------------------------------------------------
    log.info(
        "app_startup",
        environment=settings.environment.value,
        llm_provider=settings.llm_provider.value,
        embedding_provider=settings.embedding_provider.value,
        vector_store=settings.vector_store.value,
        port=settings.backend_port,
    )

    # Pre-warm singletons in background to avoid cold-start latency on first request
    try:
        from app.rag.utils import get_embeddings, get_vector_store

        log.info("warmup_start")
        get_embeddings()              # loads model weights / checks API key
        get_vector_store()            # connects to / loads vector store
        log.info("warmup_done")
    except Exception as exc:
        # Warn but don't crash — the app should still start so health checks pass
        log.warning("warmup_failed", error=str(exc))

    yield  # Application runs here

    # ---- Shutdown ---------------------------------------------------------
    log.info("app_shutdown")


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    app = FastAPI(
        title="RAG System API",
        description=(
            "Production-ready Retrieval-Augmented Generation backend.\n\n"
            "Features: hybrid search (vector + BM25), cross-encoder reranking, "
            "multi-query expansion, streaming responses, source citations."
        ),
        version="1.0.0",
        docs_url="/docs" if not settings.is_production else None,   # hide Swagger in prod
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ---- CORS -------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Session-ID"],
    )

    # ---- Request logging middleware ----------------------------------------
    app.add_middleware(BaseHTTPMiddleware, dispatch=log_request_middleware)

    # ---- Routers ----------------------------------------------------------
    app.include_router(chat_router)
    app.include_router(ingest_router)

    # ---- Exception handlers -----------------------------------------------
    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Return structured 422 with field-level error details."""
        log.warning(
            "validation_error",
            path=request.url.path,
            errors=exc.errors(),
        )
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": exc.errors(),
                "body": exc.body if hasattr(exc, "body") else None,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        """Catch-all for unhandled exceptions — never leak tracebacks to clients."""
        log.error(
            "unhandled_exception",
            path=request.url.path,
            method=request.method,
            error=str(exc),
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An internal server error occurred."},
        )

    # ---- Health endpoint --------------------------------------------------
    @app.get(
        "/health",
        response_model=HealthResponse,
        tags=["health"],
        summary="Application health check",
    )
    async def health() -> HealthResponse:
        """
        Returns 200 when the application is running and configured.
        Used by Docker HEALTHCHECK, load balancers, and uptime monitors.
        """
        return HealthResponse(
            status="ok",
            version="1.0.0",
            environment=settings.environment.value,
            vector_store=settings.vector_store.value,
            llm_provider=settings.llm_provider.value,
            embedding_provider=settings.embedding_provider.value,
        )

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "service": "RAG System API",
            "version": "1.0.0",
            "docs": "/docs",
            "health": "/health",
        }

    log.info("app_created")
    return app


# ---------------------------------------------------------------------------
# Application instance (imported by uvicorn / gunicorn)
# ---------------------------------------------------------------------------
app = create_app()


# ---------------------------------------------------------------------------
# Dev entry point — `python -m app.main` or `python backend/app/main.py`
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=not settings.is_production,   # hot-reload in dev only
        log_level=settings.log_level.lower(),
        access_log=False,  # handled by our custom middleware
    )
