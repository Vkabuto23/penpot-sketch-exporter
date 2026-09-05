$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$penpotServer = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $penpotServer "docker-compose.yaml"
$environmentFile = Join-Path $penpotServer ".env"
$manifestUrl = "http://localhost:9001/plugins/penpot-sketch-exporter/manifest.json"

if (-not (Test-Path -LiteralPath "node_modules")) {
  npm install
}

npm run check
npm run build

& docker compose --env-file $environmentFile -p penpot -f $composeFile up -d penpot-frontend
if ($LASTEXITCODE -ne 0) {
  throw "Could not start the Penpot frontend."
}

$manifest = Invoke-WebRequest -UseBasicParsing -Uri $manifestUrl -TimeoutSec 10
if ($manifest.StatusCode -ne 200) {
  throw "The exporter manifest is not available at $manifestUrl."
}

Start-Process $manifestUrl
