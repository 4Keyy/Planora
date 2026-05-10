# Operations Runbook

For complete deployment/configuration details, read:

- [`configuration.md`](configuration.md)
- [`deployment.md`](deployment.md)
- [`production.md`](production.md)
- [`secrets-management.md`](secrets-management.md)
- [`troubleshooting.md`](troubleshooting.md)
- [`auth-security.md`](auth-security.md)

## Local Operations

Start Docker backend containers plus local frontend:

```powershell
.\Start-Planora-Docker.ps1
```

Start infrastructure containers plus local .NET backend services:

```powershell
.\Start-Planora-Local.ps1
```

Both scripts preserve data volumes by default.

## Health Checks

```powershell
Invoke-WebRequest http://localhost:5132/health
Invoke-WebRequest http://localhost:5132/auth/health
Invoke-WebRequest http://localhost:5132/todos/health
Invoke-WebRequest http://localhost:5132/categories/health
Invoke-WebRequest http://localhost:5132/messaging/health
Invoke-WebRequest http://localhost:5132/realtime/health
```

## Logs

Launcher transcripts are written under `logs/` by the PowerShell scripts. Backend services also use Serilog console/file configuration in service startup.

Useful commands:

```powershell
docker compose logs api-gateway --tail=100
docker compose logs auth-api --tail=100
docker compose logs todo-api --tail=100
docker compose ps
```

## Required Secrets

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `JWT_SECRET`

`JWT_SECRET` must be consistent across every service.

## Incident Pointers

| Incident | First document |
|---|---|
| startup failure | [`troubleshooting.md`](troubleshooting.md#startup-problems) |
| auth/session failure | [`troubleshooting.md`](troubleshooting.md#authentication-problems) |
| config drift | [`configuration.md`](configuration.md#known-configuration-inconsistencies-to-keep-visible) |
| production hardening | [`production.md`](production.md) |
| secret rotation | [`secrets-management.md`](secrets-management.md#rotation-guidance) |
| e2e failure | [`testing.md`](testing.md#playwright-e2e) |
