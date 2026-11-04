# Реестр находок

Baseline `dc6b1781a24d43d967c418de30acda10fcafb8f9`. CONFIRMED означает ровно утверждение из evidence: статический путь, эксперимент с mocked boundaries, API settings или scanner output. Это не синоним production exploit. LIKELY требует указанного воспроизведения. Приоритет P0 отсутствует; это не гарантия отсутствия P0 в непрочитанном коде.

| ID | Priority | Confidence | Finding | Package |
| --- | --- | --- | --- | --- |
| BE-001 | P1 | CONFIRMED | Удаление категории фиксируется раньше durable CategoryDeleted event | [T04](PROMPT_04_CATEGORIES.md) |
| BE-002 | P1 | CONFIRMED | Todo и Collaboration фиксируют mutation и fan-out события несколькими commit | [T03](PROMPT_03_TASKS_COLLABORATION.md) |
| BE-003 | P1 | LIKELY | Конкурентное потребление refresh token не защищено CAS/row concurrency | [T02](PROMPT_02_AUTH_PRIVACY.md) |
| BE-004 | P2 | CONFIRMED | Истёкшая nonrevoked device session блокирует повторный login unique index | [T02](PROMPT_02_AUTH_PRIVACY.md) |
| BE-005 | P2 | CONFIRMED | Friendship removal оставляет worker rows и занятую capacity | [T03](PROMPT_03_TASKS_COLLABORATION.md) |
| BE-006 | P2 | CONFIRMED | Удаление subtask activity определяется заголовком вместо identity | [T03](PROMPT_03_TASKS_COLLABORATION.md) |
| BE-007 | P1 | CONFIRMED | Auth/Category/Collaboration schema upgrades не воспроизводятся tracked EF chain | [T08](PROMPT_08_DATABASE.md) |
| BE-008 | P2 | CONFIRMED | Переполнение offset при большом допустимом PageNumber | [T02](PROMPT_02_AUTH_PRIVACY.md) |
| BE-009 | P2 | CONFIRMED | Messaging design-time factory игнорирует MessagingDatabase | [T08](PROMPT_08_DATABASE.md) |
| BE-010 | P2 | CONFIRMED | Retention cap проверяет только исходное число кандидатов | [T13](PROMPT_13_TEST_STRATEGY.md) |
| DIST-001 | P1 | CONFIRMED | Коллизия consumer queue: удаление пользователя не доставляется каждому домену | [T05](PROMPT_05_MESSAGING.md) |
| DIST-002 | P1 | CONFIRMED | DLX объявлен без durable dead-letter queue и binding | [T05](PROMPT_05_MESSAGING.md) |
| DIST-003 | P2 | CONFIRMED | Readiness большинства сервисов не включает базу данных | [T01](PROMPT_01_FOUNDATIONS.md) |
| DIST-004 | P1 | CONFIRMED | Доступ в SignalR branch room живёт дольше разрешения и токена | [T06](PROMPT_06_REALTIME.md) |
| DIST-005 | P2 | CONFIRMED | Notification persist-then-push теряет push после сбоя | [T06](PROMPT_06_REALTIME.md) |
| DIST-006 | P2 | CONFIRMED | Notification pagination пропускает строки с одинаковым timestamp | [T06](PROMPT_06_REALTIME.md) |
| DIST-007 | P1 | LIKELY | Некорректный KnownProxies может включить доверие всем forwarded headers | [T07](PROMPT_07_GATEWAY_GRPC.md) |
| DIST-008 | P3 | CONFIRMED | L1 cache может сохранять stale value при failed remove | [T09](PROMPT_09_CACHE.md) |
| DIST-009 | P2 | CONFIRMED | Outbox select/mark не защищён от двух активных процессоров | [T01](PROMPT_01_FOUNDATIONS.md) |
| DIST-010 | P3 | CONFIRMED | Описание outbox backoff в INVARIANTS устарело | [T15](PROMPT_15_DOCUMENTATION.md) |
| FE-001 | P1 | CONFIRMED | Поздний refresh восстанавливает завершённую сессию | [T10](PROMPT_10_FRONTEND_CORE.md) |
| FE-002 | P1 | CONFIRMED | Notification store принимает ответы прошлой сессии после reset | [T10](PROMPT_10_FRONTEND_CORE.md) |
| FE-003 | P2 | CONFIRMED | Branch room присоединяется после unmount во время connect | [T10](PROMPT_10_FRONTEND_CORE.md) |
| FE-004 | P2 | CONFIRMED | Avatar hydration может записать ответ прошлого аккаунта в новый | [T10](PROMPT_10_FRONTEND_CORE.md) |
| FE-005 | P2 | LIKELY | Standalone branch load не защищён от устаревшего ответа | [T11](PROMPT_11_FRONTEND_UX.md) |
| OPS-001 | P1 | CONFIRMED | main допускает обход обязательных проверок | [T14](PROMPT_14_CI_CD.md) |
| OPS-002 | P1 | CONFIRMED | E2E baseline красный: шесть тестов shard 6 | [T11](PROMPT_11_FRONTEND_UX.md) |
| OPS-003 | P1 | CONFIRMED | Scheduled gitleaks сообщил 66 совпадений | [T12](PROMPT_12_SECURITY_SUPPLY_CHAIN.md) |
| OPS-004 | P2 | CONFIRMED | Полный npm audit содержит moderate minimatch advisory | [T12](PROMPT_12_SECURITY_SUPPLY_CHAIN.md) |
| OPS-005 | P2 | CONFIRMED | CI инструменты разрешаются по плавающим версиям | [T14](PROMPT_14_CI_CD.md) |
| OPS-006 | P1 | CONFIRMED | CD не связывает deploy с проверенным immutable SHA | [T14](PROMPT_14_CI_CD.md) |
| OPS-007 | P1 | CONFIRMED | Compose не сохраняет Auth avatars при пересоздании контейнера | [T14](PROMPT_14_CI_CD.md) |
| OPS-008 | P2 | CONFIRMED | Performance scripts не дают baseline реального списка | [T16](PROMPT_16_FINAL_INTEGRATION.md) |
| OPS-009 | P2 | CONFIRMED | Maintained deployment guide расходится с startup кодом | [T15](PROMPT_15_DOCUMENTATION.md) |
| OPS-010 | P2 | CONFIRMED | Secret scanner allowlist исключает целые runtime config файлы | [T12](PROMPT_12_SECURITY_SUPPLY_CHAIN.md) |
| OPS-011 | P2 | CONFIRMED | E2E path filters пропускают общие build inputs | [T14](PROMPT_14_CI_CD.md) |
| OPS-012 | P1 | CONFIRMED | Production route selection остаётся локальной | [T14](PROMPT_14_CI_CD.md) |

## BE-001 — Удаление категории фиксируется раньше durable CategoryDeleted event

Severity high; likelihood medium; confidence CONFIRMED.

- `Services/CategoryApi/Planora.Category.Infrastructure/Persistence/CategoryDbContext.cs:44-66` — ClearDomainEvents, base.SaveChanges, затем dispatch
- `Services/CategoryApi/Planora.Category.Application/Features/Categories/Events/CategoryDeletedDomainEventHandler.cs:25-48` — Outbox AddAsync вызывается после commit категории
- `Services/CategoryApi/Planora.Category.Application/Features/Categories/Commands/DeleteCategory/DeleteCategoryCommandHandler.cs:32-40` — Нет внешней транзакции вокруг delete/save

