# T01 — Shared contracts и readiness

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T01. Цель: Shared contracts и readiness. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: нет. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T01.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Зафиксировать additive track-only StageAsync: добавить entity в тот же scoped DbContext без SaveChanges. Существующий AddAsync сохраняет semantics, пока каждый caller не переведён отдельным пакетом. Добавить тест shared contract и ready tags. Для outbox сначала сохранить один активный processor как deployment precondition; horizontal scale требует PostgreSQL atomic claim/lease, не одного in-memory lock. Никакой универсальной новой transaction framework.

## Change boundaries и ownership

- `BuildingBlocks/Planora.BuildingBlocks.Application/Outbox`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### DIST-003 / P2 / CONFIRMED — Readiness большинства сервисов не включает базу данных

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs:67-70` — MapPlanoraHealthEndpoints: ready выбирает только checks c tag ready
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/DependencyInjection.cs:83-96` — AddBuildingBlocksInfrastructure: DB tags db/postgres, Redis tags cache/redis
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/DependencyInjection.cs:131-132` — AddRealtimeInfrastructure: DbContext check без tags
- `Services/MessagingApi/Planora.Messaging.Infrastructure/DependencyInjection.cs:65-66` — AddMessagingInfrastructure: DbContext check без tags

Trigger: После запуска сделать только тестовую DB недоступной и запросить /health/ready; нет ready-tagged DB registration.

Impact: Readiness может вернуть 200 при невозможности обслуживать DB-запросы. /health aggregate остаётся отдельной рабочей проверкой; утверждение не распространяется на неё.

Root cause: Несогласованный contract registration tags и predicate endpoint.

Решение по шагам: T01 закрепляет ready tagging в shared регистрации/тестах; T02/T03/T04/T05/T06 применяют к service-owned DbContext checks. Liveness не зависит от DB; broker остаётся Degraded на aggregate согласно принятой политике. Не включать Redis fail-open auth в hard ready без согласования политики.

Альтернативы: Сменить predicate на все checks опасно: transient RabbitMQ заставит убрать сервис с буферизующим outbox из rotation.

Regression scenarios:

- Host test с unhealthy tagged DB: /health/live=200, /health/ready=503.
- Проверить регистрации всех 6 API; Auth Redis check уже ready, DB всё равно отдельно.
- Aggregate /health продолжает показывать broker Degraded.

Acceptance:

- Для каждого API явно документирован набор readiness dependencies.
- Тесты проверяют реальную DI wiring, не только helper predicate.

Граница доказательства: DI соответствующих сервисов дополнительно найден через rg; полный runtime outage не проводился. Реальные probe URLs платформы проверяет T14.

### DIST-009 / P2 / CONFIRMED — Outbox select/mark не защищён от двух активных процессоров

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs:118-145` — ProcessOutboxMessagesAsync: SELECT batch затем отдельный SaveChanges MarkAsProcessing; код прямо предполагает SINGLE processor

Trigger: Два service replicas выбирают те же Pending rows до изменения status.

Impact: Двойные публикации и возможные повторные effects в consumers без atomic inbox. At-least-once сам допускает duplicates, но deployment ошибочно может рассчитывать на единичную обработку.

Root cause: Нет DB claim/lease atomicity; эксплуатационное ограничение не enforced.

Решение по шагам: Сначала закрепить single active processor как deploy gate. Если horizontal scale требуется: atomic PostgreSQL claim через transaction SKIP LOCKED/UPDATE RETURNING с lease ownership; не держать DB transaction во время broker publish, reclaim проверяет owner/lease. Это отдельное изменение после T08 schema/provider validation.

Альтернативы: Advisory lock один processor на DB проще и достаточен при текущем объёме; не вводить отдельный worker проект без измерений.

Regression scenarios:

- Два processor instance, barrier синхронизация SELECT; не два concurrent claims одной row.
- Crash после publish допускает redelivery и consumer idempotency.
- Reclaim не отнимает живой lease.

Acceptance:

- Выбран и доказан single-instance либо atomic-claim contract.
- Нагрузка/throughput измерены до изменения; нет обещания exactly-once.
- Документация deploy не предлагает недопустимую топологию.

Граница доказательства: Код подтверждён; live число replicas не проверялось. Это conditional scaling finding, не утверждение текущего инцидента.

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

Формат `results/T01.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 3–5 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.

## Принятое решение после независимого review

В этом пакете только single-active-processor contract и additive staging/readiness. PostgreSQL claim/lease НЕ реализовать внутри T01: T08 зависит от него. Если deployment требует нескольких processors, выпуск блокируется до отдельного post-T08 задания с schema/claim tests; это не скрытая зависимость T01. Scope включает shared DependencyInjection.cs и профильные infrastructure tests. Service DI ready tags выполняют соответствующие service owners после freeze.
