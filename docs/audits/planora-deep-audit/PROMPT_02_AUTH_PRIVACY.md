# T02 — Auth: token consumption, device sessions и privacy

## 1. Роль, цель и автономный контракт

Ты реализуешь узкие исправления Auth, сохраняя API/cookies/login UX. Прочитай целиком [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md), [backend evidence](evidence/backend-review.md) и BE-003/BE-004 в [реестре](03_FINDINGS.json). Даже если получен только этот файл: не трогай чужой diff; не печатай tokens/passwords/PII; не обращайся к production; тест сначала; не меняй дизайн или API молча; не ослабляй checks; migrations/deploy/merge/push требуют отдельной действующей санкции. При несовпадении фактов останови конкретный пункт и обнови evidence.

## 2. Baseline и входы

`F:\Projects\Planora`, `main`, `dc6b1781a24d43d967c418de30acda10fcafb8f9`, origin `https://github.com/4Keyy/Planora`. При планировании dirty `frontend/next-env.d.ts` принадлежал другой работе. Начни с `git status --short`, `git rev-parse HEAD`, сравни текущие символы с baseline. Baseline здесь — историческая точка, не команда reset/checkout.

Inputs: BE-003/004; итог T01 для health tags; итог T05 для полного account-erasure fan-out. Inputs schema от T08 нужны только если выбранное решение меняет persisted model. Главные Auth исправления независимы от брокера и не должны ждать erasure acceptance.

## 3. Фактическая трасса

