# Secret Management

Implementation reviewed on **2026-10-06**. Use [configuration](configuration.md) for the
full key reference, [deployment](deployment.md) for rollout requirements, and
[authentication/security](auth-security.md) for credential behavior. Values below are
names and placeholders; no local credential files were read for this audit.

## Secret Inventory

| Secret / configuration key | Consumers | Purpose and minimum |
|---|---|---|
| `JWT_SECRET` → `JwtSettings__Secret` in Compose | gateway and six APIs | signs/validates access JWTs; startup validator requires at least 32 characters |
| `POSTGRES_PASSWORD` / `ConnectionStrings__*Database` | PostgreSQL, matching API, migrator | database credentials; connection strings are secrets when they contain passwords |
| `REDIS_PASSWORD` / `Redis__Configuration` | Redis, APIs and configured workers | cache, revocation stamps, rate windows, TOTP replay and Auth Data Protection key ring |
| `RABBITMQ_USER`, `RABBITMQ_PASSWORD` → `RabbitMq__UserName`, `RabbitMq__Password` | broker, producers/consumers and configured workers | broker access; username is configuration but must match the credential pair |
| `GRPC_SERVICE_KEY` → `GrpcSettings__ServiceKey` in Compose | Auth, Category, Todo, Messaging, Realtime servers; all internal clients including Collaboration | shared `x-service-key` trust; interceptor minimum 16 characters, use a random value of at least 32 |
| `Email__Password` | Auth, when SMTP enabled | SMTP password; GmailSmtp requires a Google App Password |
| `OTEL_EXPORTER_OTLP_HEADERS` | processes using configured OTLP exporter | may carry observability authorization; store as a secret |
| `LOKI_TOKEN` | processes using configured Loki sink | Loki basic-auth password/API token |
| `FLY_API_TOKEN` | GitHub Actions CD | Fly deployment credential in repository/environment secrets |
| Auth Data Protection key ring (`Planora:Auth:DataProtection-Keys`) | Auth Redis storage and backups | encryption material for TOTP secrets; protect and retain alongside Auth DB backups |

The gateway is an HTTP/WebSocket proxy: it validates JWTs but does not need a gRPC
service key, broker password or database credential. The migrator uses the selected
database connection strings and needs no JWT, gRPC, Redis or RabbitMQ credential.
The shared key authenticates an internal service; it is not a separate end-user token
and does not establish encrypted transport by itself.

### Database consumers

| Key | Runtime API | Migrator service selector |
|---|---|---|
| `ConnectionStrings__AuthDatabase` | Auth | `auth` |
| `ConnectionStrings__CategoryDatabase` | Category | `category` |
| `ConnectionStrings__TodoDatabase` | Todo | `todo` |
| `ConnectionStrings__MessagingDatabase` | Messaging | `messaging` |
| `ConnectionStrings__CollaborationDatabase` | Collaboration | `collaboration` |
| `ConnectionStrings__RealtimeDatabase` | Realtime durable notification read store | `realtime` |

Realtime selects a null read store when its database connection is absent: notification
list/summary return empty state and mark-read does nothing. This is optional fallback
behavior, not equivalent to a configured durable notification inbox.

### Configuration that is not inherently secret

