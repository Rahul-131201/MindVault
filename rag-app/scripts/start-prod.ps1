param(
  [switch]$Build
)

Write-Output "Starting production stack..."
Push-Location -LiteralPath (Join-Path $PSScriptRoot "..")
try {
  $cmd = "docker compose up --build --detach"
  if (-not $Build) { $cmd = "docker compose up --detach" }
  Write-Output "Running: $cmd"
  iex $cmd
} finally {
  Pop-Location
}
