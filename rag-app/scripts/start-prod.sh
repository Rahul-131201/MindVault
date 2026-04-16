#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT_DIR"

BUILD=${1:-}
if [ "$BUILD" = "--no-build" ]; then
  docker compose up --detach
else
  docker compose up --build --detach
fi
