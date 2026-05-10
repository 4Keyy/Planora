<#
.SYNOPSIS
    Planora Docker Launcher - starts all backend services via Docker Compose,
    runs the Next.js frontend locally on the host.

.DESCRIPTION
    Modes:
      (default)  Kill existing Planora processes, preserve all data volumes,
                 restart all Docker services fresh. Fast, incremental restart.
      -Clean     Kill processes, docker compose down (no --volumes - data preserved),
                 rebuild all images with --no-cache, then start everything fresh.

.PARAMETER Clean
    Tears down containers and rebuilds all Docker images from scratch.
    Does NOT wipe database volumes - data is preserved.

.EXAMPLE
    .\Start-Planora-Docker.ps1
.EXAMPLE
    .\Start-Planora-Docker.ps1 -Clean
#>
param(
    [switch]$Clean
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
#  Module imports
# ---------------------------------------------------------------------------
$ScriptRoot = $PSScriptRoot
Import-Module "$ScriptRoot/scripts/PidManager.psm1"    -Force
Import-Module "$ScriptRoot/scripts/PortChecker.psm1"   -Force
Import-Module "$ScriptRoot/scripts/HealthChecker.psm1"  -Force

# ---------------------------------------------------------------------------
#  ANSI color definitions
# ---------------------------------------------------------------------------
$ESC    = [char]27
$RESET  = "$ESC[0m"
$BOLD   = "$ESC[1m"
$RED    = "$ESC[91m"
$GREEN  = "$ESC[92m"
$YELLOW = "$ESC[93m"
$CYAN   = "$ESC[96m"
$GRAY   = "$ESC[90m"

function Write-Step { param($msg) Write-Host "${CYAN}${BOLD}  > $msg${RESET}" }
function Write-OK   { param($msg) Write-Host "${GREEN}  + $msg${RESET}" }
function Write-Warn { param($msg) Write-Host "${YELLOW}  ! $msg${RESET}" }
function Write-Fail { param($msg) Write-Host "${RED}  x $msg${RESET}" }
function Write-Info { param($msg) Write-Host "${GRAY}    $msg${RESET}" }

function Show-Header {
    param($Title)
    $line = "=" * 54
    Write-Host ""
    Write-Host "${CYAN}  +${line}+${RESET}"
    Write-Host "${CYAN}  |${BOLD}$(("  $Title").PadRight(54))${RESET}${CYAN}|${RESET}"
    Write-Host "${CYAN}  +${line}+${RESET}"
    Write-Host ""
}

# ---------------------------------------------------------------------------
#  Global state
# ---------------------------------------------------------------------------
$RepoRoot    = $ScriptRoot
$LogDir      = Join-Path $RepoRoot "logs"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
$FrontendDir = Join-Path $RepoRoot "frontend"
$FrontendPort = 3000
$Failures    = [System.Collections.Generic.List[string]]::new()
$totalTimer  = [System.Diagnostics.Stopwatch]::StartNew()

# Docker application service names (not infra)
$AppServices = @("auth-api", "category-api", "todo-api", "messaging-api", "realtime-api", "api-gateway")

# All services including infra
$AllServices = @("postgres", "redis", "rabbitmq") + $AppServices

# Health endpoints for Docker-deployed services (host ports from docker-compose.yml)
$HealthChecks = @(
    @{ Name = "auth-api";      HealthUrl = "http://localhost:5031/health" }
    @{ Name = "category-api";  HealthUrl = "http://localhost:5281/health" }
    @{ Name = "todo-api";      HealthUrl = "http://localhost:5100/health" }
    @{ Name = "messaging-api"; HealthUrl = "http://localhost:5058/health" }
    @{ Name = "realtime-api";  HealthUrl = "http://localhost:5032/health" }
    @{ Name = "api-gateway";   HealthUrl = "http://localhost:5132/health" }
    @{ Name = "frontend";      HealthUrl = "http://localhost:$FrontendPort" }
)

# ---------------------------------------------------------------------------
#  Logging via transcript
# ---------------------------------------------------------------------------
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir "startup-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').log"
Start-Transcript -Path $LogFile -Append | Out-Null

# ---------------------------------------------------------------------------
#  Load .env into process environment
# ---------------------------------------------------------------------------
function Import-EnvFile {
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) { return }
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
            $k = $Matches[1].Trim()
            $v = $Matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
    Write-OK ".env loaded into process environment"
}

