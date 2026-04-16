"""
api/ingest.py — FastAPI router for document upload and ingestion.

Endpoints:
  POST /api/ingest                      — Upload a file and trigger ingestion
  GET  /api/ingest/{document_id}/status — Poll ingestion status
  GET  /api/ingest/documents            — List all ingested documents
  DELETE /api/ingest/{document_id}      — Remove a document from the index

Security:
  - File size enforced before writing to disk
  - Only whitelisted extensions accepted (pdf, txt, docx)
  - Filenames sanitised to prevent path traversal
  - Files stored outside the web root
"""

from __future__ import annotations

import asyncio
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any

import aiofiles
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, status

from app.config import settings
from app.core.logger import get_logger
from app.models.chat import (
    DocumentType,
    IngestResponse,
    IngestStatus,
    IngestStatusResponse,
)
from app.rag.ingest import IngestionPipeline
from app.rag.utils import get_vector_store, get_embeddings
from app.api import chat as chat_module

log = get_logger(__name__)
router = APIRouter(prefix="/api/ingest", tags=["ingest"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ALLOWED_EXTENSIONS: set[str] = {".pdf", ".txt", ".docx"}
_ALLOWED_MIME_TYPES: set[str] = {
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}

# In-memory job tracker (replace with Redis for multi-process deployments)
# Structure: { document_id: IngestStatusResponse }
_job_store: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitise_filename(filename: str) -> str:
    """
    Strip directory components and dangerous characters from an uploaded filename.
    Prevents path traversal (e.g. ../../etc/passwd).
    """
    # Take only the final component
    name = Path(filename).name
    # Replace anything that's not alphanumeric, dash, underscore, or dot
    name = re.sub(r"[^\w.\-]", "_", name)
    # Limit length
    return name[:200]


def _detect_doc_type(filename: str) -> DocumentType:
    ext = Path(filename).suffix.lower()
    return {
        ".pdf": DocumentType.pdf,
        ".txt": DocumentType.txt,
        ".docx": DocumentType.docx,
    }.get(ext, DocumentType.unknown)


def _validate_file(file: UploadFile) -> None:
    """Raise HTTPException for invalid files before any disk I/O."""
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No filename provided.",
        )

    ext = Path(file.filename).suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(_ALLOWED_EXTENSIONS)}",
        )

    # Content-Type header check (first line of defence; not a security guarantee)
    if file.content_type and file.content_type not in _ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported MIME type '{file.content_type}'.",
        )


# ---------------------------------------------------------------------------
# Background ingestion task
# ---------------------------------------------------------------------------

