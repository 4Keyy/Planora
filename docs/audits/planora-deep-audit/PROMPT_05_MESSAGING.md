# T05 — RabbitMQ delivery и Messaging

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T05. Цель: RabbitMQ delivery и Messaging. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T01. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T05.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Logical subscription ID должен быть стабильным и различаться между сервисами; одинаковые реплики одного сервиса сохраняют одну queue. Использовать event routing key без изменения payload. Дать каждой queue durable DLQ и explicit dead-letter routing key, проверить publisher confirms и unroutable. Переход: inventory old backlog, pause old consumers в согласованное окно, новые bindings, bounded idempotent replay, counts; не удалять старую queue автоматически. Сервисные эффекты erasure проверяют T02/T03/T04. Rabbit retry tests сейчас helper-only, нужен real broker.

## Change boundaries и ownership

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging`
- `Services/MessagingApi`
- `tests/Planora.UnitTests/Services/MessagingApi`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### DIST-001 / P1 / CONFIRMED — Коллизия consumer queue: удаление пользователя не доставляется каждому домену

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:158-209` — SubscribeAsync: queueName строится из eventName и handlerType.Name без namespace/service; одна durable queue
- `Services/TodoApi/Planora.Todo.Api/Program.cs:169` — SubscribeAsync<UserDeletedIntegrationEvent, UserDeletedEventConsumer>: Todo подписан на UserDeletedEventConsumer
- `Services/CategoryApi/Planora.Category.Api/Program.cs:163` — SubscribeAsync<UserDeletedIntegrationEvent, UserDeletedEventConsumer>: Category имеет то же простое имя handler
- `Services/CollaborationApi/Planora.Collaboration.Api/Program.cs:165` — SubscribeAsync<UserDeletedIntegrationEvent, UserDeletedEventConsumer>: Collaboration имеет то же простое имя handler

Trigger: В одном vhost запустить Todo/Category/Collaboration; опубликовать один UserDeletedIntegrationEvent. Каждый сервис ожидает собственную копию, но все consumers подключены к UserDeletedIntegrationEvent.UserDeletedEventConsumer.

Impact: Очистка задач, категорий и комментариев выполняется лишь получившим delivery сервисом. Персональные данные остаются в остальных доменах.

Root cause: Transport subscription identity равен простому имени типа вместо независимого логического подписчика.

Решение по шагам: Ввести стабильные service/subscription identifiers в именование очереди, сохранить routing key eventName. Каждой подписке соответствует один handler. Подготовить совместимый переход старой очереди с остановкой старых consumers, сохранением backlog и идемпотентным replay по всем трём подписчикам; не удалять очередь автоматически.

Альтернативы: Полное имя handler устраняет текущую коллизию, но превращает rename namespace в breaking transport change; предпочтительны явные стабильные logical IDs. Переименовать три класса как временную меру — менее устойчиво и также требует migration broker topology.

Regression scenarios:

- На настоящем изолированном RabbitMQ один event доставлен всем трём разным logical subscribers.
- Две реплики одного logical subscriber делят работу, не удваивают побочный эффект.
- Replay UserDeletedIntegrationEvent повторно безопасен для каждого домена.
- Mock channel assertion проверяет разные queue names для одинаковых simple class names.

Acceptance:

- Три домена очищают синтетического пользователя после одного события.
- Очереди и replay lineage документированы; backlog не удалён.
- Конкретные historical event IDs могут быть повторены с подтверждением по каждому домену.

Граница доказательства: Коллизия подтверждена кодом и регистрациями. Live broker/topology и реальные данные не запрашивались; runtime reproduction не проводился.

### DIST-002 / P1 / CONFIRMED — DLX объявлен без durable dead-letter queue и binding

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:26-48` — EnsureConnectionAsync: DLX объявлен
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:192-200` — SubscribeAsync: queue содержит x-dead-letter-exchange, но создаётся только основная queue/binding
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:325-340` — ProcessEventAsync: poison/retry-exhausted nack requeue:false

Trigger: Fresh broker; обработчик бросает исключение дважды либо malformed JSON попадает в основную очередь. Код отправляет delivery в planora-eventbus-dlx, у которого репозиторий не создаёт ни одного binding.

Impact: Событие исчезает после ограниченного retry; оператор не может восстановить его из DLQ. Это особенно опасно для account erasure и task lifecycle.

Root cause: Объявление exchange ошибочно используется как полноценное хранение dead letters.

Решение по шагам: Добавить декларацию durable DLQ с явным binding до запуска consumers; выбрать отдельную DLQ логического подписчика и dead-letter-routing-key, сохранить headers/source subscription/event id. Добавить runbook bounded replay с согласованием владельца и метрики backlog. Проверить существующие queue arguments до rollout — несовместимые redeclare не лечить удалением.

Альтернативы: Общая durable quarantine queue с routing '#' проще, но replay должен сохранять оригинального logical subscriber. Broker policy управляет DLX без жёстких x-arguments; изменение ownership инфраструктуры согласовать с T14.

Regression scenarios:

- Fresh broker: malformed JSON наблюдаем в DLQ.
- Transient first failure requeues, second moves to DLQ ровно один раз.
- Replay синтетического события сохраняет event Id, не вызывает пропуск другого subscriber.
- Unroutable publish не переводит outbox в Processed.

Acceptance:

- Ни одно окончательно отклонённое тестовое событие не исчезает.
- DLQ durable и переживает restart; наличие queue/binding проверено.
- Нет бесконечного requeue или авто-replay poison сообщений.

Граница доказательства: Отсутствие деклараций подтверждено поиском исходников/compose/deploy; внешняя ручная настройка broker неизвестна. RabbitMQ semantics сверены по официальным docs.

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

Формат `results/T05.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 4–7 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
