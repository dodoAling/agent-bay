param([ValidateRange(1, 65535)][int]$Port = 4318, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$agentBayNode = (Get-Command node -ErrorAction SilentlyContinue).Source
foreach ($agentBayNvmPath in @($env:NVM_SYMLINK, [Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'User'), [Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'Machine'))) {
    if ($agentBayNvmPath -and (Test-Path -LiteralPath (Join-Path $agentBayNvmPath 'node.exe'))) {
        $agentBayNode = Join-Path $agentBayNvmPath 'node.exe'
        break
    }
}
if (-not $agentBayNode) { throw 'Install Node.js 22.19+ first. Node.js 24.11+ is recommended for REA.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/@modelcontextprotocol/client/package.json'))) {
    $agentBayNpm = Join-Path (Split-Path $agentBayNode) 'node_modules/npm/bin/npm-cli.js'
    if (-not (Test-Path -LiteralPath $agentBayNpm)) { throw 'npm was not found. Run npm install in this directory.' }
    & $agentBayNode $agentBayNpm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$env:PORT = "$Port"
if ($NoBrowser) {
    & $agentBayNode (Join-Path $PSScriptRoot 'src/server.mjs')
} else {
    & $agentBayNode (Join-Path $PSScriptRoot 'src/server.mjs') --open
}
