<#
.SYNOPSIS
    Planora Docker Launcher - starts every backend service via Docker Compose and
    runs the Next.js frontend locally on the host.

.DESCRIPTION
    Infrastructure (PostgreSQL, Redis, RabbitMQ) and all .NET services run as
    Docker containers; the frontend runs on the host for fast iteration.

    Modes:
      (default)  Stop existing host processes, preserve all data volumes, and
                 (re)start every container fresh. Fast, incremental restart.
      -Clean     `docker compose down` (no --volumes, so data is preserved),
                 rebuild all images with --no-cache, then start everything.

.PARAMETER Clean
    Tears down containers and rebuilds all Docker images from scratch.
    Database volumes are NOT touched.

.PARAMETER ExitAfterHealthCheck
    Start everything, verify health endpoints, then shut down. Intended for
    CI / smoke tests. Exit code is non-zero if any service failed its check.

.PARAMETER SkipFrontend
    Start the Docker stack only; do not launch the host Next.js frontend.

.PARAMETER NoBrowser
    Do not open the browser automatically once the frontend is healthy.

.PARAMETER Stop
    Stop the host frontend this launcher started and run `docker compose down`
    (containers + network only). Data volumes are preserved. Then exit.

.PARAMETER Help
    Print usage and exit without starting anything.

.EXAMPLE
    .\Start-Planora-Docker.ps1
.EXAMPLE
    .\Start-Planora-Docker.ps1 -Clean
.EXAMPLE
    .\Start-Planora-Docker.ps1 -SkipFrontend -NoBrowser
.EXAMPLE
    .\Start-Planora-Docker.ps1 -Stop
