Write-Output "Starting development stack (hot-reload)..."
Push-Location -LiteralPath (Join-Path $PSScriptRoot "..")
try {
  $cmd = "docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build"
  Write-Output "Running: $cmd"
  iex $cmd
} finally {
  Pop-Location
}
