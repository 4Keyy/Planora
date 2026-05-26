#requires -Version 7
<#
.SYNOPSIS
    Idempotently creates the eight Planora Fly.io applications.

.DESCRIPTION
    Reads the list of Planora apps from `deploy/fly/*.fly.toml`, asks flyctl
    whether each app already exists, and runs `flyctl apps create` only for
    the missing ones. Safe to re-run as many times as needed.

.PARAMETER Org
    Fly.io organisation slug under which the apps should live. If omitted,
    flyctl uses your default org from `flyctl auth login`.

.PARAMETER PrimaryRegion
    Primary Fly.io region for newly-created apps. Defaults to `ams`.
    Existing apps are NOT moved.

.EXAMPLE
    PS> .\deploy\fly\setup.ps1 -Org my-org -PrimaryRegion ams

.EXAMPLE
    PS> .\deploy\fly\setup.ps1
    # Uses default org and region.

.NOTES
    Prerequisites:
      1. flyctl on PATH (https://fly.io/docs/flyctl/install/).
      2. `flyctl auth login` already completed.

    After this script:
      - `set-secrets.ps1` to push the required secret matrix to each app.
      - `flyctl deploy --config deploy/fly/<app>.fly.toml ...` (or the
        Github Actions CD workflow on tag push) to ship images.
#>
[CmdletBinding()]
param(
    [string]$Org,
    [string]$PrimaryRegion = 'ams'
)

$ErrorActionPreference = 'Stop'

# Resolve flyctl ---------------------------------------------------------------
$flyctl = Get-Command flyctl -ErrorAction SilentlyContinue
if ($null -eq $flyctl) {
    Write-Error 'flyctl is not on PATH. Install from https://fly.io/docs/flyctl/install/ and run `flyctl auth login`.'
}

# Verify auth ------------------------------------------------------------------
try {
    $whoami = & flyctl auth whoami 2>&1
    if ($LASTEXITCODE -ne 0) { throw $whoami }
    Write-Host "Authenticated as: $whoami" -ForegroundColor Green
} catch {
    Write-Error "flyctl auth check failed: $_`nRun 'flyctl auth login' first."
}

# Enumerate apps from manifests ------------------------------------------------
$manifestDir = Join-Path $PSScriptRoot ''
$manifests = Get-ChildItem -Path $manifestDir -Filter '*.fly.toml' | Sort-Object Name

if ($manifests.Count -eq 0) {
    Write-Error "No fly.toml manifests found under $manifestDir"
}

Write-Host "Planning to ensure the following Planora apps exist:" -ForegroundColor Cyan
$plan = @()
foreach ($m in $manifests) {
    $appLine = Select-String -Path $m.FullName -Pattern '^app\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($null -eq $appLine) {
        Write-Warning "Skipping $($m.Name) — no `app = ""...""` declaration."
        continue
    }
    $appName = $appLine.Matches[0].Groups[1].Value
    $plan += [pscustomobject]@{ Manifest = $m.Name; App = $appName }
}
$plan | Format-Table -AutoSize

# Create missing apps ---------------------------------------------------------
foreach ($entry in $plan) {
    $appName = $entry.App
    Write-Host "`n--- $appName ---" -ForegroundColor Yellow

    # `flyctl status --app <name> --json` exits 0 when the app exists, non-zero otherwise.
    & flyctl status --app $appName --json *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  exists — skip" -ForegroundColor DarkGray
        continue
    }

    $args = @('apps', 'create', $appName)
    if ($Org) {
        $args += @('--org', $Org)
    }
    Write-Host "  creating: flyctl $($args -join ' ')"
    & flyctl @args
    if ($LASTEXITCODE -ne 0) {
        Write-Error "flyctl apps create $appName failed."
    }

    # Set the primary region (idempotent — Fly accepts the same region twice).
    & flyctl regions set $PrimaryRegion --app $appName *> $null
    Write-Host "  primary region set to: $PrimaryRegion" -ForegroundColor Green
}

Write-Host "`nAll Planora apps are present." -ForegroundColor Green
Write-Host "Next step: run .\deploy\fly\set-secrets.ps1 to push the secret matrix." -ForegroundColor Cyan
