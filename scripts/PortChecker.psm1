<#
.SYNOPSIS
    PortChecker - TCP port availability utilities for Planora launch scripts.

.DESCRIPTION
    Uses .NET TcpListener to probe ports (more reliable than netstat/ss because
    it actually attempts to bind, confirming the OS will grant the bind).
    Also integrates with netstat to identify which process holds a port when
    it is already in use.

    Typical usage:
        Import-Module "$PSScriptRoot/PortChecker.psm1"

        if (-not (Test-PortFree -Port 5030)) {
            $owner = Get-PortOwner -Port 5030
            Write-Warning "Port 5030 owned by $($owner.ProcessName) (PID $($owner.Pid))"
        }

        Assert-PortsFree -PortList @(
            @{ Port = 5030; ServiceName = 'auth-api' },
            @{ Port = 5100; ServiceName = 'todo-api' }
        )
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-PortFree {
    <#
    .SYNOPSIS
        Returns $true if the given TCP port is free (not in use), $false otherwise.

    .DESCRIPTION
        Attempts to bind a TcpListener to 127.0.0.1:<Port>. If binding succeeds
        the port is free; if an exception is thrown the port is occupied.
        The listener is always released, so this function has no side effects.

    .PARAMETER Port
        TCP port number to check (1-65535).
    .OUTPUTS
        [bool]
    .EXAMPLE
        if (Test-PortFree -Port 5030) { Write-Host "Port 5030 is available" }
    #>
    param(
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port
    )

    $listener = $null
    try {
        $endpoint = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener  = [System.Net.Sockets.TcpListener]::new($endpoint)
        $listener.Start()
        return $true
    } catch [System.Net.Sockets.SocketException] {
        return $false
    } catch {
        # Unexpected error - treat as occupied to fail safely
        Write-Verbose "[PortChecker] Unexpected error probing port ${Port}: $_"
        return $false
    } finally {
        if ($null -ne $listener) {
            try { $listener.Stop() } catch {}
        }
    }
}

function Get-PortOwner {
    <#
    .SYNOPSIS
        Returns information about the process currently listening on the given TCP port.

    .DESCRIPTION
        Uses Get-NetTCPConnection (Windows built-in) to identify the PID owning
        the port, then looks up the process name. Falls back to netstat parsing
        when Get-NetTCPConnection is unavailable (older OS versions).

        The returned object's IsPlanora property is $true when the owning
        process name contains 'dotnet', 'Planora', or 'node' - a quick signal
        that a previous run is still alive rather than an unrelated conflict.

    .PARAMETER Port
        TCP port number to inspect.
    .OUTPUTS
        [PSCustomObject] with: Port, Pid, ProcessName, IsPlanora, State
        Returns $null if no process is listening on the port.
    .EXAMPLE
        $owner = Get-PortOwner -Port 5100
        if ($owner) { Write-Warning "Port in use by $($owner.ProcessName)" }
    #>
    param(
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port
    )

    $ownerPid      = $null
    $ownerName     = '(unknown)'
    $connectionState = 'Unknown'

    # --- Method 1: Get-NetTCPConnection (Windows PowerShell / pwsh on Windows) ---
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
                Where-Object { $_.State -in @('Listen', 'Established', 'CloseWait') } |
                Select-Object -First 1

        if ($null -ne $conn) {
            $ownerPid        = $conn.OwningProcess
            $connectionState = $conn.State
        }
    } catch {
        Write-Verbose "[PortChecker] Get-NetTCPConnection unavailable, falling back to netstat."
    }

    # --- Method 2: netstat fallback ---
    if ($null -eq $ownerPid) {
        try {
            $netstatOutput = & netstat -ano 2>$null
            foreach ($line in $netstatOutput) {
                # Match lines like:  TCP    0.0.0.0:5030    ...    LISTENING    1234
                if ($line -match "TCP\s+[^\s]+:$Port\s+[^\s]+\s+(\w+)\s+(\d+)") {
                    $connectionState = $Matches[1]
                    $ownerPid        = [int]$Matches[2]
                    break
                }
            }
        } catch {
            Write-Verbose "[PortChecker] netstat fallback also failed: $_"
        }
    }

    if ($null -eq $ownerPid) {
        return $null
    }

    # Look up process name
    try {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        if ($null -ne $proc) {
            $ownerName = $proc.ProcessName
        }
    } catch {}

    $isPlanora = ($ownerName -match 'dotnet|Planora|node')

    return [PSCustomObject]@{
        Port          = $Port
        Pid           = $ownerPid
        ProcessName   = $ownerName
        IsPlanora = $isPlanora
        State         = $connectionState
    }
}

