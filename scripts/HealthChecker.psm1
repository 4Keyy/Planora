<#
.SYNOPSIS
    HealthChecker - HTTP health-endpoint polling for Planora services.

.DESCRIPTION
    Provides functions to poll ASP.NET health endpoints (/health) with exponential
    backoff, run parallel health checks across all services, and display a
    formatted status table suitable for a startup summary.

    All services in this project expose a /health endpoint returning HTTP 200
    with JSON body { "status": "Healthy" }.

    Typical usage:
        Import-Module "$PSScriptRoot/HealthChecker.psm1"

        $services = @(
            @{ Name = 'auth-api';    HealthUrl = 'http://localhost:5030/health' },
            @{ Name = 'todo-api';    HealthUrl = 'http://localhost:5100/health' },
            @{ Name = 'category-api'; HealthUrl = 'http://localhost:5281/health' },
            @{ Name = 'messaging-api'; HealthUrl = 'http://localhost:5058/health' },
            @{ Name = 'realtime-api';  HealthUrl = 'http://localhost:5032/health' },
            @{ Name = 'api-gateway';   HealthUrl = 'http://localhost:5132/health' }
        )

        $results = Test-AllServicesHealthy -Services $services
        $results | Format-Table
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

function Ensure-SystemNetHttpAvailable {
    try {
        if ($null -eq [System.Type]::GetType('System.Net.Http.HttpClient, System.Net.Http', $false)) {
            Add-Type -AssemblyName System.Net.Http -ErrorAction Stop | Out-Null
        }
        return $true
    } catch {
        return $false
    }
}

function Invoke-HealthRequest {
    <#
    .SYNOPSIS Internal - performs a single HTTP GET to a health URL.
    .OUTPUTS  [PSCustomObject] { IsHealthy, StatusCode, ResponseTime, Body, Error }
    #>
    param(
        [Parameter(Mandatory)][string]$Url,
        [int]$TimeoutMilliseconds = 5000
    )

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        if (-not (Ensure-SystemNetHttpAvailable)) {
            throw "Could not load System.Net.Http assembly."
        }

        # Use HttpClient for reliable timeout and response body access
        $client  = [System.Net.Http.HttpClient]::new()
        $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMilliseconds)

        $response = $client.GetAsync($Url).GetAwaiter().GetResult()
        $body     = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        $stopwatch.Stop()

        $isHealthy = ($response.StatusCode -eq [System.Net.HttpStatusCode]::OK)

        return [PSCustomObject]@{
            IsHealthy    = $isHealthy
            StatusCode   = [int]$response.StatusCode
            ResponseTime = $stopwatch.ElapsedMilliseconds
            Body         = $body
            Error        = $null
        }
    } catch {
        $stopwatch.Stop()
        return [PSCustomObject]@{
            IsHealthy    = $false
            StatusCode   = 0
            ResponseTime = $stopwatch.ElapsedMilliseconds
            Body         = $null
            Error        = $_.Exception.Message
        }
    } finally {
        if ($null -ne $client)  { try { $client.Dispose()  } catch {} }
    }
}

# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

