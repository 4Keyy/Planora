# Security Policy

This file is the public security policy for Planora. The full implementation reference is [`docs/auth-security.md`](docs/auth-security.md), and production secret handling is documented in [`docs/secrets-management.md`](docs/secrets-management.md).

## Supported Versions

| Version / branch | Supported |
|---|---|
| `main` | yes |
| Released tags | not confirmed in the repository |
| Older branches | not confirmed in the repository |

No release support matrix was found in the repository. Until releases are formalized, security fixes should target `main`.

## Reporting A Vulnerability

Use GitHub Private Vulnerability Reporting for this repository.

Maintainer action required: enable it in GitHub under repository settings before publishing this project as an open-source repository. No project-specific security email address was found in the codebase or existing docs, so this policy does not invent one.

Do not open a public issue for exploitable vulnerabilities. Include:

- affected commit, branch, or version;
- exact reproduction steps;
- expected and actual behavior;
- impact assessment;
- logs, request examples, or screenshots when safe to share;
- whether the issue is already public or actively exploited.

## Response Expectations

| Step | Target |
|---|---|
| Initial acknowledgement | 3 business days |
| Triage and severity assessment | 7 business days |
| Fix plan for confirmed high/critical issues | 14 business days |
| Public disclosure | after a fix or mitigation is available |

These targets are policy goals, not automated guarantees in the current repository.

## Confirmed Security Model

- Access tokens are JWTs and are kept in frontend memory.
- Refresh tokens are stored as httpOnly `refresh_token` cookies scoped to `/auth/api/v1/auth`.
- Register/login/refresh responses do not return the raw refresh token in JSON.
- Browser state-changing requests require a double-submit CSRF token.
- Protected services validate JWT issuer, audience, lifetime, and signing key locally.
- Admin-only endpoints use `[Authorize(Roles = "Admin")]`.
- Password validation includes length/complexity checks, weak-pattern checks, optional HIBP lookup, and password history checks.
- Backend and frontend set security headers.
- CORS uses explicit origins with credentials.

Key code:

- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/JwtAuthenticationExtensions.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs`
- `frontend/src/store/auth.ts`
- `frontend/src/lib/csrf.ts`
- `frontend/next.config.js`

## Required Secret Hygiene

Never commit `.env`. At minimum, set strong local/production values for:

- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `RABBITMQ_USER`
- `RABBITMQ_PASSWORD`
- `JWT_SECRET`

`JWT_SECRET` must be at least 32 characters and identical across the gateway and every backend service.

## Production Security Notes

The repository now includes a production baseline, but no automated production deployment target is committed. Before production use, define:

- HTTPS termination and forwarded header policy;
- secure cookie behavior behind the proxy;
- secret management outside plaintext `.env` files;
- network isolation for PostgreSQL, Redis, and RabbitMQ;
- RabbitMQ AMQP binding/firewalling;
- backup/restore and migration policy;
- observability sinks and alerting.

References:

- [`docs/production.md`](docs/production.md)
- [`docs/secrets-management.md`](docs/secrets-management.md)
- [`.env.production.example`](.env.production.example)
