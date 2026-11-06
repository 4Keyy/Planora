# READ-013b: logging source review

Прочитаны полностью **12 файлов, 762 строки**: нулевые индексы 13–24
пачки READ-013. HEAD `145eeea57e22aa5881318ec75dc62ee5509f146e`. Все тексты совпадают с HEAD после нормализации
концов строк. [Точные диапазоны, SHA256 и call boundaries](read-013b-review.json).

Статус **REVIEWED_SOURCE_ONLY**. Исходники, findings, CSV, PROGRESS и статус пачки
не изменялись. Stable finding IDs не назначались; triage выполняет root.

## Кандидаты для triage

- **READ013B-C01, P1:** `HttpLoggingMiddleware.cs:156–186` сравнивает raw query name
  с набором sensitive keys, не декодируя имя. Percent-encoded spelling принимается
  обычными decoded query readers SignalR/verify-email, а значение проходит в
  Information request/response Path. `LogSanitizer.Clean` не скрывает credential.
  Реальные tokens и рабочие журналы не читались; нужен harmless-marker capture test.
- **READ013B-C02, P2:** `HttpLoggingMiddleware.cs:57–83` всегда заменяет non-gRPC Body
  на неограниченный MemoryStream, копирует только после завершения downstream и
  не восстанавливает original Body. Ссылка остаётся на disposed stream; copy не
  использует RequestAborted и может скрыть исходную ошибку. Буферизация подтверждена
  кодом. Последствия для SSE требуют отдельного transport regression: сервер
  регистрирует обычный SignalR, но текущий frontend принудительно использует WebSocket.
- **READ013B-C03, P3:** `HttpLoggingMiddleware.cs:114–126` читает только raw `sub`.
  При inbound mapping response record получает `UserId=Anonymous`; правильный
  enterprise enricher с NameIdentifier fallback не заменяет явно заданное свойство
  через AddPropertyIfAbsent. Это потеря audit correlation, не обход authorization.

## Трассировка и dedup

Все шесть API регистрируют HttpLoggingMiddleware. Активная конфигурация —
`ConfigureEnterpriseLogging` из SerilogConfiguration; legacy ConfigureSerilog /
ConfigureWebSerilog callers не найдены. ConfigureWebAppLogging вызывается активно,
добавляет metadata/HasAuthorization и не пишет значение Authorization. Наличие
неиспользуемого SensitiveHeaders не является доказательством утечки header.

Активные enrichers используют HttpContext.Items: Operation заполняет LoggingBehavior,
EventType приходит из business logger scope. Legacy root enrichers/AsyncLocal-контексты
имеют другую регистрацию; их ограничения не выданы за активную поломку. RequestPath
enricher не добавляет query string. LogSanitizer ограничивает длину и управляющие
символы, но не является secret redactor или рекурсивным payload sanitizer.

Typed BusinessEvents содержат email/metadata/names, но production constructors не
найдены. Отдельная реальная цепочка IBusinessEventLogger передаёт email/IP при login
и имя первой категории в Data scope; structured JSON sink сохраняет scope properties.
Это privacy observation, родственное OPS-015, без утверждения несанкционированного
доступа к логам. OPS-015 описывает Realtime RPC notification text; OPS-003/010 —
Git history scanner. Они не закрывают query-key bypass. DIST-004/005/012 также не
покрывают lifecycle response stream. Новые стабильные IDs не созданы.

## Проверки и границы

Выполнены чтение полного assigned source, поиск callers/tests и сравнение с HEAD.
Прямые regression tests перечисленных logging helpers не найдены; существующие Auth
tests мокируют IBusinessEventLogger. Ничего не запускалось против приложения, БД,
брокера, реальных HTTP endpoints или рабочего log sink. Нет runtime подтверждения
malformed URLs, SSE, response cancellation, exception re-execution или sink formatting.
Supporting snippets не добавляют baseline files к этому охвату.

## Полные диапазоны

| Файл | Диапазон |
| --- | --- |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Enrichers/EventTypeEnricher.cs` | 1–28 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Enrichers/OperationEnricher.cs` | 1–28 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Enrichers/RequestPathEnricher.cs` | 1–27 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Enrichers/ServiceNameEnricher.cs` | 1–22 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Enrichers/UserIdEnricher.cs` | 1–28 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/EventTypeContext.cs` | 1–22 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/EventTypeEnricher.cs` | 1–21 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Events/BusinessEvents.cs` | 1–187 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/HttpLoggingMiddleware.cs` | 1–205 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/LogSanitizer.cs` | 1–65 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/LoggingConfiguration.cs` | 1–107 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/OperationContext.cs` | 1–22 |