async def _run_ingestion(
    document_id: str,
    file_path: Path,
    safe_filename: str,
) -> None:
    """
    Background task: runs the full ingestion pipeline and updates the job store.
    Errors are caught and recorded so status polling reflects failure.
    """
    pipeline = IngestionPipeline()
    try:
        # Update progress to 10% once pipeline is initialised
        _job_store[document_id]["progress"] = 10
        result = await pipeline.ingest_file(file_path, safe_filename)

        if result.success:
            _job_store[document_id].update(
                {
                    "status": IngestStatus.completed,
                    "chunk_count": result.chunk_count,
                    "progress": 100,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "error": None,
                }
            )
            log.info("ingest_job_done", doc_id=document_id, chunks=result.chunk_count)
        else:
            _job_store[document_id].update(
                {
                    "status": IngestStatus.failed,
                    "error": result.error,
                    "progress": 0,
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            log.error("ingest_job_failed", doc_id=document_id, error=result.error)

    except Exception as exc:
        _job_store[document_id].update(
            {
                "status": IngestStatus.failed,
                "error": str(exc),
                "progress": 0,
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        log.error("ingest_job_exception", doc_id=document_id, error=str(exc), exc_info=True)
    finally:
        # Clean up temp file regardless of outcome
        try:
            file_path.unlink(missing_ok=True)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post(
    "",
    summary="Upload and ingest a document",
    response_model=IngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="PDF, TXT, or DOCX file to ingest"),
) -> IngestResponse:
    """
    Accept a file upload and queue it for RAG ingestion.

    Returns immediately with a `document_id` — poll
    `GET /api/ingest/{document_id}/status` to track progress.

    Validates:
    - File extension (pdf / txt / docx)
    - MIME type header
    - File size (MAX_UPLOAD_SIZE_MB from env)
    """
    _validate_file(file)

    safe_filename = _sanitise_filename(file.filename)  # type: ignore[arg-type]
    doc_type = _detect_doc_type(safe_filename)
    document_id = str(uuid.uuid4())

    # Read file into memory with size check
    # Stream in 64 KB chunks to avoid loading huge files at once
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    temp_path = settings.upload_dir / f"{document_id}_{safe_filename}"

    total_bytes = 0
    try:
        async with aiofiles.open(temp_path, "wb") as out:
            while chunk := await file.read(65_536):  # 64 KB chunks
                total_bytes += len(chunk)
                if total_bytes > settings.max_upload_size_bytes:
                    # Clean up partial file
                    await out.close()
                    temp_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"File exceeds maximum allowed size of "
                            f"{settings.max_upload_size_mb} MB."
                        ),
                    )
                await out.write(chunk)
    except HTTPException:
        raise
    except Exception as exc:
        temp_path.unlink(missing_ok=True)
        log.error("file_write_error", filename=safe_filename, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file.",
        )

    log.info(
        "file_received",
        doc_id=document_id,
        filename=safe_filename,
        size_bytes=total_bytes,
    )

    # Register job in store
    now = datetime.now(timezone.utc)
    _job_store[document_id] = {
        "document_id": document_id,
        "file_name": safe_filename,
        "status": IngestStatus.processing,
        "chunk_count": None,
        "progress": 0,
        "error": None,
        "created_at": now.isoformat(),
        "completed_at": None,
    }

    # Queue background ingestion (non-blocking)
    background_tasks.add_task(_run_ingestion, document_id, temp_path, safe_filename)

    return IngestResponse(
        document_id=document_id,
        file_name=safe_filename,
        file_size_bytes=total_bytes,
        document_type=doc_type,
        status=IngestStatus.processing,
        message="Document received and queued for ingestion. Poll /status for updates.",
        created_at=now,
    )


@router.get(
    "/{document_id}/status",
    summary="Poll ingestion status",
    response_model=IngestStatusResponse,
)
async def get_ingest_status(document_id: str) -> IngestStatusResponse:
    """Return the current ingestion status for a given document_id."""
    job = _job_store.get(document_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No ingestion job found for document_id '{document_id}'.",
        )

    return IngestStatusResponse(
        document_id=job["document_id"],
        file_name=job["file_name"],
        status=job["status"],
        chunk_count=job.get("chunk_count"),
        progress=job.get("progress", 0),
        error=job.get("error"),
        created_at=datetime.fromisoformat(job["created_at"]),
        completed_at=(
            datetime.fromisoformat(job["completed_at"])
            if job.get("completed_at")
            else None
        ),
    )


@router.get(
    "/documents",
    summary="List all ingested documents",
)
async def list_documents() -> dict:
    """Return a summary of all documents seen in this server session."""
    docs = [
        {
            "document_id": v["document_id"],
            "file_name": v["file_name"],
            "status": v["status"],
            "chunk_count": v.get("chunk_count"),
            "created_at": v["created_at"],
        }
        for v in _job_store.values()
    ]
    return {"count": len(docs), "documents": docs}


@router.post(
    "/clear",
    summary="Clear all stored data",
    status_code=status.HTTP_200_OK,
)
async def clear_all_data() -> dict:
    """
    Clear all stored data:
    - FAISS vector store index
    - BM25 corpus index
    - Uploaded files
    - Job tracking history
    - Cached instances (embeddings, vector store, pipeline)
    
    This is useful for starting fresh with new documents.
    """
    try:
        # Clear FAISS index
        faiss_path = settings.faiss_index_path
        if faiss_path.exists():
            shutil.rmtree(faiss_path)
            log.info("cleared_faiss_index", path=str(faiss_path))
        
        # Clear uploaded files
        upload_path = settings.upload_dir
        if upload_path.exists():
            shutil.rmtree(upload_path)
            log.info("cleared_uploads", path=str(upload_path))
        
        # Clear job store (ingestion history)
        _job_store.clear()
        log.info("cleared_job_store")
        
        # Clear cached instances (LRU cache) so fresh instances are created
        get_vector_store.cache_clear()
        get_embeddings.cache_clear()
        chat_module._get_pipeline.cache_clear()
        log.info("cleared_caches")
        
        return {
            "status": "success",
            "message": "All data cleared successfully. Ready for new uploads.",
        }
    except Exception as exc:
        log.error("clear_data_error", error=str(exc), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear data: {str(exc)}",
        )


@router.get(
    "/health",
    summary="Ingest router health check",
    include_in_schema=False,
)
async def ingest_health() -> dict:
    return {"status": "ok", "router": "ingest"}
