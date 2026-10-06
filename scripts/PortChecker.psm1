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
        Two independent checks, because either one alone lies on Windows:

          1. Get-NetTCPConnection - is ANY socket already LISTENING on this port,
             on any local address and any address family?
          2. Exclusive wildcard bind probes on IPv4 (0.0.0.0) and IPv6 ([::]) - the
             OS is the final authority on whether a bind would actually be granted.

        Check 1 exists because Windows grants a second bind on the same port when the
        two sockets sit on different address families: one server on 0.0.0.0, another
        on [::]. Both then log a successful start, and whichever family the caller's
        name resolution picks decides which application answers - the symptom being
        that every request 404s inside a server that has never heard of the route.
        The old probe (a plain bind on 127.0.0.1) reported such a port as free.

        Both listeners are always released, so this function has no side effects.

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

    # --- Check 1: is anything already listening, on any address / family? ---
    try {
        $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($null -ne $listening) { return $false }
    } catch {
        Write-Verbose "[PortChecker] Get-NetTCPConnection unavailable for port ${Port}; relying on bind probes."
    }

    # --- Check 2: exclusive wildcard bind on each address family ---
    foreach ($address in @([System.Net.IPAddress]::Any, [System.Net.IPAddress]::IPv6Any)) {
        $listener = $null
        try {
            $endpoint = [System.Net.IPEndPoint]::new($address, $Port)
            $listener = [System.Net.Sockets.TcpListener]::new($endpoint)
            # SO_EXCLUSIVEADDRUSE - refuse to share the port with a socket that bound it
            # without exclusive use (Kestrel's default), so the probe can never report a
            # port as free just because the OS would let us squat next to the current owner.
            $listener.ExclusiveAddressUse = $true
            $listener.Start()
        } catch [System.Net.Sockets.SocketException] {
            # A machine with the IPv6 stack disabled cannot probe [::] at all - that is not
            # evidence the port is taken, so skip that family instead of failing the check.
            if ($_.Exception.SocketErrorCode -eq [System.Net.Sockets.SocketError]::AddressFamilyNotSupported) {
                Write-Verbose "[PortChecker] Address family $address unsupported; skipping that probe for port ${Port}."
                continue
            }
            return $false
        } catch {
            # Unexpected error - treat as occupied to fail safely
            Write-Verbose "[PortChecker] Unexpected error probing port ${Port} on ${address}: $_"
            return $false
        } finally {
            if ($null -ne $listener) {
                try { $listener.Stop() } catch {}
            }
        }
    }

    return $true
}

function Test-ProcessUnderPath {
    <#
    .SYNOPSIS
        Returns $true when a process was launched from inside the given directory tree.

    .DESCRIPTION
        Ownership, not naming, is what makes a process safe to kill. A launcher that
        decides by process name alone ('dotnet', 'node') will happily terminate an
        unrelated .NET or Node application that happens to sit on one of its ports -
        which is exactly what Planora used to do to the EDU-ECON backend sharing 5100.

        The executable path and command line are checked for the root, then the parent
        chain is walked: a service started through `dotnet run` or `npm run dev` lives
        under cmd -> npm -> node, and only one link in that chain carries the repo path.
        The walk is depth-limited because Windows recycles PIDs and a parent chain can
        loop back on itself.

    .PARAMETER ProcessId
        PID to classify.
    .PARAMETER RootPath
        Directory tree that defines ownership (typically the repository root).
    .OUTPUTS
        [bool]
    #>
    param(
        [Parameter(Mandatory)][int]$ProcessId,
        [Parameter(Mandatory)][string]$RootPath
    )

    if ([string]::IsNullOrWhiteSpace($RootPath)) { return $false }

    try { $needle = [System.IO.Path]::GetFullPath($RootPath) -replace '[\\/]+$', '' }
    catch { $needle = $RootPath -replace '[\\/]+$', '' }
    if ([string]::IsNullOrWhiteSpace($needle)) { return $false }

    $currentId = $ProcessId

    for ($hop = 0; $hop -lt 6; $hop++) {
        # PIDs 0 and 4 are Idle/System - never ours, and never worth walking past.
        if ($currentId -le 4) { return $false }

        $info = $null
        try {
            $info = Get-CimInstance Win32_Process -Filter "ProcessId = $currentId" -ErrorAction SilentlyContinue
        } catch {
            Write-Verbose "[PortChecker] Win32_Process unavailable for PID ${currentId}: $_"
            return $false
        }
        if ($null -eq $info) { return $false }

        foreach ($field in @($info.ExecutablePath, $info.CommandLine)) {
            if ($field -and $field.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return $true
            }
        }

        $currentId = [int]$info.ParentProcessId
    }

    return $false
}

