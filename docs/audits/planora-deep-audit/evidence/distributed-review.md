# Distributed systems: доказательный проход

Baseline: `dc6b1781a24d43d967c418de30acda10fcafb8f9`, main, 2026-11-02. Это статическое исследование исходников и targeted истории, не эксплуатационный тест. Полный per-file register: [distributed-files.json](distributed-files.json); находки: [distributed-findings.json](distributed-findings.json). Исследователь не менял приложение/тесты/конфиги и не запускал сервисы, Redis, RabbitMQ или миграции.

## Реальные трассы и положительные контроли

| Путь | Подтверждение | Вывод |
| --- | --- | --- |
| Message HTTP POST → SendMessageHandler → friendship gRPC → MessageRepository.Add → OutboxRepository.AddAsync | MessagesController.cs:33-42; SendMessageCommandHandler.cs:33-66; Messaging DependencyInjection.cs:38-45 | Sender из JWT; body SenderId обнуляется; accepted friendship проверяется. Message и единственное notification event задуманы в одном SaveChanges; нельзя глобально менять AddAsync в track-only без перевода caller. |
| Outbox → publisher confirms → Rabbit → consumer | OutboxProcessor.cs:127-184; RabbitMqEventBus.cs:58-135,237-340 | Persistent publish, mandatory:true, publisher confirmations; ACK после обработчика. At-least-once допускает повтор после crash между publish и Processed. |
| User deletion → 3 domain consumers | Todo/Category/Collaboration Program.cs:169/163/165 → RabbitMqEventBus.cs:192 | DIST-001: все три handler simple names совпадают; разные domain effects не получают независимые очереди. |
| NotificationEvent → durable notification → SignalR user group | NotificationEventHandler.cs:30-66; NotificationStore.cs:26-65; NotificationService.cs:20-47 | Unique SourceEventId защищает insert; push после commit. DIST-005: retry-after-push-failure пропускает отправку, durable row остаётся. |
| Notification HTTP reads → current JWT subject → read model | NotificationsController.cs:48-112; NotificationReadStore.cs:25-109 | UserId обязателен во всех query/update predicates, AsNoTracking; mark-read bulk update. DIST-006: timestamp-only keyset теряет ties. |
| JoinTask → Todo CheckTaskCommentAccess RPC → task group | NotificationHub.cs:133-147; TaskBranchAuthorizer.cs:28-61 | Первичный вход fail-closed при RPC error, client не может подписаться на чужую user: группу. DIST-004: revoke/expiry не переоцениваются на passive receive. |
| Gateway → Ocelot downstream HTTP/ws | Gateway Program.cs:306-340; ocelot.Docker.json | JWT до rate limit; health обход Ocelot; QoS только Category route; Gateway не имеет gRPC clients. Реальные route map чтением подтверждены, endpoints по нему не запускались. |
| gRPC backplane → service key interceptor | ServiceKeyServerInterceptor.cs:28-92; ServiceKeyClientInterceptor.cs:22-62 | Все четыре RPC shapes поддерживают key check/injection; fixed-time compare; ключи не выводятся. Service key не заменяет user-level authorization. |
| Retention scheduler → advisory session lock → tripwire/dry-run → batched DELETE | RetentionBackgroundService.cs:34-123; RetentionExecutor.cs:19-94; PostgresAdvisoryLock.cs:21-57 | Lock держит соединение открытым; static clock cutoff; purge safety guards присутствуют. Production retention не запускался. |
| CacheService → L1/L2 | CacheService.cs:55-94,152-288; DI.cs:21-65 | TTL L1 ограничен L2 при Set; pattern cancellation evicts local prefix. Direct application callers ICacheService поиском не найдены; доменные caches отдельные. DIST-008 нельзя выдавать за активную privacy leak. |

## Findings и приоритеты

Полная структура, trigger, root cause, альтернативы, red/green tests и acceptance — в JSON.

- DIST-001 P1 CONFIRMED: collision queue identity ломает fan-out erasure.
- DIST-002 P1 CONFIRMED: repository не объявляет DLQ/binding; fresh broker теряет rejected event.
- DIST-003 P2 CONFIRMED: DB checks не имеют ready tag, /health/ready фильтрует только ready.
- DIST-004 P1 CONFIRMED: server не отзывает room membership/passive receive после изменения прав/токена.
- DIST-005 P2 CONFIRMED: сохранённый notification после failed send не отправляется повторно.
- DIST-006 P2 CONFIRMED: timestamp-only notification keyset пропускает равновременные строки.
- DIST-007 P1 LIKELY: непустой invalid KnownProxies приводит к очищенным trust lists; runtime regression требуется.
- DIST-008 P3 CONFIRMED: failed L2 remove пропускает L1 eviction; product impact не подтверждён.
- DIST-009 P2 CONFIRMED: outbox claim-free SELECT требует single active processor; live scale не проверен.
- DIST-010 P3 CONFIRMED: INVARIANTS описывает уже исправленный backoff как текущий дефект.