| Путь | Факт и доказательство |
|---|---|
| `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/Login/LoginCommandHandler.cs:140` | fingerprint = user-agent/IP; active lookup, иначе insert; save на 181 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/RefreshTokenRepository.cs:42` | active lookup исключает expired |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/RefreshTokenConfiguration.cs:54` | unique device index исключает revoked, но включает expired |
| `Services/AuthApi/Planora.Auth.Application/Features/Authentication/Handlers/RefreshToken/RefreshTokenCommandHandler.cs:45` | load/check/revoke/successor/save; sequential replay ветка 71–86 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/AuthDbContext.cs:47` | xmin относится Friendship; token row не защищена |
| `Services/AuthApi/Planora.Auth.Application/Features/Users/Handlers/DeleteUser/DeleteUserCommandHandler.cs:68` | tracked deletion + durable outbox, затем stamp/avatar; сохранить atomicity |
| `tests/Planora.UnitTests/Services/AuthApi/Authentication/Handlers/AuthLifecycleHandlerTests.cs:349` | mock rotation/replay проверки; не доказывают concurrency |

Register выдаёт legacy token без fingerprint; этот кейс актуален, а не только старые данные. Register сохраняет пользователя до best-effort email; login сейчас не требует verified email. Не вводи новое требование email verification в рамках этой задачи.

## 4. Порядок работ и выбранное решение

1. **T02.1 / BE-003 / P1**: воспроизведи concurrent consume в двух независимых Npgsql contexts с barrier после read. Матрица fingerprint null/non-null. Оба запроса читают active, затем оба пытаются сохранить. Вариант исправления по умолчанию: атомарный consume существующей token row с optimistic concurrency/CAS и successor в той же transaction. `affected == 0`/concurrency conflict требует перечитать durable state; обработать как replay согласно текущей политике, без возврата нового access/refresh. Новый токен возвращается только после commit. Не применяй in-process lock, поскольку сервис может иметь несколько replicas. Если используешь explicit transaction с EnableRetryOnFailure, оберни всю транзакцию в EF execution strategy и обеспечь отсутствие повторных внешних side effects.
2. **T02.2 / BE-004 / P2**: добавь regression: истёкшая, не revoked запись того же device ещё существует. После неё login должен succeed. Query и unique predicate должны описывать один lifecycle. Сначала retire expired nonrevoked row в том же transactional login boundary, потом insert/reuse по явной политике. Нельзя оживлять revoked row через UpdateForReLogin. Нельзя включать volatile NOW() в partial unique index. Учти два параллельных login; не отдавай raw PostgreSQL exception.
3. **T02.3 / P1 verification**: сохрани sequential reuse revocation, password/logout/stamp checks и atomic deletion. После T05 проверь, что один UserDeleted event доставляется во все три owning services. Брокер исправляет T05, не этот пакет.
4. **T02.4 / P2**: после T01 добавь согласованный readiness tag к Auth DbContext health check; не меняй liveness в DB probe.

## 5. Тесты и локальный runbook

Запускать из корня. Команды существуют; ниже они являются runbook будущего исполнителя, в этом planning pass не запускались.

```powershell
git status --short
git rev-parse HEAD
dotnet --info
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --filter 'FullyQualifiedName~AuthLifecycleHandlerTests|FullyQualifiedName~AuthSessionHandlerTests|FullyQualifiedName~AuthRepositoryPersistenceTests|FullyQualifiedName~AuthDeletionOutboxTests'
dotnet build Services/AuthApi/Planora.Auth.Api/Planora.Auth.Api.csproj --no-restore
```

Если default dotnet не соответствует `global.json`, используй установленный SDK, подтверждённый в 00_BASELINE_AND_SCOPE, без установки новой версии. Для новых relational regressions используй существующий `tests/Planora.UnitTests/BuildingBlocks/Retention/Postgres/PostgresRetention.cs`: `PostgresFact` требует `PLANORA_TEST_POSTGRES` и fixture создаёт/удаляет временную БД. Это **NOT_VERIFIED**, пока переменная указывает на явно выделенный test server и тесты не выполнены. Не используй production connection string, не печатай её. Отсутствие variable означает SKIPPED, а не PASS. Нельзя доказывать uniqueness/race одним EF InMemory или Moq.

Red → минимальный fix → green → полный Auth namespace suite. Обязательно: malformed/missing/expired/revoked tokens, two contexts, request cancellation, rollback, same/different device, RememberMe, hashed-at-rest, sanitised errors. Проверь, что replay losing request не получает successor, а logout не затрагивает чужой token.

## 6. Готовность и ownership

Owner scope: Auth token handlers/repositories/interfaces/configuration, Auth tests, Auth DI readiness. Shared stamp policy принадлежит T01/T09; bus T05; migrations и `.gitignore` T08; frontend T10. Никаких массовых refactor и package upgrades. Изменение схемы сначала согласовать с T08, не создавать параллельные migration chains.

- [ ] PostgreSQL regression для expired device была красной и стала зелёной.
- [ ] Concurrent consume выдаёт не более одного success; tested null fingerprint.
- [ ] Sequential replay/stamp/deletion и прежний cookie contract сохранены.
- [ ] SKIPPED/NOT_VERIFIED отражены явно; нельзя закрыть race без relational evidence.
- [ ] Нет tokens/PII в новых логах; statuses и UI не изменены без причины.
- [ ] Auth build и relevant tests прошли; docs/auth-security.md и docs/testing.md отражают фактическую семантику.

## 7. Риски, rollback, outputs и оценка

Риски: EF ordering revoke/insert, retry дублирует issuance, конфликт stamp и database commit, неправильная трактовка легитимного двухвкладочного refresh. Rollback: откатить собственный code commit, сохранив additive schema; destructive down migration для токенов запрещена. Если новый concurrency contract нужен старым replicas, deploy совместимый expand сначала, включение consume после проверки совместимости.

Outputs: regression evidence с commands/exit/tests/skips, exact changed paths, before/after concurrent outcomes, обновлённый finding status и docs, residual risks. Report: baseline/current SHA, воспроизведение, выбранный механизм/почему, failing→passing tests, schema implications, разрешённые commit/PR ссылки. Не объявляй security complete по одному unit suite.

Оценка: 2–4 инженерных дня; medium/high context. T02.1 и T02.2 делят Login/RefreshTokenRepository/model — вести одним исполнителем или строго последовательно. Erasure verification после T05 можно выделить read-only проверяющему.
