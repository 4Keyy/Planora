<#
.SYNOPSIS
    PidManager - Process ID lifecycle management for Planora services.

.DESCRIPTION
    Manages .pid files under the .pids/ directory at the project root.
    Used by start/stop scripts to track which processes belong to this project
    and to support graceful, ordered shutdown.

    Typical usage:
        Import-Module "$PSScriptRoot/PidManager.psm1"
        Initialize-PidDirectory
        Write-ServicePid  -ServiceName "auth-api"  -ProcessId 12345
        Stop-AllServices
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

function Get-PidDirectory {
    <#
    .SYNOPSIS Internal - returns the absolute path to the .pids/ directory.
    #>
    # Walk up from this module's location to find the project root
    # (the directory that contains docker-compose.yml).
    $dir = $PSScriptRoot
    for ($i = 0; $i -lt 5; $i++) {
        if (Test-Path (Join-Path $dir 'docker-compose.yml')) {
            return (Join-Path $dir '.pids')
        }
        $dir = Split-Path $dir -Parent
    }
    # Fallback: place .pids/ next to the scripts/ folder
    return (Join-Path $PSScriptRoot '..\\.pids')
}

function Get-PidFilePath {
    param([Parameter(Mandatory)][string]$ServiceName)
    return Join-Path (Get-PidDirectory) "$ServiceName.pid"
}

# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

function Initialize-PidDirectory {
    <#
    .SYNOPSIS
        Creates the .pids/ directory if it does not already exist.
    .EXAMPLE
        Initialize-PidDirectory
    #>
    $pidDir = Get-PidDirectory
    if (-not (Test-Path $pidDir)) {
        New-Item -ItemType Directory -Path $pidDir -Force | Out-Null
        Write-Verbose "[PidManager] Created pid directory: $pidDir"
    }
}

function Write-ServicePid {
    <#
    .SYNOPSIS
        Writes a process ID to .pids/<ServiceName>.pid.
    .PARAMETER ServiceName
        Logical service name (e.g. 'auth-api', 'todo-api').
    .PARAMETER ProcessId
        The OS process ID of the service process.
    .EXAMPLE
        Write-ServicePid -ServiceName 'auth-api' -ProcessId 12345
    #>
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][int]$ProcessId
    )
    Initialize-PidDirectory
    $pidFile = Get-PidFilePath -ServiceName $ServiceName
    Set-Content -Path $pidFile -Value $ProcessId -Encoding UTF8
    Write-Verbose "[PidManager] Wrote PID $ProcessId to $pidFile"
}

function Read-ServicePid {
    <#
    .SYNOPSIS
        Returns the PID stored in .pids/<ServiceName>.pid, or $null if the file is missing.
    .PARAMETER ServiceName
        Logical service name.
    .OUTPUTS
        [int] or $null
    .EXAMPLE
        $pid = Read-ServicePid -ServiceName 'auth-api'
    #>
    param(
        [Parameter(Mandatory)][string]$ServiceName
    )
    $pidFile = Get-PidFilePath -ServiceName $ServiceName
    if (-not (Test-Path $pidFile)) {
        return $null
    }
    $raw = Get-Content -Path $pidFile -Raw -Encoding UTF8
    $trimmed = $raw.Trim()
    if ($trimmed -match '^\d+$') {
        return [int]$trimmed
    }
    Write-Warning "[PidManager] PID file '$pidFile' contains non-numeric data: '$trimmed'"
    return $null
}

