# T06 — Realtime authorization и durable notifications

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T06. Цель: Realtime authorization и durable notifications. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T02, T03, T05, T08. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T06.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Security решение: room membership не является permission; определить текущий audience через Todo authority перед broadcast и отправлять в разрешённые personal groups. Typing проверяет access перед payload; revoke/stamp/expiry закрывают доступ действующего connection. CloseOnAuthenticationExpiration не заменяет revoke. Для persist-then-push выбрать retryable stable ID delivery плюс reconnect reconciliation, используя существующую NotificationDelivery только после проверки её модели. Pagination cursor содержит timestamp+ID, legacy before остаётся явно совместимым; SQL UUID ordering проверить в Npgsql. Frontend client принадлежит T10, acceptance совместный.

## Change boundaries и ownership

- `Services/RealtimeApi`
- `tests/Planora.UnitTests/Services/RealtimeApi`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### DIST-004 / P1 / CONFIRMED — Доступ в SignalR branch room живёт дольше разрешения и токена

- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs:133-147` — JoinTask: Права проверяются только при join
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs:169-192` — StartTyping/StopTyping: Последующие вызовы проверяют лишь локальный joined set
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/RealtimeBroadcaster.cs:64-85` — BranchChangedAsync: Событие отправляется всем участникам task group
- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs:84-94,219-221` — OnTokenValidated/MapHub: SecurityStamp проверяется при authentication; MapHub не включает CloseOnAuthenticationExpiration

Trigger: Пользователь вступает в branch room; затем доступ отозван, дружба удалена, токен истёк либо security stamp изменён. Соединение не разрывается клиентом.

Impact: Продолжают поступать branch entity/actor metadata и typing display names; бывший участник может посылать typing. Не утверждается доступ к полному тексту задач: HTTP refetch имеет отдельную авторизацию.

Root cause: Долгоживущая group membership ошибочно принимается за актуальное право; authentication principal SignalR кэшируется на lifetime connection.

Решение по шагам: Включить close-on-expiry и серверную проверку revocation перед hub invocations. Для branch privacy перейти от группового broadcast к разрешённому списку пользователей: взять текущую audience через защищённый Todo RPC и направить событие personal groups; typing проверяет CanAccessBranchAsync и отправляется только текущей разрешённой аудитории. Удалять stale memberships как cleanup, а не как единственную защиту. Для security-stamp changes нужен серверный disconnect/periodic validation для idle connections; client logout не является контролем безопасности.

Альтернативы: Надёжное AccessRevoked event + distributed group membership registry может сократить RPC, но требует versioned ordering и гарантированной доставки; не выбирать до доказательства. Повторная авторизация только StartTyping не закрывает passive receive.

Regression scenarios:

- Join->revoke->BranchChanged/typing: бывший viewer получает 0 новых payload.
- Valid token expires during open WebSocket: server closes, reconnect with fresh token.
- Password change при открытом idle WebSocket: connection не продолжает private receive.
- Reconnect восстанавливает только разрешённые rooms; два Realtime instances.

Acceptance:

- Устранены active send и passive receive после revoke.
- Visual/UI contract unchanged; transient auth dependency failure fail-closed.
- Определена и проверена верхняя граница latency revocation.

Граница доказательства: Подтверждён отсутствующий контроль в server code. WebSocket exploit не выполнялся. Точная revocation policy/latency требует решения владельца; T06 сначала фиксирует её.

### DIST-005 / P2 / CONFIRMED — Notification persist-then-push теряет push после сбоя

