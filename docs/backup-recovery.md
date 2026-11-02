# Backup and Recovery

A recovery set must preserve databases, encryption keys, messages and uploaded files together.
Keep backups outside the checkout, restrict access to the owner and administrators, and test
restoration before relying on them. Never publish backups, credentials or diagnostic payloads.

<!-- contents:start -->
## Contents

- [Recovery set](#recovery-set)
- [Establish a consistent checkpoint](#establish-a-consistent-checkpoint)
- [PostgreSQL export example](#postgresql-export-example)
- [Restore drill](#restore-drill)
- [Safe housekeeping](#safe-housekeeping)
<!-- contents:end -->

## Recovery set

| Resource | Preserve | Verify in isolation |
|---|---|---|
| PostgreSQL | Every service database, roles and migration history | Restore, schemas, constraints and checkpoint control counts |
| Redis | Compatible AOF/RDB data, including the Auth Data Protection key ring | Successful load and protected-value decryption |
| RabbitMQ | Definitions and durable message storage with compatible version/node identity | Queues, bindings and message counts without consumers |
| Uploads | Host directories, mounts and Auth container writable-layer avatars | File counts, lengths and SHA-256 |
| Configuration | Required secrets, certificates and keys | Availability and permissions; never print values |
| Development work | Git references, staged/unstaged changes and unique untracked files | Bundle verification and file manifest |

Redis is part of authentication recovery: `Planora:Auth:DataProtection-Keys` protects stored
TOTP secrets. Losing it can make existing 2FA data unreadable even after PostgreSQL restores.
RabbitMQ definitions exports do not contain queued messages.

## Establish a consistent checkpoint

1. Identify the exact Compose project, containers, mounts, host processes and upload paths.
   Inspect necessary metadata only; a full container inspection can expose secrets.
2. Record server versions and application revision. Check backup disk capacity and permissions.
3. Agree a maintenance window. Stop application writers, consumers and owned host processes
   gracefully. Record resource IDs needed to resume them.
4. Export PostgreSQL while writes are stopped. Stop the identified Redis/RabbitMQ instances
   gracefully before taking a complete storage copy, or use their supported consistent online
   procedure. Do not copy a changing volume as an ordinary folder.
5. Preserve host uploads and any existing Auth container files before recreation. The base
   Compose file does not currently mount persistent Auth avatar storage.
6. Write a manifest of source paths, sizes, SHA-256, versions and checkpoint time. Resume the
   original services and verify their health. Keep the original volumes intact.

Retention runs with real deletion at startup in the base configuration. Schema initialization
also runs during startup. Do not start APIs or consumers merely to inspect recovered data.

## PostgreSQL export example

After confirming ownership and stopping application writers, run from the checkout. First
create a private backup directory outside the repository with restricted access. The example
writes dumps inside the identified PostgreSQL container and copies them out without binary
PowerShell redirection; it does not modify application tables.

```powershell
$ErrorActionPreference = 'Stop'
$backupParent = 'F:\PrivateBackups\Planora' # pre-created private directory with restricted access
if (-not (Test-Path -LiteralPath $backupParent -PathType Container)) {
    throw 'Create and secure the private backup parent first.'
}
$checkpointId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N'))
$backupRoot = Join-Path $backupParent $checkpointId
New-Item -ItemType Directory -Path $backupRoot | Out-Null # fails rather than reusing a checkpoint
New-Item -ItemType File -Path (Join-Path $backupRoot 'checkpoint.incomplete') | Out-Null
$postgresContainer = docker compose ps -q postgres
if ($LASTEXITCODE -ne 0 -or @($postgresContainer).Count -ne 1 -or -not $postgresContainer) {
    throw 'Identify exactly one owned PostgreSQL container first.'
}
$remoteDirectory = "/tmp/planora-backup-$checkpointId"
docker exec --user postgres $postgresContainer mkdir $remoteDirectory
if ($LASTEXITCODE -ne 0) { throw 'Cannot create a new container checkpoint directory.' }
$databases = @('planora_auth_db', 'planora_todo', 'planora_category',
    'planora_messaging', 'planora_collaboration', 'planora_realtime')
foreach ($database in $databases) {
    $remoteDump = "$remoteDirectory/$database.dump"
    $localDump = Join-Path $backupRoot "$database.dump"
    if (Test-Path -LiteralPath $localDump) { throw "Refusing to overwrite: $database" }
    docker exec --user postgres $postgresContainer test ! -e $remoteDump
    if ($LASTEXITCODE -ne 0) { throw "Container dump already exists: $database" }
    docker exec --user postgres $postgresContainer pg_dump -U postgres -Fc -f $remoteDump $database
    if ($LASTEXITCODE -ne 0) { throw "Export failed: $database" }
    docker cp "${postgresContainer}:$remoteDump" $localDump
    if ($LASTEXITCODE -ne 0) { throw "Copy failed: $database" }
}
Get-ChildItem -LiteralPath $backupRoot -Filter '*.dump' -File | Get-FileHash -Algorithm SHA256 |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $backupRoot 'postgres-manifest.json') -Encoding UTF8
```

Adjust the inventory for optional databases. Capture required roles separately with
`pg_dumpall --roles-only`; role dumps contain sensitive password hashes. Windows PowerShell
5.1 redirection can corrupt binary `pg_dump -Fc` output, so use `-f` and `docker cp`. Remove
only this checkpoint's temporary container files after the copies are verified.

Keep `checkpoint.incomplete` until the full recovery set (including roles, Redis, RabbitMQ,
uploads and configuration) and its restore drill are verified. The PostgreSQL manifest alone
does not mark a checkpoint complete. Never reuse a previous checkpoint directory.

## Restore drill

1. Create a separate infrastructure-only Compose project on compatible versions, with new
   volumes/networks and free loopback ports. Remove fixed `container_name` entries. Reject
   original data mounts, external volumes and original connection strings before startup.
2. Verify checksums and inspect custom archives using `pg_restore --list`. Restore roles and
   databases only to the isolated server. Keep all APIs, consumers and migrators stopped.
3. Compare schemas, constraints, migration history and checkpoint control counts. Validate
   representative identifiers without copying user content into reports.
4. Load copied Redis data and check the key ring. Verify protected-value decryption using
   the matching application purpose/configuration, reporting success/failure counts only.
5. Load copied RabbitMQ storage with compatible node identity and no consumers. Compare
   definitions and durable message counts. Compare uploads with the file manifest.
6. Record exit codes and mismatches privately. Keep originals and backups until all required
   resources pass. A valid checksum alone does not demonstrate successful restoration.

Use a different empty disposable stack for API/UI tests. Disable retention there, route SMTP
to Mailpit and block external integrations. Retention regressions may enable their policies
only on dedicated test databases. A different Compose project name alone does not isolate
fixed container names, ports or bind mounts.

## Safe housekeeping

Archive unique notes, logs and evidence first. Delete only identified reproducible artifacts
after checking ownership, active processes, absolute paths and reparse points. Keep backups.
Never use global Docker/volume prune, Redis flush, schema reset or `compose down -v` on the
working stack as cleanup. See [operations](OPERATIONS.md), [database](database.md) and
[secret management](secrets-management.md) for runtime contracts.
