$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host 'BladeIA - modo demo local'
Write-Host 'Datos sinteticos en memoria. No se conecta a Railway ni envia mensajes externos.'
Write-Host 'La pagina se abrira en http://127.0.0.1:5173/operations'

Set-Location -LiteralPath (Join-Path $repoRoot 'frontend')
npm.cmd exec vite -- --mode demo --host 127.0.0.1 --open /operations