`Frontend__BaseUrl`, `Cors__AllowedOrigins__*`, JWT issuer/audience, gRPC URLs,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OpenTelemetry__OtlpEndpoint`, `LOKI_URL` and
`Serilog__LokiUrl` normally identify endpoints/policies rather than credentials.
Endpoint URLs become sensitive if credentials are embedded. `Email__Username` and
`LOKI_USER` can identify an account/tenant and should be handled according to its policy.

The OTLP endpoint uses the configuration key before the environment fallback; Loki
does the same (`Serilog:LokiUrl` before `LOKI_URL`). An empty explicitly configured
value can prevent the fallback. See [observability](observability.md) for the exact keys.

## Storage Rules

- Local development: copy [.env.example](../.env.example) to `.env`; keep actual values untracked.
- Production: use the hosting secret manager; do not bake credentials into images or committed manifests.
- CI e2e generates temporary values in `.env.e2e`; those values are not production credentials.
- Templates [.env.example](../.env.example) and [.env.production.example](../.env.production.example) contain examples/placeholders.
- Do not copy assistant OAuth/session credentials into project or assistant configuration.
- Restrict Redis, PostgreSQL, RabbitMQ, log and backup access. Auth's default `Email:Provider=Log` writes reset/verification links into logs; those links are bearer credentials until used or expired.

TOTP secrets are encrypted with Data Protection purpose `Planora.TwoFactorSecret.v1`
and application name `Planora.Auth`. Backing up the Auth DB without its Redis key ring
can make existing TOTP secrets undecryptable. Persisting the ring to Redis is not proof
that Redis backups, TLS or at-rest encryption are configured; verify those separately.

## Generation Guidance

This generator works in Windows PowerShell 5.1 and PowerShell 7. It assigns the value
without printing it; use the assigned variable with the intended secret store.

```powershell
$secretBytes = New-Object byte[] 48
$secretGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $secretGenerator.GetBytes($secretBytes)
    $generatedSecret = [Convert]::ToBase64String($secretBytes)
}
finally {
    $secretGenerator.Dispose()
}
```

Generate an independent value for each security domain. A shared JWT or gRPC value
must be identical only across its required participants. Avoid saving generated values
to transcripts, screenshots or example files. The Fly helper script requires PowerShell
7; the generator above does not change that script's runtime requirement.

## Rotation Guidance

| Credential | Coordinated rotation and verification |
|---|---|
| JWT secret | Update gateway and all six APIs together; existing JWTs fail signature validation. No multi-key rollover is implemented. Plan for client refresh/sign-in behavior. |
| DB credential | Change the backing role/password, update the matching API and migrator connection strings, reconnect and verify that API's readiness/migration access. |
| Redis credential | Update the server and all actual Redis consumers. Preserve Auth Data Protection keys; flushing Redis can remove revocation/replay markers as well as caches. |
| RabbitMQ credential | Change broker credentials, update producers/consumers/workers, reconnect and verify publish/consume and outbox recovery. |
| gRPC key | Update all participating servers and clients, including Collaboration. No dual-key transition is implemented. Watch `planora.grpc.unauthenticated{reason}` for mismatches. Gateway and migrator need no copy. |
| SMTP password | Revoke the old app password, replace the Auth secret, restart Auth and verify real delivery without exposing the link in public logs. |
| OTLP authorization/Loki token | Replace values only on exporters/sinks using them, restart those processes and check ingestion. They are read when the pipeline is registered. |
| Fly deployment token | Create an appropriately scoped replacement, update the `FLY_API_TOKEN` Actions secret, then revoke the previous token through the provider's supported workflow. Never print it in CI. |

Origin/frontend URL changes are configuration changes: verify verification/reset links,
credentialed CORS and browser requests after changing them. They do not require secret
rotation unless a credential was embedded in the old value.

## GitHub Actions And Fly Secrets

[CI](../.github/workflows/ci.yml), [security scans](../.github/workflows/security.yml)
and [e2e](../.github/workflows/e2e.yml) use build/test inputs or generated temporary
credentials. [CD](../.github/workflows/cd.yml) **already exists** and consumes the
long-lived `FLY_API_TOKEN` secret. It runs on `v*` tags or manual dispatch, runs a
preflight, optionally invokes the migrator, deploys backend apps, deploys the gateway
and checks public health. Repository environment protections and actual secret values
were not inspected.

[deploy/fly/set-secrets.ps1](../deploy/fly/set-secrets.ps1) is a convenience helper,
not a least-privilege inventory. Its shared bundle sends some unnecessary credentials
to apps. The inspected script omits `RealtimeDatabase` for Realtime and the migrator,
and does not fully configure all production gRPC URLs. Check the per-app matrix and
route/listener limitations in [the Fly guide](../deploy/fly/README.md) before running it.
Do not infer mTLS or private transport authorization from a `.internal` hostname alone.

## Scanner Interpretation Of Configuration References

The Email password rule captures a complete Compose variable expression, including
required-variable messages with spaces, before applying the existing interpolation
allowlist. For example, `${E2E_SMTP_PASSWORD:?Set a disposable E2E_SMTP_PASSWORD}`
is a configuration reference, not an embedded credential. Literal email passwords
remain findings. This behavior is verified with gitleaks 8.24.3 against both synthetic
configuration cases and the reviewed PR commit range; no scan gate or rule is disabled.

## Leak Response

1. Revoke/rotate the credential in its backing system immediately.
2. Remove the exposed value from the current content; coordinate any history rewrite with maintainers rather than performing an unapproved force-push.
3. Check provider/application logs for use during the exposure window, including downstream tokens minted with a leaked signing key.
4. Update detection rules when the leak type was missed.
5. Record sensitive evidence in the private channel described in [SECURITY.md](../SECURITY.md).

Relevant implementations: [configuration validation](../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/ConfigurationValidator.cs),
[service-key interceptors](../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/),
[Auth infrastructure](../Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs),
[migrator](../tools/Planora.Migrator/Program.cs), and [Compose](../docker-compose.yml).
