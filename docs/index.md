# Planora Documentation

Start with the task you need to complete. These guides describe implemented behaviour;
architectural policies and release requirements are identified separately.

## Find your guide

| Task | Read first | Next step |
|---|---|---|
| Run Planora locally | [Getting started](getting-started.md) | [Troubleshooting](troubleshooting.md) |
| Understand the product | [Overview](overview.md) | [Features](features.md), [glossary](glossary.md) |
| Change backend behaviour | [Architecture](architecture.md) | [API](API.md), [database](database.md), [invariants](INVARIANTS.md) |
| Change the frontend | [Frontend](frontend.md) | [Design system](design-system.md), [testing](testing.md) |
| Find source code | [Codebase map](codebase-map.md) | [Development](development.md) |
| Diagnose access or sessions | [Authentication and security](auth-security.md) | [Authorization coverage](security-idor-coverage.md) |
| Operate the stack | [Operations](OPERATIONS.md) | [Configuration](configuration.md), [observability](observability.md) |
| Protect or restore data | [Backup and recovery](backup-recovery.md) | [Database](database.md), [secrets management](secrets-management.md) |
| Prepare a release | [Deployment](deployment.md) | [Production requirements](production.md), [known limitations](known-limitations.md) |
| Contribute a change | [Contributing](../CONTRIBUTING.md) | [Development](development.md), [testing](testing.md) |

## Product and application

- [Overview](overview.md): purpose, domain model and supported scenarios.
- [Features](features.md): behaviour, permissions and route-specific differences.
- [Getting started](getting-started.md): prerequisites, launch modes and first-user flow.
- [FAQ](faq.md) and [troubleshooting](troubleshooting.md): common questions and failures.
- [Glossary](glossary.md): shared product and engineering vocabulary.
- [Frontend](frontend.md): rendering, data access, state, keyboard behaviour and composition.
- [Design system](design-system.md): tokens, components, motion and accessibility rules.

## Architecture and contracts

- [Architecture](architecture.md): service boundaries, communication and delivery semantics.
- [Codebase map](codebase-map.md): source and tooling by responsibility.
- [API reference](API.md): HTTP routes, request/response shapes and errors.
- [Database](database.md): data ownership, models and schema initialization.
- [Caching](caching.md): keys, TTLs, invalidation and isolation.
- [Invariants](INVARIANTS.md): engineering rules and implementation gaps.
- [Architecture decisions](DECISIONS/): retained decisions and their historical context.

## Security and operations

- [Authentication and security](auth-security.md), [authorization coverage](security-idor-coverage.md).
- [Security reporting](../SECURITY.md) and [secret management](secrets-management.md).
- [Operations](OPERATIONS.md), [configuration](configuration.md), [backup and recovery](backup-recovery.md).
- [Deployment](deployment.md), [Fly setup](../deploy/fly/README.md), [production requirements](production.md).
- [Observability](observability.md), [service objectives](slo.md), [known limitations](known-limitations.md).

## Development and verification

- [Contributing](../CONTRIBUTING.md) and [development workflow](development.md).
- [Test guide](testing.md), [test summary](../TESTING.md), [E2E setup](../frontend/e2e/README.md).
- [Performance scenarios](../perf/README.md).
- [Documentation checks](../tools/docs/README.md) and [interface checks](../tools/ui-audit/README.md).
- [Changelog](../CHANGELOG.md) and [license](../LICENSE).

## Maintaining these guides

Update the relevant guide alongside changes to its contract, commands or configuration.
Use one maintained source for each topic and link to it from summaries. Keep measurements
with their commit, environment and command; a historical result is not a current guarantee.
Personal working notes and generated test results belong outside published documentation.

Run the [documentation checks](../tools/docs/README.md) before committing. They inspect
Git-listed documents, including local links, anchors, images and path case. Operational
commands also need an isolated execution check; syntax and links alone do not prove safety.
