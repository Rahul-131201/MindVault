#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT_DIR"

docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
