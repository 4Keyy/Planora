#requires -Version 7
<#
.SYNOPSIS
    Push the Planora secret matrix to every Fly.io app from a single env file.

.DESCRIPTION
    Reads key=value pairs from `.env.fly` (or the file passed via -EnvFile)
    and pushes the appropriate subset to each Planora Fly.io app via
    `flyctl secrets set --stage`. `--stage` queues the change without
    triggering an immediate restart so the next `flyctl deploy` picks
    everything up atomically.

    The script is idempotent: re-running it with the same env file is a
    no-op for unchanged values; Fly only restarts on actual change at the
    next deploy.

.PARAMETER EnvFile
    Path to a key=value env file. Defaults to `.env.fly` next to this script
    (i.e. `deploy/fly/.env.fly`). The file is gitignored — never commit it.

.PARAMETER DryRun
    Print the planned commands without executing them. No secrets are
    printed; only the variable names that would be staged per app.

.EXAMPLE
    PS> Copy-Item deploy/fly/.env.fly.example deploy/fly/.env.fly
    PS> # edit deploy/fly/.env.fly to fill in real values
    PS> .\deploy\fly\set-secrets.ps1

.EXAMPLE
    PS> .\deploy\fly\set-secrets.ps1 -EnvFile C:\secret\planora.env -DryRun

.NOTES
    Secret matrix (which variables are pushed to which apps):

      shared on every app:
          JwtSettings__Secret
          GrpcSettings__ServiceKey
          ConnectionStrings__Redis
          RabbitMq__HostName, RabbitMq__UserName, RabbitMq__Password
          OTEL_EXPORTER_OTLP_ENDPOINT (optional)
          OTEL_EXPORTER_OTLP_HEADERS  (optional)
          LOKI_URL, LOKI_USER, LOKI_TOKEN (optional — activates Loki sink)

      planora-auth:        ConnectionStrings__AuthDatabase
                           Email__Provider, Email__Username, Email__Password,
                           Email__SmtpHost, Email__SmtpPort, Email__EnableSsl,
                           Email__FromEmail, Email__FromName  (optional, when SMTP is enabled)
      planora-category:    ConnectionStrings__CategoryDatabase
      planora-todo:        ConnectionStrings__TodoDatabase
                           GrpcServices__AuthApi=https://planora-auth.internal:443
                           GrpcServices__CategoryApi=https://planora-category.internal:443
      planora-messaging:   ConnectionStrings__MessagingDatabase
                           GrpcServices__AuthApi=https://planora-auth.internal:443

    Realtime, Gateway, outbox-worker, migrator get only the shared values.