function Stop-ServiceByPid {
    <#
    .SYNOPSIS
        Stops a service identified by its .pid file.

    .DESCRIPTION
        1. Reads the PID from .pids/<ServiceName>.pid.
        2. Verifies the process is still alive.
        3. Sends SIGTERM (graceful stop via Stop-Process).
        4. Waits up to $GracePeriodSeconds; if still alive and -Force is set,
           sends SIGKILL (forceful termination).
        5. Removes the .pid file on success.
        Returns $true if the service was stopped, $false if the process was
        not found (i.e. already dead or never started).

    .PARAMETER ServiceName
        Logical service name.
    .PARAMETER Force
        If set, forcefully kills the process after the grace period expires.
    .PARAMETER GracePeriodSeconds
        Seconds to wait for the process to exit before force-killing.
        Default: 10 seconds.
    .OUTPUTS
        [bool]
    .EXAMPLE
        Stop-ServiceByPid -ServiceName 'todo-api' -Force
    #>
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [switch]$Force,
        [int]$GracePeriodSeconds = 10,
        [switch]$Quiet
    )

    $storedPid = Read-ServicePid -ServiceName $ServiceName
    if ($null -eq $storedPid) {
        Write-Verbose "[PidManager] No PID file for '$ServiceName' - skipping."
        return $false
    }

    $process = $null
    try {
        $process = Get-Process -Id $storedPid -ErrorAction SilentlyContinue
    } catch {
        # Process.GetProcessById throws if the process does not exist
    }

    if ($null -eq $process -or $process.HasExited) {
        if ($Quiet) {
            Write-Verbose "[PidManager] Process $storedPid ('$ServiceName') is no longer running. Cleaning up stale PID file."
        } else {
            Write-Warning "[PidManager] Process $storedPid ('$ServiceName') is no longer running. Cleaning up stale PID file."
        }
        Remove-PidFile -ServiceName $ServiceName
        return $false
    }

    Write-Host "[PidManager] Stopping '$ServiceName' (PID $storedPid)..." -ForegroundColor Yellow

    # Attempt graceful shutdown
    try {
        $process.CloseMainWindow() | Out-Null
    } catch {
        # Process may not have a main window (console process) - fall through to Stop-Process
    }

    # Wait for graceful exit
    $deadline = [datetime]::UtcNow.AddSeconds($GracePeriodSeconds)
    while (-not $process.HasExited -and [datetime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 500
        try { $process.Refresh() } catch { break }
    }

    if (-not $process.HasExited) {
        if ($Force) {
            if ($Quiet) {
                Write-Host "[PidManager] '$ServiceName' did not exit within ${GracePeriodSeconds}s - force-stopping PID $storedPid." -ForegroundColor Yellow
            } else {
                Write-Warning "[PidManager] '$ServiceName' did not exit within ${GracePeriodSeconds}s - force-killing PID $storedPid."
            }
            try {
                Stop-Process -Id $storedPid -Force -ErrorAction SilentlyContinue
            } catch {
                if ($Quiet) {
                    Write-Verbose ("[PidManager] Could not force-stop PID {0}: {1}" -f $storedPid, $_)
                } else {
                    Write-Warning ("[PidManager] Could not force-kill PID {0}: {1}" -f $storedPid, $_)
                }
            }
        } else {
            Write-Warning "[PidManager] '$ServiceName' (PID $storedPid) is still running after ${GracePeriodSeconds}s. Use -Force to kill."
            return $false
        }
    }

    Remove-PidFile -ServiceName $ServiceName
    Write-Host "[PidManager] '$ServiceName' stopped." -ForegroundColor Green
    return $true
}

