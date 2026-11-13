# Production Deployment Baseline

This is the release specification for the committed deployment targets.
The [Cloud.ru checkpoint](audits/planora-deep-audit/results/CLOUDRU_20261106.md)
records what was verified on the temporary host. The
[known limitations](known-limitations.md) records remaining code, migration and
workflow gaps.

<!-- contents:start -->
## Contents

- [Committed target and missing pieces](#committed-target-and-missing-pieces)
- [Temporary Cloud.ru deployment](#temporary-cloudru-deployment)
- [Required runtime configuration](#required-runtime-configuration)
- [Database rollout acceptance](#database-rollout-acceptance)
- [Release verification](#release-verification)
- [Rollback and incident handling](#rollback-and-incident-handling)
- [Outstanding production decisions](#outstanding-production-decisions)
<!-- contents:end -->

## Committed target and missing pieces

The automated backend deployment target is Fly.io. Nine manifests, app creation and
secret staging scripts, a migration CLI and `.github/workflows/cd.yml` are
committed. The CD workflow requests blue/green service deployments after a
migration step, then gateway deployment and health smoke. A separate Compose
target builds the production frontend for the temporary Cloud.ru VM. The repository
does not have a Kubernetes/Helm or Terraform stack or a separate outbox worker.

```mermaid
flowchart LR
    browser[Browser] --> frontend[Next.js hosting: unresolved]
    browser --> gateway[External gateway]
    gateway --> auth[Auth]
    gateway --> category[Category]
    gateway --> todo[Todo]
    gateway --> collaboration[Collaboration]
    gateway --> messaging[Messaging]
    gateway --> realtime[Realtime]
    todo --> auth
    todo --> category
    collaboration --> auth
    collaboration --> todo
    messaging --> auth
    auth --> pg[(PostgreSQL)]
    category --> pg
    todo --> pg
    collaboration --> pg
    messaging --> pg
    realtime --> pg
```

The diagram shows logical API/data relationships; actual network exposure,
TLS, listener protocols, private addressing, Redis and RabbitMQ dependencies
must be validated from effective deployment configuration.

## Temporary Cloud.ru deployment

Use the [Cloud.ru runbook](../deploy/cloudru/README.md) for the Compose host.
Caddy serves the public HTTPS origin, forwards API paths to the gateway and
other routes to Next.js. The databases, Redis, RabbitMQ and application services
use the private Docker network. The Fly CD workflow does not deploy this host.

The initial migration restored six PostgreSQL databases, the Redis encryption
key ring, RabbitMQ storage and uploads, with a verified recovery copy off the VM.
The [migration checkpoint](audits/planora-deep-audit/results/CLOUDRU_20261106.md)
records the source checks, tested release and open acceptance items. This is a
single-server deployment. Plan backup retention and repeat the restore drill as
new production data accumulates.

## Required runtime configuration

| Area | Acceptance requirement | Source |
|---|---|---|
| Public origins | Concrete frontend/gateway HTTPS origins; frontend API values fixed at build time | `frontend/next.config.js`, `frontend/src/lib/config.ts` |
| Cookie transport | HTTPS and Auth `Security:RequireHttps` enabled/default-secure | `AuthenticationController.cs` |
| Identity | Identical issuer, audience and JWT signing secret at gateway/services | `JwtAuthenticationExtensions.cs`, service startup |
| Internal RPC | Shared service key; working Auth/Category/Todo HTTP/2 endpoints | `GrpcContracts/Protos`, gRPC clients/interceptors |
| Listener ports | Effective Kestrel endpoints match Fly internal ports | Service `appsettings.json`, `deploy/fly/*.fly.toml` |
| Gateway routes | Production Ocelot targets point to actual service hosts | `Planora.ApiGateway/Program.cs`, route files |
| Databases | Six separately owned schemas/databases when durable Realtime is enabled | `docs/database.md` |
| Distributed limiting | Configure Redis in services; account for gateway in-memory limiter and middleware order | `docs/auth-security.md` |
| CORS | Explicit frontend allow-list; no development LAN wildcard assumption | Gateway/service startup |
| Forwarded headers | Gateway known-proxy array of literal IP addresses; current parser does not accept CIDR | `Planora.ApiGateway/Program.cs` |
| Email | SMTP provider/credentials/sender and correct `Frontend__BaseUrl` | Auth EmailOptions/EmailService |
| Uploads | Persistent and writable storage at the path the avatar writer actually uses | Auth profile-picture handlers, `auth.fly.toml` |
| Monitoring | Compatible OTLP endpoint/protocol and optional Loki; collector access controls | `docs/observability.md` |

Use [Configuration](configuration.md) and [Secrets](secrets-management.md) for
key names. Example env files are not secret stores and are not automatically
applied by Fly. `Start-Planora-Local.ps1 -Prod` is a LAN simulation which disables
secure-cookie enforcement for plain HTTP; it is not a production deployment recipe.

## Database rollout acceptance

1. Validate Todo's reviewed migration chain on a clean database and a restored legacy copy.
2. Establish a tracked migration history for services currently bootstrapped by
   `EnsureCreatedAsync`; an existing model-created database needs a deliberate
   baseline strategy. Do not equate model creation with schema upgrades.
3. Build the migrator image and verify its six-service dependency graph and startup.
4. Provide every selected connection string, including Realtime, to the runner.
5. Run `--all --list-pending` against the intended environment, inspect migration
   IDs and SQL artifacts, then apply the reviewed release.
6. Verify application/schema compatibility before admitting traffic. Startup
   schema initialization remains active in all six service hosts; CD has not disabled them.
7. Keep backup/restore evidence and a tested forward-fix or compatible image
   rollback path. The runner's missing-history guard is not a model drift audit.

See [Deployment blockers](deployment.md#confirmed-rollout-blockers) and
[Database governance](database.md). The migration artifact job restores/builds and generates
SQL for all six contexts. Inspect those artifacts and apply them to a disposable database;
artifact generation alone does not establish a safe upgrade.

## Release verification

Before promotion, record image/ref, effective non-secret settings, migration
IDs, test reports, operator and observation window. Successful health responses
are necessary but insufficient, particularly for the empty gateway/Realtime
health-check registrations.

- Probe every host and gateway service alias; inspect service logs.
- Exercise register, verification link, login, refresh, logout and revocation.
- Confirm cookies and CSRF behavior on the chosen real origins.
- Create category/task and validate list/detail/update persistence.
- Exercise owner, accepted friend, unrelated user, hidden viewer and revoked
  participant cases using the [authorization audit](security-idor-coverage.md).
- Validate comments/replies/subtasks, notification REST reads and SignalR push.
- Validate avatar upload/static serving after restart and after a new deploy.
- Confirm actual trace/log/metric arrival and inspect collector label names.
- Confirm database backup restoration in an isolated environment.

Review the maintained [authorization coverage map](security-idor-coverage.md) for remaining
access-control constraints. Re-run the release tests and restore drill against the chosen
revision and environment; documentation updates alone do not establish readiness.

## Rollback and incident handling

Use immutable release references/images. Blue/green service deployment does
not roll back database changes, secrets, uploads or a frontend deployed
elsewhere. Document the last compatible schema/image pair, required restore
procedure, credentials rotation impact and verification steps before promoting.
CD has no dedicated manual rollback workflow. Dispatching an older ref is a
new deployment and still runs the migrator unless explicitly skipped; inspect
schema compatibility before doing so.

## Outstanding production decisions

| Decision / gap | Evidence needed to close it |
|---|---|
| Next.js hosting and deployment | Working build/start, origin config, TLS and deploy rollback |
| Fly public/private service exposure | Allocated addresses and verified effective networking; manifest comments are insufficient |
| Avatar persistence path | Upload/redeploy/serve test against the mounted volume |
| PostgreSQL backup and retention | Provider policy plus successful restore drill |
| Operational dashboards and SLOs | Exported metric samples, deployed rules and routing of alerts |
| Worker extraction | Implemented worker project and controlled ownership transfer; current manifest is reserved |
| Authorization and event reliability gaps | Reviewed code/test changes addressing the audit findings |