Trigger: Сбой записи outbox или остановка процесса после category commit и до enqueue integration event.

Impact: Категория удалена, но Todo не получает durable событие очистки ссылок; повторный delete может вернуть not found и не восстановить событие.

Root cause: Domain event dispatch находится после сохранения, а unit of work не охватывает следующий save.

Minimal solution: T04: stage CategoryDeletedIntegrationEvent до единственного owner SaveChanges с additive StageAsync из T01; исключить повторную публикацию в post-commit domain handler. Сохранить owner checks и soft-delete semantics.

Limits: Статически доказанный порядок операций; аварийный PostgreSQL сценарий в аудите не запускался.

Regression / acceptance:

- Npgsql fault injection: outbox insert fails -> category remains live and no event; success -> deleted category plus exactly one event.
- Existing CreateDeleteCategoryCommandHandlerTests и CategoryOutboxRepositoryTests, новая настоящая atomicity regression.
- Ошибка enqueue не оставляет category commit.
- Успех сохраняет категорию и ровно одно событие.
- T05 доставляет CategoryDeleted всем нужным потребителям без изменения payload.

## BE-002 — Todo и Collaboration фиксируют mutation и fan-out события несколькими commit

Severity high; likelihood medium; confidence CONFIRMED.

- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/OutboxRepository.cs:14-18` — Каждое добавление outbox вызывает context.SaveChangesAsync
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateTodo/CreateTodoCommandHandler.cs:112-133` — TaskCreated event записан до realtime event; первый AddAsync уже фиксирует todo
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/AddComment/AddCommentCommandHandler.cs:72-88,201-244` — Comment SaveChanges предшествует sync и каждому recipient event

Trigger: Ошибка/отмена между первым и последующим enqueue или после сохранения comment.

Impact: Клиент получает ошибку при уже сохранённом изменении; часть уведомлений/синхронизации отсутствует, повтор запроса может создавать дубли.

Root cause: Save-through outbox API ошибочно используется как часть большого атомарного набора.

Minimal solution: T03: StageAsync в service-specific repos; stage all events и business changes в том же context, затем один SaveChanges. Network authorization/enrichment делать до commit где влияет на обязательные events; необязательные post-commit enrichments не превращать commit в failed operation.

Limits: Runtime crash injection не выполнялся. Существующие mock SaveChanges assertions не доказывают atomicity.

Regression / acceptance:

- Fault after Nth staged event; assert zero mutation/events persisted.
- Success asserts complete expected event set and actor exclusion.
- Two-context retry/concurrency tests, no duplicate comment on safe retry policy.
- Один атомарный commit для mutation и полного outbox набора.
- Legacy AddAsync callers других сервисов сохраняют прежнюю семантику.
- UI/API statuses и content не меняются.

## BE-003 — Конкурентное потребление refresh token не защищено CAS/row concurrency

Severity high; likelihood medium; confidence LIKELY.

- `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/RefreshToken/RefreshTokenCommandHandler.cs:45-130` — Read active -> generate -> revoke/add -> save; нет атомарного conditional consume
- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/RefreshTokenConfiguration.cs:37-66` — DeviceFingerprint nullable; нет token concurrency property
- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs:47-59` — xmin добавлен Friendship, не RefreshToken
- `Services/AuthApi/Planora.Auth.Domain/Entities/RefreshToken.cs:49-53` — Допустимы refresh rows без fingerprint; Register использует legacy path

Trigger: Два DbContext загружают один active refresh до любого commit; особенно registration/legacy token с DeviceFingerprint=null.

Impact: Оба запроса могут выпустить действующие successor tokens; sequential replay detection не охватывает одновременный replay.

Root cause: Проверка состояния токена выполняется в памяти без сериализации потребления.

Minimal solution: Сначала two-context Npgsql reproduction. Затем атомарный consume по token hash + nonrevoked + nonexpired с concurrency/CAS, последующая issuance в той же транзакции; losing writer перечитывает состояние и следует явной replay policy.

Limits: Эксплуатация и PostgreSQL race не запускались; подтверждён отсутствующий механизм, runtime outcome LIKELY.

Regression / acceptance:

- Barrier-synchronized two-context null/non-null fingerprint refresh; at most one successful consume.
- Sequential replay продолжает revoke chain и stamp.
- No token minted/returned after rollback; cancellation and unique conflict sanitized.
- Результат concurrent теста зафиксирован до fix.
- Никогда два успешных consume одного token generation.
- Нет raw token в логах/evidence.

## BE-004 — Истёкшая nonrevoked device session блокирует повторный login unique index

Severity medium; likelihood high; confidence CONFIRMED.

- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/RefreshTokenConfiguration.cs:54-61` — Unique filter только RevokedAt IS NULL, expiry не исключается
- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/RefreshTokenRepository.cs:42-53` — Find исключает ExpiresAt <= now
- `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/Login/LoginCommandHandler.cs:140-181` — Если active отсутствует, INSERT нового токена с тем же fingerprint

Trigger: UserAgent/IP прежние, старый device token истёк, не revoked и ещё не purged; модельный unique index существует.

Impact: Корректный пароль приводит к database unique violation вместо login.

Root cause: Определение active в query и predicate unique index различается.

Minimal solution: В короткой транзакции retire expired nonrevoked rows данного user/device перед созданием нового; реализовать конкурентный re-login с re-read/retry outcome и сохранить запрет восстановления revoked token.

Limits: Подтверждено чтением model/query/handler. Наличие индекса на фактической deployed DB NOT_VERIFIED; InMemory не выявит дефект.

Regression / acceptance:

- Npgsql expired+unrevoked device row -> login success and exactly one nonrevoked device row.
- Revoked row не оживает; два одновременных login того же device; другой device unaffected.
- Реляционная regression красная на baseline и зелёная после.
- Нет 23505 для последовательного expiry→login.
- Сохранены RememberMe и session listing contracts.

## BE-005 — Friendship removal оставляет worker rows и занятую capacity

Severity medium; likelihood high; confidence CONFIRMED.

- `Services/TodoApi/Planora.Todo.Application/Features/IntegrationEvents/FriendshipRemovedEventConsumer.cs:26-37` — Вызывает только RemoveSharesBetweenUsersAsync
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs:393-413` — Удаляет shares, workers не затрагиваются
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs:460-486,500-518` — Capacity считает workers; cleanup вызывается при изменении domain shares, обходится repository delete

Trigger: Друг занял последнее место, затем friendship удалена и событие обработано.

Impact: Пользователь уже не имеет доступа, но worker count/capacity продолжают учитывать его; другие участники не могут занять освободившееся по смыслу место.

Root cause: Интеграционная очистка shares обходит aggregate cleanup workers.

Minimal solution: Удалить worker rows revoked peer на задачах обоих владельцев, включая subtasks, в одной транзакции с shares; сохранить unrelated workers/owner и определить sync event после очистки через staged outbox.

Limits: Статический consistency defect. Реальный пользовательский сценарий не запускался.

Regression / acceptance:

- Owner A, peer B и C; capacity=2; B join, revoke A/B, C join succeeds.
- Both directions/subtasks; no-share-but-worker historical state; duplicate event idempotent.
- Отозванный peer отсутствует в shares и workers соответствующих task trees.
- Чужие owners/участники не удалены.
- Live authorization остаётся fail-closed.

## BE-006 — Удаление subtask activity определяется заголовком вместо identity

Severity medium; likelihood medium; confidence CONFIRMED.

- `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence/Repositories/CommentRepository.cs:76-102` — Выборка system comments по EndsWith title suffix
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/SubtaskDeletedEventConsumer.cs:29-36` — Для activity передаётся Title, SubtaskId используется только replies
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/TaskActivityEventConsumer.cs:30-58` — System comment сохраняет текст события без subtask identity

Trigger: Две subtasks в одной branch с одинаковым заголовком; либо subtask переименована после создания.

Impact: Удаление одной subtask скрывает историю другой с тем же названием; после rename старая activity может остаться.

Root cause: Отображаемый текст используется как foreign identity.

Minimal solution: После contract/schema этапов добавить optional SourceSubtaskId к activity payload и persisted system comment; новые события удалять по ID. Legacy ambiguous title matches не удалять массово; оставить видимую historical запись либо отдельное явно одобренное reconciliation.

Limits: Точные новые поле/миграция — proposed design, сейчас их нет. Нужна isolated schema plan, а не destructive migration.

Regression / acceptance:

- Duplicate titles, rename, Unicode/suffix collisions, unrelated user comment, out-of-order create/delete.
- Backward payload with отсутствующим optional field остаётся читаемым.
- Событие удаления никогда не удаляет activity другой subtask.
- Контракт расширен обратно совместимо.
- Backfill не угадывает identity.

## BE-007 — Auth/Category/Collaboration schema upgrades не воспроизводятся tracked EF chain

Severity high; likelihood medium; confidence CONFIRMED.

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs:11-26` — При отсутствии migrations EnsureCreated не обновляет существующую schema
- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs:37-41` — PendingModelChangesWarning подавляется
- `.gitignore:188-189,223-248` — Широкое исключение migration sources; allowlist только Todo/Realtime в конце
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDatabaseStartup.cs:22-78` — Положительный контроль reviewed migration chain/adoption

