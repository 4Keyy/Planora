<#
.SYNOPSIS
    Planora Local Launcher - runs the full stack on Windows: infrastructure in Docker,
    every .NET backend service + the API gateway, and the Next.js frontend as host
    processes, with health-gated startup and a clean shutdown path.

.DESCRIPTION
    One command brings up the whole stack. Infrastructure (PostgreSQL, Redis, RabbitMQ)
    runs in Docker; the .NET services, the Ocelot API gateway and the Next.js frontend run
    directly on the host via `dotnet run` / `npm run dev`.

    Startup pipeline:
      1.  Preflight       - verifies the .NET 10 SDK (auto-resolves/installs a side-by-side
                            copy under %USERPROFILE%\.dotnet if the system dotnet is older),
                            Node, npm, the Docker engine (auto-starts Docker Desktop and waits
                            up to 60s), and a valid .env with a >=32-char JWT_SECRET.
      1b. LAN setup       - only with -Lan (see that parameter).
      2.  Stop existing   - kills any prior Planora processes (PID files first, then a
                            port-based sweep) and frees their ports.
      3.  Clean           - only with -Clean (see that parameter).
      4.  Infrastructure  - `docker compose up -d postgres redis rabbitmq`, then waits for
                            each container's health check.
      5.  Build           - builds Planora.sln once (skipped with -SkipBuild).
      6.  Backend         - launches each service in dependency order as a hidden background
                            process (--no-build --no-launch-profile); ports come from each
                            service's appsettings Kestrel config (the gateway binds 0.0.0.0).
      7.  Frontend        - `npm run dev -- -H 0.0.0.0` (skipped with -SkipFrontend), so it is
                            reachable from other devices on the LAN.
      8.  Health checks   - polls every /health endpoint (and the frontend) until healthy.
      9.  Browser         - opens http://localhost:3000 (unless -NoBrowser / -SkipFrontend /
                            -ExitAfterHealthCheck).
      10. Summary         - prints a status table (and, with -Lan, the shareable URL).

    Database schema: each service creates/ensures its own schema on first startup - this
    launcher does NOT run a separate migration step. Application data in the Docker volumes
    is preserved across every run (including -Clean); only `.\Start-Planora-Docker.ps1` /
    `docker compose down -v` removes volumes.

    Ports (REST, +gRPC sidecar where present): auth 5030 (+5031), category 5281 (+5282),
    todo 5100 (+5101), collaboration 5060, messaging 5058, realtime 5032, gateway 5132,
    frontend 3000. Infrastructure (host-mapped): PostgreSQL 5433, Redis 6379, RabbitMQ 5672
    (management UI 15672).

    Secrets: .env values are loaded into THIS process's environment block only and inherited
    by the child service processes - they never appear on a child command line or in the
    transcript. ASP.NET Core config keys are mirrored from the docker-compose mappings
    (e.g. JWT_SECRET -> JwtSettings__Secret), and Redis/RabbitMQ/Database connection strings
    are rewritten to the host-mapped localhost ports.

    Logs & lifecycle: a transcript plus per-service logs are written under .\logs; process
    IDs are tracked in PID files. The script stays in the foreground - press Ctrl+C for a
    graceful shutdown that stops the frontend, then the services in reverse start order, and
    clears the PID files (infrastructure containers and data volumes are left running/intact).

    Requirements: Windows PowerShell 5.1+ or PowerShell 7+, Docker Desktop, Node.js + npm,
    and a .NET 10 SDK (auto-installed locally if missing).

.PARAMETER Clean
    Kill processes, wipe all bin/obj/.next build artifacts, run `dotnet restore`, rebuild the
    infrastructure Docker images with --no-cache, then start everything. Forces a fully clean
    build. Database volumes are NOT touched - application data is preserved.

.PARAMETER ExitAfterHealthCheck
    Start everything, verify health endpoints, then shut down. Intended for
    CI / smoke tests. Exit code is non-zero if any service failed its check.

.PARAMETER SkipFrontend
    Start the backend stack only; do not launch the Next.js frontend.

.PARAMETER NoBrowser
    Do not open the browser automatically once the frontend is healthy.

.PARAMETER SkipBuild
    Skip the dotnet build step and start services from existing output
    (--no-build). Fastest option when only restarting unchanged binaries.

.PARAMETER Stop
    Stop every Planora process this launcher started (backend services and the
    frontend), free their ports, and clear stale PID files. Infrastructure
    containers and all data volumes are left untouched.

.PARAMETER Lan
    Share the running app on the local Wi-Fi/LAN. Detects the host's physical LAN
    IPv4 (ignoring any VPN virtual adapter, so a split-tunnel VPN does not interfere),
    opens the Windows Firewall for the frontend (3000) and API gateway (5132) ports
    (inbound, LocalSubnet only - one UAC prompt if not already elevated), and prints
    the shareable http://<lan-ip>:3000 URL. The frontend already binds 0.0.0.0 and the
    client auto-targets the gateway on the same host it was opened from, so a teammate
    just opens that URL in their browser.

.PARAMETER Help
    Print usage and exit without starting anything. No log file is created.

.EXAMPLE
    .\Start-Planora-Local.ps1
    Fresh restart from the current compiled binaries (rebuilds the solution). Data preserved.

.EXAMPLE
    .\Start-Planora-Local.ps1 -Clean
    Full clean rebuild: wipe bin/obj/.next, restore, rebuild infra images. Data preserved.

.EXAMPLE
    .\Start-Planora-Local.ps1 -SkipBuild
    Fastest restart - reuse existing build output (services start with --no-build).