# ---------------------------------------------------------------------------
#  Preflight checks
# ---------------------------------------------------------------------------
function Invoke-PreflightChecks {
    Write-Step "Running preflight checks..."
    $ok = $true

    # dotnet (needed for -Clean restore, good to verify)
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        Write-Warn "dotnet CLI not found - install from https://dot.net (needed for -Clean restore)"
    } else {
        Write-OK "dotnet $(& dotnet --version 2>&1)"
    }

    # Docker CLI - auto-start engine if stopped, wait up to 60s
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Fail "docker not found - install Docker Desktop from https://docker.com"
        $ok = $false
    } else {
        $dockerOk = $false
        $null = docker ps 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerOk = $true
        } else {
            Write-Warn "Docker engine not running - attempting to start Docker Desktop..."
            $ddExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
            if (Test-Path $ddExe) {
                Start-Process $ddExe -WindowStyle Hidden -ErrorAction SilentlyContinue
            } else {
                $null = docker context use desktop-linux 2>&1
            }
            Write-Info "Waiting for Docker engine (up to 60s)..."
            for ($di = 1; $di -le 20; $di++) {
                Start-Sleep -Seconds 3
                $null = docker ps 2>&1
                if ($LASTEXITCODE -eq 0) { $dockerOk = $true; break }
                Write-Info "  Still waiting... ($($di * 3)s / 60s)"
            }
        }
        if ($dockerOk) {
            Write-OK "Docker daemon running"
        } else {
            Write-Fail "Docker engine did not start within 60s"
            Write-Info "  Open Docker Desktop, wait for the engine to start, then retry."
            $ok = $false
        }
    }

    # .env file
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) {
        Write-Fail ".env file not found - copy .env.example to .env and fill in values"
        $ok = $false
    } else {
        Write-OK ".env file present"
        $envContent = Get-Content $envFile | Where-Object { $_ -match "^JWT_SECRET=" }
        if (-not $envContent) {
            Write-Fail "JWT_SECRET not set in .env"
            $ok = $false
        } else {
            $jwtVal = ($envContent -split "=", 2)[1].Trim()
            if ($jwtVal.Length -lt 32) {
                Write-Fail "JWT_SECRET is too short ($($jwtVal.Length) chars, need >=32)"
                $ok = $false
            } else {
                Write-OK "JWT_SECRET present ($($jwtVal.Length) chars)"
            }
        }
    }

    # docker-compose.yml
    if (-not (Test-Path $ComposeFile)) {
        Write-Fail "docker-compose.yml not found at $ComposeFile"
        $ok = $false
    } else {
        Write-OK "docker-compose.yml found"
    }

    # node/npm (for frontend)
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "node not found - frontend will not start (install from https://nodejs.org)"
    } else {
        Write-OK "node $(& node --version 2>&1)"
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Warn "npm not found - frontend will not start"
    } else {
        $npmVer = (& npm -v 2>$null) | Where-Object { $_ -match '^\d+\.\d+\.\d+' } | Select-Object -First 1
        if (-not $npmVer) { $npmVer = "(unknown)" }
        Write-OK "npm $npmVer"
    }

    return $ok
}

# ---------------------------------------------------------------------------
#  Stop existing local Planora processes (frontend + any local .NET)
# ---------------------------------------------------------------------------
function Stop-PlanoraProcesses {
    Write-Step "Stopping existing Planora processes..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    # Phase 1: stop via PID files
    $null = Stop-AllServices -Force -GracePeriodSeconds 8

    # Phase 2: port-based fallback for local processes not tracked by PID files
    $localPorts = @(5030, 5031, 5100, 5281, 5282, 5058, 5032, 5132, 3000)
    foreach ($port in $localPorts) {
        $owner = Get-PortOwner -Port $port
        if ($owner -and $owner.IsPlanora) {
            Write-Info "Stopping PID $($owner.Pid) ($($owner.ProcessName)) on port $port"
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
        }
    }

    # Wait for frontend port to be free
    $null = Wait-PortFree -Port $FrontendPort -ServiceName "frontend" -TimeoutSeconds 15

    # Clean up stale PID files
    Clear-PidDirectory

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Local processes stopped ($($elapsed)s)"
}

