<#
.SYNOPSIS
    Planora Local Launcher - starts infrastructure in Docker, backend .NET services
    and the Next.js frontend locally on the host machine.

.DESCRIPTION
    Modes:
      (default)  Kill all existing Planora processes, preserve all data volumes,
                 restart everything fresh from compiled binaries.
      -Clean     Kill processes, wipe all bin/obj/.next build artifacts, dotnet restore,
                 rebuild images with --no-cache, then start everything.
                 Does NOT wipe database volumes - data is preserved.

.PARAMETER Clean
    Wipes code build artifacts (bin/obj/.next) and forces a full rebuild.
    Database volumes are NOT touched.

.EXAMPLE
    .\Start-Planora-Local.ps1
.EXAMPLE
    .\Start-Planora-Local.ps1 -Clean
#>
param(
    [switch]$Clean,
    [switch]$ExitAfterHealthCheck
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

# ---------------------------------------------------------------------------
#  Global state
# ---------------------------------------------------------------------------
$RepoRoot    = $ScriptRoot
$LogDir      = Join-Path $RepoRoot "logs"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
$FrontendDir = Join-Path $RepoRoot "frontend"
$Failures    = [System.Collections.Generic.List[string]]::new()
$totalTimer  = [System.Diagnostics.Stopwatch]::StartNew()

# Service definitions - name => project path (relative), port, health path
$ServiceDefs = [ordered]@{
    "auth-api"      = @{
        Project    = "Services/AuthApi/Planora.Auth.Api/Planora.Auth.Api.csproj"
        Port       = 5030
        HealthPath = "/health"
    }
    "category-api"  = @{
        Project    = "Services/CategoryApi/Planora.Category.Api/Planora.Category.Api.csproj"
        Port       = 5281
        HealthPath = "/health"
    }
    "todo-api"      = @{
        Project    = "Services/TodoApi/Planora.Todo.Api/Planora.Todo.Api.csproj"
        Port       = 5100
        HealthPath = "/health"
    }
    "messaging-api" = @{
        Project    = "Services/MessagingApi/Planora.Messaging.Api/Planora.Messaging.Api.csproj"
        Port       = 5058
        HealthPath = "/health"
    }
    "realtime-api"  = @{
        Project    = "Services/RealtimeApi/Planora.Realtime.Api/Planora.Realtime.Api.csproj"
        Port       = 5032
        HealthPath = "/health"
    }
    "api-gateway"   = @{
        Project    = "Planora.ApiGateway/Planora.ApiGateway.csproj"
        Port       = 5132
        HealthPath = "/health"
    }
}

$FrontendPort = 3000

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
#  Preflight checks
# ---------------------------------------------------------------------------
function Invoke-PreflightChecks {
    Write-Step "Running preflight checks..."
    $ok = $true

    # dotnet CLI
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        Write-Fail "dotnet CLI not found - install from https://dot.net"
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
    $ports = @(5030, 5031, 5100, 5281, 5282, 5058, 5032, 5132, 3000)
    foreach ($port in $ports) {
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

    # Wait for critical ports to be free before proceeding
    $criticalPorts = @(
        @{ Port = 5030; ServiceName = "auth-api" },
        @{ Port = 5100; ServiceName = "todo-api" },
        @{ Port = 5281; ServiceName = "category-api" },
        @{ Port = 5132; ServiceName = "api-gateway" },
        @{ Port = 3000; ServiceName = "frontend" }
    )
    foreach ($entry in $criticalPorts) {
        $null = Wait-PortFree -Port $entry.Port -ServiceName $entry.ServiceName -TimeoutSeconds 15
    }

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
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
            $k = $Matches[1].Trim()
            $v = $Matches[2].Trim()
            $v = Convert-EnvValueForLocal -Key $k -Value $v
            [System.Environment]::SetEnvironmentVariable($k, $v, "Process")
        }
    }
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

    # Build the inline command: set env vars, then start without rebuilding
    $envSetup  = '$env:ASPNETCORE_ENVIRONMENT=''Development''; '

    $envFile = Join-Path $RepoRoot ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)\s*$') {
                $k = $Matches[1].Trim()
                $v = Convert-EnvValueForLocal -Key $k -Value $Matches[2].Trim()
                $v = $v.Replace("'", "''")
                $envSetup += "`$env:$k='$v'; "
            }
        }
    }

    $redisConnection = (Get-LocalRedisConnectionString).Replace("'", "''")
    $envSetup += "`$env:ConnectionStrings__Redis='$redisConnection'; "
    $envSetup += "`$env:Redis__Configuration='$redisConnection'; "
    $envSetup += "`$env:REDIS_CONNECTION='$redisConnection'; "

    $cmd = $envSetup + 'dotnet run --project "' + $projectPath + '" --no-launch-profile --no-build 2>&1 | Tee-Object -FilePath "' + $svcLog + '"'

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
    $services += @{
        Name      = "frontend"
        HealthUrl = "http://127.0.0.1:$FrontendPort"
        Timeout   = 180
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
        $row = "  $statusIcon  $($s.Name.PadRight(16)) $($s.Url)"
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
    $servicePorts = @(3000, 5132, 5032, 5058, 5100, 5281, 5030)
    foreach ($port in $servicePorts) {
        $owner = Get-PortOwner -Port $port
        if ($owner -and $owner.IsPlanora) {
            Write-Info "Stopping service PID $($owner.Pid) ($($owner.ProcessName)) on port $port"
            Stop-Process -Id $owner.Pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 2

    # Stop frontend wrapper first
    $null = Stop-ServiceByPid -ServiceName "frontend" -Force -GracePeriodSeconds 2 -Quiet

    # Stop .NET services in reverse startup order
    foreach ($name in @("api-gateway", "realtime-api", "messaging-api", "todo-api", "category-api", "auth-api")) {
        $null = Stop-ServiceByPid -ServiceName $name -Force -GracePeriodSeconds 2 -Quiet
    }

    # Final port-based fallback for anything that survived wrapper shutdown.
    $ports = @(5030, 5031, 5100, 5281, 5282, 5058, 5032, 5132, 3000)
    foreach ($port in $ports) {
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
$modeLabel = if ($Clean) { "CLEAN REBUILD" } else { "Fresh Restart" }
Show-Header "Planora - Local Launcher [$modeLabel]"

Write-Info "Log file: $LogFile"
Write-Host ""

Set-Location -LiteralPath $RepoRoot
Import-EnvFile

try {
    Import-LauncherModules
} catch {
    Write-Fail $_
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
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
$backendBuildOk = Invoke-DotnetBackendBuild
if (-not $backendBuildOk) {
    Write-Fail "Backend build failed. Fix the compilation errors above and retry."
    $Failures.Add("Backend build failed")
    try { Stop-Transcript | Out-Null } catch {}
    exit 1
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
Write-Host ""
Write-Step "Starting Next.js frontend..."
$stepTimer = [System.Diagnostics.Stopwatch]::StartNew()
Start-Frontend
$elapsed = [Math]::Round($stepTimer.Elapsed.TotalSeconds, 1)
Write-OK "Frontend launch triggered ($($elapsed)s)"

# -- Step 8: Wait for health endpoints ---------------------------------------
Write-Host ""
$healthResults = Invoke-AllHealthChecks

# -- Step 9: Open browser (if frontend is healthy) ---------------------------
$frontendHealthy = $healthResults | Where-Object { $_.ServiceName -eq "frontend" -and $_.Status -eq "Healthy" }
if ($frontendHealthy -and -not $ExitAfterHealthCheck) {
    try { Start-Process "http://localhost:3000" | Out-Null } catch {}
}

# -- Step 10: Print summary ---------------------------------------------------
$totalSecs = $totalTimer.Elapsed.TotalSeconds
Show-Summary -HealthResults $healthResults -TotalSeconds $totalSecs

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