function Test-ServiceHealth {
    <#
    .SYNOPSIS
        Polls a service's /health endpoint with exponential backoff until it
        returns HTTP 200 or the timeout expires.

    .DESCRIPTION
        Backoff schedule (capped at 8s):
            attempt 1 -> wait 1s
            attempt 2 -> wait 2s
            attempt 3 -> wait 4s
            attempt 4+ -> wait 8s

        Returns a PSCustomObject with:
            ServiceName   - name passed in
            Status        - 'Healthy' | 'Unhealthy' | 'Timeout'
            StatusCode    - last HTTP status code (0 if no response)
            ResponseTime  - last round-trip time in milliseconds
            Attempts      - number of poll attempts made
            Error         - error message if Status is not 'Healthy'

    .PARAMETER ServiceName
        Human-readable service name used in log messages.
    .PARAMETER HealthUrl
        Full URL of the health endpoint (e.g. 'http://localhost:5030/health').
    .PARAMETER TimeoutSeconds
        Maximum total seconds to wait for the service to become healthy.
        Default: 60 seconds.
    .OUTPUTS
        [PSCustomObject]
    .EXAMPLE
        $result = Test-ServiceHealth -ServiceName 'auth-api' -HealthUrl 'http://localhost:5030/health'
        if ($result.Status -ne 'Healthy') { throw "auth-api did not start" }
    #>
    param(
        [Parameter(Mandatory)][string]$ServiceName,
        [Parameter(Mandatory)][string]$HealthUrl,
        [int]$TimeoutSeconds = 60
    )

    $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
    $attempt  = 0
    $lastResult = $null

    Write-Host "[HealthChecker] Waiting for '$ServiceName' at $HealthUrl (timeout: ${TimeoutSeconds}s)..." -ForegroundColor Cyan

    while ([datetime]::UtcNow -lt $deadline) {
        $attempt++
        $lastResult = Invoke-HealthRequest -Url $HealthUrl -TimeoutMilliseconds 5000

        if ($lastResult.IsHealthy) {
            Write-Host "[HealthChecker] '$ServiceName' is Healthy (attempt $attempt, $($lastResult.ResponseTime)ms)." -ForegroundColor Green
            return [PSCustomObject]@{
                ServiceName  = $ServiceName
                Status       = 'Healthy'
                StatusCode   = $lastResult.StatusCode
                ResponseTime = $lastResult.ResponseTime
                Attempts     = $attempt
                Error        = $null
            }
        }

        # Log failure details at verbose level to avoid noise
        $errorDetail = if ($null -ne $lastResult.Error) { $lastResult.Error } else { "HTTP $($lastResult.StatusCode)" }
        Write-Verbose "[HealthChecker] '$ServiceName' not ready yet (attempt $attempt): $errorDetail"

        # Exponential backoff: 1s, 2s, 4s, capped at 8s
        $backoff = [Math]::Min([Math]::Pow(2, $attempt - 1), 8)
        $remaining = ($deadline - [datetime]::UtcNow).TotalSeconds
        if ($remaining -le 0) { break }
        $sleepFor = [Math]::Min($backoff, $remaining)
        Start-Sleep -Seconds $sleepFor
    }

    $finalError = if ($null -ne $lastResult) {
        if ($null -ne $lastResult.Error) { $lastResult.Error } else { "HTTP $($lastResult.StatusCode)" }
    } else {
        "No response received"
    }

    Write-Warning "[HealthChecker] '$ServiceName' did not become healthy within ${TimeoutSeconds}s. Last error: $finalError"

    return [PSCustomObject]@{
        ServiceName  = $ServiceName
        Status       = 'Timeout'
        StatusCode   = if ($null -ne $lastResult) { $lastResult.StatusCode } else { 0 }
        ResponseTime = if ($null -ne $lastResult) { $lastResult.ResponseTime } else { 0 }
        Attempts     = $attempt
        Error        = $finalError
    }
}

