# ADR 0001: Microservices And Database-Per-Service

## Status

Accepted.

## Context

Planora separates identity, todos, categories, messages, realtime delivery, and gateway ingress. These domains have different authorization rules and failure modes.

## Decision

Use .NET microservices with database-per-service ownership:

- Auth owns users, sessions, friendships, verification, password reset, and deletion events.
- Todo owns todo items, shares, hidden state, and viewer preferences.
- Category owns user categories.
- Messaging owns direct messages.
- Realtime owns connection tracking and push fan-out.
- Gateway owns browser routing and ingress concerns.

Services communicate through HTTP via the gateway, gRPC for synchronous boundary checks, and RabbitMQ integration events for async cleanup/notifications.

## Consequences

### Implementation Note — 2026-10-06

The implemented system now has six domain services plus the gateway. Collaboration owns
stored user/system/reply comments and obtains the live task description/access rules from
Todo over gRPC. Realtime conditionally owns the durable notification read-model in
`planora_realtime`; its delivery-state table remains a scaffold without a runtime writer.
These additions extend the database-per-service decision above.

The migration runner is an explicit administrative exception: its Collaboration backfill
reads the legacy Todo comment table and writes Collaboration during cutover. Runtime domain
services do not share databases. See [architecture.md](../architecture.md) and
[database.md](../database.md) for current topology, transaction boundaries and schema gaps.

### Original Tradeoffs

Positive:

- Service ownership is explicit.
- Tests can target handler behavior inside each boundary.
- No service can silently query another service database.
- Security checks such as friendship and category ownership have clear API boundaries.

Tradeoffs:

- Local startup requires more infrastructure.
- Cross-service flows need contract tests.
- Documentation must stay current or navigation becomes expensive.