.EXAMPLE
    .\Start-Planora-Local.ps1 -SkipFrontend -NoBrowser
    Backend + gateway only, no frontend, no browser window (e.g. when running the UI separately).

.EXAMPLE
    .\Start-Planora-Local.ps1 -Lan
    Start the stack and share it on the Wi-Fi/LAN: opens the firewall and prints the URL teammates open.

.EXAMPLE
    .\Start-Planora-Local.ps1 -ExitAfterHealthCheck
    CI / smoke test: start, verify every health endpoint, then shut down. Non-zero exit on any failure.

.EXAMPLE
    .\Start-Planora-Local.ps1 -Stop
    Stop everything this launcher started and free the ports. Infra containers/volumes are left intact.

.NOTES
    - All shell behaviour is Windows PowerShell-compatible.
    - Companion script: .\Start-Planora-Docker.ps1 runs the entire stack (services included)
      inside Docker; this launcher instead runs the services on the host for fast iteration.
    - Logs: .\logs\startup-<timestamp>.log (transcript) plus .\logs\<service>-<timestamp>.log.
#>
param(
    # Wipe bin/obj/.next, restore, and rebuild images with --no-cache. Data volumes preserved.
    [switch]$Clean,
    # Start everything, verify health, then shut down (used by CI / smoke tests).
    [switch]$ExitAfterHealthCheck,
    # Do not start the Next.js frontend (backend-only run).
    [switch]$SkipFrontend,
    # Do not open the browser once the frontend is healthy.
    [switch]$NoBrowser,
    # Reuse existing build output - skip the dotnet build step (fastest iteration).
    [switch]$SkipBuild,
    # Stop everything this launcher started, then exit (no startup).
    [switch]$Stop,
    # Open the Windows Firewall for the frontend + gateway ports and print a shareable
    # LAN URL, so another device on the same Wi-Fi can use the app while this runs.
    [switch]$Lan,
    # Print usage and exit.
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
#  Script root (module imports happen after transcript starts - see below)
# ---------------------------------------------------------------------------
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

function Convert-EnvValueForLocal {
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Value
    )

    if ($Key -eq "REDIS_PASSWORD") {
        return $Value
    }

    if ($Key -match ".*Redis.*" -or $Key -match ".*redis.*" -or $Key -eq "REDIS_CONNECTION") {
        $localValue = $Value -replace 'redis:', 'localhost:'
        if ($localValue -notmatch 'abortConnect') {
            $localValue = "$localValue,abortConnect=false"
        }
        return $localValue
    }

    if ($Key -match ".*RabbitMq.*" -or $Key -match ".*rabbitmq.*") {
        return ($Value -replace 'rabbitmq:', 'localhost:')
    }

    if ($Key -match ".*Database.*" -or $Key -match ".*database.*") {
        $localValue = $Value -replace 'Host=postgres', 'Host=localhost'
        if ($localValue -notmatch 'Port=5433') {
            $localValue = $localValue -replace 'Port=5432', 'Port=5433'
        }
        return $localValue
    }

    return $Value
}

function Get-LocalRedisConnectionString {
    $redisPassword = [System.Environment]::GetEnvironmentVariable("REDIS_PASSWORD", "Process")
    if ([string]::IsNullOrWhiteSpace($redisPassword)) {
        return "localhost:6379,abortConnect=false"
    }

    return "localhost:6379,password=$redisPassword,abortConnect=false"
}

function Set-LocalRedisConnectionEnvironment {
    $redisConnection = Get-LocalRedisConnectionString
    [System.Environment]::SetEnvironmentVariable("ConnectionStrings__Redis", $redisConnection, "Process")
    [System.Environment]::SetEnvironmentVariable("Redis__Configuration", $redisConnection, "Process")
    [System.Environment]::SetEnvironmentVariable("REDIS_CONNECTION", $redisConnection, "Process")
}

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
    Write-Host "${BOLD}Planora Local Launcher${RESET}"
    Write-Host "  Runs the full stack on Windows: PostgreSQL/Redis/RabbitMQ in Docker, and every"
    Write-Host "  .NET service + the API gateway + the Next.js frontend as host processes."
    Write-Host "  Health-gated startup; Ctrl+C performs a graceful shutdown. Data volumes are preserved."
    Write-Host ""
    Write-Host "${BOLD}USAGE${RESET}"
    Write-Host "  .\Start-Planora-Local.ps1 [-Clean] [-SkipBuild] [-SkipFrontend] [-NoBrowser]"
    Write-Host "                            [-Lan] [-ExitAfterHealthCheck] [-Stop] [-Help]"
    Write-Host ""
    Write-Host "${BOLD}OPTIONS${RESET}"
    Write-Host "  -Clean                 Wipe bin/obj/.next, restore, rebuild infra images (data preserved)."
    Write-Host "  -SkipBuild             Reuse existing build output - skip 'dotnet build' (fastest restart)."
    Write-Host "  -SkipFrontend          Start the backend + gateway only; do not start the frontend."
    Write-Host "  -NoBrowser             Do not open the browser when the frontend is ready."
    Write-Host "  -Lan                   Share on the Wi-Fi/LAN: open the firewall + print the share URL."
    Write-Host "  -ExitAfterHealthCheck  Start, verify every health endpoint, then shut down (CI / smoke test)."
    Write-Host "  -Stop                  Stop everything this launcher started and free the ports, then exit."
    Write-Host "  -Help                  Show this help and exit (no log file created)."
    Write-Host ""
    Write-Host "${BOLD}URLS${RESET}  (default ports)"
    Write-Host "  Frontend  http://localhost:3000        API gateway  http://localhost:5132"
    Write-Host "  RabbitMQ UI http://localhost:15672     Per-service /health on 5030/5281/5100/5060/5058/5032"
    Write-Host ""
    Write-Host "${BOLD}EXAMPLES${RESET}"
    Write-Host "  .\Start-Planora-Local.ps1                 # fresh restart (rebuild), data preserved"
    Write-Host "  .\Start-Planora-Local.ps1 -SkipBuild      # fastest restart, reuse existing build"
    Write-Host "  .\Start-Planora-Local.ps1 -Clean          # full clean rebuild"
    Write-Host "  .\Start-Planora-Local.ps1 -Lan            # also share on the Wi-Fi/LAN"
    Write-Host "  .\Start-Planora-Local.ps1 -SkipFrontend -NoBrowser"
    Write-Host "  .\Start-Planora-Local.ps1 -Stop           # stop everything this launcher started"
    Write-Host "  Get-Help .\Start-Planora-Local.ps1 -Full  # full annotated help"
    Write-Host ""
    Write-Host "  Tip: .\Start-Planora-Docker.ps1 runs the entire stack inside Docker instead."
    Write-Host ""
}

