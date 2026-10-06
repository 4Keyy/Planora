# Fly.io Deployment Manifests

These are reviewable deployment templates and bootstrap scripts. They contain
no real secrets. The [deployment guide](../../docs/deployment.md) records
confirmed rollout blockers; a valid TOML file or green prerequisite checker
does not mean this checkout can be promoted successfully.

## Layout

| Manifest | App | Role |
|---|---|---|
| `gateway.fly.toml` | `planora-gateway` | Ocelot edge |
| `auth.fly.toml` | `planora-auth` | Identity, sessions, friendship, avatar serving |
| `category.fly.toml` | `planora-category` | Categories and category gRPC |
| `todo.fly.toml` | `planora-todo` | Tasks and Todo gRPC |
| `collaboration.fly.toml` | `planora-collaboration` | Comments/replies and timeline |
| `messaging.fly.toml` | `planora-messaging` | Direct messages |
| `realtime.fly.toml` | `planora-realtime` | SignalR and optional persistent notifications |
| `migrator.fly.toml` | `planora-migrator` | Implemented one-shot CLI; Docker build graph currently incomplete |
| `outbox-worker.fly.toml` | `planora-outbox-worker` | Reserved only; referenced worker project/Dockerfile is absent |

The migrator manifest's old reserved comment is stale: the CLI is now in the
solution. The outbox worker remains reserved and is not deployed by the CD
service matrix. HTTP manifests declare port `8080`; verify effective Kestrel
settings before deployment. Most API manifests declare auto-stop plus
`min_machines_running=1`; this does not mean zero always-on machines in the
primary region. Gateway and Realtime auto-stop is off.

## Bootstrap scripts

`setup.ps1`, `set-secrets.ps1` and the prerequisite checker require
**PowerShell 7**. Run from the repository root with `pwsh`; the application
launchers have a separate PowerShell 5.1-compatible contract.

```powershell
$flyOrganization = 'replace-with-your-organization'
pwsh -File deploy/fly/setup.ps1 -Org $flyOrganization
Copy-Item deploy/fly/.env.fly.example deploy/fly/.env.fly
# Fill the ignored file with values for the intended environment.
pwsh -File deploy/fly/set-secrets.ps1 -DryRun
```

`setup.ps1` creates every app discovered from `*.fly.toml`, including the
reserved worker. `-DryRun` prints selected key names, not values; it still
requires `flyctl` and parses the file. Normal `set-secrets.ps1` uses
`flyctl secrets set --stage`; staged values activate on a subsequent deploy.
It does not reject missing required values or validate app-specific runtime
requirements. Do not use it as a completeness check.

## Actual secret selection

The script selects a shared set for API apps: JWT key, gRPC key, Redis
connection, RabbitMQ host/user/password, optional OTLP and Loki keys. Runtime
requirements differ: the gateway does not use the broker/Redis, and the
migrator needs database configuration rather than those shared API secrets.

| App | Additional keys selected by `set-secrets.ps1` |
|---|---|
| Auth | `ConnectionStrings__AuthDatabase`, email options, `Frontend__BaseUrl` |
| Category | `ConnectionStrings__CategoryDatabase` |
| Todo | `ConnectionStrings__TodoDatabase`, `GrpcServices__AuthApi`, `GrpcServices__CategoryApi` |
| Messaging | `ConnectionStrings__MessagingDatabase`, `GrpcServices__AuthApi` |
| Collaboration | `ConnectionStrings__CollaborationDatabase`, `GrpcServices__AuthApi`, `GrpcServices__TodoApi` |
| Realtime | Shared set only; **RealtimeDatabase is missing from the script** |
| Gateway | Shared set plus `Frontend__BaseUrl` |
| Migrator | Auth, Category, Todo, Messaging, Collaboration database strings; **RealtimeDatabase is missing** |

For durable notifications, both Realtime and the migrator require
`ConnectionStrings__RealtimeDatabase`; the current script must be corrected
or the key supplied separately. `GrpcServices__TodoApi` has no injected default
in the script. Default Auth/Category URLs use `https://<app>.internal:443`:
these are configured strings, not evidence of working TLS, HTTP/2 or Flycast.
A `.internal` hostname does not itself prove application-layer mTLS. Verify
DNS, certificates, listeners and routing in the target network.

Use [Secrets management](../../docs/secrets-management.md) for the complete
runtime inventory and rotation impact. `Cors__AllowedOrigins__N`, effective
Kestrel endpoints and production gateway routes also need explicit planning;
the current staging script is not a universal configuration deployment tool.

## Delivery workflow and blockers

`.github/workflows/cd.yml` exists and triggers on `v*` tags or manual dispatch.
It validates manifests, invokes the migrator, requests blue/green service
deployments, deploys gateway after the service matrix, then probes gateway
health. No frontend deploy step exists.

Before activation, resolve:

- incomplete Todo migration baseline and migrator Docker COPY graph;
- local Ocelot targets selected by `ASPNETCORE_ENVIRONMENT=Production`;
- effective listener ports/protocols versus manifest port `8080`;
- missing Realtime DB secret selection and explicit schema initialization;
- reserved worker manifest included in blanket validation;
- actual app exposure and Auth avatar volume/write-path alignment.

The prerequisite checker asks for the same five common secrets on every app,
including the migrator, rather than this per-app matrix. It misses required DB
connections, RabbitMQ username, effective ports, production route selection,
test failures, and Docker build correctness. Its zero exit code is only the
result of those limited checks. See [Production acceptance](../../docs/production.md).

## Persistent avatars

`auth.fly.toml` declares a `planora_auth_uploads` mount at `/data/uploads`
and `ASPNETCORE_WEBROOT=/data/uploads`. This is a persistence intention;
confirm the running host honors that webroot and the profile-picture writer
uses it. A mounted volume alone does not prove avatar durability.

```powershell
flyctl volumes create planora_auth_uploads --app planora-auth --region ams --size 3
```

The example is an operator provisioning command, not part of the bootstrap
script. Verify access permissions, machine-to-volume placement and behavior
after redeploy. Local filesystem volumes do not automatically replicate avatar
content between independently mounted replicas. No R2 upload implementation
is present in the audited checkout.

## PostgreSQL and observability

Compose configures `idle_in_transaction_session_timeout=30000` and per-service
connection pools of 10. A managed production provider needs equivalent tuning
and capacity planning applied through its own configuration; local Compose
does not configure that provider.

OTLP uses the exporter protocol configured by the .NET library defaults
(gRPC here); choose a compatible collector endpoint. Loki is optional.
[`observability.md`](../../docs/observability.md) explains configuration
precedence, emitted instruments and collector-dependent query examples.
`gateway.fly.toml` declares a reserved `/metrics` scrape path, but no
Prometheus scrape endpoint is registered in gateway startup.

## Related references

- [Deployment](../../docs/deployment.md)
- [Production baseline](../../docs/production.md)
- [Operations](../../docs/OPERATIONS.md)
- [Audit](../../docs/audits/2026-10-06.md)
