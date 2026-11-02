# Backend checkpoint: Auth, Todo, Category, Collaboration

Baseline `dc6b1781a24d43d967c418de30acda10fcafb8f9`, 2026-11-02. Источник: реальное чтение кода, DI, EF configurations, выборочных tests/history. Никакие изменения приложения, миграции или тестовые запуски этим исследователем не выполнялись. Статический контроль не является PostgreSQL/broker воспроизведением.

## Подтверждённые границы

- Auth использует SHA-256 refresh token hashes, HttpOnly refresh cookie, password verification, lockout, TOTP/recovery path; RefreshToken handler распознаёт последовательный replay по причине revocation. У RefreshToken нет EF concurrency token; partial unique device index защищает только non-null device key и не является token compare-and-swap.
- Category HTTP create сбрасывает присланный UserId; read-by-id требует owner; update/delete проверяют owner. gRPC update/delete явно запрещены. Category soft-delete фильтруется глобально, Npgsql aggregate concurrency защищается xmin.
- Todo access = owner либо живой friend + stored share; legacy public/null snapshot имеет отдельную ветвь. Нельзя заменять эту политику обычным IsPublic. Subtasks читаются после access check родителя; completion у них глобальный, у shared top-level task может быть viewer state.
- Collaboration Add/Update проверяют текущий доступ через Todo; reply на чужую branch отклоняется по TaskId; system comments нельзя редактировать как пользовательские. Delete проверяет author/owner, но не HasAccess: эта асимметрия требует отдельного решения по политике, не объявлена подтверждённой BOLA.
- Auth deletion пишет UserDeletedIntegrationEvent через общий outbox в том же scoped context, затем stamp/avatar cleanup. Todo/Category/Collaboration имеют одноимённые UserDeletedEventConsumer; shared queue identity дефект ведёт агент distributed, владелец T05.

## Предварительные дефекты и решения

1. BE-001 Category commit before outbox: CategoryDbContext.SaveChangesAsync очищает domain events, вызывает base.SaveChangesAsync, затем dispatch. CategoryDeletedDomainEventHandler только после этого пишет outbox. Ошибка/краш между шагами оставляет удалённую категорию без durable cleanup event. T04: stage событие до одного commit, исключить дублирующий post-commit handler; не менять глобальный dispatcher слепо.
2. BE-002 Todo/Collaboration partial commit: Todo OutboxRepository.AddAsync сохраняет tracked business change и первое событие немедленно; subsequent realtime/fanout события отдельно. Collaboration Add/Update/Delete сохраняют comment прежде любого event. T03: additive StageAsync из T01, собрать все сообщения до одного owner SaveChanges; сохранить legacy AddAsync у непереведённых callers.
3. BE-003 concurrent refresh: read/check/revoke/add/save без CAS/lock позволяет двум contexts увидеть active token. При nullable legacy device fingerprint уникальный индекс не исключает двух successor tokens. LIKELY, нужен двухконтекстный Npgsql test; T02: serializable token-consumption boundary/CAS и явный replay outcome, не возвращать два success.
4. BE-004 expired device session: Login FindActiveByUserAndDeviceAsync ищет ExpiresAt > now, но unique index WHERE RevokedAt IS NULL включает истёкшую запись. Новый login того же user-agent/IP пытается вставить конфликтующий fingerprint. CONFIRMED статически при наличии индекса; T02: транзакционно retire expired unrevoked device row перед insert, проверить concurrency, не использовать NOW() в partial index.

## Уже прочитанные положительные контроли

TodoDatabaseStartup валидирует цепочку history, не принимает неизвестные migration IDs, проверяет legacy schema, не удаляет старые comments автоматически; reviewed Todo migrations tracked. Auth/Category/Collaboration tracked migrations отсутствуют: generic DatabaseStartup использует EnsureCreated при отсутствии migrations и не обновляет существующую схему. Это deployment verification gap, T08 должен определить безопасный baseline по фактической isolated DB, не штамповать migrations без сравнения.

История просмотрена через `git log -7` на RefreshToken handler, Category context и AddComment handler: `5235d7f`, `3900df6`, `796a1ae`, `0bd275e`, `da090fe`, `8c9c26c`, `eabb0ea`. Это происхождение соответствующих поверхностей, не утверждение о просмотре всех diff этих commits.

## Ограничения и продолжение

Точный per-file охват в backend-files.json. READ означает полное чтение; NEEDS_DEEP_REVIEW с ranges означает частичный проход. Все остальные файлы сервиса остаются на продолжение общего file inventory. Отсутствие findings в непрочитанном файле не является заключением о корректности. Реальные DB isolation, schema upgrades, two-context races, live gRPC and UI flows пока NOT_VERIFIED.
