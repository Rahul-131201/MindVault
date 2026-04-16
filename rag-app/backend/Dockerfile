# =============================================================================
# Stage 1 — Builder
#   Install dependencies into a clean venv so we can copy only what's needed.
# =============================================================================
FROM python:3.11-slim AS builder

# System deps needed to compile some packages (faiss wheels are pre-built,
# but sentence-transformers may need build tools at runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create & activate a virtualenv
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Upgrade pip once here, not in the final image
RUN pip install --upgrade pip --no-cache-dir

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# =============================================================================
# Stage 2 — Runtime
# =============================================================================
FROM python:3.11-slim AS runtime

# Non-root user for security
RUN groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

# Runtime-only system libraries (libgomp for FAISS, libstdc++)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy the virtualenv from the builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Copy application source
COPY --chown=appuser:appgroup . .

# Directories that may be written at runtime
RUN mkdir -p /app/uploads /app/faiss_index \
    && chown -R appuser:appgroup /app/uploads /app/faiss_index

USER appuser

# Expose the API port
EXPOSE 8000

# Healthcheck — hit the /health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Gunicorn + Uvicorn workers for production.
# In dev (docker-compose override) this can be swapped for `uvicorn ... --reload`.
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "2", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
