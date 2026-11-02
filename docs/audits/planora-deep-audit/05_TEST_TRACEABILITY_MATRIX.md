# Инварианты, тесты и CI

Тест, который существует, не обязательно выполнялся в этой сессии. Runtime evidence указано отдельно. Профильные test paths и точные symbols — в evidence/findings; таблица не заявляет exhaustive покрытие.

| Требование | Code / finding | Существующий safety net | Требуемое расширение | CI |
| --- | --- | --- | --- | --- |
| Завершённая session не воскресает | auth.ts/api.ts,FE-001 | store/auth.test.ts | deferred logout/login B на всех refresh paths | CI frontend |
| Notification owner isolation | notifications.ts,FE-002 | store/notifications.test.ts | late load/hydrate/mark-read/ingest | CI frontend |
| Join/leave lifecycle | realtime/hooks.ts,FE-003 | lib/realtime-hooks.test.tsx | deferred start/unmount,StrictMode,2 subscribers | CI frontend |
| Avatar принадлежит current user | security-initializer,FE-004 | initializer tests в frontend register | delayed A response after B | CI frontend |
| Route latest-wins | branch page,FE-005 | branch-page tests | A slow→B fast→A error | CI frontend/E2E |
| Category deletion atomic | BE-001 | CreateDeleteCategoryCommandHandlerTests | Npgsql fault between changes/events | CI backend |
| Complete task/comment fan-out | BE-002 | service handler tests | Nth outbox failure,zero partial commit | CI backend + isolated |
| Refresh at most one consume | BE-003/004 | Auth handler/repo tests | two contexts/device expiry | CI backend/Postgres |
| Friendship revoke frees workers | BE-005 | Todo domain tests | capacity/subtasks/both directions | CI backend |
| System comment identity | BE-006 | Collaboration repository tests | duplicate titles/rename/Unicode/out-of-order | CI backend |
| Schema reproducibility | BE-007 | Todo/Realtime startup tests | other services fresh/prior/drift | Migration + CI Postgres |
| Every erasure subscriber receives | DIST-001 | RabbitMqEventBusFailureTests helper tests | real broker 3 subscribers/2 replicas | isolated integration |
| Poison retained | DIST-002 | failure helper tests | actual DLQ binding/replay/unroutable | isolated integration |
| Ready reflects DB outage | DIST-003 | shared health infrastructure | host live200/ready503 | CI backend |
| Revoke live subscription | DIST-004 | NotificationInfrastructureTests | join→revoke→send,expiry,2 instances | E2E |
| Persist/push retries stable | DIST-005 | NotificationEventHandlerTests | send failure after persist + reconnect | CI backend/E2E |
| Cursor ties complete | DIST-006 | NotificationReadStoreTests summary | Npgsql ties/malformed cursor | CI backend |
| Forwarded trust validation | DIST-007 | RateLimitPolicyTests | real middleware invalid config/spoof | CI backend/E2E |
| L1 removed on L2 failure | DIST-008 | CacheServiceMetricsTests | faulting cache/cancellation | CI backend |
| No double claim | DIST-009 | outbox state tests | 2 processors/lease/crash | isolated Postgres |
| UX motion/TTL/search preserved | OPS-002,FE/T11 | motion/height/notices E2E | isolate 6 failures,viewport matrix | E2E6 shards |
| Scanner/CI rules truthful | OPS-001..012 | nuget parser,docs/runner tests | matches,skip triggers,immutable deploy | CI/security/T14 |

Frontend focused existing tests:53 PASS; backend filtered suite1207 PASS/31 skipped. Neither covers new regressions above. No new application tests were written in this planning phase. Postgres-specific deletion tests require disposable credentials; test names filtered out are not counted as skips. Captured results are in baseline.

T13 adds property/boundary/permissions matrices where behavior benefits: malformed/empty/Unicode payloads, UTC/time zones/TTL, duplicate/out-of-order/lost events, cancellation, transactions, retry and backward compatibility. Use existing Testcontainers.PostgreSql where rational; no new framework by default. Mutation testing scoped to critical predicates only after fast deterministic suite, not a universal PR gate. Preserve existing vitest global88/81/79/85 and directory ratchets; do not replace them with a guessed85%.