# ---------------------------------------------------------------------------
#  Global state
# ---------------------------------------------------------------------------
$RepoRoot    = $ScriptRoot
$LogDir      = Join-Path $RepoRoot "logs"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
$FrontendDir = Join-Path $RepoRoot "frontend"
$Failures    = [System.Collections.Generic.List[string]]::new()
$totalTimer  = [System.Diagnostics.Stopwatch]::StartNew()
# Host LAN IPv4 resolved when -Lan is used; shown in the summary as the shareable URL.
$script:LanShareIp = $null

# Service definitions in dependency/startup order - name => project path (relative),
# REST Port, optional gRPC sidecar port (GrpcPort), and health path.
#
# Order matters: services that other services call over gRPC start first.
# Collaboration is a gRPC *client* of Auth (5031) and Todo (5101), so it is listed
# after both. The API gateway is last. Graceful shutdown reverses this order, and
# every port list below is derived from these defs so they can never drift.
$ServiceDefs = [ordered]@{
    "auth-api"          = @{
        Project    = "Services/AuthApi/Planora.Auth.Api/Planora.Auth.Api.csproj"
        Port       = 5030
        GrpcPort   = 5031
        HealthPath = "/health"
    }
    "category-api"      = @{
        Project    = "Services/CategoryApi/Planora.Category.Api/Planora.Category.Api.csproj"
        Port       = 5281
        GrpcPort   = 5282
        HealthPath = "/health"
    }
    "todo-api"          = @{
        Project    = "Services/TodoApi/Planora.Todo.Api/Planora.Todo.Api.csproj"
        Port       = 5100
        GrpcPort   = 5101
        HealthPath = "/health"
    }
    "collaboration-api" = @{
        Project    = "Services/CollaborationApi/Planora.Collaboration.Api/Planora.Collaboration.Api.csproj"
        Port       = 5060
        HealthPath = "/health"
    }
    "messaging-api"     = @{
        Project    = "Services/MessagingApi/Planora.Messaging.Api/Planora.Messaging.Api.csproj"
        Port       = 5058
        HealthPath = "/health"
    }
    "realtime-api"      = @{
        Project    = "Services/RealtimeApi/Planora.Realtime.Api/Planora.Realtime.Api.csproj"
        Port       = 5032
        HealthPath = "/health"
    }
    "api-gateway"       = @{
        Project    = "Planora.ApiGateway/Planora.ApiGateway.csproj"
        Port       = 5132
        HealthPath = "/health"
    }
}

$FrontendPort = 3000

# Derived, single-source-of-truth port lists (no hand-maintained duplicates).
$ServiceRestPorts = @($ServiceDefs.Values | ForEach-Object { $_.Port })
$ServiceGrpcPorts = @(foreach ($d in $ServiceDefs.Values) { if ($d.Contains('GrpcPort')) { $d.GrpcPort } })
# Every port the launcher owns - used by stop/cleanup fallbacks to find orphans.
$AllPlanoraPorts  = @($ServiceRestPorts + $ServiceGrpcPorts + $FrontendPort)
# Service names in reverse startup order, for graceful shutdown.
$ShutdownOrder    = @($ServiceDefs.Keys) ; [array]::Reverse($ShutdownOrder)

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
#  Helper module imports
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
#  LAN sharing helpers (-Lan)
# ---------------------------------------------------------------------------

# Resolve the host's LAN IPv4. Get-NetAdapter -Physical lists only real NICs, so a VPN's
# virtual adapter (split-tunnel or not) is ignored and we never hand out the tunnel address.
# We then keep RFC1918 private addresses only, preferring Wi-Fi, then a 192.168.x address.
function Get-LanIPv4 {
    try {
        $upPhysical = Get-NetAdapter -Physical -ErrorAction Stop | Where-Object { $_.Status -eq 'Up' }
    } catch {
        $upPhysical = $null
    }

    $candidates = @()
    if ($upPhysical) {
        $idx = @($upPhysical | Select-Object -ExpandProperty ifIndex)
        $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $idx -contains $_.InterfaceIndex }
    }
    if (-not $candidates) {
        # Fallback: any IPv4 that is not loopback or APIPA.
        $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' }
    }

    $private = @($candidates | Where-Object {
        $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
    })
    if ($private.Count -eq 0) { return $null }

    $best = $private |
        Sort-Object `
            @{ Expression = { [int]([bool]($_.InterfaceAlias -match 'Wi-?Fi|Wireless|WLAN')) }; Descending = $true }, `
            @{ Expression = { [int]($_.IPAddress -like '192.168.*') }; Descending = $true } |
        Select-Object -First 1
    return $best.IPAddress
}