# ---------------------------------------------------------------------------
#  Infrastructure startup - postgres, redis, rabbitmq
# ---------------------------------------------------------------------------
function Start-Infrastructure {
    Write-Step "Starting infrastructure containers (postgres, redis, rabbitmq)..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    $null = docker compose -f $ComposeFile up -d postgres redis rabbitmq 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose up for infrastructure failed"
        return $false
    }

    $infra = @(
        @{ Container = "planora-postgres"; Name = "PostgreSQL" },
        @{ Container = "planora-redis";    Name = "Redis" },
        @{ Container = "planora-rabbitmq"; Name = "RabbitMQ" }
    )

    foreach ($svc in $infra) {
        Write-Info "Waiting for $($svc.Name) to be healthy..."
        $delay   = 500
        $healthy = $false
        for ($i = 1; $i -le 20; $i++) {
            $status = docker inspect $svc.Container --format "{{.State.Health.Status}}" 2>$null
            if ($status -eq "healthy") { $healthy = $true; break }
            Write-Info "  Attempt $i/20 ($($svc.Name): $status) - $($delay)ms..."
            Start-Sleep -Milliseconds $delay
            $delay = [Math]::Min([int]($delay * 1.5), 10000)
        }
        if (-not $healthy) {
            Write-Fail "$($svc.Name) failed health check - check: docker logs $($svc.Container)"
            return $false
        }
        Write-OK "$($svc.Name) healthy"
    }

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Infrastructure ready ($($elapsed)s)"
    return $true
}

# ---------------------------------------------------------------------------
#  Start application services via docker compose
# ---------------------------------------------------------------------------
function Start-AppServices {
    Write-Step "Starting application services via Docker Compose..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    $svcArgs = @("-f", $ComposeFile, "up", "-d") + $AppServices
    $null = docker compose @svcArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose up for application services failed"
        return $false
    }

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "docker compose up -d completed ($($elapsed)s)"
    return $true
}

# ---------------------------------------------------------------------------
#  Wait for Docker application containers to reach healthy/running state
# ---------------------------------------------------------------------------
function Wait-AppContainersReady {
    Write-Step "Waiting for application containers to become healthy..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    foreach ($svc in $AppServices) {
        $containerName = "planora-$svc"
        Write-Info "Waiting for $containerName..."
        $delay   = 500
        $healthy = $false

        for ($i = 1; $i -le 30; $i++) {
            $raw = docker inspect $containerName --format "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" 2>$null
            if ($raw) {
                $parts  = $raw -split "\|", 2
                $state  = $parts[0].Trim()
                $health = if ($parts.Count -gt 1) { $parts[1].Trim() } else { "none" }

                if ($health -eq "healthy") {
                    $healthy = $true; break
                }
                if ($health -eq "none" -and $state -eq "running") {
                    $healthy = $true; break
                }
                Write-Info "  $containerName - state=$state health=$health (attempt $i/30)"
            } else {
                Write-Info "  $containerName - not yet visible (attempt $i/30)"
            }
            Start-Sleep -Milliseconds $delay
            $delay = [Math]::Min([int]($delay * 1.5), 10000)
        }

        if ($healthy) {
            Write-OK "$svc container ready"
        } else {
            Write-Warn "$svc container did not reach healthy state - check: docker logs planora-$svc"
            $Failures.Add("$svc container did not become healthy in time")
        }
    }

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Container readiness check complete ($($elapsed)s)"
}