#>
param(
    # docker compose down + rebuild all images with --no-cache. Data volumes preserved.
    [switch]$Clean,
    # Start everything, verify health, then shut down (used by CI / smoke tests).
    [switch]$ExitAfterHealthCheck,
    # Do not start the host Next.js frontend (containers only).
    [switch]$SkipFrontend,
    # Do not open the browser once the frontend is healthy.
    [switch]$NoBrowser,
    # Stop the host frontend and `docker compose down`, then exit (no startup).
    [switch]$Stop,
    # Print usage and exit.
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$ScriptRoot = $PSScriptRoot

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

function Show-Usage {
    Write-Host ""
    Write-Host "${BOLD}Planora Docker Launcher${RESET}"
    Write-Host "  Starts every backend service in Docker and the Next.js frontend on the host."
    Write-Host ""
    Write-Host "${BOLD}USAGE${RESET}"
    Write-Host "  .\Start-Planora-Docker.ps1 [-Clean] [-SkipFrontend] [-NoBrowser]"
    Write-Host "                             [-ExitAfterHealthCheck] [-Stop] [-Help]"
    Write-Host ""
    Write-Host "${BOLD}OPTIONS${RESET}"
    Write-Host "  -Clean                 docker compose down + rebuild all images (data preserved)."
    Write-Host "  -SkipFrontend          Start the Docker stack only."
    Write-Host "  -NoBrowser             Do not open the browser when the frontend is ready."
    Write-Host "  -ExitAfterHealthCheck  Start, verify health, then shut down (CI / smoke test)."
    Write-Host "  -Stop                  Stop the host frontend + 'docker compose down', then exit."
    Write-Host "  -Help                  Show this help and exit."
    Write-Host ""
    Write-Host "${BOLD}EXAMPLES${RESET}"
    Write-Host "  .\Start-Planora-Docker.ps1"
    Write-Host "  .\Start-Planora-Docker.ps1 -Clean"
    Write-Host "  .\Start-Planora-Docker.ps1 -SkipFrontend -NoBrowser"
    Write-Host "  .\Start-Planora-Docker.ps1 -Stop"
    Write-Host ""
}

# ---------------------------------------------------------------------------
#  Global state
# ---------------------------------------------------------------------------
$RepoRoot     = $ScriptRoot
$LogDir       = Join-Path $RepoRoot "logs"
$ComposeFile  = Join-Path $RepoRoot "docker-compose.yml"
$FrontendDir  = Join-Path $RepoRoot "frontend"
$FrontendPort = 3000
$Failures     = [System.Collections.Generic.List[string]]::new()
$totalTimer   = [System.Diagnostics.Stopwatch]::StartNew()

# Single source of truth: compose service name => host port + health path, in
# dependency/startup order. Host ports are the 127.0.0.1 mappings published by
# docker-compose.yml. Collaboration is a gRPC client of Auth and Todo, so it is
# listed after both. Every list below is derived from this map (no duplicates).
$ServiceDefs = [ordered]@{
    "auth-api"          = @{ HostPort = 5031; HealthPath = "/health" }
    "category-api"      = @{ HostPort = 5281; HealthPath = "/health" }
    "todo-api"          = @{ HostPort = 5100; HealthPath = "/health" }
    "collaboration-api" = @{ HostPort = 5060; HealthPath = "/health" }
    "messaging-api"     = @{ HostPort = 5058; HealthPath = "/health" }
    "realtime-api"      = @{ HostPort = 5032; HealthPath = "/health" }
    "api-gateway"       = @{ HostPort = 5132; HealthPath = "/health" }
}

# Compose service names: application tier, and the full set including infra.
$AppServices = @($ServiceDefs.Keys)
$AllServices = @("postgres", "redis", "rabbitmq") + $AppServices

# Host ports a previous *local* launcher run may have left bound, cleaned up so a
# Docker run after a local run does not collide. Includes the frontend port.
$HostCleanupPorts = @(5030, 5031, 5060, 5100, 5101, 5281, 5282, 5058, 5032, 5132, $FrontendPort)

# ---------------------------------------------------------------------------
#  -Help: print usage and exit before any side effects (no log file created)
# ---------------------------------------------------------------------------
if ($Help) {
    Show-Usage
    exit 0
}

# ---------------------------------------------------------------------------
#  Logging via transcript
# ---------------------------------------------------------------------------
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir "startup-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').log"
Start-Transcript -Path $LogFile -Append | Out-Null

# ---------------------------------------------------------------------------
#  Helper module imports (validated, with actionable errors)
# ---------------------------------------------------------------------------
function Import-LauncherModules {
    $requiredModules = @(
        @{ Name = "PidManager";    Path = (Join-Path $RepoRoot "scripts/PidManager.psm1") }
        @{ Name = "PortChecker";   Path = (Join-Path $RepoRoot "scripts/PortChecker.psm1") }
        @{ Name = "HealthChecker"; Path = (Join-Path $RepoRoot "scripts/HealthChecker.psm1") }
    )

    foreach ($module in $requiredModules) {
        if (-not (Test-Path $module.Path)) {
            throw "Required helper module '$($module.Name)' was not found at '$($module.Path)'."
        }
        try {
            Import-Module $module.Path -Force -DisableNameChecking -ErrorAction Stop | Out-Null
        } catch {
            throw "Failed to import helper module '$($module.Name)' from '$($module.Path)': $($_.Exception.Message)"
        }
    }
}

function Get-NpmExecutable {
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCmd) { return $npmCmd.Source }

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($npm) { return $npm.Source }

    return $null
}

# ---------------------------------------------------------------------------
#  Load .env into process environment
# ---------------------------------------------------------------------------
function Import-EnvFile {
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) { return }

    # SECURITY: secrets are loaded into THIS process's environment block only.
    # docker compose reads them from the same .env file for the containers, and
    # the host frontend (started with Start-Process) inherits this block - so no
    # secret is ever placed on a child process command line or in the transcript.
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

    # docker-compose.yml
    if (-not (Test-Path $ComposeFile)) {
        Write-Fail "docker-compose.yml not found at $ComposeFile"
        $ok = $false
    } else {
        Write-OK "docker-compose.yml found"
    }

    # .env file + JWT_SECRET sanity
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

    # node/npm (for the host frontend) - warn only
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "node not found - frontend will not start (install from https://nodejs.org)"
    } else {
        Write-OK "node $(& node --version 2>&1)"
    }
    $npmExe = Get-NpmExecutable
    if (-not $npmExe) {
        Write-Warn "npm not found - frontend will not start"
    } else {
        $npmVer = (& $npmExe -v 2>$null) | Where-Object { $_ -match '^\d+\.\d+\.\d+' } | Select-Object -First 1
        if (-not $npmVer) { $npmVer = "(unknown)" }
        Write-OK "npm $npmVer"
    }

    return $ok
}