## История и предотвращённые false positives

`git log -8` для eventbus/outbox и gateway/hub прочитан. `git show --stat 0fd486a` и patch `1e73dab` просмотрены.

- `0fd486add085950450b96920466f666a6b127cfa`: 2026-10-06 уже добавил NextRetryUtc gate для Pending в processor/repository; CanonicalOutboxRepositoryTests:23 именует regression. Старая docs gap не является новым runtime дефектом.
- `1e73dab87c311552b39a8f1b3c54c08cd26629dc`: dedup key стал (eventId, handler full name). Это исправляет suppression, но не queue identity collision: queue использует simple name.
- `b2b1dec`: orphan Processing reclaim; `813f20e`: poison classification; `1f723c8`: async disposal; эти guards реально присутствуют.
- `07d3317`: branch rooms/typing; проверка только JoinTask осталась.
- `eae74a7`: rate limits per-user; `fc1dbb5`: Ocelot limiter отключён, `5c15cfb`: UseRateLimiter включён. Не повторять старый диагноз «лимитер не работает».
- `a3e1d1d`: single-instance outbox limitation документирован; задача требует gate, не необоснованный framework rewrite.

## Тесты: что действительно проверяет suite

Полностью прочитаны RabbitMqEventBusFailureTests (7 helper-only cases, не реальный broker), NotificationEventHandlerTests (persist/push, duplicate, malformed, throw отдельно), NotificationReadStoreTests (2 summary cases, не pagination), CacheServiceMetricsTests (5 cases с MemoryDistributedCache, не real Redis).

Targeted symbol search подтвердил OutboxMessageStateMachineTests и CanonicalOutboxRepositoryTests; остальные тестовые файлы из navigation не отмечаются полным чтением. NotificationInfrastructureTests содержит join/typing положительные и denied tests, но динамический revoke сценарий поиском не найден; файл нуждается в полном continuation review.

Агент не запускал эти тесты. Общий фактический .NET run выполняет root и записывает отдельное evidence. Команды для будущего исполнения имеют статус NOT_VERIFIED до запуска.

## Владение и договорённости

- T01: shared foundation contracts и readiness helper; additive StageAsync/track-only, AddAsync до перевода всех callers сохраняет semantics.
- T05: Rabbit topology/consumer routing/DLQ + Messaging; владеет изменениями shared bus. Service erasure effects остаются у T02/T03/T04.
- T06: Realtime handlers, API/store/hub + revoke protocol; расширения Todo RPC согласуются с T03/T07, UI получает согласованный contract.
- T07: Gateway/shared gRPC resilience + contract boundary; не расширять публичный доступ.
- T09: generic cache и документирование фактических Redis owners; Auth token/key material исправляет T02, deploy config — T14.
- T15 исправляет DIST-010 документации; не назначать тот же файл двум параллельным исполнителям.

## Первичные внешние источники

Проверены web tool 2026-11-02. Только первичные источники; версии API сверять с installed .NET 10.

- [RabbitMQ Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx): DLX является exchange; требуется маршрут к queue, а default dead-letter forwarding не гарантирует восстановление при отказе.
- [RabbitMQ at-least-once dead lettering](https://www.rabbitmq.com/blog/2022/03/29/at-least-once-dead-lettering): отсутствие целевой binding/queue — отдельный режим потери; не обещать, что одного exchange достаточно.
- [Microsoft SignalR authentication](https://learn.microsoft.com/en-us/aspnet/core/signalr/authn-and-authz?view=aspnetcore-10.0): principal кэшируется lifetime connection, expiry по умолчанию не закрывает соединение; CloseOnAuthenticationExpiration не является полным revocation механизмом.
- [Microsoft forwarded headers](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0): задавать trusted proxies/networks явно. Установленную middleware semantics для invalid configuration ещё требуется проверить.

## Непроверенное / следующий пакет чтения

GrpcContracts protobuf, остальные small domain types, весь exception/logging surface, все Messaging validators/EF mapping, generated migrations и значительная часть тестов ещё не прошли содержательный review этим агентом. Их пути отмечены NEEDS_DEEP_REVIEW в registry. Не утверждается line-by-line полный аудит области, production состояние, throughput, Redis eviction, Rabbit backlog или успешный WebSocket exploit. Участки продолжения закреплены в пяти PROMPT-пакетах.
