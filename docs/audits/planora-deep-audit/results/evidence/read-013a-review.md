# READ-013a: BuildingBlocks contracts, health and first logging contexts

Полностью прочитаны **13 файлов, 885 строк**, indices **0–12** pending batch
READ-013. Source HEAD `145eeea57e22aa5881318ec75dc62ee5509f146e`.
Это первая половина batch, а не завершение всего READ-013. Исходники,
registry/index/PROGRESS, runtime и рабочие БД не менялись.

Статус: **REVIEWED_SOURCE_ONLY**. Builds/tests и live probes в этом review
не запускались. SHA256, точные ranges, caller/state/error boundaries и
предлагаемые regressions находятся в [JSON](read-013a-review.json).

## Кандидаты на triage

Новые стабильные finding IDs не назначены. Во всех трёх случаях ниже масштаб
статического доказательства отделён от текущей production reachability.

### Decorator не повторяет Failed/Pending delivery — P2, latent contract defect

`IdempotentConsumer/IdempotentMessageHandler.cs:25–29,37–45,55–69` сохраняет
inbox row до decorated handler. При отказе handler row становится Failed;
после crash до работы может остаться Pending. Следующая delivery проверяет
лишь Exists и возвращается до handler независимо от status. С настоящим
Collaboration `InboxRepository.cs:22–35` insert немедленно сохраняется,
а Exists не проверяет Processed. Поэтому такой retry теряет необходимую работу.

У decorator не найден non-test caller/DI registration в BuildingBlocks,
Services и Gateway. Это **не доказательство потери событий текущим event bus**:
активный `RabbitMqEventBus.cs:292–329` использует отдельный per-handler key
и записывает Processed receipt после handler. Его известный commit/receipt
gap остаётся INV-COMM-4/T05.

Перед возможным использованием decorator нужен regression: сохранить claim,
упасть один раз внутри handler, повторить тот же event и доказать recovery;
отдельно проверить abandoned Pending и concurrent active claim. Текущие три
mock tests проверяют лишь existing row, success и insert conflict.

### Любой DbUpdateException трактуется как duplicate — P2, latent contract defect

`IdempotentConsumer/IdempotentMessageHandler.cs:43–53` не проверяет причину
`DbUpdateException` и возвращает success для любой такой ошибки AddAsync.
Ошибка записи, не связанная с конфликтом уникальности, тем самым становится
"already being processed", хотя decorated handler не выполнялся. Вызывающий
transport мог бы ACK потерянную delivery. Текущий mock conflict test также
не различает provider-specific unique collision и прочие ошибки.

Ограничение reachability то же: production activation decorator не найдена.
Нужны отдельные synthetic failures для подтверждённого same-key conflict
и несвязанной ошибки записи; последняя обязана распространяться вызывающему
коду. Этот review их не исполнял.

### Legacy AUTHORIZATION shadowed by AUTH — P3, conditional fallback defect

`Filters/ResultToActionResultFilter.cs:124–135` сначала проверяет StartsWith
`AUTH`, затем `AUTHORIZATION`. Поэтому untyped `AUTHORIZATION.FORBIDDEN`
получает 401 до достижения ветки 403. Аналогично затронуты другие authorization
codes. Typed ErrorType.Forbidden корректно даёт 403 (`114–122`).

Фильтр зарегистрирован в пяти API, но текущий producer untyped
`AUTHORIZATION.*` в Services не найден; обычные ForbiddenException обслуживает
exception middleware, а typed results обходят fallback. Не заявляется текущий
пользовательский incident. Нужен targeted filter test для untyped authorization
codes при сохранении правильного AUTH_REQUIRED и typed Forbidden.

## Существующие границы и опровержения

- **DIST-003:** Rabbit probe намеренно Degraded и tagged messaging, без ready/live.
  Текущая shared DI добавляет ready tag DB; ReadinessContractTests явно
  различают DB outage и broker degradation. Отсутствие ready у Rabbit не
  переоткрывает исправленную DB-registration проблему. Реальные deployment
  probe targets остаются T14.
- **INV-COMM-4/T05:** активный bus имеет best-effort receipt после handler;
  decorator имеет другой pre-handler claim contract и найден только в tests.
  Эти два пути нельзя объединять в заявление об exactly-once.
- `IIdempotentMessageHandler` не имеет найденной реализации; DI registration
  `ValidationFilter` также не доказывает его execution: в startup найдены
  Result filter, а применение этого ValidationFilter не найдено. Нового active
  validation defect не установлено.
- Rate-limit limits, partition scope, IPv4-mapped normalization и Retry-After
  связаны с существующими policy/partition tests. Shared Redis outage behavior
  этим чтением не проверялось; AddResilientHttpClient не имеет найденных callers.
- BusinessEvent/ILogger extension отделён от используемого IBusinessEventLogger.
  Root-namespace CorrelationIdEnricher зарегистрирован legacy ConfigureSerilog;
  Auth стартует через ConfigureEnterpriseLogging. AsyncLocal correlation context
  действительно используется middleware, но cross-request leak не доказан.
  Client correlation headers — diagnostic input, не identity/authorization.

## Полнота чтения

| Index | Файл внутри BuildingBlocks.Infrastructure | Полный range |
| --- | --- | --- |
| 0 | Extensions/ServiceCollectionExtensions.cs | 1–290 |
| 1 | Filters/ResultToActionResultFilter.cs | 1–150 |
| 2 | Filters/ValidationFilter.cs | 1–41 |
| 3 | GlobalUsings.cs | 1–48 |
| 4 | HealthChecks/RabbitMqHealthCheck.cs | 1–45 |
| 5 | IdempotentConsumer/IdempotentMessageHandler.cs | 1–93 |
| 6 | Inbox/IIdempotentMessageHandler.cs | 1–8 |
| 7 | Inbox/IInboxRepository.cs | 1–11 |
| 8 | Inbox/InboxMessage.cs | 1–73 |
| 9 | Inbox/InboxMessageStatus.cs | 1–10 |
| 10 | Logging/BusinessEvent.cs | 1–54 |
| 11 | Logging/CorrelationIdContext.cs | 1–40 |
| 12 | Logging/CorrelationIdEnricher.cs | 1–22 |

Supplemental callers/tests и прежний READ-014 использовались для проверки
reachability и дедупликации; они не увеличивают охват этих 13 manifest paths.
Root объединяет обе половины, назначает IDs после triage и обновляет общий индекс.
