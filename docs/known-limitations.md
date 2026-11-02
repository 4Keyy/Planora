# Known Limitations

Use this page to locate implementation constraints before changing behaviour or preparing
a release. Linked source and maintained references take precedence over old measurements.
Passing unit tests does not establish production readiness or exhaustive security coverage.

## Data and deployment

- Schema startup is active in service hosts. Starting an API can apply migrations and run
  retention; use isolated databases for verification. See [database initialization](database.md#startup-and-schema-initialization).
- Todo has a reviewed historical migration chain and guarded adoption of compatible
  model-created schemas. Unknown or partial schemas are rejected. Validate both fresh and
  upgraded PostgreSQL databases for every schema release.
- Auth, Category, Messaging and Collaboration use model creation when no migrations are
  compiled. `EnsureCreatedAsync` does not upgrade an existing database.
- Fly deployment still requires verified service addresses, listeners, secrets, persistent
  avatar storage and a production frontend target. See [rollout blockers](deployment.md#confirmed-rollout-blockers).
- Redis contains authentication Data Protection keys as well as session/rate-limit state.
  A PostgreSQL-only backup does not preserve the ability to decrypt every user's 2FA secret.
- The default Compose Auth container has no persistent avatar mount. Preserve any avatars
  in its writable layer before recreating that container.

## Authorization and sessions

- Check the [authorization map](security-idor-coverage.md#known-findings-and-missing-regressions)
  for remaining branch-access and subscription-revocation constraints.
- Security-stamp lookups have fail-open behaviour and a fixed cache TTL; existing realtime
  subscriptions are not uniformly reauthorized on every access change.
- Friend and affinity caches isolate cached data and in-flight results by viewer. Preserve
  account-switch, logout and late-response regressions when changing shared caches.
- Public token-validation responses do not substitute for authenticated access checks.
  See [security limitations](auth-security.md#known-security-gaps--clarifications).

## Delivery and consistency

- Inbox registration, business-write/outbox atomicity and consumer idempotence vary by
  service. Replaying an event does not establish exactly-once effects.
- Outbox retry scheduling and multi-instance recovery need verification at the query/claim
  boundary. A state-machine unit test alone cannot prove those boundaries.
- Durable notification storage does not guarantee browser receipt or complete reconnect
  replay. See [delivery semantics](architecture.md#outbox-delivery-semantics).
- Account/friendship removal and retention span independent service stores; verify related
  worker, comment and notification records when changing cleanup policy.

## Verification boundaries

- PostgreSQL-specific suites create and remove test databases. Supply only a disposable
  PostgreSQL server through `PLANORA_TEST_POSTGRES`.
- Browser suites require explicit frontend, gateway and test SMTP endpoints. Inspect skips
  and retries; discovery or a successful retry is not a clean first-pass result.
- Frontend pages and the task editor have directory-specific coverage ratchets. Keep these
  gates; improving coverage is preferable to lowering thresholds.
- Large component decomposition remains incremental work. Preserve route-specific actions,
  notices, layout and motion when extracting shared logic.
- Hosting accounts, GitHub settings and deployed infrastructure require their own checks.
  Repository manifests describe intent, not evidence of a running release.

See [testing](testing.md), [production requirements](production.md) and
[backup and recovery](backup-recovery.md) for acceptance procedures.