# ---------------------------------------------------------------------------
#  Start the Next.js frontend locally (not in Docker Compose)
# ---------------------------------------------------------------------------
function Start-Frontend {
    Write-Step "Starting Next.js frontend (local)..."

    if (-not (Test-Path $FrontendDir)) {
        Write-Warn "Frontend directory not found at $FrontendDir - skipping"
        return
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Warn "npm not found - skipping frontend"
        return
    }

    $ts     = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $fLog   = Join-Path $LogDir "frontend-$ts.log"
    $nmPath = Join-Path $FrontendDir "node_modules"
    $nextBin = Join-Path $nmPath ".bin/next.cmd"
    $nextRuntimeBin = Join-Path $nmPath "next/dist/bin/next"

    $installPart = if (-not (Test-Path $nextBin) -or -not (Test-Path $nextRuntimeBin)) {
        'if (Test-Path "node_modules/next") { Remove-Item -LiteralPath "node_modules/next" -Recurse -Force }; ' +
        'if (Test-Path "node_modules/.bin/next") { Remove-Item -LiteralPath "node_modules/.bin/next" -Force }; ' +
        'if (Test-Path "node_modules/.bin/next.cmd") { Remove-Item -LiteralPath "node_modules/.bin/next.cmd" -Force }; ' +
        'if (Test-Path "node_modules/.bin/next.ps1") { Remove-Item -LiteralPath "node_modules/.bin/next.ps1" -Force }; ' +
        "npm install --no-fund --no-audit; "
    } else {
        ""
    }

    $cmd = $installPart + 'npm run dev -- -H 0.0.0.0 2>&1 | Tee-Object -FilePath "' + $fLog + '"'

    $proc = Start-Process powershell `
        -ArgumentList @("-NoProfile", "-NonInteractive", "-Command", $cmd) `
        -WorkingDirectory $FrontendDir `
        -PassThru `
        -WindowStyle Hidden

    if ($proc) {
        Write-ServicePid -ServiceName "frontend" -ProcessId $proc.Id
        Write-OK "Frontend starting (PID $($proc.Id), port $FrontendPort)"
        Write-Info "Log: $fLog"
    } else {
        $Failures.Add("frontend: Start-Process returned null")
        Write-Fail "Frontend failed to start"
    }
}

# ---------------------------------------------------------------------------
#  Health check all services via HealthChecker module
# ---------------------------------------------------------------------------
function Invoke-AllHealthChecks {
    Write-Step "Waiting for all services to become healthy..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    $services = $HealthChecks | ForEach-Object {
        @{
            Name      = $_.Name
            HealthUrl = $_.HealthUrl
            Timeout   = if ($_.Name -eq "frontend") { 120 } else { 90 }
        }
    }

    $results = Test-AllServicesHealthy -Services $services -OverallTimeoutSeconds 180

    foreach ($r in $results) {
        if ($r.Status -ne "Healthy") {
            $Failures.Add("$($r.ServiceName) health check failed: $($r.Error)")
        }
    }

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Health checks complete ($($elapsed)s)"
    return $results
}