function Test-IsAdministrator {
    return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Open an inbound TCP allow rule for the given ports, scoped to the local subnet only
# (so it is reachable by Wi-Fi peers but never from the wider internet) and on every
# firewall profile (a VPN often flips the active adapter to the Public profile). Idempotent:
# the rule is removed then recreated. Self-elevates a single time if not already admin.
function Enable-LanFirewall {
    param([int[]]$Ports)

    $ruleName = "Planora LAN (local dev)"
    $portCsv  = ($Ports -join ',')

    if (Test-IsAdministrator) {
        try {
            Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
                -Protocol TCP -LocalPort $Ports -Profile Any -RemoteAddress LocalSubnet `
                -ErrorAction Stop | Out-Null
            Write-OK "Firewall opened (inbound TCP $portCsv, LocalSubnet only)"
            return $true
        } catch {
            Write-Warn "Could not create the firewall rule: $($_.Exception.Message)"
            return $false
        }
    }

    Write-Info "Requesting administrator rights to open the firewall (one UAC prompt)..."
    $inner = "Remove-NetFirewallRule -DisplayName '$ruleName' -ErrorAction SilentlyContinue; " +
             "New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow " +
             "-Protocol TCP -LocalPort $portCsv -Profile Any -RemoteAddress LocalSubnet | Out-Null"
    try {
        $p = Start-Process powershell -Verb RunAs -WindowStyle Hidden -PassThru -Wait `
            -ArgumentList @("-NoProfile", "-NonInteractive", "-Command", $inner) -ErrorAction Stop
        if ($p.ExitCode -eq 0) {
            Write-OK "Firewall opened (inbound TCP $portCsv, LocalSubnet only)"
            return $true
        }
        Write-Warn "Firewall rule command exited with code $($p.ExitCode)"
    } catch {
        Write-Warn "Firewall rule was not created (UAC declined or blocked)."
        Write-Info "Run this once in an elevated PowerShell, then retry -Lan:"
        Write-Info "  New-NetFirewallRule -DisplayName '$ruleName' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $portCsv -Profile Any -RemoteAddress LocalSubnet"
    }
    return $false
}

# ---------------------------------------------------------------------------
#  .NET 10 SDK resolution
#
#  The backend targets net10.0. A machine whose default `dotnet` is still .NET 9
#  cannot build it (NU1202). This resolves a .NET 10 SDK in priority order and
#  puts it on PATH for this process (inherited by the `dotnet run` children):
#    1. the system `dotnet` already exposes a 10.x SDK -> use it as-is;
#    2. a side-by-side SDK under %USERPROFILE%\.dotnet -> prepend it to PATH;
#    3. otherwise auto-install one there (one-time, ~250 MB) via the official script.
# ---------------------------------------------------------------------------
function Test-DotnetHasSdk10 {
    param([string]$DotnetExe = "dotnet")
    try { $sdks = & $DotnetExe --list-sdks 2>$null } catch { return $false }
    return [bool]($sdks | Where-Object { $_ -match '^\s*10\.' })
}

function Resolve-DotnetSdk10 {
    if (Test-DotnetHasSdk10 "dotnet") { return $true }

    $localRoot = Join-Path $env:USERPROFILE ".dotnet"
    $localExe  = Join-Path $localRoot "dotnet.exe"

    if ((Test-Path $localExe) -and (Test-DotnetHasSdk10 $localExe)) {
        $env:DOTNET_ROOT = $localRoot
        $env:PATH = "$localRoot;$env:PATH"
        Write-Info "Using .NET 10 SDK from $localRoot"
        return $true
    }

    Write-Warn ".NET 10 SDK not found - installing a local copy to $localRoot (one-time, ~250 MB)..."
    try {
        $installer = Join-Path $env:TEMP "dotnet-install.ps1"
        Invoke-WebRequest -Uri "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer -UseBasicParsing -TimeoutSec 60
        & $installer -Channel 10.0 -InstallDir $localRoot -NoPath | Out-Null
    } catch {
        Write-Fail ".NET 10 SDK auto-install failed: $($_.Exception.Message)"
        Write-Info "  Install it manually, then retry:  winget install Microsoft.DotNet.SDK.10"
        return $false
    }

    if ((Test-Path $localExe) -and (Test-DotnetHasSdk10 $localExe)) {
        $env:DOTNET_ROOT = $localRoot
        $env:PATH = "$localRoot;$env:PATH"
        Write-OK ".NET 10 SDK installed at $localRoot"
        return $true
    }

    Write-Fail ".NET 10 SDK is still unavailable after the install attempt."
    Write-Info "  Install it manually, then retry:  winget install Microsoft.DotNet.SDK.10"
    return $false
}

# ---------------------------------------------------------------------------
#  Preflight checks
# ---------------------------------------------------------------------------
function Invoke-PreflightChecks {
    Write-Step "Running preflight checks..."
    $ok = $true

    # dotnet CLI + .NET 10 SDK (the backend targets net10.0)
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        Write-Fail "dotnet CLI not found - install from https://dot.net"
        $ok = $false
    } elseif (-not (Resolve-DotnetSdk10)) {
        Write-Fail ".NET 10 SDK is required - the backend targets net10.0"
        $ok = $false
    } else {
        $ver = (& dotnet --version 2>&1)
        Write-OK "dotnet $ver"
    }

    # node
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Warn "node not found - frontend will not start (install from https://nodejs.org)"
    } else {
        $nver = (& node --version 2>&1)
        Write-OK "node $nver"
    }

    # npm
    $npmExe = Get-NpmExecutable
    if (-not $npmExe) {
        Write-Warn "npm not found - frontend will not start"
    } else {
        # Use -v (short flag) - --version can print full help on some Windows installs
        $npmVer = (& $npmExe -v 2>$null) | Where-Object { $_ -match '^\d+\.\d+\.\d+' } | Select-Object -First 1
        if (-not $npmVer) { $npmVer = "(unknown)" }
        Write-OK "npm $npmVer"
    }

    # Docker CLI - auto-start engine if stopped, wait up to 60s
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Fail "docker not found - install Docker Desktop from https://docker.com"
        $ok = $false
    } else {
        $dockerOk = $false
        # Quick first check
        $null = docker ps 2>&1
        if ($LASTEXITCODE -eq 0) {
            $dockerOk = $true
        } else {
            # Engine is stopped - try to start Docker Desktop GUI which will bring up the engine
            Write-Warn "Docker engine not running - attempting to start Docker Desktop..."
            $ddExe = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
            if (Test-Path $ddExe) {
                Start-Process $ddExe -WindowStyle Hidden -ErrorAction SilentlyContinue
            } else {
                # Try to start via the desktop-linux context switch as a nudge
                $null = docker context use desktop-linux 2>&1
            }
            # Wait up to 60 seconds for the engine to come up
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

    return $ok
}

# ---------------------------------------------------------------------------
#  Stop existing Planora processes
# ---------------------------------------------------------------------------
function Stop-PlanoraProcesses {
    Write-Step "Stopping existing Planora processes..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    # Phase 1: stop via PID files (targeted, safe)
    $null = Stop-AllServices -Force -GracePeriodSeconds 8 -Quiet

    # Phase 2: port-based fallback for anything not in PID files
    foreach ($port in $AllPlanoraPorts) {
        $owner = Get-PortOwner -Port $port
        if ($owner -and $owner.IsPlanora) {
            Write-Info "Stopping PID $($owner.Pid) ($($owner.ProcessName)) on port $port"
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
        }
    }

    # Shut down .NET build server to release file locks
    if (Get-Command dotnet -ErrorAction SilentlyContinue) {
        Write-Info "Shutting down .NET build servers..."
        & dotnet build-server shutdown 2>&1 | Out-Null
    }

    # Wait for every REST port (plus frontend) to be free before proceeding.
    foreach ($name in $ServiceDefs.Keys) {
        $null = Wait-PortFree -Port $ServiceDefs[$name].Port -ServiceName $name -TimeoutSeconds 15
    }
    $null = Wait-PortFree -Port $FrontendPort -ServiceName "frontend" -TimeoutSeconds 15

    # Clean up stale PID files now that everything is stopped
    Clear-PidDirectory

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "All Planora processes stopped ($($elapsed)s)"
}

# ---------------------------------------------------------------------------
#  Clean build artifacts (bin/obj/.next) - does NOT touch data volumes
# ---------------------------------------------------------------------------
function Remove-BuildArtifacts {
    Write-Step "Removing bin/obj build artifacts..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
    $count = 0

    $roots = @(
        (Join-Path $RepoRoot "Services"),
        (Join-Path $RepoRoot "Planora.ApiGateway"),
        (Join-Path $RepoRoot "BuildingBlocks")
    )
    foreach ($base in $roots) {
        if (-not (Test-Path $base)) { continue }
        Get-ChildItem -Path $base -Directory -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq "bin" -or $_.Name -eq "obj" } |
            ForEach-Object {
                try {
                    Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction Stop
                    $count++
                } catch {
                    Write-Warn "Could not remove $($_.FullName): $_"
                }
            }
    }

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Removed $count bin/obj directories ($($elapsed)s)"

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
}