function Get-PortOwner {
    <#
    .SYNOPSIS
        Returns information about the process currently listening on the given TCP port.

    .DESCRIPTION
        Uses Get-NetTCPConnection (Windows built-in) to identify the PID owning
        the port, then looks up the process name. Falls back to netstat parsing
        when Get-NetTCPConnection is unavailable (older OS versions).

        The returned object's IsPlanora property answers "may this be killed?".
        When -RepoRoot is supplied it is decided by Test-ProcessUnderPath - the process
        (or an ancestor) was launched from inside the Planora tree. Without it the old
        name-based guess is used, which cannot tell a stale Planora service from an
        unrelated 'dotnet' or 'node' application squatting on the same port.

    .PARAMETER Port
        TCP port number to inspect.
    .PARAMETER RepoRoot
        Planora repository root. Supply it so ownership is decided by provenance
        instead of by process name.
    .OUTPUTS
        [PSCustomObject] with: Port, Pid, ProcessName, ExecutablePath, IsPlanora, State
        Returns $null if no process is listening on the port. ExecutablePath is
        '(unknown)' when the owning process cannot be opened (e.g. a SYSTEM process).
    .EXAMPLE
        $owner = Get-PortOwner -Port 5100
        if ($owner) { Write-Warning "Port in use by $($owner.ProcessName)" }
    #>
    param(
        [Parameter(Mandatory)][ValidateRange(1, 65535)][int]$Port,
        [string]$RepoRoot
    )

    $ownerPid      = $null
    $ownerName     = '(unknown)'
    $ownerPath     = '(unknown)'
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

    # Look up process name and, when readable, the executable that owns the port.
    # The path is what actually identifies a foreign app in a conflict message - two
    # unrelated .NET services both show up as 'dotnet' or a bare product name.
    try {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        if ($null -ne $proc) {
            $ownerName = $proc.ProcessName
            try { if ($proc.Path) { $ownerPath = $proc.Path } } catch {}
        }
    } catch {}

    # Ownership decides whether this process may be killed. With a repo root supplied
    # the answer comes from where the process was launched; the name-based guess is only
    # the fallback for callers that cannot say where Planora lives.
    $isPlanora = if ($PSBoundParameters.ContainsKey('RepoRoot') -and -not [string]::IsNullOrWhiteSpace($RepoRoot)) {
        Test-ProcessUnderPath -ProcessId $ownerPid -RootPath $RepoRoot
    } else {
        ($ownerName -match 'dotnet|Planora|node')
    }

    return [PSCustomObject]@{
        Port           = $Port
        Pid            = $ownerPid
        ProcessName    = $ownerName
        ExecutablePath = $ownerPath
        IsPlanora      = $isPlanora
        State          = $connectionState
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

    .PARAMETER RepoRoot
        Planora repository root, forwarded to Get-PortOwner so the "stale Planora run"
        hint is decided by provenance rather than by process name.
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
        [Parameter(Mandatory)][array]$PortList,
        [string]$RepoRoot
    )

    $conflicts = @()

    foreach ($entry in $PortList) {
        $port    = [int]$entry.Port
        $svcName = if ($entry.PSObject.Properties['ServiceName']) { $entry.ServiceName } else { "port $port" }

        if (-not (Test-PortFree -Port $port)) {
            $owner = if ($PSBoundParameters.ContainsKey('RepoRoot')) { Get-PortOwner -Port $port -RepoRoot $RepoRoot } else { Get-PortOwner -Port $port }
            if ($null -ne $owner) {
                $hint = if ($owner.IsPlanora) {
                    " [looks like a stale Planora process - run Stop-AllServices first]"
                } else {
                    " [external process - stop it manually]"
                }
                Write-Warning "[PortChecker] CONFLICT: Port $port ($svcName) in use by $($owner.ProcessName) (PID $($owner.Pid), $($owner.ExecutablePath))$hint"
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
    'Test-ProcessUnderPath',
    'Get-PortOwner',
    'Wait-PortFree',
    'Assert-PortsFree'
)
