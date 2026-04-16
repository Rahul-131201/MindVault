"""
config.py — Central application settings via Pydantic v2 BaseSettings.

All values are read from environment variables or a .env file.
Import the singleton `settings` object anywhere in the app:

    from app.config import settings
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import List

from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ---------------------------------------------------------------------------
# Enum types — prevent typos in provider names
# ---------------------------------------------------------------------------

class LLMProvider(str, Enum):
    openai = "openai"
    groq = "groq"
    together = "together"


class EmbeddingProvider(str, Enum):
    openai = "openai"
    huggingface = "huggingface"


class VectorStore(str, Enum):
    faiss = "faiss"
    pinecone = "pinecone"
    weaviate = "weaviate"


class Environment(str, Enum):
    development = "development"
    production = "production"


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class Settings(BaseSettings):
    """
    Application-wide settings loaded from environment / .env file.
    All fields are typed; Pydantic v2 will coerce and validate on startup.
    """

    # Resolve .env location relative to this file (robust across cwd changes)
    _env_file = Path(__file__).resolve().parent.parent.parent / ".env"

    model_config = SettingsConfigDict(
        env_file=str(_env_file),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",          # silently ignore unknown env vars
    )

    # ------------------------------------------------------------------
    # LLM
    # ------------------------------------------------------------------
    llm_provider: LLMProvider = LLMProvider.openai

    # OpenAI
    openai_api_key: str = Field(default="", repr=False)
    openai_model: str = "gpt-4o"
    openai_embedding_model: str = "text-embedding-3-small"

    # Groq
    groq_api_key: str = Field(default="", repr=False)
    groq_model: str = "llama3-70b-8192"

    # Together.ai
    together_api_key: str = Field(default="", repr=False)
    together_model: str = "mistralai/Mixtral-8x7B-Instruct-v0.1"

    # ------------------------------------------------------------------
    # Embeddings
    # ------------------------------------------------------------------
    embedding_provider: EmbeddingProvider = EmbeddingProvider.openai
    hf_embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"

    # ------------------------------------------------------------------
    # Vector Store
    # ------------------------------------------------------------------
    vector_store: VectorStore = VectorStore.faiss
    faiss_index_path: Path = Path("./data/faiss_index")

    # Pinecone
    pinecone_api_key: str = Field(default="", repr=False)
    pinecone_index_name: str = "rag-index"
    pinecone_environment: str = "us-east-1-aws"

    # Weaviate
    weaviate_url: str = ""
    weaviate_api_key: str = Field(default="", repr=False)
    weaviate_class_name: str = "Document"

    # ------------------------------------------------------------------
    # Backend server
    # ------------------------------------------------------------------
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    environment: Environment = Environment.development
    log_level: str = "INFO"

    # CORS — comma-separated list of allowed origins in .env
    allowed_origins_raw: str = Field(
        default="http://localhost:3000",
        alias="ALLOWED_ORIGINS",
    )

    @property
    def allowed_origins(self) -> List[str]:
        """Parse comma-separated ALLOWED_ORIGINS into a Python list."""
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]

    # ------------------------------------------------------------------
    # Redis
    # ------------------------------------------------------------------
    redis_url: str = "redis://localhost:6379/0"

    # ------------------------------------------------------------------
    # File upload
    # ------------------------------------------------------------------
    max_upload_size_mb: int = 50
    upload_dir: Path = Path("./data/uploads")

    @property
    def max_upload_size_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    # ------------------------------------------------------------------
    # RAG tuning
    # ------------------------------------------------------------------
    chunk_size: int = 512
    chunk_overlap: int = 64
    retrieval_top_k: int = 10      # candidates fetched before reranking
    rerank_top_n: int = 4          # docs passed to the LLM after reranking
    bm25_weight: float = 0.3       # hybrid search — keyword component
    vector_weight: float = 0.7     # hybrid search — semantic component
    multi_query_count: int = 3     # number of expanded queries
    max_chat_history: int = 10     # conversation turns kept in memory

    # ------------------------------------------------------------------
    # Frontend (surfaced via NEXT_PUBLIC_* in Next.js)
    # ------------------------------------------------------------------
    next_public_api_url: str = "http://localhost:8000"

    # ------------------------------------------------------------------
    # Computed / derived helpers
    # ------------------------------------------------------------------
    @property
    def is_production(self) -> bool:
        return self.environment == Environment.production

    @property
    def llm_api_key(self) -> str:
        """Return the active provider's API key."""
        mapping = {
            LLMProvider.openai: self.openai_api_key,
            LLMProvider.groq: self.groq_api_key,
            LLMProvider.together: self.together_api_key,
        }
        return mapping[self.llm_provider]

    # ------------------------------------------------------------------
    # Validators
    # ------------------------------------------------------------------
    @field_validator("bm25_weight", "vector_weight", mode="after")
    @classmethod
    def _weight_range(cls, v: float) -> float:
        if not 0.0 <= v <= 1.0:
            raise ValueError("Hybrid search weights must be between 0.0 and 1.0")
        return v

    @model_validator(mode="after")
    def _check_required_keys(self) -> "Settings":
        """
        Warn (not crash) if the active provider's API key is missing.
        We warn rather than raise so the app still starts; individual
        route handlers will surface a clean error to the caller.
        """
        import warnings

        if not self.llm_api_key:
            warnings.warn(
                f"No API key set for LLM provider '{self.llm_provider}'. "
                "Set the corresponding *_API_KEY environment variable.",
                stacklevel=2,
            )

        if self.embedding_provider == EmbeddingProvider.openai and not self.openai_api_key:
            warnings.warn(
                "EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set.",
                stacklevel=2,
            )

        # Ensure upload and FAISS directories exist at startup
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        if self.vector_store == VectorStore.faiss:
            self.faiss_index_path.mkdir(parents=True, exist_ok=True)

        return self


# ---------------------------------------------------------------------------
# Singleton — import this everywhere
# ---------------------------------------------------------------------------
settings = Settings()