# ---------------------------------------------------------------------------
#  dotnet restore for all projects
# ---------------------------------------------------------------------------
function Invoke-DotnetRestore {
    Write-Step "Running dotnet restore..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    $sln = Join-Path $RepoRoot "Planora.sln"
    if (Test-Path $sln) {
        & dotnet restore $sln --verbosity minimal 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "dotnet restore had warnings - check build output"
        } else {
            $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
            Write-OK "dotnet restore complete ($($elapsed)s)"
        }
    } else {
        Write-Warn "Planora.sln not found - skipping restore"
    }
}

# ---------------------------------------------------------------------------
#  Build backend projects once to avoid parallel dotnet run build contention
# ---------------------------------------------------------------------------
function Invoke-DotnetBackendBuild {
    Write-Step "Building .NET backend services..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    # PERF: build the whole solution in a single dotnet invocation. MSBuild resolves
    # the project dependency graph and compiles shared projects (BuildingBlocks) once,
    # in parallel where possible - far faster than 6 sequential per-project builds that
    # each re-evaluate the same shared references.
    $sln = Join-Path $RepoRoot "Planora.sln"
    if (Test-Path $sln) {
        & dotnet build $sln --configuration Debug --verbosity minimal 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Solution build failed - inspect the errors above"
            return $false
        }
        $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
        Write-OK ".NET backend build complete ($($elapsed)s)"
        return $true
    }

    # Fallback: no solution file - build each service project individually.
    foreach ($name in $ServiceDefs.Keys) {
        $def = $ServiceDefs[$name]
        $projectPath = Join-Path $RepoRoot $def.Project

        if (-not (Test-Path $projectPath)) {
            Write-Fail "$($name): project file not found at $projectPath"
            return $false
        }

        Write-Info "Building $name..."
        & dotnet build $projectPath --configuration Debug --verbosity minimal 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "$($name): dotnet build failed"
            return $false
        }
    }

    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK ".NET backend build complete ($($elapsed)s)"
    return $true
}

