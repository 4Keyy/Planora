# T05 broker topology transition for review

Status: **prepared procedure; working-environment rollout and historical replay NOT EXECUTED**. The source mapping below was checked against the 13 startup subscriptions during T05 implementation, after local T12 commit `90f8341ae35a60e39fcdbabde83577a1a96bfa02`. This document performs no broker, deployment or data operation. T14 must bind the approved procedure to the final release SHA and observed environment; T02/T03/T04 must establish domain-effect and replay acceptance.

## Subscription inventory

Normal publication still uses durable topic exchange `planora-eventbus`, routing key equal to the event's simple type name, and the existing event payload. Replicas of a logical subscriber use the same stable ID and source queue. Independent subscribers use different IDs. Class or namespace renaming must not change an existing ID without another reviewed transport migration.

For each row, the source queue is `planora.<subscription-id>.v1`; its DLQ appends `.dlq`. The legacy-name column describes the old code's naming rule, not an observation of any working broker. There are 13 new logical subscriptions and 11 distinct legacy names because three services shared the same user-deletion queue.

| Owner | Event / unchanged routing key | Handler simple name | Stable subscription ID | Legacy queue name |
| --- | --- | --- | --- | --- |
| Todo | `CategoryDeletedIntegrationEvent` | `CategoryDeletedEventHandler` | `todo.category-deleted` | `CategoryDeletedIntegrationEvent.CategoryDeletedEventHandler` |
| Todo | `UserDeletedIntegrationEvent` | `UserDeletedEventConsumer` | `todo.user-deleted` | `UserDeletedIntegrationEvent.UserDeletedEventConsumer` |
| Todo | `FriendshipRemovedIntegrationEvent` | `FriendshipRemovedEventConsumer` | `todo.friendship-removed` | `FriendshipRemovedIntegrationEvent.FriendshipRemovedEventConsumer` |
| Category | `UserDeletedIntegrationEvent` | `UserDeletedEventConsumer` | `category.user-deleted` | `UserDeletedIntegrationEvent.UserDeletedEventConsumer` |
| Collaboration | `TaskCreatedIntegrationEvent` | `TaskCreatedEventConsumer` | `collaboration.task-created` | `TaskCreatedIntegrationEvent.TaskCreatedEventConsumer` |
| Collaboration | `TaskActivityIntegrationEvent` | `TaskActivityEventConsumer` | `collaboration.task-activity` | `TaskActivityIntegrationEvent.TaskActivityEventConsumer` |
| Collaboration | `TaskDeletedIntegrationEvent` | `TaskDeletedEventConsumer` | `collaboration.task-deleted` | `TaskDeletedIntegrationEvent.TaskDeletedEventConsumer` |
| Collaboration | `SubtaskDeletedIntegrationEvent` | `SubtaskDeletedEventConsumer` | `collaboration.subtask-deleted` | `SubtaskDeletedIntegrationEvent.SubtaskDeletedEventConsumer` |
| Collaboration | `UserDeletedIntegrationEvent` | `UserDeletedEventConsumer` | `collaboration.user-deleted` | `UserDeletedIntegrationEvent.UserDeletedEventConsumer` |
| Realtime | `NotificationEvent` | `NotificationEventHandler` | `realtime.notification` | `NotificationEvent.NotificationEventHandler` |
| Realtime | `RealtimeSyncIntegrationEvent` | `RealtimeSyncEventHandler` | `realtime.sync` | `RealtimeSyncIntegrationEvent.RealtimeSyncEventHandler` |
| Realtime | `TaskDeletedIntegrationEvent` | `TaskDeletedNotificationCleanupHandler` | `realtime.task-deleted-cleanup` | `TaskDeletedIntegrationEvent.TaskDeletedNotificationCleanupHandler` |
| Realtime | `UserDeletedIntegrationEvent` | `UserDeletedNotificationCleanupHandler` | `realtime.user-deleted-cleanup` | `UserDeletedIntegrationEvent.UserDeletedNotificationCleanupHandler` |

