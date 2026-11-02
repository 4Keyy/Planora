# T04 — Category: atomic deletion и owner boundary

## 1. Миссия и минимальный контракт

Ты устраняешь BE-001 без изменения категории как продукта. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md), [backend-review](evidence/backend-review.md), finding BE-001. Сохраняй чужой diff, API/UX/privacy; не читай реальные secrets; сначала regression. Не выполняй production migrations, push, merge или deploy без отдельной санкции. Любое расхождение baseline проверяй до правки; опасный пункт останови с evidence.

## 2. Baseline, preconditions, inputs

Repo `https://github.com/4Keyy/Planora`, checkout `F:\Projects\Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Проверь `git status --short`, `git rev-parse HEAD`. Исходный чужой `frontend/next-env.d.ts` не трогать. Требуется T01 additive staging contract. Для erasure integration требуется T05 queue fix; для схемы — T08. Сам atomic fix не требует новой schema.

## 3. Исследованные факты

- `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs` сбрасывает body UserId на create, использует route id на update и возвращает 204 на успешный delete.
- `...Application/Features/Categories/Queries/GetCategoryById/GetCategoryByIdQueryHandler.cs:27` делает owner-scoped lookup, не раскрывает чужую категорию.
- `...Api/Grpc/CategoryGrpcService.cs:130` запрещает update/delete RPC без owner identity; не включать их автоматически.
- `...Infrastructure/Persistence/CategoryDbContext.cs:57-63` очищает domain events, сохраняет category, затем dispatch.
- `...Application/Features/Categories/Events/CategoryDeletedDomainEventHandler.cs:25-48` после commit пишет CategoryDeletedIntegrationEvent в outbox.
- `...Infrastructure/DependencyInjection.cs:41-43` регистрирует canonical generic OutboxRepository, legacy wrapper не является текущим DI owner.
- `...Infrastructure/Persistence/Configurations/CategoryConfiguration.cs` глобально исключает soft-deleted, задаёт owner/retention indexes; xmin добавлен context для Npgsql.

## 4. Конкретная реализация

**T04.1 / P1 / BE-001.** Regression должен падать при ошибке записи event после category mutation: durable category и event обязаны существовать вместе. Предпочтительное решение — orchestrating DeleteCategory handler создаёт integration event, stage через T01 StageAsync, затем один SaveChanges. Удали дублирующую публикацию CategoryDeletedIntegrationEvent через post-commit domain event handler либо переведи именно этот event на pre-save mapping без I/O. Не меняй весь Auth/Category domain dispatcher: это расширит scope и может перенести внешние side effects внутрь transaction. Сохрани domain Delete owner rule и мягкое удаление.

Схема целевого алгоритма (псевдокод, не готовый patch):

```text
load tracked category -> verify current owner -> category.Delete(owner)
stage CategoryDeletedIntegrationEvent(category.Id, owner) in same CategoryDbContext
one SaveChangesAsync -> success
failure -> neither category deletion nor outbox row committed
```

**T04.2 / P1 verification.** После T05 один UserDeletedIntegrationEvent должен обработаться Category consumer независимо от Todo/Collaboration. Не добавляй второй consumer или параллельный cleanup маршрут. Проверяй idempotent replay и чужие категории.

**T04.3 / P2.** После T01 исправь Category readiness DbContext tag по согласованной health helper семантике. Preserve live endpoint независимым от DB.

## 5. Runbook red/green и проверки

Prerequisites: установленный .NET SDK, восстановленные текущие dependencies, isolated PostgreSQL для atomicity. Существующий helper `tests/Planora.UnitTests/BuildingBlocks/Retention/Postgres/PostgresRetention.cs` создаёт throwaway DB по `PLANORA_TEST_POSTGRES`; не направлять на production. Команды из root:

```powershell
git status --short
git rev-parse HEAD
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --filter 'FullyQualifiedName~CategoryApi|FullyQualifiedName~CanonicalOutboxRepositoryTests'
dotnet build Services/CategoryApi/Planora.Category.Api/Planora.Category.Api.csproj --no-restore
```

Эти команды — future runbook, planning агент их не запускал. Добавь настоящие Npgsql tests: failure outbox insert, cancellation до commit, success exactly one event, retry без duplicate. Существующий `CategoryOutboxRepositoryTests` использует InMemory и mock dispatcher: он не доказывает post-commit atomicity. Controller tests должны сохранить statuses; owner/friend/stranger/anonymous matrix для HTTP, valid/missing/foreign user для gRPC, soft-deleted category not found. После targeted green запусти весь backend набор по общей command matrix.

## 6. Scope, критерии и ограничения

Owner: Category delete handler, CategoryDeleted mapping/handler, Category-specific DI/tests. Canonical outbox interface и реализация — T01; Todo category-cleanup consumer — T03 с согласованным контрактом. Не менять общий event payload, если BE-001 исправляется staging. Документация по факту: docs/architecture.md outbox semantics, docs/features.md category delete, docs/testing.md новый relational test.

- [ ] Atomicity regression red→green на PostgreSQL, а не только mock verification.
- [ ] Category delete и exactly one outbox event фиксируются одним commit.
- [ ] Owner denial и unknown id сохраняют прежние HTTP/JSON contracts.
- [ ] No duplicate event от old dispatcher; no broker call в transaction.
- [ ] Отмена/DB failure оставляет доступную категорию, если commit не состоялся.
- [ ] T05 fan-out verification выполнена либо явно BLOCKED; не маскировать зависимость.
- [ ] API/UI не редизайнены; Category build и tests имеют реальные результаты.

## 7. Rollback, отчёт и размер

Риск: двойное событие после добавления stage при сохранённом старом handler; вложенный SaveChanges; retry execution strategy. Rollback — собственный code commit с сохранением прежней schema; не удалять уже созданные durable events. Event idempotency обязана переносить смешанные версии во время rollout. Порядок deploy согласуется с T01, staging API сначала совместим со старым AddAsync.

Outputs: изменённые paths/symbols, red/green evidence и counts, command exit codes, docs, residual risks и разрешённый commit. В отчёте отдели static checks, unit tests и настоящий DB crash/failure test. Приёмщик отвергает «atomic» без реляционного доказательства. Оценка: 1–2 дня, medium context; один владелец Category mutation, независимый reviewer читает diff и fault test.
