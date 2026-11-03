# Outbox topology snapshot preflight

The current outbox processor requires one active processor per service database.
This local validator checks a sanitized inventory and proposed rollout before the
live release gate is integrated in T14. It does not contact Docker, Fly, a database
or any production service, and it cannot acquire or enforce runtime ownership.

```powershell
node tools/outbox/validate-topology.mjs path/to/sanitized-inventory.json
node --test tools/outbox/validate-topology.test.mjs
```

Exit `0` means `PASS_SNAPSHOT_PRECONDITION`; exit `1` means `BLOCKED`.
Every report includes `runtimeExclusivityVerified: false` and
`releaseGate: "T14_PENDING"`. A successful result never authorizes deployment.
Diagnostics do not echo supplied identifiers, values or file paths.

## Input contract

The JSON file must be at most 64 KiB and contain exactly these fields:

```json
{
  "schemaVersion": 1,
  "observedAt": "2026-11-02T09:00:00.000Z",
  "source": "docker-inspect",
  "scopeId": "disposable-test-stack",
  "inventoryComplete": true,
  "services": [
    { "name": "auth", "databaseId": "auth-database", "instances": [{ "runtimeId": "auth-instance", "state": "running" }] },
    { "name": "todo", "databaseId": "todo-database", "instances": [{ "runtimeId": "todo-instance", "state": "running" }] },
    { "name": "category", "databaseId": "category-database", "instances": [{ "runtimeId": "category-instance", "state": "running" }] },
    { "name": "messaging", "databaseId": "messaging-database", "instances": [{ "runtimeId": "messaging-instance", "state": "running" }] },
    { "name": "collaboration", "databaseId": "collaboration-database", "instances": [{ "runtimeId": "collaboration-instance", "state": "running" }] }
  ],
  "rollout": {
    "strategy": "stop-before-start",
    "autoscaling": false,
    "automaticStart": false
  }
}
```

The example is synthetic and deliberately becomes stale. Do not refresh its
timestamp and pass it off as observed evidence.

- `observedAt` is a canonical UTC timestamp with millisecond precision, no more
  than five minutes old and never in the future.
- `source` is `docker-inspect` or `fly-machines-list`. The collector must inventory
  the entire relevant scope, including all replicas, old revisions, worker
  processes and stopped or transitioning instances. Merely listing the expected
  containers does not establish completeness.
- `scopeId`, `databaseId` and `runtimeId` are lowercase opaque identifiers using
  letters, digits, dots, underscores and hyphens, with a maximum of 128 characters.
  Use immutable runtime IDs, not display names or replica-count hints.
- `databaseId` identifies the actual outbox database, not a service name or
  connection endpoint. The collector must resolve aliases to the same stable
  identity across all five owners. Use a sanitized mapping or fingerprint; never
  include connection strings, credentials, environment dumps or user data.
- All five current processor owners must appear exactly once. Realtime currently
  has an outbox repository but no hosted processor. Any future processor owner
  requires an explicit schema/validator update and review.
- Every owner must have exactly one observed instance in state `running`.
  Empty inventories, stopped/transitional states and shared database identities
  are blocked. Do not omit additional instances to make the check pass.
- `rollout` describes a reviewed stop-before-start sequence that waits for the
  previous processor to exit. Overlapping strategies, autoscaling and automatic
  starts are rejected. All nested fields are required; unknown fields fail.

## Evidence boundary and T14 handoff

The validator verifies the shape and consistency of a supplied snapshot. It
cannot authenticate the collector, discover omitted processes, verify aliases,
prove that the declared rollout is actually followed, or prevent topology changes
after collection. `inventoryComplete: true` is a collector attestation that needs
independent evidence; it is not a discovery mechanism.

T14 must implement authoritative collection, inspect actual immutable IDs and
database mappings, bind the evidence to the reviewed release, and enforce the
stop-before-start sequence with fresh checks around each transition. The current
CD `bluegreen` strategy and Fly minimum-machine settings do not prove this
precondition. No live release gate has been executed by these fixture tests.

Multi-instance claiming/leases remain outside T01. The processor still has
at-least-once delivery: a crash after publication can cause redelivery even with
a single processor, so consumer idempotency remains required.