function Stop-AllServices {
    <#
    .SYNOPSIS
        Stops all services that have active .pid files, in reverse alphabetical order.

    .DESCRIPTION
        Reads every *.pid file in the .pids/ directory and stops each process
        gracefully (then forcefully if -Force is set). Returns a hashtable mapping
        each service name to 'Stopped', 'NotFound', or 'Failed'.

    .PARAMETER Force
        Force-kill services that do not exit within the grace period.
    .PARAMETER GracePeriodSeconds
        Grace period per service. Default: 10 seconds.
    .OUTPUTS
        [hashtable]  Keys = service names, Values = 'Stopped' | 'NotFound' | 'Failed'
    .EXAMPLE
        $results = Stop-AllServices -Force
        $results | Format-Table
    #>
    param(
        [switch]$Force,
        [int]$GracePeriodSeconds = 10,
        [switch]$Quiet
    )

    $pidDir = Get-PidDirectory
    $results = @{}

    if (-not (Test-Path $pidDir)) {
        Write-Verbose "[PidManager] No .pids/ directory found - nothing to stop."
        return $results
    }

    $pidFiles = @(Get-ChildItem -Path $pidDir -Filter '*.pid' -ErrorAction SilentlyContinue)
    if ($pidFiles.Count -eq 0) {
        Write-Host "[PidManager] No services are tracked. Nothing to stop." -ForegroundColor Cyan
        return $results
    }

    # Stop in reverse order (reverse alphabetical approximates reverse start-order
    # when services are named consistently; the launch script can use a fixed order list).
    $serviceNames = $pidFiles | Select-Object -ExpandProperty BaseName | Sort-Object -Descending

    foreach ($svc in $serviceNames) {
        try {
            $stopped = Stop-ServiceByPid -ServiceName $svc -Force:$Force -GracePeriodSeconds $GracePeriodSeconds -Quiet:$Quiet
            $results[$svc] = if ($stopped) { 'Stopped' } else { 'NotFound' }
        } catch {
            Write-Warning "[PidManager] Error stopping '$svc': $_"
            $results[$svc] = 'Failed'
        }
    }

    return $results
}

function Get-RunningServices {
    <#
    .SYNOPSIS
        Returns a list of services that have active .pid files where the process is still alive.

    .OUTPUTS
        [PSCustomObject[]]  Each object has: ServiceName, Pid, ProcessName, IsAlive
    .EXAMPLE
        Get-RunningServices | Format-Table
    #>
    $pidDir = Get-PidDirectory
    $running = @()

    if (-not (Test-Path $pidDir)) {
        return $running
    }

    foreach ($file in Get-ChildItem -Path $pidDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
        $svcName = $file.BaseName
        $storedPid = Read-ServicePid -ServiceName $svcName

        $isAlive = $false
        $procName = '(unknown)'

        if ($null -ne $storedPid) {
            try {
                $proc = Get-Process -Id $storedPid -ErrorAction SilentlyContinue
                if ($null -ne $proc -and -not $proc.HasExited) {
                    $isAlive = $true
                    $procName = $proc.ProcessName
                }
            } catch {}
        }

        $running += [PSCustomObject]@{
            ServiceName = $svcName
            Pid         = $storedPid
            ProcessName = $procName
            IsAlive     = $isAlive
        }
    }

    return $running
}

function Clear-PidDirectory {
    <#
    .SYNOPSIS
        Removes all .pid files from the .pids/ directory.
        Call this on a clean start to discard any stale state from a previous session.
    .EXAMPLE
        Clear-PidDirectory
    #>
    $pidDir = Get-PidDirectory
    if (-not (Test-Path $pidDir)) {
        Write-Verbose "[PidManager] No .pids/ directory to clear."
        return
    }

    $count = 0
    foreach ($file in Get-ChildItem -Path $pidDir -Filter '*.pid' -ErrorAction SilentlyContinue) {
        Remove-Item -Path $file.FullName -Force -ErrorAction SilentlyContinue
        $count++
    }

    Write-Verbose "[PidManager] Cleared $count PID file(s) from $pidDir"
}

# ---------------------------------------------------------------------------
# Private helper - not exported
# ---------------------------------------------------------------------------

function Remove-PidFile {
    param([Parameter(Mandatory)][string]$ServiceName)
    $pidFile = Get-PidFilePath -ServiceName $ServiceName
    if (Test-Path $pidFile) {
        Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
        Write-Verbose "[PidManager] Removed PID file: $pidFile"
    }
}

Export-ModuleMember -Function @(
    'Initialize-PidDirectory',
    'Write-ServicePid',
    'Read-ServicePid',
    'Stop-ServiceByPid',
    'Stop-AllServices',
    'Get-RunningServices',
    'Clear-PidDirectory'
)
