<div align="center">

<img src="https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white" />
<img src="https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
<img src="https://img.shields.io/badge/Next.js-15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" />
<img src="https://img.shields.io/badge/LangChain-1.2-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white" />
<img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
<img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />

<br/><br/>

# 🧠 MindVault — QAgent

### *Production-Grade Retrieval-Augmented Generation Platform*

**Upload documents. Ask anything. Get precise answers with verified citations — powered by hybrid AI search.**

<br/>

[🚀 Live Demo](#-quick-start) · [📖 Architecture](#-architecture) · [⚙️ API Docs](#-api-reference) · [🛠️ Local Setup](#-quick-start)

---

</div>

## ✨ What is MindVault?

MindVault is a **full-stack, production-ready RAG (Retrieval-Augmented Generation) platform** that transforms your document corpus into a queryable knowledge base. It combines the latest LLM capabilities with enterprise-grade retrieval techniques — going far beyond simple vector search.

> **Built for real-world deployment:** From a polished Next.js frontend with a 3D Spline hero to a FastAPI backend with structured observability, Docker orchestration, and an Nginx reverse proxy — this is how production AI systems are built.

---

## 🎯 Key Features

### 🔍 Advanced RAG Pipeline
| Feature | Details |
|--------|---------|
| **Hybrid Search** | Vector similarity + BM25 keyword search, fused via Reciprocal Rank Fusion (RRF) |
| **Multi-Query Expansion** | LLM generates 3 alternative query phrasings to maximize recall |
| **Cross-Encoder Reranking** | FlashRank ms-marco-MiniLM-L-12-v2 reranks candidates for precision |
| **Context Compression** | Token-budget trimming ensures the LLM receives the most relevant context |
| **Source Citations** | Every answer includes chunk-level citations with relevance scores and excerpts |
| **Fallback Handling** | Graceful degradation when no relevant documents exist |
| **Conversation Memory** | Multi-turn chat with configurable history window (default: 10 turns) |

### ⚡ Streaming-First Architecture
- **Server-Sent Events (SSE)** for real-time token streaming
- AbortController support to **cancel in-flight requests**
- Streaming and batch modes via the same pipeline

### 🔌 Multi-Provider Support
| Category | Providers |
|----------|----------|
| **LLM** | OpenAI (GPT-4o), Groq (Llama3-70B), Together.ai (Mixtral-8x7B) |
| **Embeddings** | OpenAI (text-embedding-3-small), HuggingFace (sentence-transformers) |
| **Vector Store** | FAISS (local), Pinecone (serverless), Weaviate (cloud) |

> Switch providers with a single environment variable change — zero code modifications.

### 🏗️ Production Infrastructure
- **Dockerized** with multi-stage builds for minimal image sizes
- **Nginx reverse proxy** with rate limiting, security headers, SSE buffering disabled
- **Gunicorn + Uvicorn** for production ASGI serving
- **Structured JSON logging** via structlog (per-request correlation IDs)
- **Health checks** on all services (Docker HEALTHCHECK + `/health` endpoint)

### 🎨 Beautiful Frontend UI
- **3D animated landing page** (Spline integration)
- **Glassmorphism design** with animated blob background
- **Drag-and-drop file upload** with real-time progress tracking and ingestion status polling
- **Dark/light mode** with localStorage persistence
- **Collapsible sidebar** showing active document corpus
- **ChatGPT-inspired** chat interface with markdown rendering and source citation display

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          User Browser                           │
│              Next.js 15 + React + Tailwind CSS                 │
│        (3D Landing · Chat Interface · File Upload)             │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / SSE
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy                          │
│         Rate Limiting · Security Headers · TLS Termination     │
│              /api/* → FastAPI   /  → Next.js                  │
└──────────────┬──────────────────────────────┬──────────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐    ┌─────────────────────────────┐
│   FastAPI Backend        │    │   Next.js Frontend          │
│   (Python 3.12)         │    │   (Port 3000)               │
│                          │    └─────────────────────────────┘
│  ┌────────────────────┐  │
│  │   RAG Pipeline     │  │
│  │                    │  │
│  │  1. Multi-Query    │  │    ┌─────────────────────────────┐
│  │     Expansion      │  │    │    Vector Store             │
│  │  2. HybridRetriever│◄─┼────┤  FAISS / Pinecone /        │
│  │     ├─ Vector      │  │    │  Weaviate                   │
│  │     └─ BM25        │  │    └─────────────────────────────┘
│  │  3. RRF Fusion     │  │
│  │  4. Reranker       │  │    ┌─────────────────────────────┐
│  │     (FlashRank)    │  │    │    BM25 Index               │
│  │  5. LLM + SSE      │◄─┼────┤  (Persisted JSON corpus)   │
│  └────────────────────┘  │    └─────────────────────────────┘
│                          │
│  ┌────────────────────┐  │
│  │ Ingestion Pipeline │  │
│  │  Load → Chunk →   │  │
│  │  Embed → Upsert   │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

### RAG Pipeline Flow

```
User Query
    │
    ▼
┌─────────────────────────────────┐
│  Multi-Query Expansion          │  LLM generates N alternative queries
│  "What is X?" → 3 variations   │
└──────────────┬──────────────────┘
               │
     ┌─────────┼──────────┐
     ▼         ▼          ▼
  Vector    BM25      Vector    ... (all queries × both methods)
  Search   Search    Search
     │         │          │
     └─────────┼──────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Reciprocal Rank Fusion (RRF)   │  vector_weight=0.7, bm25_weight=0.3
│  De-duplicate + re-rank         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  Cross-Encoder Reranking        │  FlashRank ms-marco-MiniLM-L-12-v2
│  Relevance threshold filtering  │  Token-budget context compression
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  LLM Generation (Streaming)     │  GPT-4o / Llama3-70B / Mixtral
│  Context + History + Query      │
└──────────────┬──────────────────┘
               │
               ▼
     SSE Tokens + Source Citations
```

---

## 📁 Project Structure

```
MindVault/
└── rag-app/
    ├── backend/                    # FastAPI Python backend
    │   ├── app/
    │   │   ├── main.py             # App factory, middleware, lifespan
    │   │   ├── config.py           # Pydantic settings (all env vars)
    │   │   ├── api/
    │   │   │   ├── chat.py         # SSE streaming + batch chat endpoints
    │   │   │   └── ingest.py       # File upload + ingestion endpoints
    │   │   ├── rag/
    │   │   │   ├── pipeline.py     # End-to-end RAG orchestrator
    │   │   │   ├── retriever.py    # HybridRetriever (vector + BM25 + RRF)
    │   │   │   ├── reranker.py     # Cross-encoder reranking + compression
    │   │   │   ├── ingest.py       # Document loading, chunking, embedding
    │   │   │   └── utils.py        # Factory functions (LLM, embeddings, store)
    │   │   ├── models/
    │   │   │   └── chat.py         # Pydantic v2 request/response schemas
    │   │   └── core/
    │   │       └── logger.py       # Structured logging (structlog + correlation IDs)
    │   ├── requirements.txt
    │   └── Dockerfile
    │
    ├── frontend/                   # Next.js 15 frontend
    │   ├── app/
    │   │   ├── page.tsx            # Landing page (Spline 3D + hero)
    │   │   ├── chat/page.tsx       # Main chat interface
    │   │   ├── dashboard/page.tsx  # Dashboard page
    │   │   └── about/page.tsx      # About page
    │   ├── components/
    │   │   ├── ChatMessage.tsx     # Message renderer with citations
    │   │   ├── FileUpload.tsx      # Drag-and-drop upload + progress polling
    │   │   ├── AnimatedTitle.tsx   # Hero animated text
    │   │   └── EnterVaultButton.tsx
    │   ├── hooks/
    │   │   └── useChat.ts          # Full chat lifecycle hook (SSE + state)
    │   └── lib/
    │       └── api.ts              # Typed API client (streamChat, uploadDocument)
    │
    ├── infra/
    │   └── nginx/nginx.conf        # Reverse proxy, rate limiting, security headers
    │
    ├── docker-compose.yml          # Production orchestration
    ├── docker-compose.dev.yml      # Development overrides (hot-reload mounts)
    └── .env.example                # Environment variable template
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.12+
- Node.js 18+
- An LLM API key (OpenAI, Groq, or Together.ai)

### 1. Clone & Configure

```bash
git clone https://github.com/your-username/MindVault.git
cd MindVault/rag-app
cp .env.example .env
```

Edit `.env`:

```env
# LLM Provider (openai | groq | together)
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# Embedding Provider (openai | huggingface)
EMBEDDING_PROVIDER=openai

# Vector Store (faiss | pinecone | weaviate)
VECTOR_STORE=faiss

# Environment
ENVIRONMENT=development
```

### 2. Run with Docker (Recommended)

```bash
# Production (all services)
docker compose up --build

# Development (with hot-reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Access at → `http://localhost` (Nginx) or `http://localhost:3000` (frontend direct)

### 3. Run Locally (Development)

**Backend:**
```bash
cd rag-app/backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
python -m app.main
# API running at http://localhost:8000
# Swagger UI at http://localhost:8000/docs
```

**Frontend:**
```bash
cd rag-app/frontend
npm install
npm run dev
# UI running at http://localhost:3000
```

---

## ⚙️ Configuration Reference

All settings are loaded from environment variables or `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `openai` | LLM provider: `openai` \| `groq` \| `together` |
| `OPENAI_API_KEY` | — | OpenAI API key (for LLM + embeddings) |
| `GROQ_API_KEY` | — | Groq API key |
| `TOGETHER_API_KEY` | — | Together.ai API key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI chat model |
| `GROQ_MODEL` | `llama3-70b-8192` | Groq model |
| `EMBEDDING_PROVIDER` | `openai` | Embedding provider: `openai` \| `huggingface` |
| `VECTOR_STORE` | `faiss` | Vector store: `faiss` \| `pinecone` \| `weaviate` |
| `PINECONE_API_KEY` | — | Pinecone API key (if using Pinecone) |
| `WEAVIATE_URL` | — | Weaviate cluster URL (if using Weaviate) |
| `CHUNK_SIZE` | `512` | Document chunk size (characters) |
| `CHUNK_OVERLAP` | `64` | Chunk overlap (characters) |
| `RETRIEVAL_TOP_K` | `10` | Candidate docs to fetch before reranking |
| `RERANK_TOP_N` | `4` | Docs to pass to LLM after reranking |
| `BM25_WEIGHT` | `0.3` | BM25 score weight in hybrid fusion |
| `VECTOR_WEIGHT` | `0.7` | Vector score weight in hybrid fusion |
| `MULTI_QUERY_COUNT` | `3` | Number of query expansions to generate |
| `MAX_CHAT_HISTORY` | `10` | Conversation turns kept in context |
| `MAX_UPLOAD_SIZE_MB` | `50` | Maximum upload file size |
| `ENVIRONMENT` | `development` | `development` \| `production` |

---

## 📡 API Reference

Base URL: `http://localhost:8000`  
Interactive docs: `http://localhost:8000/docs` *(development only)*

### Chat Endpoints

#### `POST /api/chat/stream` — Streaming chat (SSE)
```json
// Request
{
  "session_id": "uuid-optional",
  "query": "What is the refund policy?",
  "history": [
    {"role": "user", "content": "previous question"},
    {"role": "assistant", "content": "previous answer"}
  ],
  "top_k": 10,
  "filters": {"file_name": "policy.pdf"},
  "stream": true
}

// SSE Response frames:
// event: message  →  {"delta": "token", "done": false, ...}
// event: done     →  {"delta": "", "done": true, "sources": [...], "fallback": false}
// event: error    →  {"delta": "", "done": true, "error": "message"}
```

#### `POST /api/chat` — Batch chat
```json
// Response
{
  "session_id": "uuid",
  "answer": "Based on the policy document...",
  "sources": [
    {
      "document_id": "abc123",
      "file_name": "policy.pdf",
      "page": 3,
      "chunk_index": 7,
      "score": 0.9432,
      "excerpt": "Refunds are processed within 14 business days..."
    }
  ],
  "query_expansions": ["refund timeline", "money back guarantee"],
  "fallback": false,
  "latency_ms": 1243.5
}
```

### Ingestion Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ingest` | Upload a document (PDF, TXT, DOCX) |
| `GET` | `/api/ingest/{id}/status` | Poll ingestion progress (0–100%) |
| `GET` | `/api/ingest/documents` | List all ingested documents |
| `POST` | `/api/ingest/clear` | Purge all data (index + uploads) |
| `GET` | `/health` | Application health check |

---

## 🔬 Technical Deep Dive

### Hybrid Retrieval (RRF)

The `HybridRetriever` executes vector and BM25 searches in parallel for every expanded query, then fuses all ranked lists using **Reciprocal Rank Fusion**:

$$\text{RRF}(d) = \sum_{i} \frac{w_i}{k + \text{rank}_i(d)}$$

Where:
- $w_i \in \{0.7\text{ (vector)}, 0.3\text{ (BM25)}\}$ — configurable weights
- $k = 60$ — RRF constant (per original paper)
- $\text{rank}_i(d)$ — rank of document $d$ in list $i$

### Document Ingestion Pipeline

```
File Upload (async, 64KB chunks)
    │
    ▼
Load Document
  ├── PDF   → PyPDFLoader (page-level metadata)
  ├── DOCX  → Docx2txtLoader
  └── TXT   → TextLoader (UTF-8 with latin-1 fallback)
    │
    ▼
Recursive Character Chunking
  chunk_size=512, overlap=64
  separators: [\n\n, \n, ". ", " ", ""]
    │
    ▼
Metadata Enrichment
  {doc_id, file_name, page, chunk_index, chunk_id}
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
Embedding (batched, 200 chunks/call)  BM25 Index Update
  OpenAI / HuggingFace                Persistent JSON corpus
    │
    ▼
Vector Store Upsert (100 chunks/batch)
  FAISS.save_local() / Pinecone / Weaviate
```

### Cross-Encoder Reranking

After RRF fusion, **FlashRank** (ms-marco-MiniLM-L-12-v2, ~120MB) scores every candidate against the query. Logit scores are normalized via sigmoid to [0,1]:

$$\text{score} = \sigma(\text{logit}) = \frac{1}{1 + e^{-\text{logit}}}$$

Chunks below a relevance threshold (0.05) are filtered. The top `N` chunks are then **token-budget trimmed** (max 3,000 tokens) before being passed to the LLM.

### Structured Observability

Every log entry carries:
- `request_id` — UUID per HTTP request (propagated through async context)
- `app`, `env` — static application metadata  
- `timestamp` — ISO 8601 UTC
- `event` — structured event name (e.g., `pipeline_stream_done`, `llm_call_success`)

JSON output in production, colored console output in development.

---

## 🛡️ Security

| Control | Implementation |
|---------|---------------|
| **File validation** | Extension allowlist (pdf/txt/docx) + MIME type check |
| **Path traversal prevention** | Filename sanitization, stored outside web root |
| **File size limits** | Streamed in 64KB chunks, rejected at `MAX_UPLOAD_SIZE_MB` |
| **Rate limiting** | Nginx: 60 req/min (API), 10 req/min (ingest) |
| **Security headers** | X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy |
| **CORS** | Configurable per-environment via `ALLOWED_ORIGINS` |
| **Error isolation** | Global exception handler prevents traceback leaks |
| **JWT foundation** | python-jose + passlib included for auth extension |

---

## 🧩 Tech Stack

### Backend
| Technology | Version | Role |
|-----------|---------|------|
| **Python** | 3.12 | Runtime |
| **FastAPI** | 0.115 | ASGI web framework |
| **Uvicorn + Gunicorn** | 0.32 + 23.0 | ASGI server (dev + prod) |
| **LangChain** | 1.2 | RAG orchestration |
| **Pydantic v2** | 2.13 | Data validation & settings |
| **FAISS** | 1.9 | Local vector store |
| **rank-bm25** | 0.2.2 | BM25 keyword retrieval |
| **FlashRank** | 0.2.9 | Cross-encoder reranking (CPU) |
| **structlog** | 24.4 | Structured JSON logging |
| **PyPDF** | 5.1 | PDF parsing |
| **aiofiles** | 24.1 | Async file I/O |
| **Redis** | 5.2 | Caching (optional) |

### Frontend
| Technology | Version | Role |
|-----------|---------|------|
| **Next.js** | 15 | React framework (App Router) |
| **TypeScript** | 5 | Type safety |
| **Tailwind CSS** | 3 | Styling |
| **Spline** | latest | 3D scene rendering |
| **Lucide React** | latest | Icon library |
| **clsx** | latest | Conditional class names |

### Infrastructure
| Technology | Role |
|-----------|------|
| **Docker + Compose** | Container orchestration |
| **Nginx 1.27** | Reverse proxy, rate limiting, SSE support |
| **Multi-stage Dockerfiles** | Minimal production images |

---

## 📊 Performance Characteristics

| Metric | Value |
|--------|-------|
| **First token latency** | ~200-500ms (with pre-warmed singletons) |
| **Embedding batch size** | 200 chunks/call (OpenAI API) |
| **Vector upsert batch** | 100 chunks/batch |
| **Max context tokens** | 3,000 tokens (reranker token budget) |
| **Max upload size** | 50 MB per file |
| **Concurrent requests** | Limited by Gunicorn worker count |
| **Cold start** | Pre-warmed on app startup (embeddings + vector store) |

---

## 🗺️ Roadmap

- [ ] **Authentication** — JWT-based user sessions (foundation already included)
- [ ] **Redis job queue** — Replace in-memory job store for multi-process deployments
- [ ] **Semantic chunking** — `SemanticChunker` (commented stub ready to enable)
- [ ] **Cohere Rerank API** — Drop-in upgrade from FlashRank (already in requirements)
- [ ] **S3 document storage** — Replace local upload directory
- [ ] **WebSocket support** — Alternative to SSE for bidirectional streaming
- [ ] **Document deletion** — Per-document index cleanup

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">

**Built with ❤️ using FastAPI, LangChain, and Next.js**

*If this project was helpful, please consider giving it a ⭐*

</div>
