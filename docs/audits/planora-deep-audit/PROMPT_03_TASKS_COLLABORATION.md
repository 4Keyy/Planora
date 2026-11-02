# T03 — Tasks и Collaboration invariants

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T03. Цель: Tasks и Collaboration invariants. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T01, T02, T05, T08. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T03.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Операция mutation + все durable events должна иметь один commit. До commit получить необходимую authorization/enrichment информацию, затем stage полный fan-out и сохранить; недоступность необязательной enrichment после commit не возвращает ложное failure. Friendship revoke удаляет workers в обе стороны и у subtasks без изменения чужих workers. System comment deletion перевести с title suffix на SourceSubtaskId: optional backward-compatible event field, nullable column, новые события пишут ID; legacy ambiguous строки не удалять. Схему заказывает T08, contract extension согласовать T01/T07 до патча.

## Change boundaries и ownership

- `Services/TodoApi`
- `Services/CollaborationApi`
- `tests/Planora.UnitTests/Services/TodoApi`
- `tests/Planora.UnitTests/Services/CollaborationApi`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### BE-002 / P1 / CONFIRMED — Todo и Collaboration фиксируют mutation и fan-out события несколькими commit

- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/OutboxRepository.cs:14-18` — AddAsync: Каждое добавление outbox вызывает context.SaveChangesAsync
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateTodo/CreateTodoCommandHandler.cs:112-133` — Handle: TaskCreated event записан до realtime event; первый AddAsync уже фиксирует todo
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/AddComment/AddCommentCommandHandler.cs:72-88,201-244` — Handle/PublishNotificationsAsync: Comment SaveChanges предшествует sync и каждому recipient event

Trigger: Ошибка/отмена между первым и последующим enqueue или после сохранения comment.

Impact: Клиент получает ошибку при уже сохранённом изменении; часть уведомлений/синхронизации отсутствует, повтор запроса может создавать дубли.

Root cause: Save-through outbox API ошибочно используется как часть большого атомарного набора.

Решение по шагам: T03: StageAsync в service-specific repos; stage all events и business changes в том же context, затем один SaveChanges. Network authorization/enrichment делать до commit где влияет на обязательные events; необязательные post-commit enrichments не превращать commit в failed operation.

Альтернативы: Транзакция вокруг existing AddAsync — допустимый промежуточный путь при доказанной retry совместимости, но не глобальное удаление save из AddAsync.

Regression scenarios:

- Fault after Nth staged event; assert zero mutation/events persisted.
- Success asserts complete expected event set and actor exclusion.
- Two-context retry/concurrency tests, no duplicate comment on safe retry policy.

Acceptance:

- Один атомарный commit для mutation и полного outbox набора.
- Legacy AddAsync callers других сервисов сохраняют прежнюю семантику.
- UI/API statuses и content не меняются.

Граница доказательства: Runtime crash injection не выполнялся. Существующие mock SaveChanges assertions не доказывают atomicity.

### BE-005 / P2 / CONFIRMED — Friendship removal оставляет worker rows и занятую capacity

- `Services/TodoApi/Planora.Todo.Application/Features/IntegrationEvents/FriendshipRemovedEventConsumer.cs:26-37` — HandleAsync: Вызывает только RemoveSharesBetweenUsersAsync
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs:393-413` — RemoveSharesBetweenUsersAsync: Удаляет shares, workers не затрагиваются
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs:460-486,500-518` — AddWorker/CleanupWorkersOnAccessChange: Capacity считает workers; cleanup вызывается при изменении domain shares, обходится repository delete

Trigger: Друг занял последнее место, затем friendship удалена и событие обработано.

Impact: Пользователь уже не имеет доступа, но worker count/capacity продолжают учитывать его; другие участники не могут занять освободившееся по смыслу место.

Root cause: Интеграционная очистка shares обходит aggregate cleanup workers.

Решение по шагам: Удалить worker rows revoked peer на задачах обоих владельцев, включая subtasks, в одной транзакции с shares; сохранить unrelated workers/owner и определить sync event после очистки через staged outbox.

Альтернативы: Загружать затронутые aggregates tracked и менять shares через domain API; сравнить bounded batching с bulk approach по correctness.

Regression scenarios:

- Owner A, peer B и C; capacity=2; B join, revoke A/B, C join succeeds.
- Both directions/subtasks; no-share-but-worker historical state; duplicate event idempotent.

Acceptance:

- Отозванный peer отсутствует в shares и workers соответствующих task trees.
- Чужие owners/участники не удалены.
- Live authorization остаётся fail-closed.

Граница доказательства: Статический consistency defect. Реальный пользовательский сценарий не запускался.

### BE-006 / P2 / CONFIRMED — Удаление subtask activity определяется заголовком вместо identity

- `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence/Repositories/CommentRepository.cs:76-102` — SoftDeleteSubtaskActivityAsync: Выборка system comments по EndsWith title suffix
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/SubtaskDeletedEventConsumer.cs:29-36` — HandleAsync: Для activity передаётся Title, SubtaskId используется только replies
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/TaskActivityEventConsumer.cs:30-58` — HandleAsync: System comment сохраняет текст события без subtask identity

Trigger: Две subtasks в одной branch с одинаковым заголовком; либо subtask переименована после создания.

Impact: Удаление одной subtask скрывает историю другой с тем же названием; после rename старая activity может остаться.

Root cause: Отображаемый текст используется как foreign identity.

Решение по шагам: После contract/schema этапов добавить optional SourceSubtaskId к activity payload и persisted system comment; новые события удалять по ID. Legacy ambiguous title matches не удалять массово; оставить видимую historical запись либо отдельное явно одобренное reconciliation.

Альтернативы: Не очищать legacy activity вовсе, сохраняя timeline audit; только новые identity-backed entries удаляются точно.

Regression scenarios:

- Duplicate titles, rename, Unicode/suffix collisions, unrelated user comment, out-of-order create/delete.
- Backward payload with отсутствующим optional field остаётся читаемым.

Acceptance:

- Событие удаления никогда не удаляет activity другой subtask.
- Контракт расширен обратно совместимо.
- Backfill не угадывает identity.

Граница доказательства: Точные новые поле/миграция — proposed design, сейчас их нет. Нужна isolated schema plan, а не destructive migration.

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

Формат `results/T03.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 5–9 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
