# T05 independent transport source review

Reviewed on 2026-11-03 against the working-tree T05 transport changes after
`db0d82acd35a705d903a2e121893034c2097ebe2`.

Verdict: **no actionable findings in the reviewed transport source/caller diff**.
This is a source review with the executable gates still owned by the root and
transport implementation agent. It does not approve deployment or old-backlog migration.

## Scope and source identity

- `IEventBus.cs` SHA256: `50d0f8082828bd5c7d21ed0b0d5b489b366504850ac1266e6247d54c4feaaa27`.
- `RabbitMqEventBus.cs` SHA256: `a70bd2b1eb83bcf8ef6d53a790b3471b79f0105adb50c1ee64a78c61845f271e`.
- `RabbitMqSubscriptionTests.cs` SHA256: `9c66d8f4c02ccaddb99fcb334947c901059d5199cd3daf165afa5df17e6c98ba`.
- All 13 production startup subscriptions across Todo, Category, Collaboration
  and Realtime were checked against their event/handler pairs. They use distinct
  service/purpose IDs while keeping the existing event type and cancellation token.
- The only other `IEventBus` implementation found was `MockEventBus`; its two
  method signatures were updated to match the interface.

## Checks performed

Read the complete transport source and subscription test source, the interface/caller
diff and the T05 prompt. Used `rg` to enumerate subscription call sites and interface
implementations, `git diff` for the narrow caller changes, and `Get-FileHash` for the
source snapshot above. No .NET build/test or broker operation was executed in this
review because root coordinated shared build outputs and live fixtures.

The review covered:

- Subscription identity is explicit and validated before connecting; its queue does
  not depend on the handler's simple name. The callback dispatches exactly the typed
  handler captured by that subscription, avoiding the former event-wide handler fanout.
- Registration is committed only after successful consumption setup. Failed/canceled
  setup disposes the temporary channel and allows another subscription attempt.
- Subscription access is serialized; duplicate registration is idempotent within a bus;
  mismatched event/handler reuse is rejected; unsubscribe targets the exact ID/types.
- Durable quorum DLQ declaration and its explicit binding precede source consumption.
  The source declares the explicit dead-letter routing key and at-least-once transfer
  options. Broker acceptance and restart behavior require root's live evidence.
- Publishing retains mandatory delivery and tracked confirmations. Failure disposes
  the cached channel and is propagated to its caller. No outbox success is synthesized.
- Missing handlers no longer acknowledge silently; null/malformed JSON is rejected;
  transient failures retain the bounded requeue policy.
- Both disposal paths reject new operations and close owned channels. Semaphores stay
  usable for already-waiting operations, which recheck the disposed state after acquiring.

## Limits and handoff

Legacy per-handler inbox keys are intentionally preserved by this change. Handler
renames still require an inbox compatibility decision; queue identity alone does not
make the historical inbox key independent of the CLR type. Atomic domain/inbox effects
and parallel duplicate delivery remain outside this transport change.

This reviewer authored `UserDeletionRabbitPostgresTests.cs` as a separate assigned
subtask and does not claim independent review of that file. Root owns its review and
execution. The live source/DLQ durability, real domain cleanup, crash recovery,
unroutable outbox state, broader tests, backlog inventory/replay and T14 release gate
must be assessed from their own execution evidence and runbook.

## Live-test source and transition runbook review

The reviewer subsequently read the complete root-authored `RabbitMqLiveTests.cs`,
the complete transition runbook and the actual outbox processing method used by the
unroutable test. Reviewed snapshots:

- `RabbitMqLiveTests.cs` final reviewed SHA256: `53a848923fb07d6e66d6602723cceaa8d996db7f484de9dd84bb796374fa18a7`.
- `UserDeletionRabbitPostgresTests.cs` SHA256: `0ab92762fa4b127e0ffec848af855d162d6d65e4f25e6f1f832ca8fdcbdb3dde`.
- `t05-topology-transition.md` SHA256: `147e35e898bea3090ed9d1082af144b6b3a5703745756957f31795adea8701da`.

No actionable production/runbook defect was identified in that scope. The live
test source checks actual broker delivery to three logical queues, shared replica
consumer count, malformed and retry-exhausted payloads arriving in the DLQ with
original identity, recovery after a mandatory unroutable publish, and a persisted
outbox row remaining pending with a scheduled retry after failed publication.
The restart tests hold a persistent poison message in a durable quarantine across
an externally orchestrated restart and then assert its body, identity and death header.
These scenarios observe broker/database boundaries rather than repeat mock assertions.

One bounded test limitation was reported to root and **resolved in the source**: the synthetic fanout test's
`Effects.Count` dictionary suppresses duplicate effects within the test itself,
and its replay wait uses total deliveries greater than or equal to 120. Those
assertions establish unique effects and consumer topology, but do not alone prove
an absence of extra handler invocations. Root added exact per-subscriber delivery
counts of 20 after the first batch and 40 after replay, which this reviewer reread
in the final snapshot above. Root owns the rerun after this change; the reviewer
did not independently execute it. This is not a claim of exactly-once delivery
under failures.

The domain test was self-reviewed because this reviewer authored it. It invokes
the actual three domain consumers and repositories, checks target/control rows and
ancillary Todo cleanup physically in PostgreSQL, and compares timestamps/xmin after
replay. Its completion logger only synchronizes the observation; the stored-state
assertions supply the effect evidence. It proves the current cleanup/soft-delete
contract and does not prove complete hard erasure or atomic inbox/domain handling.

The transition runbook keeps old queues/backlog, distinguishes source-derived names
from observed broker inventory, requires queue/property/feature preflight and a pause
window, and supplies per-event/per-domain replay lineage with explicit unknown outcomes.
It does not treat a publisher confirm or consumer ACK as verified domain cleanup,
does not authorize working-environment replay, and does not silently remove backlog.
It correctly limits the local single-node restart test and leaves release, capacity,
historical completeness and domain erasure gates with their owning packages.

The review independently consulted the official [RabbitMQ 3.13 quorum documentation](https://www.rabbitmq.com/docs/3.13/quorum-queues#dead-lettering)
for the dead-letter strategy prerequisites, retained-message capacity and duplicate
caveats, and [confirms documentation](https://www.rabbitmq.com/docs/3.13/confirms#are-publisher-confirms-related-to-consumer-delivery-acknowledgements)
for the separate publish/consume acknowledgement boundaries. No live broker command,
.NET build or .NET test was run during this additional review. Execution counts and
the actual restart are root's evidence, not independently repeated measurements.
