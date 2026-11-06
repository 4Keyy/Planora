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
- Auth, Category, Messaging and Collaboration now require reviewed migration chains and
  guarded schema equivalence/adoption. This local mechanism does not replace deployment
  schema inventory, backup/restore proof and controlled rollout. `EnsureCreatedAsync` does
  not upgrade an existing database.
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
  service. Reviewed Todo mutations and Collaboration comment commands stage their complete
  event sets with the owner save, but consumer effects and inbox recording still commit
  separately. Replaying an event does not establish exactly-once effects.
- Outbox retry scheduling and multi-instance recovery need verification at the query/claim
  boundary. The processor requires one active drainer per service database; the sanitized
  topology validator cannot enforce live exclusivity or make overlapping rollouts safe.
- Stable subscriber IDs now isolate quorum queues/DLQs across services. Existing broker
  topology and retained legacy backlogs still need the reviewed transition/reconciliation
  procedure; changing queue names does not repair earlier missed effects.
- Durable notification storage does not guarantee browser receipt or complete reconnect
  replay. See [delivery semantics](architecture.md#outbox-delivery-semantics).
- Account/friendship removal and retention span independent service stores; verify related
  worker, comment and notification records when changing cleanup policy.

## Verification boundaries

- PostgreSQL-specific suites create and remove test databases. Supply only a disposable
  PostgreSQL server through `PLANORA_TEST_POSTGRES`.
- Live broker tests need a separately verified RabbitMQ fixture and explicit restart
  orchestration. The default CI backend job supplies PostgreSQL only and skips these facts.
- The deep audit remains open, with pending per-file review, integration and operational
  gates. Local regression success and a verified local startup do not certify the release.
- Secret-history scanning remains red pending provenance/usage/revocation decisions;
  do not suppress historical matches merely to obtain a successful security check. See
  [the security checkpoint](audits/planora-deep-audit/results/T12.md).
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
