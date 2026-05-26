#requires -Version 7
<#
.SYNOPSIS
    Sanity-check the three Phase 1 manual prerequisites and the repository
    state that depends on them.

.DESCRIPTION
    This script does NOT change anything. It walks through the three pieces
    of external state that Phase 1 of the master plan depends on and reports
    whether each one is in place.

    1. flyctl is on PATH and authenticated.
    2. Each Planora Fly.io app (per `deploy/fly/*.fly.toml`) exists and the
       five mandatory secrets are present on it.
    3. The local repo is ready to deploy: `dotnet build -warnaserror` clean,
       and (when `gh` is on PATH) the GitHub repository has FLY_API_TOKEN
       secret configured.

.PARAMETER SkipFly
    Skip every Fly.io check. Useful when running on a CI agent without
    `flyctl` installed but you still want to confirm the local build state.

.PARAMETER SkipGh
    Skip the GitHub secret check.

.EXAMPLE
    PS> .\scripts\Verify-Phase1-Prereqs.ps1
    Walks through every check and prints a per-step status.

.NOTES
    Exit code is the number of failed checks (0 = all green).
#>
[CmdletBinding()]
param(
    [switch]$SkipFly,
    [switch]$SkipGh
)

$ErrorActionPreference = 'Continue'
$failed = 0

function Write-Check {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [ValidateSet('Pass', 'Fail', 'Warn', 'Skip')] [string]$Status,
        [string]$Detail
    )
    $colors = @{ Pass = 'Green'; Fail = 'Red'; Warn = 'Yellow'; Skip = 'DarkGray' }
    $marker = @{ Pass = '[OK]  '; Fail = '[FAIL]'; Warn = '[WARN]'; Skip = '[SKIP]' }[$Status]
    Write-Host "$marker $Name" -ForegroundColor $colors[$Status]
    if ($Detail) {
        Write-Host "       $Detail" -ForegroundColor DarkGray
    }
    if ($Status -eq 'Fail') {
        $script:failed++
    }
}

# Section 1: flyctl ----------------------------------------------------------
Write-Host "`n=== Fly.io prerequisites ===" -ForegroundColor Cyan
if ($SkipFly) {
    Write-Check 'flyctl on PATH' 'Skip' '-SkipFly supplied'
    Write-Check 'flyctl authenticated' 'Skip' '-SkipFly supplied'
} else {
    $flyctl = Get-Command flyctl -ErrorAction SilentlyContinue
    if ($null -eq $flyctl) {
        Write-Check 'flyctl on PATH' 'Fail' 'install from https://fly.io/docs/flyctl/install/'
    } else {
        Write-Check 'flyctl on PATH' 'Pass' $flyctl.Source

        $whoami = & flyctl auth whoami 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Check 'flyctl authenticated' 'Pass' "as $whoami"
        } else {
            Write-Check 'flyctl authenticated' 'Fail' "run 'flyctl auth login'"
        }
    }
}

# Section 2: Fly apps --------------------------------------------------------
Write-Host "`n=== Planora Fly.io apps ===" -ForegroundColor Cyan
$manifestDir = Join-Path $PSScriptRoot '..' 'deploy' 'fly'
$manifests = Get-ChildItem -Path $manifestDir -Filter '*.fly.toml' -ErrorAction SilentlyContinue

if (-not $manifests) {
    Write-Check 'deploy/fly/*.fly.toml' 'Fail' "no manifests found under $manifestDir"
} else {
    Write-Check 'deploy/fly/*.fly.toml' 'Pass' "$($manifests.Count) manifests"

    # The five mandatory secrets every Planora app needs.
    $mandatorySecrets = @(
        'JwtSettings__Secret',
        'GrpcSettings__ServiceKey',
        'ConnectionStrings__Redis',
        'RabbitMq__HostName',
        'RabbitMq__Password'
    )

    if (-not $SkipFly -and (Get-Command flyctl -ErrorAction SilentlyContinue)) {
        foreach ($m in $manifests) {
            $appLine = Select-String -Path $m.FullName -Pattern '^app\s*=\s*"([^"]+)"' | Select-Object -First 1
            if (-not $appLine) { continue }
            $app = $appLine.Matches[0].Groups[1].Value

            & flyctl status --app $app --json *> $null
            if ($LASTEXITCODE -ne 0) {
                Write-Check "$app exists" 'Fail' "run deploy/fly/setup.ps1"
                continue
            }
            Write-Check "$app exists" 'Pass'

            $secrets = & flyctl secrets list --app $app --json 2>$null | ConvertFrom-Json
            if ($LASTEXITCODE -ne 0 -or $null -eq $secrets) {
                Write-Check "$app secrets queryable" 'Warn' 'flyctl secrets list returned nothing'
                continue
            }
            $configured = $secrets | Select-Object -ExpandProperty Name
            $missing = $mandatorySecrets | Where-Object { $_ -notin $configured }
            if ($missing.Count -eq 0) {
                Write-Check "$app required secrets present" 'Pass'
            } else {
                Write-Check "$app required secrets present" 'Fail' "missing: $($missing -join ', ')"
            }
        }
    }
}

# Section 3: Local build state -----------------------------------------------
Write-Host "`n=== Local repo readiness ===" -ForegroundColor Cyan
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $repoRoot
try {
    $buildOutput = & dotnet build Planora.sln --configuration Release -warnaserror 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Check 'dotnet build -warnaserror' 'Pass'
    } else {
        Write-Check 'dotnet build -warnaserror' 'Fail' "see output of: dotnet build Planora.sln -warnaserror"
        $buildOutput | Select-Object -Last 10 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkRed }
    }
} finally {
    Pop-Location
}

# Section 4: GitHub repo secret ---------------------------------------------
Write-Host "`n=== GitHub repository ===" -ForegroundColor Cyan
if ($SkipGh) {
    Write-Check 'gh on PATH' 'Skip' '-SkipGh supplied'
} else {
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($null -eq $gh) {
        Write-Check 'gh on PATH' 'Warn' "install from https://cli.github.com/  (skipping secret check)"
    } else {
        Write-Check 'gh on PATH' 'Pass'
        $secrets = & gh secret list 2>$null
        if ($LASTEXITCODE -eq 0 -and $secrets -match '^FLY_API_TOKEN\b') {
            Write-Check 'FLY_API_TOKEN repository secret' 'Pass'
        } else {
            Write-Check 'FLY_API_TOKEN repository secret' 'Fail' "create it: flyctl auth token | gh secret set FLY_API_TOKEN"
        }
    }
}

# Summary --------------------------------------------------------------------
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($failed -eq 0) {
    Write-Host 'All Phase 1 prerequisites satisfied — CD workflow is ready to run.' -ForegroundColor Green
} else {
    Write-Host "$failed check(s) failed. Fix the items marked [FAIL] above and rerun this script." -ForegroundColor Red
}
exit $failed