Source locations: [Todo startup](../../../../../Services/TodoApi/Planora.Todo.Api/Program.cs), [Category startup](../../../../../Services/CategoryApi/Planora.Category.Api/Program.cs), [Collaboration startup](../../../../../Services/CollaborationApi/Planora.Collaboration.Api/Program.cs), [Realtime startup](../../../../../Services/RealtimeApi/Planora.Realtime.Api/Program.cs), and [transport declaration](../../../../../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs).

## Required declarations and preflight

For a source queue `Q` and its `Q.dlq`, require the following observed values before accepting the rollout:

| Entity | Required properties / binding |
| --- | --- |
| `planora-eventbus` | Topic exchange; durable; no auto-delete |
| `planora-eventbus-dlx` | Topic exchange; durable; no auto-delete |
| `Q.dlq` | Durable quorum queue; nonexclusive; no auto-delete; bound from `planora-eventbus-dlx` using routing key `Q` |
| `Q` | Durable quorum queue; nonexclusive; no auto-delete; bound from `planora-eventbus` using the row's unchanged event routing key |
| Source arguments | `x-queue-type=quorum`, `x-dead-letter-exchange=planora-eventbus-dlx`, `x-dead-letter-routing-key=Q`, `x-dead-letter-strategy=at-least-once`, `x-overflow=reject-publish` |

