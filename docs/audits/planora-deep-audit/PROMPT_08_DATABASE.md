# T08 — EF schema integrity и migration baseline

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T08. Цель: EF schema integrity и migration baseline. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T01. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T08.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Составить таблицу model/migrations/compiled chain/applied history без подключения production. Auth, Category, Collaboration model-created schemas требуют versioned upgrade/adoption, не EnsureCreated как upgrade. Включить Messaging в inventory: отсутствие finding не означает проверенную схему. Todo и Realtime имеют рабочие guarded startup helpers — сохранить проверки, не восстанавливать устаревший missing-initial диагноз. Fresh, compatible unmanaged, prior managed, unknown migration, partial schema и cancellation проверяются на одноразовом Npgsql. Approval исключения ignore только для реально reviewed migration sources; expand/backfill/contract с restore plan, не history stamp без equivalence.

## Change boundaries и ownership

- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence`
- `Services/CategoryApi/Planora.Category.Infrastructure/Persistence`
- `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Persistence`
- `tools/Planora.Migrator`
- `.gitignore`
- `.dockerignore`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### BE-007 / P1 / CONFIRMED — Auth/Category/Collaboration schema upgrades не воспроизводятся tracked EF chain

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/DatabaseStartup.cs:11-26` — EnsureReadyAsync: При отсутствии migrations EnsureCreated не обновляет существующую schema
- `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs:37-41` — OnConfiguring: PendingModelChangesWarning подавляется
- `.gitignore:188-189,223-248` — Migrations ignore: Широкое исключение migration sources; allowlist только Todo/Realtime в конце
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDatabaseStartup.cs:22-78` — EnsureReadyAsync: Положительный контроль reviewed migration chain/adoption

Trigger: Fresh clone или обновление существующей Auth/Category/Collaboration БД после изменения EF model; локальные ignored migrations не поставляются с commit.

Impact: Чистый install может создать новую схему, а upgrade existing DB останется со старой; одинаковый SHA не гарантирует одинаковую схему.

Root cause: Нет tracked per-service upgrade chain в Git inventory; EnsureCreated предназначен для bootstrap.

Решение по шагам: T08: отдельно инвентаризовать actual applied histories в изоляции, зафиксировать versioned baseline/migrations и guarded adoption для каждого сервиса; проверка schema equivalence до stamp, plan expand/backfill/contract; ignore exceptions только на reviewed sources.

Альтернативы: Оставить миграции внешним поставляемым артефактом, но его SHA/provenance и проверяемый upgrade contract должны стать частью релиза.

Regression scenarios:

- Fresh clone bootstrap, previous supported schema upgrade with representative rows, drift/unknown history rejection, idempotent rerun.
- Schema/model comparison, index/FK/check constraints, no data loss.

Acceptance:

- Все поддерживаемые service schema versions имеют воспроизводимый upgrade path.
- Existing data preserved и неизвестный drift останавливает upgrade.
- Production migrations выполняются только отдельным разрешённым этапом.

Граница доказательства: Inventory: git ls-files Services/*/*Infrastructure/Migrations/* содержит Todo/Realtime only. Deployed schema и ignored local migration contents не исследовались; drift конкретной БД не доказан.

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

Формат `results/T08.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 5–9 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.

## Provider gate и ownership после review

Scope включает sibling `Services/*/Planora.*.Infrastructure/Migrations`, startup tests и reviewed `.gitignore`/`.dockerignore` exceptions. Путь будущей migration сначала получить из EF tooling, не выдумывать вручную. Новая миграция без separate permission не применяется к рабочим данным.

До provider command доказать, что PLANORA_TEST_POSTGRES указывает на собственный одноразовый сервер; сохранить container/project/port и seed counts без credentials. Если его нет — BLOCKED; без env запускать Testcontainers не автоматически.

```powershell
if ([string]::IsNullOrWhiteSpace($env:PLANORA_TEST_POSTGRES)) { throw 'Disposable PostgreSQL prerequisite is missing' }
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --configuration Release --filter 'FullyQualifiedName~RealtimeDatabaseStartupTests|FullyQualifiedName~TodoDatabaseStartupTests|FullyQualifiedName~Postgres'
```

Эта команда будущая, NOT_RUN в planning session. Новые Auth/Category/Collaboration upgrade tests добавить и выполнить явно по их actual names. Ни filtered !~Postgres suite, ни InMemory не закрывают provider acceptance. Требуется ненулевой executed count и zero unexpected skips.