# ---------------------------------------------------------------------------
#  Load .env into process environment
# ---------------------------------------------------------------------------
function Import-EnvFile {
    $envFile = Join-Path $RepoRoot ".env"
    if (-not (Test-Path $envFile)) { return }

    # SECURITY: load every secret into the *parent* process environment block only.
    # Child service processes (dotnet run, npm) are launched with Start-Process and
    # inherit this block automatically — so secrets never appear on a child process
    # command line (visible via Get-CimInstance Win32_Process) nor in the transcript.
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
            $k = $Matches[1].Trim()
            $v = Convert-EnvValueForLocal -Key $k -Value $Matches[2].Trim()
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")

            # Mirror docker-compose.yml env var mappings so `dotnet run` on the host
            # receives the same ASP.NET Core config key names the containers get.
            switch ($k) {
                "JWT_SECRET"        { [System.Environment]::SetEnvironmentVariable("JwtSettings__Secret",    $v, "Process") }
                "GRPC_SERVICE_KEY"  { [System.Environment]::SetEnvironmentVariable("GrpcSettings__ServiceKey", $v, "Process") }
                "RABBITMQ_USER"     { [System.Environment]::SetEnvironmentVariable("RabbitMq__UserName",      $v, "Process") }
                "RABBITMQ_PASSWORD" { [System.Environment]::SetEnvironmentVariable("RabbitMq__Password",      $v, "Process") }
            }
        }
    }

    # ASP.NET Core environment + local Redis connection (host-mapped ports).
    [System.Environment]::SetEnvironmentVariable("ASPNETCORE_ENVIRONMENT", "Development", "Process")
    Set-LocalRedisConnectionEnvironment
}

# ---------------------------------------------------------------------------
#  Infrastructure startup (infra always runs in Docker)
# ---------------------------------------------------------------------------
function Start-Infrastructure {
    Write-Step "Starting infrastructure containers..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    # Start only the three infra containers
    $null = docker compose -f $ComposeFile up -d postgres redis rabbitmq 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "docker compose up for infrastructure failed"
        return $false
    }

    # Wait for each with exponential backoff
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
#  Start a single .NET backend service as a hidden background process
# ---------------------------------------------------------------------------
function Start-DotnetService {
    param(
        [string]$Name,
        [string]$ProjectRelPath,
        [int]$Port,
        [string]$HealthPath
    )

    $projectPath = Join-Path $RepoRoot $ProjectRelPath
    if (-not (Test-Path $projectPath)) {
        Write-Warn "$($Name): project file not found at $projectPath - skipping"
        return
    }

    $ts      = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $svcLog  = Join-Path $LogDir "$Name-$ts.log"

    # SECURITY: no secrets are embedded in this command line. All env vars
    # (JWT secret, gRPC key, RabbitMQ creds, Redis connection, ASP.NET env)
    # were loaded into this process's environment block by Import-EnvFile and
    # are inherited automatically by the child process below.
    $cmd = 'dotnet run --project "' + $projectPath + '" --no-launch-profile --no-build 2>&1 | Tee-Object -FilePath "' + $svcLog + '"'

    $proc = Start-Process powershell `
        -ArgumentList @("-NoProfile", "-NonInteractive", "-Command", $cmd) `
        -WorkingDirectory $RepoRoot `
        -PassThru `
        -WindowStyle Hidden

    if ($proc) {
        Write-ServicePid -ServiceName $Name -ProcessId $proc.Id
        Write-OK "$Name starting (PID $($proc.Id), port $Port)"
        Write-Info "Log: $svcLog"
    } else {
        $Failures.Add("$($Name): Start-Process returned null")
        Write-Fail "$Name failed to start"
    }
}