function Wait-PortFree {
    <#
    .SYNOPSIS
        Polls until a TCP port becomes free or the timeout expires.

    .DESCRIPTION
        Useful after calling Stop-ServiceByPid to confirm the OS has released
        the port before starting a new process on the same port.
        Polls at 1-second intervals with a progress log every 5 seconds.

    .PARAMETER Port
        TCP port to wait on.
    .PARAMETER ServiceName
        Human-readable name used in log messages.
    .PARAMETER TimeoutSeconds
        Maximum seconds to wait. Default: 30.
    .OUTPUTS
        [bool] - $true if the port became free within the timeout, $false otherwise.
    .EXAMPLE
        if (-not (Wait-PortFree -Port 5030 -ServiceName 'auth-api' -TimeoutSeconds 20)) {
            throw "Port 5030 still occupied after 20s"
        }
    #>
    param(
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port,
        [string]$ServiceName = "service on port $Port",
        [int]$TimeoutSeconds = 30
    )

    $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
    $elapsed  = 0

    Write-Verbose "[PortChecker] Waiting up to ${TimeoutSeconds}s for port $Port ($ServiceName) to be released..."

    while ([datetime]::UtcNow -lt $deadline) {
        if (Test-PortFree -Port $Port) {
            Write-Verbose "[PortChecker] Port $Port is now free (waited ${elapsed}s)."
            return $true
        }

        Start-Sleep -Seconds 1
        $elapsed++

        if ($elapsed % 5 -eq 0) {
            $remaining = [int]($deadline - [datetime]::UtcNow).TotalSeconds
            Write-Host "[PortChecker] Still waiting for port $Port ($ServiceName)... ${remaining}s remaining." -ForegroundColor DarkYellow
        }
    }

    Write-Warning "[PortChecker] Port $Port ($ServiceName) is still occupied after ${TimeoutSeconds}s."
    return $false
}

function Assert-PortsFree {
    <#
    .SYNOPSIS
        Checks a list of ports and reports conflicts. Returns $true only if all are free.

    .DESCRIPTION
        Iterates over an array of port descriptors. For each occupied port it
        prints a warning showing which process owns it and whether it looks like
        a stale Planora process. Suitable for a pre-flight check at the top
        of a launch script.

    .PARAMETER PortList
        Array of hashtables/PSObjects each with mandatory 'Port' (int) and
        optional 'ServiceName' (string) keys.

        Example:
          @(
            @{ Port = 5030; ServiceName = 'auth-api' },
            @{ Port = 5100; ServiceName = 'todo-api' },
            @{ Port = 5132; ServiceName = 'api-gateway' }
          )

    .OUTPUTS
        [bool] - $true if all ports are free, $false if any conflict exists.
    .EXAMPLE
        $allFree = Assert-PortsFree -PortList @(
            @{ Port = 5030; ServiceName = 'auth-api' },
            @{ Port = 5100; ServiceName = 'todo-api' }
        )
        if (-not $allFree) { throw "Port conflict - cannot start." }
    #>
    param(
        [Parameter(Mandatory)][array]$PortList
    )

    $conflicts = @()

    foreach ($entry in $PortList) {
        $port    = [int]$entry.Port
        $svcName = if ($entry.PSObject.Properties['ServiceName']) { $entry.ServiceName } else { "port $port" }

        if (-not (Test-PortFree -Port $port)) {
            $owner = Get-PortOwner -Port $port
            if ($null -ne $owner) {
                $hint = if ($owner.IsPlanora) {
                    " [looks like a stale Planora process - run Stop-AllServices first]"
                } else {
                    " [external process - stop it manually]"
                }
                Write-Warning "[PortChecker] CONFLICT: Port $port ($svcName) in use by $($owner.ProcessName) (PID $($owner.Pid))$hint"
            } else {
                Write-Warning "[PortChecker] CONFLICT: Port $port ($svcName) is occupied (owner could not be identified)."
            }
            $conflicts += $port
        } else {
            Write-Verbose "[PortChecker] OK: Port $port ($svcName) is free."
        }
    }

    $portEntries = @($PortList)

    if (@($conflicts).Count -eq 0) {
        Write-Host "[PortChecker] All $($portEntries.Count) ports are free." -ForegroundColor Green
        return $true
    }

    Write-Warning "[PortChecker] $(@($conflicts).Count) port conflict(s) detected: $($conflicts -join ', ')"
    return $false
}

Export-ModuleMember -Function @(
    'Test-PortFree',
    'Get-PortOwner',
    'Wait-PortFree',
    'Assert-PortsFree'
)
