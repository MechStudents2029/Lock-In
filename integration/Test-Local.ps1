[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$backendPython = Join-Path $repositoryRoot 'backend/.venv/Scripts/python.exe'

if (-not (Test-Path -LiteralPath $backendPython -PathType Leaf)) {
    throw 'Create backend/.venv with Python 3.12 and install backend/requirements.txt first.'
}

Push-Location -LiteralPath $repositoryRoot
try {
    & $backendPython -m pytest -q tests --basetemp=.pytest_cache/integration-temp
    $testExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $testExitCode