# ---------------------------------------------------------------------------
#  Start the Next.js frontend
# ---------------------------------------------------------------------------
function Start-Frontend {
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

    # Use a simpler command for starting the frontend to avoid quoting issues in Start-Process
    $cmd = "cd frontend; $installPart npm run dev -- -H 0.0.0.0 2>&1 | Tee-Object -FilePath ""$fLog"""

    $proc = Start-Process powershell `
        -ArgumentList @("-NoProfile", "-Command", $cmd) `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru

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
#  Health check all services (sequential with backoff via HealthChecker module)
# ---------------------------------------------------------------------------
function Invoke-AllHealthChecks {
    Write-Step "Waiting for all services to become healthy..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    $services = @()
    foreach ($name in $ServiceDefs.Keys) {
        $def = $ServiceDefs[$name]
        $services += @{
            Name      = $name
            HealthUrl = "http://127.0.0.1:$($def.Port)$($def.HealthPath)"
            Timeout   = 120
        }
    }
    if (-not $SkipFrontend) {
        $services += @{
            Name      = "frontend"
            HealthUrl = "http://127.0.0.1:$FrontendPort"
            Timeout   = 180
        }
    }

    $results = Test-AllServicesHealthy -Services $services -OverallTimeoutSeconds 240

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
#  Success summary table
# ---------------------------------------------------------------------------
function Show-Summary {
    param($HealthResults, $TotalSeconds)

    $services = @(
        @{ Name = "Frontend";    Url = "http://localhost:3000";  Key = "frontend" }
        @{ Name = "API Gateway"; Url = "http://localhost:5132";  Key = "api-gateway" }
        @{ Name = "Auth API";    Url = "http://localhost:5030";  Key = "auth-api" }
        @{ Name = "Category API";Url = "http://localhost:5281";  Key = "category-api" }
        @{ Name = "Todo API";    Url = "http://localhost:5100";  Key = "todo-api" }
        @{ Name = "Collaboration API"; Url = "http://localhost:5060"; Key = "collaboration-api" }
        @{ Name = "Messaging API";Url = "http://localhost:5058"; Key = "messaging-api" }
        @{ Name = "Realtime API";Url = "http://localhost:5032";  Key = "realtime-api" }
        @{ Name = "RabbitMQ UI"; Url = "http://localhost:15672"; Key = $null }
    )

    $border = "=" * 58
    Write-Host ""
    Write-Host "${CYAN}  +${border}+${RESET}"
    Write-Host "${CYAN}  |${BOLD}$(("  Planora is Running  [Local Mode]").PadRight(58))${RESET}${CYAN}|${RESET}"
    Write-Host "${CYAN}  +${border}+${RESET}"

    foreach ($s in $services) {
        $r = if ($s.Key) { $HealthResults | Where-Object { $_.ServiceName -eq $s.Key } | Select-Object -First 1 } else { $null }
        $statusIcon = if ($null -eq $r) {
            "${GRAY}~${RESET}"
        } elseif ($r.Status -eq "Healthy") {
            "${GREEN}+${RESET}"
        } else {
            "$($RED)x${RESET}"
        }
        $row = "  $statusIcon  $($s.Name.PadRight(18)) $($s.Url)"
        Write-Host "${CYAN}  |${RESET}$($row.PadRight(58))${CYAN}|${RESET}"
    }

    Write-Host "${CYAN}  +${border}+${RESET}"
    $timeRow = "  Total startup time: $([Math]::Round($TotalSeconds, 1))s"
    Write-Host "${CYAN}  |${RESET}$($timeRow.PadRight(58))${CYAN}|${RESET}"

    if ($Failures.Count -gt 0) {
        $warnRow = "  Warnings: $($Failures.Count) non-fatal issue(s)"
        Write-Host "${CYAN}  |${YELLOW}$($warnRow.PadRight(58))${RESET}${CYAN}|${RESET}"
    }

    Write-Host "${CYAN}  +${border}+${RESET}"
    Write-Host ""
    Write-Info "Log file: $LogFile"
    Write-Info "Ctrl+C to stop all services"
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
    Write-Step "Shutting down Planora (Local)..."

    # dotnet run/npm are launched through wrapper PowerShell processes. Stop the
    # real service processes on their ports first so the wrappers can exit cleanly.
    foreach ($port in $AllPlanoraPorts) {
        $owner = Get-PortOwner -Port $port
        if ($owner -and $owner.IsPlanora) {
            Write-Info "Stopping service PID $($owner.Pid) ($($owner.ProcessName)) on port $port"
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2

    # Stop frontend wrapper first
    $null = Stop-ServiceByPid -ServiceName "frontend" -Force -GracePeriodSeconds 2 -Quiet

    # Stop .NET services in reverse startup order (derived from $ServiceDefs)
    foreach ($name in $ShutdownOrder) {
        $null = Stop-ServiceByPid -ServiceName $name -Force -GracePeriodSeconds 2 -Quiet
    }

    # Final port-based fallback for anything that survived wrapper shutdown.
    foreach ($port in $AllPlanoraPorts) {
        $owner = Get-PortOwner -Port $port
        if ($owner -and $owner.IsPlanora) {
            Write-Info "Stopping leftover PID $($owner.Pid) ($($owner.ProcessName)) on port $port"
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
        }
    }

    # Clear any remaining PID files
    Clear-PidDirectory

    Write-OK "Shutdown complete"
    try { Stop-Transcript | Out-Null } catch {}
}

$null = Register-EngineEvent PowerShell.Exiting -Action { Invoke-GracefulShutdown }

# ===========================================================================
#  ENTRY POINT
# ===========================================================================
$modeLabel = if ($Stop) { "Stop" } elseif ($Clean) { "CLEAN REBUILD" } else { "Fresh Restart" }
Show-Header "Planora - Local Launcher [$modeLabel]"

Write-Info "Log file: $LogFile"
Write-Host ""

Set-Location -LiteralPath $RepoRoot

# Stop mode never touches secrets - it only needs the helper modules.
if (-not $Stop) { Import-EnvFile }

try {
    Import-LauncherModules
} catch {
    Write-Fail $_
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
}

# -- -Stop: tear down everything this launcher started, then exit ------------
if ($Stop) {
    Invoke-GracefulShutdown
    exit 0
}

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

# -- Step 1b: LAN sharing setup (-Lan) ---------------------------------------
if ($Lan) {
    Write-Host ""
    Write-Step "Configuring LAN sharing..."
    $GatewayPort = $ServiceDefs["api-gateway"].Port
    $script:LanShareIp = Get-LanIPv4
    if (-not $script:LanShareIp) {
        Write-Warn "Could not detect a LAN IPv4 (are you connected to Wi-Fi/Ethernet?)."
        Write-Info "Continuing without LAN sharing; the app will still work on localhost."
    } else {
        Write-OK "Host LAN address: $($script:LanShareIp)"
        $null = Enable-LanFirewall -Ports @($FrontendPort, $GatewayPort)
    }
}

# -- Step 2: Stop existing processes -----------------------------------------
Write-Host ""
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
Stop-PlanoraProcesses

# -- Step 3: Clean build artifacts (if -Clean) --------------------------------
if ($Clean) {
    Write-Host ""
    Write-Step "CLEAN mode - removing build artifacts (data volumes preserved)..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

    Remove-BuildArtifacts
    Invoke-DotnetRestore

    # Rebuild Docker images for infra (--no-cache ensures clean layer cache)
    Write-Step "Rebuilding infrastructure Docker images (--no-cache)..."
    $null = docker compose -f $ComposeFile build --no-cache postgres redis rabbitmq 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Infrastructure images rebuilt"
    } else {
        Write-Warn "docker compose build had warnings (continuing)"
    }

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

# -- Step 5: Build .NET backend services -------------------------------------
Write-Host ""
if ($SkipBuild) {
    Write-Warn "SkipBuild specified - reusing existing build output (services start with --no-build)"
} else {
    $backendBuildOk = Invoke-DotnetBackendBuild
    if (-not $backendBuildOk) {
        Write-Fail "Backend build failed. Fix the compilation errors above and retry."
        $Failures.Add("Backend build failed")
        try { Stop-Transcript | Out-Null } catch {}
        exit 1
    }
}

# -- Step 6: Start .NET backend services -------------------------------------
Write-Host ""
Write-Step "Starting .NET backend services..."
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()

foreach ($name in $ServiceDefs.Keys) {
    $def = $ServiceDefs[$name]
    Start-DotnetService -Name $name -ProjectRelPath $def.Project -Port $def.Port -HealthPath $def.HealthPath
}

$elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
Write-OK "All .NET service processes launched ($($elapsed)s)"

# -- Step 7: Start frontend --------------------------------------------------
if ($SkipFrontend) {
    Write-Host ""
    Write-Warn "SkipFrontend specified - frontend will not be started"
} else {
    Write-Host ""
    Write-Step "Starting Next.js frontend..."
    $stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
    Start-Frontend
    $elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
    Write-OK "Frontend launch triggered ($($elapsed)s)"
}

# -- Step 8: Wait for health endpoints ---------------------------------------
Write-Host ""
$healthResults = Invoke-AllHealthChecks

# -- Step 9: Open browser (if frontend is healthy) ---------------------------
$frontendHealthy = $healthResults | Where-Object { $_.ServiceName -eq "frontend" -and $_.Status -eq "Healthy" }
if ($frontendHealthy -and -not $ExitAfterHealthCheck -and -not $NoBrowser -and -not $SkipFrontend) {
    try { Start-Process "http://localhost:3000" | Out-Null } catch {}
}

# -- Step 10: Print summary ---------------------------------------------------
$totalSecs = $totalTimer.Elapsed.TotalSeconds
Show-Summary -HealthResults $healthResults -TotalSeconds $totalSecs

# -- Step 10b: LAN share banner ----------------------------------------------
if ($Lan -and $script:LanShareIp) {
    $border = "=" * 58
    Write-Host ""
    Write-Host "${GREEN}  +${border}+${RESET}"
    Write-Host "${GREEN}  |${BOLD}$(("  Share on your Wi-Fi / LAN").PadRight(58))${RESET}${GREEN}|${RESET}"
    Write-Host "${GREEN}  +${border}+${RESET}"
    $shareUrl = "http://$($script:LanShareIp):$FrontendPort"
    Write-Host "${GREEN}  |${RESET}$(("  Anyone on the same network opens:").PadRight(58))${GREEN}|${RESET}"
    Write-Host "${GREEN}  |${BOLD}$("    $shareUrl".PadRight(58))${RESET}${GREEN}|${RESET}"
    Write-Host "${GREEN}  +${border}+${RESET}"
    Write-Host ""
    Write-Info "The browser auto-targets the API gateway on the same host - nothing to configure on their end."
    Write-Info "If a teammate cannot connect while your VPN is on:"
    Write-Info "  - keep the VPN in split-tunnel mode and allow local/LAN traffic, or"
    Write-Info "  - briefly disable the VPN; inbound LAN reaches your physical Wi-Fi adapter directly."
    Write-Info "Both devices must be on the same Wi-Fi (not a 'guest'/isolated network)."
    Write-Host ""
}

if ($Failures.Count -gt 0) {
    Write-Warn "Completed with $($Failures.Count) issue(s):"
    $Failures | Sort-Object -Unique | ForEach-Object { Write-Warn "  - $_" }
    Write-Info "Tip: run with -Clean to wipe build artifacts and rebuild from scratch"
} else {
    Write-OK "All systems healthy. Planora is running in local mode."
}

if ($ExitAfterHealthCheck) {
    Write-Info "ExitAfterHealthCheck specified; shutting down after verification."
    $exitCode = if ($Failures.Count -gt 0) { 1 } else { 0 }
    Invoke-GracefulShutdown
    exit $exitCode
}

Write-Host ""
Write-Info "Press Ctrl+C to stop all services and exit."
Write-Host ""

try {
    # Keep the script alive so Ctrl+C triggers graceful shutdown
    while ($true) { Start-Sleep -Seconds 5 }
} finally {
    Invoke-GracefulShutdown
}