- `Services/RealtimeApi/Planora.Realtime.Application/Handlers/NotificationEventHandler.cs:57-66` — HandleAsync: После успешного insert и failed send повторная delivery пропускает push как duplicate
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationStore.cs:26-34` — TryAddAsync: Наличие SourceEventId возвращает false
- `tests/Planora.UnitTests/Services/RealtimeApi/Handlers/NotificationEventHandlerTests.cs:63-76,94-106` — Duplicate/PropagatesPushFailures: Tests отдельно фиксируют skip duplicate и exception; sequence retry-after-commit не проверен

Trigger: Store commit succeeds; SendToUserAsync fails; Rabbit requeues. Second call sees stored event and returns before Send.

Impact: Уведомление сохранено и доступно read API, но активный пользователь не получает push до другого refresh/reconnect. Это не потеря durable notification row.

Root cause: Dedup persistence и delivery completion сведены в один boolean.

Решение по шагам: Сначала выбрать явный contract best-effort push с гарантированным reconciliation либо retryable delivery. Для retryable: store возвращает stable existing NotificationPayload; delivery имеет отдельный pending/sent state, replay отправляет тот же id, frontend dedup по id. Не генерировать новый Notification.Id на retry. Использовать существующий NotificationDelivery только после проверки его invariants и тестов; не обещать exactly-once network delivery.

Альтернативы: Если UX допускает best-effort, сохранить server behavior и добавить bounded periodic summary/list reconciliation в T10, документировать latency; это продуктовый выбор.

Regression scenarios:

- Первый send бросает после persist, повторная обработка доставляет тот же id либо reconciliation доказывает согласованный SLA.
- Commit-send-ack crash matrix; duplicate не увеличивает unread дважды.
- Offline client loads persisted rows after reconnect.

Acceptance:

- Есть один durable row и стабильный notification id.
- Нет дублирующих toast/unread increments.
- Результат соответствует выбранному contract и документирован.

Граница доказательства: Статически доказанная последовательность; runtime broker failure не инжектировался. Зависимость T10 является контрактным handoff, не обязательным циклом DAG.

### DIST-006 / P2 / CONFIRMED — Notification pagination пропускает строки с одинаковым timestamp

- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationReadStore.cs:60-74` — GetListAsync: Sort только OccurredOnUtc; следующий page WHERE OccurredOnUtc < before
- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs:59-74` — GetList: Публичный cursor содержит только DateTime

Trigger: Создать больше take notifications одному пользователю с одинаковым OccurredOnUtc, взять page1 и запросить before timestamp последней строки.

Impact: Оставшиеся строки того же timestamp недоступны через load older.

Root cause: Неуникальный keyset cursor и отсутствие deterministic tie-breaker.

Решение по шагам: Аддитивно ввести cursor (OccurredOnUtc, Id) с order by descending обеих колонок; timestamp-only before сохранить как legacy explicit mode до обновления T10/T11. Схему/индекс проверить в T08; сравнение UUID провайдера подтвердить PostgreSQL integration test, не предполагать LINQ translation.

Альтернативы: Offset pagination не устраняет concurrent insertion gaps и ухудшает large backlog; не использовать как быстрый обход.

Regression scenarios:

- 3+ равновременных row при take=2 возвращаются без пропусков/повторов.
- Interleaved inserts/mark-read между страницами.
- Два пользователя не смешиваются; malformed cursor дает 400.

Acceptance:

- Полный обход tied dataset совпадает с expected IDs.
- Клиент и сервер поддерживают согласованный backward-compatible cursor.
- Owner фильтр сохранён.

Граница доказательства: Нет динамического воспроизведения; exact query inspect достаточен для finding. Frontend handoff T10/T11 после contract freeze T06.

## Исполнимый runbook

1. Сохранить baseline/dirty paths, проверить реальные symbols и dependency result files.
2. Написать regression минимального trigger; показать красный результат на исходном коде. Статический finding без runtime воспроизведения не даёт права заявить exploit.
3. Реализовать решение выше небольшими шагами; каждый commit держит совместимость consumers.
4. Выполнить команды из корня (SDK/dependencies уже должны быть подготовлены):

```powershell
dotnet --version
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --no-restore --configuration Release --filter "FullyQualifiedName!~Postgres"
dotnet test tests/Planora.ErrorHandlingTests/Planora.ErrorHandlingTests.csproj --no-restore --configuration Release
```

Проверяй `$LASTEXITCODE` после каждой команды. Backend local audit использовал SDK `C:\Users\fkeyy\.dotnet\dotnet.exe` и собственный `-p:OutDir=F:\Projects\Planora\.buildcheck\forensic-audit\unit\`; адаптировать после проверки владения. Не запрашивай новые dependencies автоматически. PostgreSQL/Rabbit/Redis/E2E/perf команды условны: NOT_VERIFIED до запуска в disposable среде. Не использовать default localhost, пока не доказано, что это твой тестовый сервис. Filter обязан выполнить ненулевое число тестов.

5. Пройти broader gates из [acceptance](10_ACCEPTANCE_GATES.md), записать evidence и doc delta.

## Risk, rollback и deployment

Вернуть только собственный code commit после review; данные/схему не откатывать автоматически. Для schema/broker/key migration сначала compatible roll-forward или проверенный restore. Для queue naming сохранить старый backlog; для ключей сохранить decryptable backup; для cursor/event добавить backward-compatible reader до writer. Если нет безопасного отката, остановить выпуск и зафиксировать roll-forward. Изменения схемы требуют T08 и отдельного разрешения на применение.

## Definition of done и отчёт

- [ ] Каждая работа имеет PASS/FAIL/BLOCKED и ссылку на RED/GREEN либо verified no-change conclusion.
- [ ] Baseline SHA, изменённые файлы и commands/exit/counts сохранены.
- [ ] Permission, cancellation, retry/duplicate и failure recovery scenarios проверены.
- [ ] UX/API equivalence подтверждена; screenshot matrix при затронутом UI, иначе N/A с причиной.
- [ ] Нет lowered coverage/security gates; skips и retries раскрыты.
- [ ] Doc delta и rollback reviewed; чужие файлы не staged.

Формат `results/T06.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 5–8 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.

## Handoff и provider acceptance после review

T06 передаёт T11 `results/T06.md` с точным cursor wire schema, old/new responses и stable notification ID/reconnect contract. T11 теперь blocked_by T06 и T10; именно T11 после file lock меняет client cursor/reconciliation. T10 ранний session fix остаётся независимым. Добавление индекса/поля сверх поддерживаемой T08 схемы требует адресного post-T08 handoff и provider tests до завершения T06, не изменения уже закрытого baseline вслепую.

Для cursor выбрать opaque base64url JSON `{v:1,occurredOnUtc,id}` с invariant UTC parsing, strict size/version/GUID validation; неверный cursor=400 без отражения payload. Legacy `before` остаётся отдельным режимом, одновременные cursor+before отклонить. SQL tie order идентичен ORDER BY и WHERE, UUID translation доказать на Npgsql. Зафиксировать фактическое название query property с клиентом T11 до implementation.

Проверить disposable PLANORA_TEST_POSTGRES как в T08. Выполнить provider startup suite и новые tied-page/store tests, затем hub live integration: фильтр !~Postgres этой приёмки не закрывает. Новые tests называются по actual implementation; ненулевой count обязателен. Тесты NotificationEventHandler сами по себе не доказывают WebSocket revoke.