function Test-AllServicesHealthy {
    <#
    .SYNOPSIS
        Checks all services in parallel and returns a results table.

    .DESCRIPTION
        Spawns a background PowerShell job per service and collects results.
        Prints a colored pass/fail summary table to the console.
        Returns the full results array for programmatic use.

    .PARAMETER Services
        Array of hashtables/PSObjects, each with:
            Name       - service name
            HealthUrl  - health endpoint URL
            Timeout    - (optional) per-service timeout in seconds (default: 60)

    .PARAMETER OverallTimeoutSeconds
        Maximum seconds to wait for ALL jobs to finish.
        Default: 120 seconds.
    .OUTPUTS
        [PSCustomObject[]] - one entry per service with same shape as Test-ServiceHealth output.
    .EXAMPLE
        $services = @(
            @{ Name = 'auth-api';    HealthUrl = 'http://localhost:5030/health' },
            @{ Name = 'todo-api';    HealthUrl = 'http://localhost:5100/health' },
            @{ Name = 'category-api'; HealthUrl = 'http://localhost:5281/health' },
            @{ Name = 'messaging-api'; HealthUrl = 'http://localhost:5058/health' },
            @{ Name = 'realtime-api';  HealthUrl = 'http://localhost:5032/health' },
            @{ Name = 'api-gateway';   HealthUrl = 'http://localhost:5132/health' }
        )
        $results = Test-AllServicesHealthy -Services $services
    #>
    param(
        [Parameter(Mandatory)][array]$Services,
        [int]$OverallTimeoutSeconds = 120
    )

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  Planora - Service Health Check" -ForegroundColor Cyan
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""

    $jobs = @()
    $useParallelJobs = ($PSVersionTable.PSEdition -ne 'Desktop')

    if (-not $useParallelJobs) {
        $results = @()
        $overallDeadline = [datetime]::UtcNow.AddSeconds($OverallTimeoutSeconds)
        $serviceStates = @()

        foreach ($svc in $Services) {
            $svcTimeout = if ($svc.Timeout) { [int]$svc.Timeout } else { 120 }
            $startedAt = [datetime]::UtcNow
            $serviceStates += [PSCustomObject]@{
                ServiceName     = $svc.Name
                HealthUrl       = $svc.HealthUrl
                ServiceDeadline = $startedAt.AddSeconds($svcTimeout)
                NextAttemptAt   = $startedAt
                Attempts        = 0
                LastResult      = $null
                Completed       = $false
            }
        }

        while ([datetime]::UtcNow -lt $overallDeadline -and @($serviceStates | Where-Object { -not $_.Completed }).Count -gt 0) {
            $now = [datetime]::UtcNow
            $madeAttempt = $false

            foreach ($state in $serviceStates) {
                if ($state.Completed) { continue }

                if ($now -ge $state.ServiceDeadline) {
                    $finalError = if ($state.LastResult -and $state.LastResult.Error) {
                        $state.LastResult.Error
                    } elseif ($state.LastResult) {
                        "HTTP $($state.LastResult.StatusCode)"
                    } else {
                        'No response received'
                    }

                    $results += [PSCustomObject]@{
                        ServiceName  = $state.ServiceName
                        Status       = 'Timeout'
                        StatusCode   = if ($state.LastResult) { $state.LastResult.StatusCode } else { 0 }
                        ResponseTime = if ($state.LastResult) { $state.LastResult.ResponseTime } else { 0 }
                        Attempts     = $state.Attempts
                        Error        = $finalError
                    }
                    $state.Completed = $true
                    continue
                }

                if ($now -lt $state.NextAttemptAt) { continue }

                $remainingOverallMs = [int][Math]::Floor(($overallDeadline - $now).TotalMilliseconds)
                $remainingServiceMs = [int][Math]::Floor(($state.ServiceDeadline - $now).TotalMilliseconds)
                $probeTimeoutMs = [Math]::Max(500, [Math]::Min([Math]::Min(5000, $remainingOverallMs), $remainingServiceMs))

                $state.Attempts++
                $state.LastResult = Invoke-HealthRequest -Url $state.HealthUrl -TimeoutMilliseconds $probeTimeoutMs
                $madeAttempt = $true

                if ($state.LastResult.IsHealthy) {
                    $results += [PSCustomObject]@{
                        ServiceName  = $state.ServiceName
                        Status       = 'Healthy'
                        StatusCode   = $state.LastResult.StatusCode
                        ResponseTime = $state.LastResult.ResponseTime
                        Attempts     = $state.Attempts
                        Error        = $null
                    }
                    $state.Completed = $true
                    continue
                }

                $backoffSeconds = [Math]::Min([Math]::Pow(2, $state.Attempts - 1), 8)
                $state.NextAttemptAt = [datetime]::UtcNow.AddSeconds($backoffSeconds)
            }

            if (@($serviceStates | Where-Object { -not $_.Completed }).Count -eq 0) {
                break
            }

            if (-not $madeAttempt) {
                $nextAttemptAt = @(
                    $serviceStates |
                    Where-Object { -not $_.Completed } |
                    Select-Object -ExpandProperty NextAttemptAt |
                    Sort-Object |
                    Select-Object -First 1
                )

                $sleepMs = if ($nextAttemptAt.Count -gt 0) {
                    [Math]::Max(100, [Math]::Min(1000, [int][Math]::Ceiling(($nextAttemptAt[0] - [datetime]::UtcNow).TotalMilliseconds)))
                } else {
                    200
                }
                Start-Sleep -Milliseconds $sleepMs
            }
        }

        foreach ($state in $serviceStates | Where-Object { -not $_.Completed }) {
            $finalError = if ($state.LastResult -and $state.LastResult.Error) {
                $state.LastResult.Error
            } elseif ($state.LastResult) {
                "HTTP $($state.LastResult.StatusCode)"
            } else {
                'Overall health-check timeout reached before this service became healthy.'
            }

            $results += [PSCustomObject]@{
                ServiceName  = $state.ServiceName
                Status       = 'Timeout'
                StatusCode   = if ($state.LastResult) { $state.LastResult.StatusCode } else { 0 }
                ResponseTime = if ($state.LastResult) { $state.LastResult.ResponseTime } else { 0 }
                Attempts     = $state.Attempts
                Error        = $finalError
            }
            $state.Completed = $true
        }
    } else {
        # Spawn one background job per service
        foreach ($svc in $Services) {
            $name       = $svc.Name
            $url        = $svc.HealthUrl
            $svcTimeout = if ($svc.Timeout) { [int]$svc.Timeout } else { 120 }

            $scriptBlock = {
                param($ServiceName, $HealthUrl, $TimeoutSeconds)

                function Ensure-SystemNetHttpAvailable {
                    try {
                        if ($null -eq [System.Type]::GetType('System.Net.Http.HttpClient, System.Net.Http', $false)) {
                            Add-Type -AssemblyName System.Net.Http -ErrorAction Stop | Out-Null
                        }
                        return $true
                    } catch {
                        return $false
                    }
                }

                function Invoke-HealthRequest {
                    param([string]$Url, [int]$TimeoutMilliseconds = 5000)
                    $sw = [System.Diagnostics.Stopwatch]::StartNew()
                    try {
                        if (-not (Ensure-SystemNetHttpAvailable)) {
                            throw "Could not load System.Net.Http assembly."
                        }

                        $client   = [System.Net.Http.HttpClient]::new()
                        $client.Timeout = [TimeSpan]::FromMilliseconds($TimeoutMilliseconds)
                        $response = $client.GetAsync($Url).GetAwaiter().GetResult()
                        $body     = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                        $sw.Stop()
                        return @{
                            IsHealthy    = ($response.StatusCode -eq [System.Net.HttpStatusCode]::OK)
                            StatusCode   = [int]$response.StatusCode
                            ResponseTime = $sw.ElapsedMilliseconds
                            Error        = $null
                        }
                    } catch {
                        $sw.Stop()
                        return @{
                            IsHealthy    = $false
                            StatusCode   = 0
                            ResponseTime = $sw.ElapsedMilliseconds
                            Error        = $_.Exception.Message
                        }
                    } finally {
                        if ($client)  { try { $client.Dispose()  } catch {} }
                    }
                }

                $deadline   = [datetime]::UtcNow.AddSeconds($TimeoutSeconds)
                $attempt    = 0
                $lastResult = $null

                while ([datetime]::UtcNow -lt $deadline) {
                    $attempt++
                    $lastResult = Invoke-HealthRequest -Url $HealthUrl
                    if ($lastResult.IsHealthy) {
                        return @{
                            ServiceName  = $ServiceName
                            Status       = 'Healthy'
                            StatusCode   = $lastResult.StatusCode
                            ResponseTime = $lastResult.ResponseTime
                            Attempts     = $attempt
                            Error        = $null
                        }
                    }
                    $backoff   = [Math]::Min([Math]::Pow(2, $attempt - 1), 8)
                    $remaining = ($deadline - [datetime]::UtcNow).TotalSeconds
                    if ($remaining -le 0) { break }
                    Start-Sleep -Seconds ([Math]::Min($backoff, $remaining))
                }

                $finalError = if ($lastResult -and $lastResult.Error) { $lastResult.Error } else { "HTTP $($lastResult.StatusCode)" }
                return @{
                    ServiceName  = $ServiceName
                    Status       = 'Timeout'
                    StatusCode   = if ($lastResult) { $lastResult.StatusCode } else { 0 }
                    ResponseTime = if ($lastResult) { $lastResult.ResponseTime } else { 0 }
                    Attempts     = $attempt
                    Error        = $finalError
                }
            }

            $job = Start-Job -ScriptBlock $scriptBlock -ArgumentList $name, $url, $svcTimeout
            $jobs += [PSCustomObject]@{
                Job         = $job
                ServiceName = $name
            }
        }

        # Wait for all jobs. Wait-Job is more reliable than manual state polling
        # across Windows PowerShell background job processes.
        $jobRefs = @($jobs | ForEach-Object { $_.Job })
        $null = Wait-Job -Job $jobRefs -Timeout $OverallTimeoutSeconds -ErrorAction SilentlyContinue

        # Collect results
        $results = @()
        foreach ($entry in $jobs) {
            if ($entry.Job.State -notin @('Completed', 'Failed', 'Stopped')) {
                Stop-Job -Job $entry.Job -ErrorAction SilentlyContinue
            }

            $jobResult = $null
            try {
                $jobResult = Receive-Job -Job $entry.Job -ErrorAction SilentlyContinue
            } catch {}
            Remove-Job -Job $entry.Job -Force -ErrorAction SilentlyContinue

            if ($null -ne $jobResult) {
                $results += [PSCustomObject]$jobResult
            } else {
                $results += [PSCustomObject]@{
                    ServiceName  = $entry.ServiceName
                    Status       = 'Timeout'
                    StatusCode   = 0
                    ResponseTime = 0
                    Attempts     = 0
                    Error        = 'Job did not return a result (overall timeout)'
                }
            }
        }
    }

    # Print summary table
    Write-Host ""
    Write-Host "  Service Health Summary" -ForegroundColor White
    Write-Host "  ----------------------" -ForegroundColor DarkGray
    $colW = ($results | Select-Object -ExpandProperty ServiceName | Measure-Object -Property Length -Maximum).Maximum + 2

    foreach ($r in ($results | Sort-Object ServiceName)) {
        $icon   = if ($r.Status -eq 'Healthy') { "[OK]  " } else { "[FAIL]" }
        $color  = if ($r.Status -eq 'Healthy') { 'Green' } else { 'Red' }
        $timing = if ($r.ResponseTime -gt 0) { "$($r.ResponseTime)ms" } else { "---" }
        $line   = "  $icon $($r.ServiceName.PadRight($colW)) $($r.Status.PadRight(10)) $timing"
        if ($r.Status -ne 'Healthy' -and $r.Error) {
            $line += "  ($($r.Error))"
        }
        Write-Host $line -ForegroundColor $color
    }

    Write-Host ""
    $healthyCount   = @($results | Where-Object { $_.Status -eq 'Healthy' }).Count
    $unhealthyCount = @($results).Count - $healthyCount
    if ($unhealthyCount -eq 0) {
        Write-Host "  All $($results.Count) services are Healthy." -ForegroundColor Green
    } else {
        Write-Host "  $healthyCount/$($results.Count) services Healthy. $unhealthyCount service(s) FAILED." -ForegroundColor Red
    }
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""

    return $results
}