#>
[CmdletBinding()]
param(
    [string]$EnvFile,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Locate flyctl ---------------------------------------------------------------
if ($null -eq (Get-Command flyctl -ErrorAction SilentlyContinue)) {
    Write-Error 'flyctl is not on PATH. Install from https://fly.io/docs/flyctl/install/'
}

# Locate env file -------------------------------------------------------------
if (-not $EnvFile) {
    $EnvFile = Join-Path $PSScriptRoot '.env.fly'
}
if (-not (Test-Path $EnvFile)) {
    Write-Error "Env file not found: $EnvFile`nCopy deploy/fly/.env.fly.example to that path and fill in real values."
}

# Parse env file (key=value, lines starting with # are comments) --------------
$secrets = @{}
foreach ($line in Get-Content -LiteralPath $EnvFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $eq = $trimmed.IndexOf('=')
    if ($eq -lt 1) {
        Write-Warning "Skipping malformed line: $trimmed"
        continue
    }
    $key = $trimmed.Substring(0, $eq).Trim()
    $val = $trimmed.Substring($eq + 1).Trim()
    # Strip optional surrounding double quotes
    if ($val.Length -ge 2 -and $val.StartsWith('"') -and $val.EndsWith('"')) {
        $val = $val.Substring(1, $val.Length - 2)
    }
    $secrets[$key] = $val
}

if ($secrets.Count -eq 0) {
    Write-Error "No key=value entries found in $EnvFile."
}

Write-Host "Loaded $($secrets.Count) variables from $EnvFile" -ForegroundColor Cyan

# Define per-app secret matrix ------------------------------------------------
$shared = @(
    'JwtSettings__Secret',
    'GrpcSettings__ServiceKey',
    'ConnectionStrings__Redis',
    'RabbitMq__HostName',
    'RabbitMq__UserName',
    'RabbitMq__Password',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'OTEL_EXPORTER_OTLP_HEADERS',
    'LOKI_URL',
    'LOKI_USER',
    'LOKI_TOKEN'
)

$matrix = [ordered]@{
    'planora-auth'        = $shared + @(
        'ConnectionStrings__AuthDatabase',
        'Email__Provider', 'Email__Username', 'Email__Password',
        'Email__SmtpHost', 'Email__SmtpPort', 'Email__EnableSsl',
        'Email__FromEmail', 'Email__FromName',
        'Frontend__BaseUrl'
    )
    'planora-category'    = $shared + @('ConnectionStrings__CategoryDatabase')
    'planora-todo'        = $shared + @(
        'ConnectionStrings__TodoDatabase',
        'GrpcServices__AuthApi',
        'GrpcServices__CategoryApi'
    )
    'planora-messaging'   = $shared + @(
        'ConnectionStrings__MessagingDatabase',
        'GrpcServices__AuthApi'
    )
    'planora-collaboration' = $shared + @(
        'ConnectionStrings__CollaborationDatabase',
        'GrpcServices__AuthApi',
        'GrpcServices__TodoApi'
    )
    'planora-realtime'    = $shared
    'planora-gateway'     = $shared + @('Frontend__BaseUrl')
    'planora-outbox-worker' = $shared
    'planora-migrator'    = @(
        'ConnectionStrings__AuthDatabase',
        'ConnectionStrings__CategoryDatabase',
        'ConnectionStrings__TodoDatabase',
        'ConnectionStrings__MessagingDatabase',
        'ConnectionStrings__CollaborationDatabase'
    )
}

# Sensible defaults injected when the env file omits them
if (-not $secrets.ContainsKey('GrpcServices__AuthApi')) {
    $secrets['GrpcServices__AuthApi'] = 'https://planora-auth.internal:443'
}
if (-not $secrets.ContainsKey('GrpcServices__CategoryApi')) {
    $secrets['GrpcServices__CategoryApi'] = 'https://planora-category.internal:443'
}

# Push --------------------------------------------------------------------------
foreach ($app in $matrix.Keys) {
    Write-Host "`n--- $app ---" -ForegroundColor Yellow
    $relevant = $matrix[$app]
    $payload = @{}
    foreach ($key in $relevant) {
        if ($secrets.ContainsKey($key) -and -not [string]::IsNullOrWhiteSpace($secrets[$key])) {
            $payload[$key] = $secrets[$key]
        }
    }
    if ($payload.Count -eq 0) {
        Write-Host "  no matching variables in env file — skip" -ForegroundColor DarkGray
        continue
    }

    Write-Host ("  staging: " + ($payload.Keys -join ', ')) -ForegroundColor DarkCyan
    if ($DryRun) {
        continue
    }

    $args = @('secrets', 'set', '--stage', '--app', $app)
    foreach ($k in $payload.Keys) {
        # PowerShell passes args through verbatim; flyctl handles the `=` split.
        $args += "$k=$($payload[$k])"
    }

    & flyctl @args
    if ($LASTEXITCODE -ne 0) {
        Write-Error "flyctl secrets set failed for $app."
    }
}

Write-Host "`nAll secret stages queued." -ForegroundColor Green
if ($DryRun) {
    Write-Host '  --DryRun supplied — no secrets were actually pushed.' -ForegroundColor Yellow
} else {
    Write-Host "  The next 'flyctl deploy' (or tag push to trigger CD) will activate them." -ForegroundColor Cyan
}
