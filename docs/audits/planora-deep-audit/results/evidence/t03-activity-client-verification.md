# BE-006: source identity through the comment API and branch feed

**PASS_LOCAL** для HTTP projection и клиентской обработки identity. Это отдельная
единица после [persisted backend fix](t03-activity-identity-verification.md).
DIST-012, deployment и полные HTTP/SignalR/browser gates остаются открытыми.

## RED и исправление

Read-only review нашёл ещё одну title-зависимость: branch feed сопоставлял
completion activity с подзадачами по заголовку, а при удалении одной подавлял
activity всех одноимённых подзадач. Эти system comments скрыты как отдельные
timeline nodes, но дают имя и время видимой completion reply.

На исходной HTTP/client реализации (`dd06caa9577633d6aca1c6718b633be583296ad8`
плюс ещё не закоммиченный backend identity fix) получен RED:

- BranchFeed: **3 failed, 20 passed, 0 skipped**. Воспроизведены duplicate-title
  attribution, rename и потеря чужой completion attribution после удаления и poll.
- DTO/query contract: **2 failed, 0 passed, 0 skipped**. Query/DTO не передавали
  `sourceSubtaskId` браузеру.

`CommentDto` получил последним параметром optional nullable `SourceSubtaskId`.
`GetComments` проецирует stored identity; regular, genesis и legacy entries
остаются null. Прежний JSON без поля читается, прежние constructor callers
сохраняются. Wire name — `sourceSubtaskId`; frontend type также optional nullable.
Граница доступа к ветке и число gRPC/repository calls не менялись.

Branch feed связывает completion с subtask только по identity. Из загруженных
identity-backed completion events выбирается последнее по parsed timestamp;
дробная точность ISO не сравнивается лексикографически. Это выбор среди
загруженных persisted comments, не новая гарантия broker ordering.

Optimistic deletion подавляет только system comments с SourceSubtaskId выбранной
подзадачи. Poll/reload не возвращает их до cascade; чужие identity и legacy null
не подавляются. Rollback возвращает только изменённые записи. Live merge также
замечает появление source field при неизменных content/updatedAt.

## Legacy policy

Legacy null/отсутствующий source не удаляется и не используется для title-based
attribution. Даже единственный текущий title не доказывает историческую identity:
одноимённая подзадача могла быть удалена или переименована. Неоднозначная legacy
activity не перепривязывается к оставшейся подзадаче после удаления её соседа.

Такие lifecycle rows сохраняются и остаются скрыты отдельными timeline nodes,
как прежде. Done card показывает существующую generic completion note без
угаданного имени/времени. Если следующий ответ API передаёт source того же
comment ID, live merge использует identity и показывает attribution.

## Реальные проверки

| Проверка | Результат |
|---|---|
| BranchFeed RED | 3 failed / 20 passed / 0 skipped |
| DTO/query RED | 2 failed / 0 passed / 0 skipped |
| BranchFeed final | 29 passed / 0 failed / 0 skipped |
| DTO/query и существующие command handlers | 18 passed / 0 failed / 0 skipped |
| Frontend TypeScript | exit 0 |
| Full frontend ESLint, max-warnings 0 | exit 0 |
| Scoped whitespace check | exit 0 |
| Foreign next-env preservation | Git blob `ce4e94a6b10f160ee021fe18939af160d2927dcf` |
| Tracked tsconfig preservation | diff пуст |

Девять новых component cases проверяют identity/rename/delete+poll, null/absent
legacy без guessing, отсутствие fallback на другую identity, источник того же
ID, появляющийся при poll, latest loaded completion с дробными ISO timestamps
и rollback удаления. Шесть policy/edge cases добавлены после первого RED; они
не выдаются за первоначальные красные проверки.

Команды, counters/timestamps и source/artifact hashes:
[t03-activity-client-verification.json](t03-activity-client-verification.json).
Локальные logs/reports — `.buildcheck/sync-20261106/be006-client/`.
Vite configLoader advisory сохранился; suppression и новые зависимости не добавлены.

## Документация и границы

Doc delta для T15: additive field в comment-list API, identity-based completion
attribution/deletion и явная legacy generic policy. Новых schema изменений сверх
предыдущей backend unit нет. Demo не создаёт subtask lifecycle system activity;
его mapping не менялся. HTTP paths/statuses, user copy, layout, shortcuts и motion
не менялись. Next build/schema generators в рабочем checkout не запускались.

jsdom проверяет DOM/API interaction и mocked live-change callbacks, а не pixels,
настоящий SignalR transport или deployment. Full coverage/build и независимый
review выполняет parent integration gate. При старом server без optional field
completion работает с generic note. Late/replayed activity и отсутствие durable
deletion tombstone остаются DIST-012; эта единица не закрывает ACK/crash/ordering.