function Get-ServiceStatus {
    <#
    .SYNOPSIS
        Returns the current status of all services with a single HTTP probe each.
        Does not wait - returns immediately with whatever each service responds with.
        Useful for the startup summary table or a status command.

    .PARAMETER Services
        Array of hashtables/PSObjects, each with:
            Name      - service name
            HealthUrl - health endpoint URL

    .OUTPUTS
        [PSCustomObject[]] - one entry per service:
            ServiceName, Status (Healthy/Unhealthy/Unreachable), StatusCode, ResponseTime, Error
    .EXAMPLE
        $status = Get-ServiceStatus -Services $services
        $status | Format-Table ServiceName, Status, ResponseTime -AutoSize
    #>
    param(
        [Parameter(Mandatory)][array]$Services
    )

    $results = @()
    foreach ($svc in $Services) {
        $probe = Invoke-HealthRequest -Url $svc.HealthUrl -TimeoutMilliseconds 3000

        $status = if ($probe.IsHealthy) {
            'Healthy'
        } elseif ($probe.StatusCode -gt 0) {
            'Unhealthy'
        } else {
            'Unreachable'
        }

        $results += [PSCustomObject]@{
            ServiceName  = $svc.Name
            Status       = $status
            StatusCode   = $probe.StatusCode
            ResponseTime = $probe.ResponseTime
            Error        = $probe.Error
        }
    }

    return $results
}

Export-ModuleMember -Function @(
    'Test-ServiceHealth',
    'Test-AllServicesHealthy',
    'Get-ServiceStatus'
)
