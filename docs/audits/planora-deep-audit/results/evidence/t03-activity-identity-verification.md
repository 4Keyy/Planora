# BE-006: identity-backed subtask activity

Локальный результат: **PASS_LOCAL** для точного удаления identity-backed activity.
Пакет T03 и operational gates остаются открытыми. Исходный код перед RED:
`e96f97e27cdb1f084f21c069b913ddcee8878c30`.

## Доказательство дефекта и исправление

Восстановлен неизменённый draft из
`.buildcheck/deep-audit-t03/pending-be006/SubtaskActivityIdentityPostgresTests.cs`;
SHA256 `08220c480028e1d89cb67c7d7baf0949e2e50530e6311e45173998188483f018`
совпал с [checkpoint](t03-owner-pause-local-prod.json).
Все 14 checkpoint hashes исходников также совпали до изменений.

RED на реальном disposable PostgreSQL: **6 failed, 2 passed, 0 skipped**.
Suffix-поиск удалял activity другой подзадачи с тем же или пересекающимся
заголовком, а переименование оставляло прежнюю activity. После изменения
проверки идентичности, writers, миграций и startup прошли **60/60**, без skips.
Два исходно зелёных facts характеризуют backward payload и rollback одного
save; они не выдаются за новые RED regressions.

`TaskActivityIntegrationEvent` получил необязательный nullable `SourceSubtaskId`.
Оба пути completion в `UpdateTodoCommandHandler` передают ID подзадачи.
`TaskActivityEventConsumer` сохраняет ID только для subtask activity;
root activity игнорирует source из payload. `CreateSubtask` по-прежнему не
публикует timeline activity. Шаблоны текстов, HTTP/DTO и frontend не менялись.

`Comment.SourceSubtaskId` хранится как nullable UUID. Cleanup выбирает live system
comments по `(TaskId, SourceSubtaskId)`; legacy строки без identity сохраняются.
Флаги reply targets и soft deletion activity по-прежнему записываются одним
UoW save с xmin concurrency. Повтор удаления сохраняет первоначальные tombstone
timestamps; unrelated branches, comments и quote snapshots не меняются.

## Миграция и совместимость

`20261106182312_AddSubtaskActivityIdentity` добавляет ровно nullable column и
индекс `IX_comments_TaskId_SourceSubtaskId`. Backfill и identity guessing отсутствуют.
Pre-reply и pre-source test profiles заморожены отдельно. Managed и unmanaged
pre-source upgrade сохраняют xmin существующих строк; повтор startup не меняет
данные. Полная unmanaged current schema принимается существующим startup suite;
частично добавленное поле без индекса отвергается без stamping history.
Четыре прежних migration source/designer файла не изменены.

SQL Up и Down получены EF CLI 10.0.8 и просмотрены в собственных artifacts.
Up содержит ADD nullable UUID, CREATE INDEX и запись migration history.
Down удаляет новый индекс и колонку, поэтому теряет новые identity; автоматически
применять его к рабочей БД нельзя. CREATE INDEX требует обычных PostgreSQL locks;
большой production dataset и lock duration не измерялись.

Старый binary отвергает новую schema/history по существующему strict guard.
Для T14 требуется согласованный reader/schema/writer rollout. Миграция применялась
только к одноразовым тестовым БД. Работающий локальный стек остался на прежних
бинарных файлах и схеме; deployment или restart не выполнялись.

## Реальные проверки

| Проверка | Результат |
|---|---|
| Provider RED из parked draft | 6 failed / 2 passed / 0 skipped |
| Build перед scaffold | exit 0; 12 прежних разрешённых CS0618 warnings |
| Identity provider facts | 8 passed |
| Migration provider cases | 3 passed |
| Existing integration-event consumer cases | 12 passed |
| Frozen pre-reply и pre-source model profiles | 2 passed |
| Versioned database startup suite | 28 passed |
| UpdateTodo outbox provider suite, включая оба completion writers | 7 passed |
| EF scaffold и оба SQL script generation | exit 0 |
| Scoped diff whitespace check | exit 0 |

Команды, timestamps, TRX и source hashes находятся в
[машиночитаемом evidence](t03-activity-identity-verification.json).
Артефакты находятся в `.buildcheck/sync-20261106/be006-artifacts/`.
Среда: проверенный контейнер `93763c124e7d`, label `com.planora.audit=sync-20261106`,
tmpfs без пользовательских mounts, bind только `127.0.0.1:60865`.
Все provider tests создают и удаляют собственные случайно именованные БД.

## Границы результата

Delete-before-late-activity по-прежнему не имеет durable deletion tombstone:
поздняя activity удалённой подзадачи может появиться. Отдельный characterization
проверяет эту границу и сохранность другой подзадачи с тем же заголовком;
он не закрывает DIST-012. Legacy rows намеренно не получают угаданную identity.
ACK loss, broker crash/replay, полноценный HTTP/SignalR и production rollout
этим набором не проверены. Visual matrix N/A: backend-only identity/schema fix.
