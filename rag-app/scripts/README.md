Start scripts for the RAG app

This folder contains convenience scripts to start the project with Docker.

PowerShell (Windows):
- Production (build optional):
  - `.uild\start-prod.ps1 -Build`  # builds images then starts detached
  - `.uild\start-prod.ps1`         # starts using existing images
- Development (hot-reload):
  - `.uild\start-dev.ps1`         # runs docker compose with dev override

Bash (macOS / Linux / WSL):
- Production (default builds):
  - `./scripts/start-prod.sh`            # builds and runs detached
  - `./scripts/start-prod.sh --no-build` # uses existing images
- Development (hot-reload):
  - `./scripts/start-dev.sh`

Notes:
- Ensure `docker` and `docker compose` are installed and the daemon is running.
- Copy `.env.example` to `.env` and fill required secrets before production.
- Development compose uses mounted volumes; do not run dev compose in production.