# ---------------------------------------------------------------------------
#  Stop host Planora processes (frontend + any stray local .NET services)
# ---------------------------------------------------------------------------
function Stop-PlanoraProcesses {
    Write-Step "Stopping existing host Planora processes..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    # Phase 1: stop via PID files (targeted, safe)
    $null = Stop-AllServices -Force -GracePeriodSeconds 8 -Quiet

    # Phase 2: port-based fallback for host processes not tracked by PID files
    # (e.g. a previous local-launcher run). Docker-published ports are owned by
    # the Docker backend, not flagged IsPlanora, so containers are never killed.
    foreach ($port in $HostCleanupPorts) {
        $owner = Get-PortOwner -Port $port
        if ($owner -and $owner.IsPlanora) {
            Write-Info "Stopping PID $($owner.Pid) ($($owner.ProcessName)) on port $port"
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
        }
    }

    # Wait for the frontend port to be free before relaunching it
    $null = Wait-PortFree -Port $FrontendPort -ServiceName "frontend" -TimeoutSeconds 15

    # Clean up stale PID files
    Clear-PidDirectory

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Host processes stopped ($($elapsed)s)"
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
    Write-Step "Starting Next.js frontend (host)..."

    if (-not (Test-Path $FrontendDir)) {
        Write-Warn "Frontend directory not found at $FrontendDir - skipping"
        return
    }
    $npmExe = Get-NpmExecutable
    if (-not $npmExe) {
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
        '& "' + $npmExe + '" install --no-fund --no-audit; '
    } else {
        ""
    }

    # SECURITY: no secrets on the command line - the child inherits this process's
    # environment block (loaded by Import-EnvFile) automatically.
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

    $services = @()
    foreach ($name in $ServiceDefs.Keys) {
        $def = $ServiceDefs[$name]
        $services += @{
            Name      = $name
            HealthUrl = "http://localhost:$($def.HostPort)$($def.HealthPath)"
            Timeout   = 90
        }
    }
    if (-not $SkipFrontend) {
        $services += @{
            Name      = "frontend"
            HealthUrl = "http://localhost:$FrontendPort"
            Timeout   = 120
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
        @{ Name = "Frontend";          Url = "http://localhost:3000";  Key = "frontend" }
        @{ Name = "API Gateway";       Url = "http://localhost:5132";  Key = "api-gateway" }
        @{ Name = "Auth API";          Url = "http://localhost:5031";  Key = "auth-api" }
        @{ Name = "Category API";      Url = "http://localhost:5281";  Key = "category-api" }
        @{ Name = "Todo API";          Url = "http://localhost:5100";  Key = "todo-api" }
        @{ Name = "Collaboration API"; Url = "http://localhost:5060";  Key = "collaboration-api" }
        @{ Name = "Messaging API";     Url = "http://localhost:5058";  Key = "messaging-api" }
        @{ Name = "Realtime API";      Url = "http://localhost:5032";  Key = "realtime-api" }
        @{ Name = "RabbitMQ UI";       Url = "http://localhost:15672"; Key = $null }
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
        $row = "  $statusIcon  $($s.Name.PadRight(18)) $($s.Url)"
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
    Write-Info "Ctrl+C stops the host frontend (Docker containers keep running)."
    Write-Info "Stop everything: .\Start-Planora-Docker.ps1 -Stop"
    Write-Host ""
}

# ---------------------------------------------------------------------------
#  Stop the Docker stack (containers + network), preserving data volumes
# ---------------------------------------------------------------------------
function Stop-DockerStack {
    Write-Step "Stopping Docker stack (docker compose down, volumes preserved)..."
    $null = docker compose -f $ComposeFile down --remove-orphans 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Containers and network removed (data volumes intact)"
    } else {
        Write-Warn "docker compose down reported warnings (continuing)"
    }
}

# ---------------------------------------------------------------------------
#  Graceful shutdown (Ctrl+C): stop the host frontend; containers keep running
# ---------------------------------------------------------------------------
$global:ShuttingDown = $false

function Invoke-GracefulShutdown {
    if ($global:ShuttingDown) { return }
    $global:ShuttingDown = $true
    Write-Host ""
    Write-Step "Shutting down Planora frontend (Docker)..."

    # Stop the locally-running frontend on its port first, then by PID file.
    $owner = Get-PortOwner -Port $FrontendPort
    if ($owner -and $owner.IsPlanora) {
        Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
    }
    $null = Stop-ServiceByPid -ServiceName "frontend" -Force -GracePeriodSeconds 5 -Quiet

    # Clear PID files
    Clear-PidDirectory

    Write-OK "Host frontend stopped"
    Write-Info "Docker containers are still running. To stop them:"
    Write-Info "  .\Start-Planora-Docker.ps1 -Stop   (or)   docker compose -f `"$ComposeFile`" down"
    Write-Host ""

    try { Stop-Transcript | Out-Null } catch {}
}

$null = Register-EngineEvent PowerShell.Exiting -Action { Invoke-GracefulShutdown }

# ===========================================================================
#  ENTRY POINT
# ===========================================================================
$modeLabel = if ($Stop) { "Stop" } elseif ($Clean) { "CLEAN REBUILD" } else { "Fresh Restart" }
Show-Header "Planora - Docker Launcher [$modeLabel]"

Write-Info "Log file: $LogFile"
Write-Host ""

Set-Location -LiteralPath $RepoRoot

try {
    Import-LauncherModules
} catch {
    Write-Fail $_
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

# -- -Stop: stop host frontend + Docker stack, then exit ---------------------
if ($Stop) {
    $global:ShuttingDown = $true   # prevent the exit handler from re-running the frontend-only path
    Write-Step "Stopping the host frontend..."
    $owner = Get-PortOwner -Port $FrontendPort
    if ($owner -and $owner.IsPlanora) {
        Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
    }
    $null = Stop-ServiceByPid -ServiceName "frontend" -Force -GracePeriodSeconds 5 -Quiet
    Clear-PidDirectory
    Stop-DockerStack
    Write-OK "Shutdown complete"
    try { Stop-Transcript | Out-Null } catch {}
    exit 0
}

# Load .env into process environment so JWT_SECRET etc. are available
Import-EnvFile

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

# -- Step 2: Stop existing host processes ------------------------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
Stop-PlanoraProcesses

# -- Step 3: Clean rebuild (if -Clean) ---------------------------------------
if ($Clean) {
    Write-Host ""
    Write-Step "CLEAN mode - stopping containers and rebuilding images (data preserved)..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

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

# -- Step 9: Start frontend on the host --------------------------------------
if ($SkipFrontend) {
    Write-Host ""
    Write-Warn "SkipFrontend specified - frontend will not be started"
} else {
    Write-Host ""
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
    Start-Frontend
    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Frontend launch triggered ($($elapsed)s)"
}

# -- Step 10: Wait for all health endpoints ----------------------------------
Write-Host ""
$healthResults = Invoke-AllHealthChecks

# -- Step 11: Open browser (if frontend is healthy) --------------------------
$frontendHealthy = $healthResults | Where-Object { $_.ServiceName -eq "frontend" -and $_.Status -eq "Healthy" }
if ($frontendHealthy -and -not $ExitAfterHealthCheck -and -not $NoBrowser -and -not $SkipFrontend) {
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

if ($ExitAfterHealthCheck) {
    Write-Info "ExitAfterHealthCheck specified; shutting down the frontend after verification."
    $exitCode = if ($Failures.Count -gt 0) { 1 } else { 0 }
    Invoke-GracefulShutdown
    exit $exitCode
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