Trigger: Fresh clone или обновление существующей Auth/Category/Collaboration БД после изменения EF model; локальные ignored migrations не поставляются с commit.

Impact: Чистый install может создать новую схему, а upgrade existing DB останется со старой; одинаковый SHA не гарантирует одинаковую схему.

Root cause: Нет tracked per-service upgrade chain в Git inventory; EnsureCreated предназначен для bootstrap.

Minimal solution: T08: отдельно инвентаризовать actual applied histories в изоляции, зафиксировать versioned baseline/migrations и guarded adoption для каждого сервиса; проверка schema equivalence до stamp, plan expand/backfill/contract; ignore exceptions только на reviewed sources.

Limits: Inventory: git ls-files Services/*/*Infrastructure/Migrations/* содержит Todo/Realtime only. Deployed schema и ignored local migration contents не исследовались; drift конкретной БД не доказан.

Regression / acceptance:

- Fresh clone bootstrap, previous supported schema upgrade with representative rows, drift/unknown history rejection, idempotent rerun.
- Schema/model comparison, index/FK/check constraints, no data loss.
- Все поддерживаемые service schema versions имеют воспроизводимый upgrade path.
- Existing data preserved и неизвестный drift останавливает upgrade.
- Production migrations выполняются только отдельным разрешённым этапом.

## DIST-001 — Коллизия consumer queue: удаление пользователя не доставляется каждому домену

Severity high; likelihood high при совместном broker/vhost; confidence CONFIRMED.

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:158-209` — queueName строится из eventName и handlerType.Name без namespace/service; одна durable queue
- `Services/TodoApi/Planora.Todo.Api/Program.cs:169` — Todo подписан на UserDeletedEventConsumer
- `Services/CategoryApi/Planora.Category.Api/Program.cs:163` — Category имеет то же простое имя handler
- `Services/CollaborationApi/Planora.Collaboration.Api/Program.cs:165` — Collaboration имеет то же простое имя handler

Trigger: В одном vhost запустить Todo/Category/Collaboration; опубликовать один UserDeletedIntegrationEvent. Каждый сервис ожидает собственную копию, но все consumers подключены к UserDeletedIntegrationEvent.UserDeletedEventConsumer.

Impact: Очистка задач, категорий и комментариев выполняется лишь получившим delivery сервисом. Персональные данные остаются в остальных доменах.

Root cause: Transport subscription identity равен простому имени типа вместо независимого логического подписчика.

Minimal solution: Ввести стабильные service/subscription identifiers в именование очереди, сохранить routing key eventName. Каждой подписке соответствует один handler. Подготовить совместимый переход старой очереди с остановкой старых consumers, сохранением backlog и идемпотентным replay по всем трём подписчикам; не удалять очередь автоматически.

Limits: Коллизия подтверждена кодом и регистрациями. Live broker/topology и реальные данные не запрашивались; runtime reproduction не проводился.

Regression / acceptance:

- На настоящем изолированном RabbitMQ один event доставлен всем трём разным logical subscribers.
- Две реплики одного logical subscriber делят работу, не удваивают побочный эффект.
- Replay UserDeletedIntegrationEvent повторно безопасен для каждого домена.
- Mock channel assertion проверяет разные queue names для одинаковых simple class names.
- Три домена очищают синтетического пользователя после одного события.
- Очереди и replay lineage документированы; backlog не удалён.
- Конкретные historical event IDs могут быть повторены с подтверждением по каждому домену.

## DIST-002 — DLX объявлен без durable dead-letter queue и binding

Severity high; likelihood high на новом broker; confidence CONFIRMED.

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:26-48` — DLX объявлен
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:192-200` — queue содержит x-dead-letter-exchange, но создаётся только основная queue/binding
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/RabbitMqEventBus.cs:325-340` — poison/retry-exhausted nack requeue:false

Trigger: Fresh broker; обработчик бросает исключение дважды либо malformed JSON попадает в основную очередь. Код отправляет delivery в planora-eventbus-dlx, у которого репозиторий не создаёт ни одного binding.

Impact: Событие исчезает после ограниченного retry; оператор не может восстановить его из DLQ. Это особенно опасно для account erasure и task lifecycle.

Root cause: Объявление exchange ошибочно используется как полноценное хранение dead letters.

Minimal solution: Добавить декларацию durable DLQ с явным binding до запуска consumers; выбрать отдельную DLQ логического подписчика и dead-letter-routing-key, сохранить headers/source subscription/event id. Добавить runbook bounded replay с согласованием владельца и метрики backlog. Проверить существующие queue arguments до rollout — несовместимые redeclare не лечить удалением.

Limits: Отсутствие деклараций подтверждено поиском исходников/compose/deploy; внешняя ручная настройка broker неизвестна. RabbitMQ semantics сверены по официальным docs.

Regression / acceptance:

- Fresh broker: malformed JSON наблюдаем в DLQ.
- Transient first failure requeues, second moves to DLQ ровно один раз.
- Replay синтетического события сохраняет event Id, не вызывает пропуск другого subscriber.
- Unroutable publish не переводит outbox в Processed.
- Ни одно окончательно отклонённое тестовое событие не исчезает.
- DLQ durable и переживает restart; наличие queue/binding проверено.
- Нет бесконечного requeue или авто-replay poison сообщений.

## DIST-003 — Readiness большинства сервисов не включает базу данных

Severity medium; likelihood high при DB outage; confidence CONFIRMED.

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs:67-70` — ready выбирает только checks c tag ready
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/DependencyInjection.cs:83-96` — DB tags db/postgres, Redis tags cache/redis
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/DependencyInjection.cs:131-132` — DbContext check без tags
- `Services/MessagingApi/Planora.Messaging.Infrastructure/DependencyInjection.cs:65-66` — DbContext check без tags

Trigger: После запуска сделать только тестовую DB недоступной и запросить /health/ready; нет ready-tagged DB registration.

Impact: Readiness может вернуть 200 при невозможности обслуживать DB-запросы. /health aggregate остаётся отдельной рабочей проверкой; утверждение не распространяется на неё.

Root cause: Несогласованный contract registration tags и predicate endpoint.

Minimal solution: T01 закрепляет ready tagging в shared регистрации/тестах; T02/T03/T04/T05/T06 применяют к service-owned DbContext checks. Liveness не зависит от DB; broker остаётся Degraded на aggregate согласно принятой политике. Не включать Redis fail-open auth в hard ready без согласования политики.

Limits: DI соответствующих сервисов дополнительно найден через rg; полный runtime outage не проводился. Реальные probe URLs платформы проверяет T14.

Regression / acceptance:

- Host test с unhealthy tagged DB: /health/live=200, /health/ready=503.
- Проверить регистрации всех 6 API; Auth Redis check уже ready, DB всё равно отдельно.
- Aggregate /health продолжает показывать broker Degraded.
- Для каждого API явно документирован набор readiness dependencies.
- Тесты проверяют реальную DI wiring, не только helper predicate.

## DIST-004 — Доступ в SignalR branch room живёт дольше разрешения и токена

Severity high; likelihood medium; confidence CONFIRMED.

- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs:133-147` — Права проверяются только при join
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs:169-192` — Последующие вызовы проверяют лишь локальный joined set
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/RealtimeBroadcaster.cs:64-85` — Событие отправляется всем участникам task group
- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs:84-94,219-221` — SecurityStamp проверяется при authentication; MapHub не включает CloseOnAuthenticationExpiration

Trigger: Пользователь вступает в branch room; затем доступ отозван, дружба удалена, токен истёк либо security stamp изменён. Соединение не разрывается клиентом.

Impact: Продолжают поступать branch entity/actor metadata и typing display names; бывший участник может посылать typing. Не утверждается доступ к полному тексту задач: HTTP refetch имеет отдельную авторизацию.

Root cause: Долгоживущая group membership ошибочно принимается за актуальное право; authentication principal SignalR кэшируется на lifetime connection.

Minimal solution: Включить close-on-expiry и серверную проверку revocation перед hub invocations. Для branch privacy перейти от группового broadcast к разрешённому списку пользователей: взять текущую audience через защищённый Todo RPC и направить событие personal groups; typing проверяет CanAccessBranchAsync и отправляется только текущей разрешённой аудитории. Удалять stale memberships как cleanup, а не как единственную защиту. Для security-stamp changes нужен серверный disconnect/periodic validation для idle connections; client logout не является контролем безопасности.

Limits: Подтверждён отсутствующий контроль в server code. WebSocket exploit не выполнялся. Точная revocation policy/latency требует решения владельца; T06 сначала фиксирует её.

Regression / acceptance:

- Join->revoke->BranchChanged/typing: бывший viewer получает 0 новых payload.
- Valid token expires during open WebSocket: server closes, reconnect with fresh token.
- Password change при открытом idle WebSocket: connection не продолжает private receive.
- Reconnect восстанавливает только разрешённые rooms; два Realtime instances.
- Устранены active send и passive receive после revoke.
- Visual/UI contract unchanged; transient auth dependency failure fail-closed.
- Определена и проверена верхняя граница latency revocation.

## DIST-005 — Notification persist-then-push теряет push после сбоя

Severity medium; likelihood medium; confidence CONFIRMED.

- `Services/RealtimeApi/Planora.Realtime.Application/Handlers/NotificationEventHandler.cs:57-66` — После успешного insert и failed send повторная delivery пропускает push как duplicate
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationStore.cs:26-34` — Наличие SourceEventId возвращает false
- `tests/Planora.UnitTests/Services/RealtimeApi/Handlers/NotificationEventHandlerTests.cs:63-76,94-106` — Tests отдельно фиксируют skip duplicate и exception; sequence retry-after-commit не проверен

Trigger: Store commit succeeds; SendToUserAsync fails; Rabbit requeues. Second call sees stored event and returns before Send.

Impact: Уведомление сохранено и доступно read API, но активный пользователь не получает push до другого refresh/reconnect. Это не потеря durable notification row.

Root cause: Dedup persistence и delivery completion сведены в один boolean.

Minimal solution: Сначала выбрать явный contract best-effort push с гарантированным reconciliation либо retryable delivery. Для retryable: store возвращает stable existing NotificationPayload; delivery имеет отдельный pending/sent state, replay отправляет тот же id, frontend dedup по id. Не генерировать новый Notification.Id на retry. Использовать существующий NotificationDelivery только после проверки его invariants и тестов; не обещать exactly-once network delivery.

Limits: Статически доказанная последовательность; runtime broker failure не инжектировался. Зависимость T10 является контрактным handoff, не обязательным циклом DAG.

Regression / acceptance:

- Первый send бросает после persist, повторная обработка доставляет тот же id либо reconciliation доказывает согласованный SLA.
- Commit-send-ack crash matrix; duplicate не увеличивает unread дважды.
- Offline client loads persisted rows after reconnect.
- Есть один durable row и стабильный notification id.
- Нет дублирующих toast/unread increments.
- Результат соответствует выбранному contract и документирован.

## DIST-006 — Notification pagination пропускает строки с одинаковым timestamp

Severity medium; likelihood medium при burst; confidence CONFIRMED.

- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationReadStore.cs:60-74` — Sort только OccurredOnUtc; следующий page WHERE OccurredOnUtc < before
- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs:59-74` — Публичный cursor содержит только DateTime

Trigger: Создать больше take notifications одному пользователю с одинаковым OccurredOnUtc, взять page1 и запросить before timestamp последней строки.

Impact: Оставшиеся строки того же timestamp недоступны через load older.

Root cause: Неуникальный keyset cursor и отсутствие deterministic tie-breaker.

Minimal solution: Аддитивно ввести cursor (OccurredOnUtc, Id) с order by descending обеих колонок; timestamp-only before сохранить как legacy explicit mode до обновления T10/T11. Схему/индекс проверить в T08; сравнение UUID провайдера подтвердить PostgreSQL integration test, не предполагать LINQ translation.

Limits: Нет динамического воспроизведения; exact query inspect достаточен для finding. Frontend handoff T10/T11 после contract freeze T06.

Regression / acceptance:

- 3+ равновременных row при take=2 возвращаются без пропусков/повторов.
- Interleaved inserts/mark-read между страницами.
- Два пользователя не смешиваются; malformed cursor дает 400.
- Полный обход tied dataset совпадает с expected IDs.
- Клиент и сервер поддерживают согласованный backward-compatible cursor.
- Owner фильтр сохранён.

## DIST-007 — Некорректный KnownProxies может включить доверие всем forwarded headers

Severity high; likelihood medium при operator misconfiguration; confidence LIKELY.

- `Planora.ApiGateway/Program.cs:61-82,251-265` — Nonempty raw array активирует middleware; оба trusted lists очищены; invalid IP silently skipped; warning советует CIDR, хотя IPAddress.TryParse не принимает CIDR

Trigger: KnownProxies содержит только CIDR либо invalid value. Исходный array nonempty, parsed KnownProxies empty и KnownIPNetworks empty.

Impact: При стандартной ASP.NET forwarded-header semantics пустые trusted lists снимают peer restriction; spoofed XFF меняет rate-limit identity и XFP/XFH. Нужен regression на используемом runtime.

Root cause: Включение по raw values вместо validated allowlist; silent parse failure; противоречивая подсказка конфигурации.

Minimal solution: Парсить/валидировать список до registration. Любая непустая invalid запись fail startup с безопасным именем key; при поддержке CIDR использовать KnownIPNetworks явно и тестировать. Включать middleware только при validated allowlist >0. Убрать неверный CIDR совет, сохранить ForwardLimit=1 пока topology не доказана.

Limits: Статически доказан empty-list configuration; middleware consequence проверяется host test, поэтому LIKELY. Production config не читалась.

Regression / acceptance:

- KnownProxies=[] не доверяет spoof XFF.
- Valid proxy only: trusted accepted, untrusted ignored.
- CIDR/invalid/all-whitespace configuration не приводит к empty-trust middleware.
- Статус 429/Retry-After для двух реальных forwarded client IP остаётся раздельным.
- Ни одна разрешённая конфигурация не означает implicit trust-all.
- Сценарии проверены на .NET SDK baseline.
- TLS/host trust не расширены.

## DIST-008 — L1 cache может сохранять stale value при failed remove

Severity low; likelihood unknown: primitive без найденных runtime consumers; confidence CONFIRMED.

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/CacheService.cs:186-202` — L1 remove стоит после awaited L2 remove; catch поглощает исключение

Trigger: ICacheService L1 содержит value; IDistributedCache.RemoveAsync throws; повторный GetAsync возвращает L1.

Impact: Нарушение primitive invalidate contract до L1 TTL. На baseline не найден application caller ICacheService, поэтому не заявляется текущая утечка private data.

Root cause: Best-effort L2 error пропускает независимую локальную invalidation.

Minimal solution: Всегда удалять L1 независимо от результата L2; cancellation отдельно propagates. Зафиксировать failure contract (лог/метрика или result), не объявлять успешную invalidation в CacheInvalidator после swallowed failure. Не подключать generic cache к authorization paths.

Limits: Дефект primitive confirmed static; продуктовое воздействие NOT_VERIFIED. Сервисы используют отдельные IMemoryCache/Redis implementations, не этот wrapper.

Regression / acceptance:

- Faulting fake IDistributedCache.RemoveAsync: next read не hit_l1.
- Cancellation не превращается в cache miss/успех.
- Две независимые CacheService instances демонстрируют границы локальной invalidation без claims global consistency.
- Primitive test красный до и зелёный после.
- Документирован список реальных runtime callers; если по-прежнему 0, priority остаётся P3.
- Нет новых caching callers или dependencies.

## DIST-009 — Outbox select/mark не защищён от двух активных процессоров

Severity medium; likelihood conditional: horizontal replicas; confidence CONFIRMED.

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs:118-145` — SELECT batch затем отдельный SaveChanges MarkAsProcessing; код прямо предполагает SINGLE processor

Trigger: Два service replicas выбирают те же Pending rows до изменения status.

Impact: Двойные публикации и возможные повторные effects в consumers без atomic inbox. At-least-once сам допускает duplicates, но deployment ошибочно может рассчитывать на единичную обработку.

Root cause: Нет DB claim/lease atomicity; эксплуатационное ограничение не enforced.

Minimal solution: Сначала закрепить single active processor как deploy gate. Если horizontal scale требуется: atomic PostgreSQL claim через transaction SKIP LOCKED/UPDATE RETURNING с lease ownership; не держать DB transaction во время broker publish, reclaim проверяет owner/lease. Это отдельное изменение после T08 schema/provider validation.

Limits: Код подтверждён; live число replicas не проверялось. Это conditional scaling finding, не утверждение текущего инцидента.

Regression / acceptance:

- Два processor instance, barrier синхронизация SELECT; не два concurrent claims одной row.
- Crash после publish допускает redelivery и consumer idempotency.
- Reclaim не отнимает живой lease.
- Выбран и доказан single-instance либо atomic-claim contract.
- Нагрузка/throughput измерены до изменения; нет обещания exactly-once.
- Документация deploy не предлагает недопустимую топологию.

## DIST-010 — Описание outbox backoff в INVARIANTS устарело

Severity low; likelihood high для следующих исполнителей; confidence CONFIRMED.

- `docs/INVARIANTS.md:73-80` — Current-code gap говорит NextRetryUtc не проверяется
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs:127-135` — Pending уже gated NextRetryUtc
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/OutboxRepository.cs:40-44` — Та же retry eligibility

Trigger: Исполнитель берёт docs/INVARIANTS как описание текущего дефекта.

Impact: Повторное ненужное исправление и риск регрессии корректного retry.

Root cause: После commit 0fd486add085950450b96920466f666a6b127cfa документ не синхронизирован.

Minimal solution: T15 заменить stale gap на текущий контракт с source/test links, сохранив limitation single processor и at-least-once.

Limits: История и текущий код прочитаны; тест лично этим агентом не запускался.

Regression / acceptance:

- CanonicalOutboxRepositoryTests.GetPendingMessagesAsync_RespectsScheduledBackoffForPendingRetries
- Docs links validation.
- Описание соответствует predicate и existing regression test.

## FE-001 — Поздний refresh восстанавливает завершённую сессию

Severity high; likelihood medium; confidence CONFIRMED.

- `frontend/src/store/auth.ts:243-257,290-339,346-377` — clearAuth отменяет таймер, но не инвалидирует уже начатый refresh; restoreSession и timer callback без проверки поколения вызывают applyRefresh.
- `frontend/src/lib/api.ts:377-417` — После ожидания shared refresh без проверки исходного владельца применяет токен и повторяет исходный запрос.
- `frontend/src/lib/auth-public.ts:101-129` — Single-flight и Web Lock сериализуют refresh, но не инвалидируют запрос при logout.
- `docs/audits/planora-deep-audit/evidence/frontend-review.md:diagnostic harness` — Выполнение исходного auth.ts: restoreSession -> clearAuth -> resolve старого refresh даёт isAuthenticated=true, old-account.
- `frontend/src/app/auth/verify-email/page.tsx:57-70` — Прямой refresh->applyRefresh без identity guard.
- `frontend/src/app/(app)/profile/page.tsx:775-815` — Avatar update и refresh continuation без session guard.

Trigger: Начать restore/scheduled/401 refresh; завершить сессию либо войти другим аккаунтом, пока ответ задержан; доставить старый ответ.

Impact: Клиент вновь принимает старую идентичность; возможны показ чужих данных и повтор mutation с неверным session context. Валидность старого JWT сервером после logout отдельно не проверялась.

Root cause: Отсутствует монотонное поколение auth session на всех async auth continuations.

Minimal solution: Ввести session epoch, изменяемый при явном setAuth/clearAuth, но не при нормальной ротации. Каждый restore/validate/refresh/interceptor захватывает epoch до await и перед apply/clear/redirect/retry проверяет его; отменённый refresh не повторяет mutation. Не переносить токены в storage.

Limits: Три пути просмотрены статически; динамический harness воспроизводит restore path с mocked network/JWT boundary, не браузер/сервер.

Regression / acceptance:

- Deferred restore success/reject после clearAuth и после login B.
- Scheduled refresh success после logout.
- 401 refresh + logout/login -> ни retry, ни clear новой сессии; token rotation внутри текущей сессии работает.
- Старый async response не меняет auth/roles/profile и не повторяет запрос.
- Существующие Web Lock, CSRF retry и 429 tests остаются зелёными.

## FE-002 — Notification store принимает ответы прошлой сессии после reset

Severity high; likelihood medium; confidence CONFIRMED.

- `frontend/src/store/notifications.ts:123-143,193-213,251-275` — Async responses без owner/epoch проверок записываются в глобальный singleton.
- `frontend/src/lib/realtime/hooks.ts:58-112` — Reset только при isAuthenticated=false; effect не зависит от userId, ReceiveNotification не сверяет payload.userId.
- `docs/audits/planora-deep-audit/evidence/frontend-review.md:diagnostic harness` — loadList -> reset -> resolve возвращает old-account item в store.

Trigger: При открытом bell задержать GET notifications, logout/reset, login B, разрешить старому запросу завершиться.

Impact: В bell новой сессии могут оказаться title/message/taskId предыдущего аккаунта; summary count также откатывается поздними ответами.

Root cause: Reset очищает значения, но не закрывает async lifecycle; singleton не имеет владельца.

Minimal solution: Привязать store к auth epoch/userId; reset инвалидирует pending операции. Проверять epoch перед каждым set после await, включая catch listLoaded, и before ingest. Lifecycle должен реагировать на identity change; подписку/OS notification фильтровать по текущему владельцу. Для summary race с push использовать локальную revision и reconcile после изменившегося snapshot.

Limits: Dynamic harness покрывает loadList; остальные continuations подтверждены чтением, browser cross-account не запускался.

Regression / acceptance:

- loadList/hydrate/markRead/markTaskRead resolve/reject после reset.
- A -> B и A -> logout -> A.
- Чужой ReceiveNotification не меняет store и не показывает OS notification; текущий payload дедуплицируется.
- После reset поздние ответы не меняют items/perTask/seen/listLoaded.
- Bell не содержит данных чужого userId; счётчик восстанавливается при reconnect.

## FE-003 — Branch room присоединяется после unmount во время connect

Severity medium; likelihood medium; confidence CONFIRMED.

- `frontend/src/lib/realtime/hooks.ts:172-196` — start().then(joinTask) не отменяется cleanup; cleanup раньше вызывает leaveTask.
- `frontend/src/lib/realtime/client.ts:220-235,334-337` — Поздний join вновь увеличивает joinedTasks; room сохраняется для rejoin.
- `docs/audits/planora-deep-audit/evidence/frontend-review.md:diagnostic harness` — deferred start -> cleanup -> resolve: один join после unmount и один leave до join.

Trigger: Открыть branch/editor при отложенном подключении, закрыть до завершения start.

Impact: Неиспользуемая room остаётся подписанной до logout; лишние сообщения и восстановление устаревших подписок. Серверный доступ room этим не обходится.

Root cause: Promise continuation не связана с lifecycle effect и регистрацией refcount.

Minimal solution: В effect учитывать active/cancelled flag и session epoch; регистрировать room до start либо после start только если подписчик жив. Cleanup должен симметрично отменять именно свою регистрацию, не чужую. Проверить StrictMode и два подписчика.

Limits: Harness исполняет useBranchRoom с mocked React effect и realtime boundary; реальный SignalR reconnect не запускался.

Regression / acceptance:

- Deferred start resolves после unmount; join не происходит.
- task A -> B до start; только B входит.
- Два одновременно живых подписчика A: один wire join, wire leave после последнего.
- Нулевые ghost memberships после cleanup.
- Reconnect восстанавливает только текущие комнаты; обработчики отписаны.

## FE-004 — Avatar hydration может записать ответ прошлого аккаунта в новый

Severity medium; likelihood medium; confidence CONFIRMED.

- `frontend/src/components/security-initializer.tsx:72-91` — GET /users/me завершает updateUser без проверки владельца/cleanup; dependency только isAuthenticated.
- `frontend/src/store/auth.ts:230-234` — Patch применяется к текущему user, независимо от инициатора запроса.

Trigger: A начинает /users/me; logout/login B; ответ A приходит позже B.

Impact: В текущем профиле показывается avatar URL A, возможна утечка идентичности/путаница; изменение backend profile не производится.

Root cause: Root-mounted effect не scoped к user identity и не отменяет старый request.

Minimal solution: Захватить auth epoch/userId, AbortController и active flag; сравнить перед updateUser. Dependency userId; нормальный refresh не должен вызывать лишнюю загрузку.

Limits: Статически подтверждён путь; динамический browser сценарий не запускался.

Regression / acceptance:

- Deferred avatar A после B не применяется.
- Unmount/clearAuth не вызывает updateUser.
- ProfilePictureUrl null и сеть 5xx не ломают login.
- Avatar относится только к текущей сессии; прежние ошибки остаются nonfatal.

## FE-005 — Standalone branch load не защищён от устаревшего ответа

Severity medium; likelihood medium; confidence LIKELY.

- `frontend/src/app/(app)/branch/[id]/page.tsx:35-48,60-68` — load без abort/epoch; completion всегда setTodo/setNotFound/setLoading. Зависит только от todoId.

Trigger: При сохранении экземпляра route-компонента навигация A -> B с обратным порядком ответов; либо action reload перекрывается новым read.

Impact: URL B может показать task A либо старый error. Реальный App Router remount для перехода между ID в этой сборке требуется проверить до изменения.

Root cause: Нет per-read latest-wins guard; часть UI-сохранений имеет собственные callbacks.

Minimal solution: Сначала route-level deferred test и browser навигация. Если сценарий воспроизводится, добавить request epoch + AbortSignal в load, привязать к todoId/session; успешные actions обновляют только текущий task.

Limits: Статическое наблюдение, runtime navigation NOT_VERIFIED; нельзя маркировать confirmed UI defect.

Regression / acceptance:

- A slow -> B fast -> A resolves; final URL/data B.
- 404 A после B success не показывает MissingTask.
- Pending autosave/duplicate transition не теряет пользовательские правки.
- Доказана воспроизводимость или finding закрыт как nonissue; patch только при доказанном race.

## OPS-001 — main допускает обход обязательных проверок

Severity high; likelihood condition-dependent; confidence CONFIRMED.

- `docs/audits/planora-deep-audit/evidence/github-state.json:protection/rulesets` — required_status_checks и review gate отсутствуют; force push разрешён, admin enforcement false; rulesets пусты.

Trigger: Push непроверенного commit уполномоченным пользователем.

Impact: Красный E2E не блокирует изменение main.

Root cause: required_status_checks и review gate отсутствуют; force push разрешён, admin enforcement false; rulesets пусты.

Minimal solution: Подготовить конкретный набор required checks, запрет force push и policy bypass; применить GitHub settings только после отдельного разрешения. Проверить GET после изменения, не считать YAML настройкой branch protection.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-002 — E2E baseline красный: шесть тестов shard 6

Severity high; likelihood condition-dependent; confidence CONFIRMED.

- `docs/audits/planora-deep-audit/evidence/remote-failures.md:E2E shard 6` — Run 41368376503/job125033430746: 6 failed,3 passed,48.2m; geometry/timeouts/session restore limiter; другие 5 shards success.

Trigger: Запуск существующего E2E на baseline.

Impact: Visual и session regressions нельзя считать исключёнными.

Root cause: Run 41368376503/job125033430746: 6 failed,3 passed,48.2m; geometry/timeouts/session restore limiter; другие 5 shards success.

Minimal solution: Воспроизвести каждый уникальный failing test на изолированном стеке с тем же SHA/browser; разделить auth setup, timeout и geometry. Исправлять root cause после red evidence; не повышать timeout/threshold без измерения.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-003 — Scheduled gitleaks сообщил 66 совпадений

Severity high; likelihood condition-dependent; confidence CONFIRMED.

- `docs/audits/planora-deep-audit/evidence/remote-failures.md:Gitleaks` — Run41416485392/job125181481709 содержит leaks found:66; сохранены только rule/path/commit метаданные.

Trigger: Scheduled full-history scan.

Impact: Существующий security gate красный; реальные секреты и fixture matches ещё не классифицированы.

Root cause: Run41416485392/job125181481709 содержит leaks found:66; сохранены только rule/path/commit метаданные.

Minimal solution: Для каждого fingerprint установить происхождение без публикации значения; реальные credentials отозвать отдельным согласованным действием, fixtures разрешать точечно с доказательством. Не переписывать историю и не выключать scanner.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-004 — Полный npm audit содержит moderate minimatch advisory

Severity medium; likelihood condition-dependent; confidence CONFIRMED.

- `docs/audits/planora-deep-audit/evidence/npm-audit.json:metadata/vulnerabilities` — 16 affected package entries, одна исходная GHSA-g3hv-75wg-m249; production audit=0.

Trigger: Обработка недоверенного glob в dev tooling; достижимость конкретного DoS не проверялась.

Impact: Риск supply chain/dev availability, не доказанная production exploitability.

Root cause: 16 affected package entries, одна исходная GHSA-g3hv-75wg-m249; production audit=0.

Minimal solution: Проследить npm explain minimatch; обновить совместимый upstream/lock. Не применять предложенный npm major downgrade/force. Проверить clean install, lint, tests и обе audit команды.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-005 — CI инструменты разрешаются по плавающим версиям

Severity medium; likelihood condition-dependent; confidence CONFIRMED.

- `.github/workflows/security.yml:190,208` — CycloneDX .NET без версии; npx cyclonedx-npm без pin; openapi.yml:188 spectral-cli@latest.

Trigger: Повтор pipeline с тем же application SHA в другой день.

Impact: Невоспроизводимое сканирование и исполнение непроверенного нового tooling.

Root cause: CycloneDX .NET без версии; npx cyclonedx-npm без pin; openapi.yml:188 spectral-cli@latest.

Minimal solution: Закрепить совместимые версии и lockfile/checksum где применимо; scoped job permissions для OIDC/attestations только SBOM. Проверить update policy; не вводить новые scanners без пользы.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-006 — CD не связывает deploy с проверенным immutable SHA

Severity high; likelihood condition-dependent; confidence CONFIRMED.

- `.github/workflows/cd.yml:70-203` — Каждый job checkout inputs.ref||github.ref; нет quality gate/environments; API вернул environments=0.

Trigger: Manual deploy движущейся ветки или tag без успешных checks.

Impact: Разные jobs могут развернуть разные revisions; release может обойти E2E/security.

Root cause: Каждый job checkout inputs.ref||github.ref; нет quality gate/environments; API вернул environments=0.

Minimal solution: Resolve ref один раз в SHA, передать jobs output; проверить полный набор successful checks этого SHA; явные needs для порядка, staging migration/health gates. Production environment и approvals подготовить отдельно; деплой сейчас запрещён.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-007 — Compose не сохраняет Auth avatars при пересоздании контейнера

Severity high; likelihood condition-dependent; confidence CONFIRMED.

- `docker-compose.yml:188-228` — У auth-api отсутствует volumes; writable webroot не персистентен. docs/backup-recovery.md подтверждает operational caveat.

Trigger: Пересоздание Auth container с уже загруженными аватарами.

Impact: Потеря пользовательских файлов.

Root cause: У auth-api отсутствует volumes; writable webroot не персистентен. docs/backup-recovery.md подтверждает operational caveat.

Minimal solution: Сначала безопасный backup текущего writable layer с SHA256 manifest; выбрать persistent mount, permissions для nonroot, перенести и проверить restore. Только затем recreate по отдельному разрешению; не монтировать пустой volume поверх единственной копии.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-008 — Performance scripts не дают baseline реального списка

Severity medium; likelihood condition-dependent; confidence CONFIRMED.

- `perf/k6/scenarios/todo-list.js:35-39` — setup создаёт пустого reader, нет seed tasks/shares; login.js переиспользует один account, бюджеты лимитера документированы.

Trigger: Запуск текущих k6 scripts и вывод об app throughput.

Impact: Пустой список и 429 искажают выводы; численного before/after нет.

Root cause: setup создаёт пустого reader, нет seed tasks/shares; login.js переиспользует один account, бюджеты лимитера документированы.

Minimal solution: Создать bounded synthetic dataset и раздельно измерять limiter и handler throughput; 1/5/10 VU, 60s cap, warm/cold, p50/p95/p99,error/429,query counts. Сохранять SHA/версии/данные; не ослаблять production limits.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-009 — Maintained deployment guide расходится с startup кодом

Severity medium; likelihood condition-dependent; confidence CONFIRMED.

- `docs/deployment.md:80-104` — Todo описан как missing initial; Realtime no startup initialization, но реальные helpers и Program уже изменились.

Trigger: Следование руководству для bootstrap/release.

Impact: Ненужные опасные workaround и неверные блокеры.

Root cause: Todo описан как missing initial; Realtime no startup initialization, но реальные helpers и Program уже изменились.

Minimal solution: Сверить Todo first migration CreateTable и RealtimeDatabaseStartup invocation; заменить stale statements ссылками на существующие тесты, сохранить реальные rollout blockers.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-010 — Secret scanner allowlist исключает целые runtime config файлы

Severity medium; likelihood condition-dependent; confidence CONFIRMED.

- `.gitleaks.toml:75-96` — docker-compose.yml целиком allowlisted; общий regex test/dummy допускает substring.

Trigger: Настоящий секрет добавлен в исключённый файл или совпадает с широким allowlist.

Impact: Ложный clean security scan.

Root cause: docker-compose.yml целиком allowlisted; общий regex test/dummy допускает substring.

Minimal solution: Заменить blanket path allowlist проверяемыми placeholder patterns/fingerprints; positive/negative synthetic fixtures, включая real-looking value в compose. Не печатать matched values и не добавлять общий tests/ allowlist.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-011 — E2E path filters пропускают общие build inputs

Severity medium; likelihood condition-dependent; confidence CONFIRMED.

- `.github/workflows/e2e.yml:7-27` — Нет Directory.Packages.props, Directory.Build.props, global.json, tests/tooling в фильтрах.

Trigger: Изменён общий .NET dependency graph без Services/** diff.

Impact: E2E не запустится для потенциально несовместимого графа.

Root cause: Нет Directory.Packages.props, Directory.Build.props, global.json, tests/tooling в фильтрах.

Minimal solution: Добавить реальные build/config inputs или reusable path classifier; проверить changed-files fixtures и required-check поведение при skip, не считать skipped run green.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## OPS-012 — Production route selection остаётся локальной

Severity high; likelihood condition-dependent; confidence CONFIRMED.

- `Planora.ApiGateway/Program.cs:37-39` — Production выбирает ocelot.json, содержащий loopback targets; deploy manifests требуют отдельных Fly apps.

Trigger: Запуск committed Production deployment без дополнительного route override.

Impact: Gateway не маршрутизирует к нужным сервисам.

Root cause: Production выбирает ocelot.json, содержащий loopback targets; deploy manifests требуют отдельных Fly apps.

Minimal solution: T07 фиксирует route/listener contract; T14 добавляет отдельную проверенную production конфигурацию, checks против loopback, REST/HTTP2 портов и приватной topology. Без live Fly доступа статус deployment NOT_VERIFIED.

Limits: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

Regression / acceptance:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.
- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

## BE-008 — Large accepted page numbers overflow the login-history offset

Priority P2; severity medium; confidence CONFIRMED (static path); package T02.

- `PaginationQuery.CalculateSkip` and `PaginationExtensions.ApplyPagination` multiply Int32 values without guarding overflow.
- `GetLoginHistoryQueryValidator` accepts any positive page number and page size up to 100.
- `LoginHistoryRepository.GetPagedByUserIdAsync` clamps the overflowing product to zero.

Trigger: authenticated login-history request with PageNumber=2147483647 and PageSize=100.
The signed Int32 offset becomes -200; the repository requests Skip(0), repeating the first
page with huge page metadata. The current-user predicate remains intact; no cross-account
exposure is asserted. [READ-011 evidence](results/evidence/read-011-review.json) contains exact ranges.

Use overflow-safe offset validation and preserve ordinary page/owner behavior. Add C# and
disposable PostgreSQL regressions before changing the code. The reviewer ran a Node Int32
arithmetic diagnostic only; endpoint/provider reproduction is pending. This finding does
not change or renumber the original 34 findings.

## BE-009 — Messaging design-time database input diverges from runtime

Priority P2; confidence CONFIRMED (static source path); owner T08/T13.
The factory reads only `DefaultConnection` and its legacy environment alias, while
runtime, Migrator and migration workflow use `MessagingDatabase`. A standard named
input is ignored and a development fallback can conceal the mismatch. No database
connection or wrong-target mutation was performed by the source reviewer.

[READ-038 evidence](results/evidence/read-038-review.md) records full source ranges,
provenance and the required no-connect target-selection/precedence regressions. T08
must reject missing/blank input and preserve only deliberate legacy compatibility.
Executable reproduction and correction are tracked separately in T08.

## BE-010 — Retention cap does not bound the whole deletion pass

Priority P2; confidence CONFIRMED for the static loop semantics; owner T13.
`MaxDeletionsPerRun` is documented as a per-pass cap, but the executor checks only
its initial eligible count, then drains batches without remaining-budget accounting.
Concurrent eligibility growth could exceed the cap. The advisory lock excludes peer
retention runs, rather than domain writers.

[READ-014 evidence](results/evidence/read-014-review.md) explicitly limits this finding:
most reviewed policies use a fixed cutoff and new normal timestamps do not qualify.
A supported backfill/restore or other concurrent transition must first be reproduced
on a disposable provider before asserting normal-runtime impact. No real data-loss
incident is claimed. T13 must verify the generic cap regression and the reachable
provider case before choosing a narrowly scoped correction.

## READ-033 — Auth persistence

| ID | Priority | Confidence | Trigger and required check |
| --- | --- | --- | --- |
| BE-011 | P1 | LIKELY | Two Auth contexts load the same unused recovery code. Verify a single successful consume with a provider barrier and distinct login fingerprints. |
| BE-012 | P1 | LIKELY | Two reset requests load the same token before either write. Verify one password update, one set of external effects and preservation of a newly issued token. |
| BE-013 | P2 | CONFIRMED, static | An empty decoded key in a malformed stored PBKDF2 record compares equal to the empty derived key. Verify rejection and compatibility with supported historical hashes. |
| BE-014 | P2 | LIKELY | Concurrent same-pair friendship requests can insert separate active rows. A retained terminal row can also win the unordered lookup. Verify both directions and preserved terminal history. |

T02 owns these cases. BE-013 requires malformed stored data. The review found no
external path for writing that hash. Provider and application regressions are
pending. [READ-033](results/evidence/read-033-review.md)

## READ-040 — Todo RPC and Realtime persistence

| ID | Priority | Confidence | Trigger and required check |
| --- | --- | --- | --- |
| DIST-011 | P2 | CONFIRMED, static | Three Todo RPCs omit the request token when calling MediatR. T07 verifies token forwarding and cancellation before persistent effects. |
| BE-015 | P2 | CONFIRMED, static | The legacy Realtime startup gate accepts drift in a mapped column default. T06 verifies rejection and the effect of the default on the regular notification write path in a disposable database. |

Runtime effects remain unverified for both findings. BE-015 concerns the existing
Realtime legacy helper. T08 introduced versioned schema comparison for four
other services. [READ-040](results/evidence/read-040-review.md)

## OPS-013 — Redis eviction can remove the Auth key ring

Priority P2, severity high, CONFIRMED for the Compose binding and synthetic Redis
policy. Auth Data Protection uses the same configured endpoint as the cache.
The disposable `allkeys-lru` run evicted a non-expiring list with AOF enabled.
The `noeviction` control kept the list and rejected writes under memory pressure.
Deployment policy, working key availability and real TOTP decryption remain
unverified. T02/T14 own the dedicated durable store and migration rehearsal.
[T09 evidence](results/T09.md)

## READ-034 — Avatar replacement and Category startup

| ID | Priority | Confidence | Trigger and required check |
| --- | --- | --- | --- |
| BE-016 | P2 | CONFIRMED, static | Avatar replacement prunes the previous files before saving the new URL. T02 injects a failed profile save and verifies that the previously committed URL still resolves. |
| BE-017 | P2 | CONFIRMED, static | Category startup uses a fixed provisioned database name with a separately configured connection. T04 exercises an absent database with a unique test name and verifies the provisioning target. |

The reviewed paths establish the ordering and configuration mismatch. Provider
and filesystem regressions remain open. [READ-034](results/evidence/read-034-review.md)

## READ-035 — Category commands and caller identity

| ID | Priority | Confidence | Trigger and required check |
| --- | --- | --- | --- |
| BE-018 | P2 | CONFIRMED, static | A service-key gRPC create passes an owner ID that the real handler ignores. T04 and T07 verify the call without bearer JWT and preserve the owner boundary for HTTP create. |
| BE-019 | P2 | CONFIRMED, static | A color-only PUT clears an existing icon. T04 verifies omitted, replaced and explicitly cleared icon values against a disposable database. |

Three additional Category RPCs omit the request cancellation token in
MediatR calls. They extend DIST-011. The review did not execute the RPC or
HTTP scenarios. [READ-035](results/evidence/read-035-review.md)

## BE-020 — Login verified against a superseded password

Priority P1, CONFIRMED and PASS_LOCAL. The PostgreSQL regression paused login
after password verification and completed a reset. Before the fix, login
created a new active session in both variants and restored the old password
in the rehash variant. The guarded transaction now rejects both attempts.
[T02 evidence](results/T02.md)

## READ-036 — Collaboration startup, erasure and pagination

| ID | Priority | Confidence | Trigger and required check |
| --- | --- | --- | --- |
| OPS-014 | P2 | CONFIRMED, static | The Redis startup waiter and runtime can select different endpoints. Verify both configuration inputs in isolated services. |
| BE-021 | P2 | CONFIRMED, static | Replies retain a deleted account's ID, name and quoted text. Verify derived data after account erasure while preserving ordinary comment deletion behavior. |
| BE-022 | P2 | CONFIRMED, static | The author's note makes the total vary across comment pages. Verify the final page through the API and both comment views. |

READ-036 also traced the Collaboration paths for fixed database provisioning
and Int32 pagination offsets. Runtime verification remains open.
[READ-036](results/evidence/read-036-review.md)