The application declares and binds the DLQ before starting the source consumer. Check RabbitMQ server version, cluster health, `stream_queue` feature state, effective policies, durable storage, available disk/memory and the intended quorum membership. The disposable single-node fixture tests restart persistence; it does not establish multi-node availability. RabbitMQ 3.13 requires `stream_queue`, the configured DLX and `reject-publish` for this dead-letter strategy. Retained dead letters consume resources; T14 must set and validate capacity/alert thresholds rather than silently change overflow or add expiry. [RabbitMQ 3.13 quorum dead-lettering](https://www.rabbitmq.com/docs/3.13/quorum-queues#dead-lettering)

Inspect every existing new-name queue before application startup. An absent queue can be created by the new revision; an existing queue needs equivalent properties, reviewed effective policy and an accounted-for backlog. Any mismatch, unsupported feature, unknown owner, unresponsive queue or ambiguous inventory blocks the rollout. Do not resolve a `406 PRECONDITION_FAILED` by deleting, purging, renaming or relaxing queue type checks. Stop the revision and review a compatible roll-forward with T14. [Queue declaration equivalence](https://www.rabbitmq.com/docs/3.13/queues#declaration-and-property-equivalence)

### Read-only commands for the owned disposable fixture

These commands are prepared for review and were not executed while writing this runbook. They deliberately pin the separately created disposable container; they are not a working-environment connection recipe. If that fixture was recreated, stop and obtain its verified replacement identity from root's checkpoint instead of selecting by container name or port.

```powershell
$fixtureId = 'a702edd4d55ddcae0e682a2565aa18cd01a6db7e8f086a5741198e00c7718f21'
$expectedLabel = 'deepaudit-t05-20261103'
$expectedVolume = 'planora-audit-t05-rabbit-data'
$fixtureVhost = '/'

$observedId = docker inspect --format '{{.Id}}' $fixtureId
if ($LASTEXITCODE -ne 0 -or $observedId -ne $fixtureId) {
    throw 'Disposable fixture identity is not verified.'
}
$labelsJson = docker inspect --format '{{json .Config.Labels}}' $fixtureId
if ($LASTEXITCODE -ne 0) { throw 'Fixture label inspection failed.' }
$labels = $labelsJson | ConvertFrom-Json
if ($labels.'com.planora.audit' -ne $expectedLabel) {
    throw 'Unexpected fixture ownership label.'
}
$mountsJson = docker inspect --format '{{json .Mounts}}' $fixtureId
if ($LASTEXITCODE -ne 0) { throw 'Fixture mount inspection failed.' }
$mounts = @($mountsJson | ConvertFrom-Json)
if ($mounts.Count -ne 1 -or $mounts[0].Type -ne 'volume' -or
    $mounts[0].Name -ne $expectedVolume -or
    $mounts[0].Destination -ne '/var/lib/rabbitmq') {
    throw 'Unexpected fixture storage; do not run against it.'
}
$volumeLabelsJson = docker volume inspect --format '{{json .Labels}}' $expectedVolume
if ($LASTEXITCODE -ne 0) { throw 'Fixture volume inspection failed.' }
$volumeLabels = $volumeLabelsJson | ConvertFrom-Json
if ($volumeLabels.'com.planora.audit' -ne $expectedLabel) {
    throw 'Unexpected volume ownership label.'
}

$portsJson = docker inspect --format '{{json .NetworkSettings.Ports}}' $fixtureId
if ($LASTEXITCODE -ne 0) { throw 'Fixture port inspection failed.' }
$ports = $portsJson | ConvertFrom-Json
foreach ($portKey in @('5672/tcp', '15672/tcp')) {
    $bindings = @($ports.PSObject.Properties[$portKey].Value)
    if ($bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1') {
        throw 'Expected one loopback-only publication for each fixture port.'
    }
}
$networksJson = docker inspect --format '{{json .NetworkSettings.Networks}}' $fixtureId
if ($LASTEXITCODE -ne 0) { throw 'Fixture network inspection failed.' }
$networks = $networksJson | ConvertFrom-Json
$networkEntries = @($networks.PSObject.Properties)
if ($networkEntries.Count -ne 1 -or
    $networkEntries[0].Value.NetworkID -ne 'cff8b2cbfc871731b635c59d992879269d6bed9356b015977f0a3da1e5e33aa1') {
    throw 'Unexpected fixture network; do not use a working-stack connection.'
}
docker exec $fixtureId rabbitmq-diagnostics -q server_version
if ($LASTEXITCODE -ne 0) { throw 'Server version inspection failed.' }
docker exec $fixtureId rabbitmq-diagnostics -q check_running
if ($LASTEXITCODE -ne 0) { throw 'Broker is not running.' }
docker exec $fixtureId rabbitmqctl -q list_feature_flags name state
if ($LASTEXITCODE -ne 0) { throw 'Feature flag inspection failed.' }
docker exec $fixtureId rabbitmqctl -q list_queues -p $fixtureVhost name type durable auto_delete exclusive arguments policy operator_policy effective_policy_definition messages_ready messages_unacknowledged consumers state
if ($LASTEXITCODE -ne 0) { throw 'Queue inventory failed.' }
docker exec $fixtureId rabbitmqctl -q list_exchanges -p $fixtureVhost name type durable auto_delete
if ($LASTEXITCODE -ne 0) { throw 'Exchange inventory failed.' }
docker exec $fixtureId rabbitmqctl -q list_bindings -p $fixtureVhost source_name destination_name destination_kind routing_key
if ($LASTEXITCODE -ne 0) { throw 'Binding inventory failed.' }
```

Save only sanitized topology, counts, timestamps, exact release/container identities and exit codes in shared evidence. Do not dump environment, definitions containing credentials, connection strings, message bodies, addresses or application logs. The CLI commands list metadata and do not fetch, acknowledge, publish or remove messages. Their available fields and health commands should be checked against the actual 3.13 tooling. [rabbitmqctl reference](https://www.rabbitmq.com/docs/3.13/man/rabbitmqctl.8), [rabbitmq-diagnostics reference](https://www.rabbitmq.com/docs/3.13/man/rabbitmq-diagnostics.8)

## Working-environment transition requiring approval and T14

1. Bind the plan to an approved release SHA, environment/vhost identity, operator, window, recovery contact and storage/backup evidence. Inventory all 11 legacy queue names, actual bindings, consumers, unacknowledged deliveries, ready counts, existing DLQs, new-name collisions and relevant policies. Inventory the whole vhost scope; absence from the expected-name list does not prove an entity is unrelated. The old shared user-deletion queue cannot show which domain already applied a previously acknowledged event.
2. Agree how to quiesce relevant producers and outbox processors while preserving pending outbox rows. Drain in-flight publication/handling under a deadline, then stop old consumers gracefully. Confirm old queue consumer counts are zero and unacknowledged deliveries have returned or been independently reconciled. Capture a fresh count baseline. Preserve existing old queues, bindings, messages and storage. No blanket close-all-connections, queue purge or definition reset is part of this procedure.
3. Enforce T01's stop-before-start processor rule when replacing service revisions. Start the new revision only after new-name preflight passes. Its startup creates the 13 source queues and 13 DLQs and starts only the corresponding logical handlers. Verify declarations/bindings and handler registrations against this table; two replicas of the same logical subscriber must share the same queue. Existing new-name backlog requires a separately accounted resume decision before starting its consumer.
4. Keep producers paused during the first canary. Publish one synthetic user-deletion event in the disposable rehearsal and establish transport and domain-effect controls. Working data canaries require the owner's separate approved data plan. Once the release/replay gates below pass, resume the agreed producers and observe normal event flow, queue/DLQ depth and publisher failures. Existing legacy bindings may accumulate additional copies; this is preserved backlog, not permission to run old consumers or remove bindings automatically.
5. Execute only the approved bounded historical replay manifest. Historical events already removed from the legacy queue require an authoritative retained event source; queue depth zero cannot establish complete erasure. If history is unavailable or IDs cannot be mapped to trustworthy payloads, record the missing coverage and block closure rather than fabricate or reconstruct deletion events from current state.

Changes to broker features, policies, permissions, cluster membership, definitions, application rollout and any working-environment replay are outside this local runbook execution. This document supplies a reviewable sequence; it does not grant or request those operations.

## Bounded copy replay and lineage

The replay implementation must first be reviewed and rehearsed on the disposable fixture. No operational replay utility or historical payload export is supplied or executed by this document. Require an approved finite manifest and a durable operator ledger before replaying working events. Keep payloads in the owner's protected recovery store, outside this repository and shared audit logs; shared evidence contains opaque event IDs, source/destination identifiers, counts and statuses only.

For each historical `UserDeletedIntegrationEvent` retain the original event `Id`, original body and relevant message properties. `MessageId` must remain that event ID; a new batch ID is lineage metadata, not a replacement event ID. Record the source queue/archive, protected source-record reference, release SHA, intended subscription ID and each publication/effect result. Retain original broker headers in the protected archive; do not invent broker-generated `x-death` history during replay.

For the collision repair, form an explicit three-cell destination matrix per event:

| Destination | Required business-effect acknowledgement, owned by the domain package |
| --- | --- |
| `todo.user-deleted` | Todo-owned records and the deleted user's shares/worker/preferences on other tasks satisfy T03's approved erasure contract, with T02's authoritative deletion event. Repeated delivery leaves the verified state unchanged. |
| `category.user-deleted` | Category records satisfy T04's approved erasure contract; repeated delivery leaves the verified state unchanged. |
| `collaboration.user-deleted` | Authored comments and related retained data satisfy T03's approved erasure contract; repeated delivery leaves the verified state unchanged. |

The current handlers perform repository cleanup/soft deletion; that source behavior alone is not acceptance of the complete erasure contract. Use provider-backed domain checks defined by the owning packages. A transport ACK, an inbox row, a zero-row handler result or a log line alone cannot substitute for the effect acknowledgement. The bus's existing inbox mechanism is optional and records best effort; it does not create an atomic exactly-once domain transaction.

Use a separately reviewed maintenance publisher to address only the manifest's allowlisted new source queue through the default exchange with routing key equal to that exact queue name, persistent delivery, mandatory routing and publisher-confirm tracking. This scoped replay route leaves normal application event routing unchanged. Do not use normal event-exchange fanout as a shortcut: it would also reach other bound subscribers and the preserved legacy queue. Realtime's separate user-deletion cleanup remains its own accounted acceptance scope; the three-domain repair does not certify it.

Proposed conservative rehearsal bounds are one pilot event, then at most 25 event IDs per batch, one outstanding publish per destination and a 60-second batch deadline. T14/owners must approve environment-specific bounds and a deadline for each business-effect check before working replay. Each batch stops immediately on a return/nack, confirm timeout, unknown publication outcome, unexpected DLQ increase, topology drift or effect mismatch. There is no automatic retry or poison replay. An operator can approve a bounded retry only after reconciling the unknown outcome and proving the destination's idempotency; preserve the event ID.

Ledger states distinguish `planned`, `publish-confirmed`, `effect-verified`, `verified-preexisting-noop`, `failed` and `outcome-unknown`. Commit ledger state durably before moving to the next cell. After a crash, reconcile confirmed or unknown cells against domain state before another publish. For N approved event IDs there must be exactly 3N unique destination cells; publication attempts can exceed that count only through recorded approved retries. Report per-domain verified effects/noops, outstanding/failed cells, source and target counts, DLQ deltas and duplicate attempts. Counts alone do not prove that every original event ID reached every domain.

Prefer replay from a preserved authoritative event archive. If the legacy queue is the only payload source and the entire paused backlog fits the approved held-delivery/memory bound, a separately reviewed copy extractor can hold that complete backlog with automatic acknowledgements disabled (`autoAck:false`), keep a protected copy and return all held deliveries by requeue/channel close. Never acknowledge removal in the original queue. Immediate get-and-requeue can repeatedly expose the same head message; bounded partial reads do not establish a complete export. If the backlog exceeds the bound, require an independently verified broker backup/isolated restore or an authoritative archive before extraction. Consuming a reviewed isolated restore can advance through bounded batches while the original queue/storage remains preserved; ad hoc copying of live broker storage is not this procedure. Deduplicate the manifest by original event ID, reconcile copied unique IDs against source counts and verify the original queue's ready/unacknowledged counts return to the baseline. Any export/restore is an approved migration action, not one of the read-only commands above.

Publisher confirms establish broker acceptance, not a consumer's completed domain effect. Consumer acknowledgements cover a different boundary. [RabbitMQ confirms and acknowledgements](https://www.rabbitmq.com/docs/3.13/confirms#are-publisher-confirms-related-to-consumer-delivery-acknowledgements)

Quorum at-least-once dead-letter transfer can retry and produce duplicates; it is not exactly-once processing. A target outage can retain dead letters in the source and consume capacity. Do not downgrade the strategy or switch overflow to drop-head to clear pressure: unconfirmed retained dead letters can be lost by that change. [RabbitMQ quorum dead-letter caveats](https://www.rabbitmq.com/docs/3.13/quorum-queues#dead-lettering)

## Stop, recovery and acceptance record

On a failed gate, pause the affected approved replay/producers, preserve both old and new queues/DLQs plus the ledger, and record exact unresolved cells. Do not revert automatically to the old shared-queue consumer naming; it reintroduces the cross-domain collision. A compatible new-topology revision or reviewed roll-forward is required. Application rollback does not restore deleted data or undo acknowledged domain effects.

The transition record must contain the final release SHA; observed broker/version/features/storage; old/new queue and binding metadata; before/after counts; producer and consumer pause/resume times; approved replay manifest/ledger references; per-event, per-domain effect acknowledgements; retained-backlog evidence; failures/retries and operator approval references. Old backlog remains preserved after this procedure. Its later retention/removal requires a separate owner decision.

T05 may claim local transport tests only after their actual results exist. Operational migration remains **BLOCKED pending T14 and approval**; historical coverage and domain idempotency remain **NOT VERIFIED pending T02/T03/T04 evidence**. A completed runbook is not proof that the transition or historical repair occurred.