# ---------------------------------------------------------------------------
#  Print current container status table
# ---------------------------------------------------------------------------
function Show-ContainerStatus {
    Write-Host ""
    Write-Info "Container status:"
    $header = "  {0,-28} {1,-10} {2}" -f "Container", "Status", "Health"
    Write-Host "${GRAY}$header${RESET}"
    Write-Host "${GRAY}  $('-' * 56)${RESET}"

    foreach ($svc in $AllServices) {
        $name = "planora-$svc"
        $raw  = docker inspect $name --format "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" 2>$null
        if ($raw) {
            $parts  = $raw -split "\|", 2
            $state  = $parts[0].Trim()
            $health = if ($parts.Count -gt 1) { $parts[1].Trim() } else { "none" }
            $stateColor  = switch ($state)  { "running" { $GREEN } "exited" { $RED } default { $GRAY } }
            $healthColor = switch ($health) { "healthy" { $GREEN } "unhealthy" { $RED } "starting" { $YELLOW } default { $GRAY } }
            $row = "  {0,-28} {1}" -f $name, ""
            Write-Host "  ${GRAY}$($name.PadRight(28))${RESET} ${stateColor}$($state.PadRight(10))${RESET} ${healthColor}$health${RESET}"
        } else {
            Write-Host "  ${GRAY}$($name.PadRight(28)) not found${RESET}"
        }
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
#  Success summary table
# ---------------------------------------------------------------------------
function Show-Summary {
    param($HealthResults, $TotalSeconds)

    $services = @(
        @{ Name = "Frontend";     Url = "http://localhost:3000";  Key = "frontend" }
        @{ Name = "API Gateway";  Url = "http://localhost:5132";  Key = "api-gateway" }
        @{ Name = "Auth API";     Url = "http://localhost:5031";  Key = "auth-api" }
        @{ Name = "Category API"; Url = "http://localhost:5281";  Key = "category-api" }
        @{ Name = "Todo API";     Url = "http://localhost:5100";  Key = "todo-api" }
        @{ Name = "Messaging API";Url = "http://localhost:5058";  Key = "messaging-api" }
        @{ Name = "Realtime API"; Url = "http://localhost:5032";  Key = "realtime-api" }
        @{ Name = "RabbitMQ UI";  Url = "http://localhost:15672 (guest/guest)"; Key = $null }
    )

    $border = "=" * 60
    Write-Host ""
    Write-Host "${CYAN}  +${border}+${RESET}"
    Write-Host "${CYAN}  |${BOLD}$(("  Planora is Running  [Docker Mode]").PadRight(60))${RESET}${CYAN}|${RESET}"
    Write-Host "${CYAN}  +${border}+${RESET}"

    foreach ($s in $services) {
        $r = if ($s.Key) {
            $HealthResults | Where-Object { $_.ServiceName -eq $s.Key } | Select-Object -First 1
        } else { $null }

        $statusIcon = if ($null -eq $r) {
            "${GRAY}~${RESET}"
        } elseif ($r.Status -eq "Healthy") {
            "${GREEN}+${RESET}"
        } else {
            "$($RED)x${RESET}"
        }
        $row = "  $statusIcon  $($s.Name.PadRight(16)) $($s.Url)"
        Write-Host "${CYAN}  |${RESET}$($row.PadRight(60))${CYAN}|${RESET}"
    }

    Write-Host "${CYAN}  +${border}+${RESET}"
    $timeRow = "  Total startup time: $([Math]::Round($TotalSeconds, 1))s"
    Write-Host "${CYAN}  |${RESET}$($timeRow.PadRight(60))${CYAN}|${RESET}"

    if ($Failures.Count -gt 0) {
        $warnRow = "  Warnings: $($Failures.Count) non-fatal issue(s)"
        Write-Host "${CYAN}  |${YELLOW}$($warnRow.PadRight(60))${RESET}${CYAN}|${RESET}"
    }

    Write-Host "${CYAN}  +${border}+${RESET}"
    Write-Host ""
    Write-Info "Log file: $LogFile"
    Write-Info "Ctrl+C to stop frontend and exit (Docker containers keep running)"
    Write-Info "To stop all containers: docker compose -f docker-compose.yml down"
    Write-Host ""
}

# ---------------------------------------------------------------------------
#  Graceful shutdown
# ---------------------------------------------------------------------------
$global:ShuttingDown = $false

function Invoke-GracefulShutdown {
    if ($global:ShuttingDown) { return }
    $global:ShuttingDown = $true
    Write-Host ""
    Write-Step "Shutting down Planora (Docker)..."

    # Stop the locally-running frontend
    $null = Stop-ServiceByPid -ServiceName "frontend" -Force -GracePeriodSeconds 5

    # Clear PID files
    Clear-PidDirectory

    Write-OK "Local processes stopped"
    Write-Info "Docker containers are still running. To stop them:"
    Write-Info "  docker compose -f `"$ComposeFile`" down"
    Write-Host ""

    try { Stop-Transcript | Out-Null } catch {}
}

$null = Register-EngineEvent PowerShell.Exiting -Action { Invoke-GracefulShutdown }

# ===========================================================================
#  ENTRY POINT
# ===========================================================================
Clear-Host
$modeLabel = if ($Clean) { "CLEAN REBUILD" } else { "Fresh Restart" }
Show-Header "Planora - Docker Launcher [$modeLabel]"

Write-Info "Log file: $LogFile"
Write-Host ""

Set-Location -LiteralPath $RepoRoot

# -- Step 1: Preflight -------------------------------------------------------
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
$preOk = Invoke-PreflightChecks
$elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
Write-OK "Preflight complete ($($elapsed)s)"

if (-not $preOk) {
    Write-Fail "Preflight checks failed - resolve the issues above and retry."
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

# Load .env into process environment so JWT_SECRET etc. are available
Import-EnvFile

# -- Step 2: Stop existing local processes -----------------------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
Stop-PlanoraProcesses

# -- Step 3: Clean rebuild (if -Clean) ----------------------------------------
if ($Clean) {
    Write-Host ""
    Write-Step "CLEAN mode - stopping containers and rebuilding images (data preserved)..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    # docker compose down - removes containers but NOT volumes
    Write-Info "docker compose down (containers only, volumes intact)..."
    $null = docker compose -f $ComposeFile down --remove-orphans 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Containers removed"
    } else {
        Write-Warn "docker compose down had warnings (continuing)"
    }

    # Clear frontend .next cache
    $nextDir = Join-Path $FrontendDir ".next"
    if (Test-Path $nextDir) {
        try {
            Remove-Item -Path $nextDir -Recurse -Force -ErrorAction Stop
            Write-OK "Removed frontend/.next"
        } catch {
            Write-Warn "Could not remove .next: $_"
        }
    }

    # Rebuild all images with --no-cache
    Write-Step "Rebuilding all Docker images (--no-cache)..."
    $buildTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $null = docker compose -f $ComposeFile build --no-cache 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose build --no-cache failed - check Dockerfiles and build context"
        $Failures.Add("docker compose build --no-cache failed")
        try { Stop-Transcript | Out-Null } catch {}
        exit 1
    }
    $buildElapsed = [Math]::Round($buildTimer.Elapsed.TotalSeconds, 1)
    Write-OK "All images rebuilt from scratch ($($buildElapsed)s)"

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Clean rebuild step complete ($($elapsed)s)"
}

# -- Step 4: Start infrastructure (postgres/redis/rabbitmq) ------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
$infraOk = Start-Infrastructure
if (-not $infraOk) {
    Write-Fail "Infrastructure failed to start. Check Docker Desktop is running."
    $Failures.Add("Infrastructure startup failed")
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

# -- Step 5: Show pre-launch container state ---------------------------------
Show-ContainerStatus

# -- Step 6: Start application services via docker compose -------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
$appOk = Start-AppServices
if (-not $appOk) {
    Write-Fail "Application services failed to start via docker compose."
    $Failures.Add("docker compose up for app services failed")
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

# -- Step 7: Wait for application containers to be ready ---------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
Wait-AppContainersReady

# -- Step 8: Show updated container state ------------------------------------
Show-ContainerStatus

# -- Step 9: Start frontend locally ------------------------------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
Start-Frontend
$elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
Write-OK "Frontend launch triggered ($($elapsed)s)"

# -- Step 10: Wait for all health endpoints ----------------------------------
Write-Host ""
$healthResults = Invoke-AllHealthChecks

# -- Step 11: Open browser (if frontend is healthy) --------------------------
$frontendHealthy = $healthResults | Where-Object { $_.ServiceName -eq "frontend" -and $_.Status -eq "Healthy" }
if ($frontendHealthy) {
    try { Start-Process "http://localhost:3000" | Out-Null } catch {}
}

# -- Step 12: Print summary --------------------------------------------------
$totalSecs = $totalTimer.Elapsed.TotalSeconds
Show-Summary -HealthResults $healthResults -TotalSeconds $totalSecs

if ($Failures.Count -gt 0) {
    Write-Warn "Completed with $($Failures.Count) issue(s):"
    $Failures | Sort-Object -Unique | ForEach-Object { Write-Warn "  - $_" }
    Write-Info "Tip: run with -Clean to rebuild all images from scratch"
    Write-Info "Tip: docker compose -f docker-compose.yml logs -f <service-name>"
} else {
    Write-OK "All systems healthy. Planora is running in Docker mode."
}

Write-Host ""
Write-Info "Press Ctrl+C to stop the frontend. Docker containers will keep running."
Write-Host ""

try {
    # Keep the script alive so Ctrl+C triggers graceful shutdown
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Invoke-GracefulShutdown
}
