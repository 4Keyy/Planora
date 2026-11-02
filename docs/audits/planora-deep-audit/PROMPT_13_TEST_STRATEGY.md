# T13 — Проверяемые инварианты и надёжная тестовая инфраструктура

## Роль и цель

Ты test engineer. Цель — закрыть доказанные пробелы, обеспечить локально/CI сопоставимые проверки и сохранить работающие safety nets. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md), [test traceability](05_TEST_TRACEABILITY_MATRIX.md), [CI parity](06_CI_CD_PARITY.md), [frontend evidence](evidence/frontend-review.md), результаты T01–T12. Минимальный автономный договор: никакого production, настоящих secrets и удаления/ослабления failing tests; не менять приложение ради удобства теста; deterministic RED→GREEN; source/CI/log claims только по фактам; неизвестный результат — NOT_VERIFIED.

Baseline: main `dc6b1781a24d43d967c418de30acda10fcafb8f9`, `https://github.com/4Keyy/Planora`. Перепроверить HEAD, git status, package locks, пути и scripts. `next-env.d.ts` исходно чужой dirty. Сведения прошлых аудитов не заменяют свежий run.

## Inputs / outputs / blocked_by / ownership

- Inputs: findings→tests от каждого владельца сервисов и T10/T11; T14 mapping jobs/SDK/env; T08 disposable DB strategy. Нельзя считать всех upstream завершёнными по наличию prompt-файлов.
- Outputs: заполненная requirement→code→test→CI→evidence matrix; только нужные fixtures/helpers; воспроизводимые commands; flaky classification; сохранённые ratchets; release vs PR test tiers.
- Regression tests конкретного fix принадлежат пакету fix (например T10 auth.test/notifications.test/realtime-hooks.test). T13 владеет `frontend/src/test/setup.ts`, общими fixture utilities, `frontend/playwright.config.ts`, `frontend/e2e/run-ci.cjs` и их тестами **после согласования с T14**, общими backend test infrastructure в существующих `tests/Planora.UnitTests` и `tests/Planora.ErrorHandlingTests`. До любого изменения проверить реальные owners.
- CI YAML принадлежит T14. T13 не меняет workflow permissions/required checks, business handlers или UX. Cross-system сценарии выполняет T16, T13 готовит детерминированный fixture contract.

## Фактическая исходная картина

`frontend/vitest.config.ts:8-21` — jsdom, 15s testTimeout, hooks list order, E2E/build outputs excluded. `coverage:36-52`: global lines88/functions81/branches79/statements85; non-app/editor 85; отдельные ratchets для app/editor. Например tasks 72/60/50/67 — существующий порог, а не разрешение снизить измеренное качество. Не требовать единый 100% и не считать coverage доказательством permissions.

`frontend/playwright.config.ts:15-18,29-33,35-53`: single worker, retries CI2/local0, trace/video off ради auth secrets, api+ui Desktop Chrome. Других browser projects нет; viewport tests в specs не означают Safari/Firefox support. `src/test/setup.ts:4-8` shim pointer capture/scroll; настоящую geometry/focus/animation проверяет browser.

Существуют focused suites: auth store/public/interceptors; notification lifecycle/store; friend/category caches; task-action hook/page actions; contract tests API/gateway/text limits; sorting golden tests; motion/usability/brand tokens; E2E auth/privacy/avatar/frozen audience и UI geometry. Inventory всех файлов в frontend-files.json; многие tests ещё требуют семантического review, наличие файла не означает quality pass.

Root подтвердил baseline E2E failure run `41368376503`, job `125033430746`: 6 failed, 3 passed, около48.2m; exact status/log evidence читать в общем CI документе. Не объявлять причину всех failures одной: auth bucket 429 и task-height geometry/timeouts должны быть разными расследованиями.

## План работ

### T13.1 / P1 — детерминированные async regression tests

Проверить результаты T10: FE-001 success/reject after logout/login; FE-002 notifications reset ownership; FE-003 deferred room start cleanup; FE-004 avatar old owner. Для каждой строки нужны assertion observable state/requests, RED до fix, GREEN после. Не ограничиваться `toHaveBeenCalled`, если инвариант про принадлежность данных. Table-driven A→B, A→logout→A, token rotate same-session, unmount, aborted request, resolve/reject reversed order.

Reusable deferred helper можно добавить только если уже ≥3 потребителя и не дублируется существующий utility. Fake timers для timers/TTL, explicit deferred promises для network ordering; не использовать arbitrary sleeps. HTTP mocks закрывают весь I/O, включая analytics/CSRF: `auth.test.ts:51-56` уже предотвращает утечку запросов в gateway, этот fix сохранить.

### T13.2 / P1 — permissions и распределённые контракты

Получить от T02/T03/T04/T06 owner/friend/stranger/anonymous matrix на tasks/categories/comments/notifications. Существующие backend tests рассмотреть на реальные assertions permissions и SaveChanges boundaries; mocks не доказывают FK/transaction/inbox semantics. Отдельные disposable PostgreSQL/Redis/RabbitMQ integration сценарии только после T08/T05 договоров и наличия инструментов. Не добавлять Testcontainers до проверки существующих dependencies и рациональности.

Обязательные сценарии: duplicate/out-of-order event, timeout before/after commit, cache stale after access revoke, reconnect after missed events, expired notification/time-zone boundary, cancellation, malformed payload, owner-completed/viewer-completed disagreement. In-memory EF provider не заменяет PostgreSQL SQL/unique/index checks. Для migrations — clean DB + legacy-upgrade fixture + history/schema assertions из T08, никакого real DB.

### T13.3 / P1 — E2E failures и parity

Для каждого baseline failure сохранить: commit/workflow/job/spec/test title, sanitized error, trace availability, retries, shard/env/fixtures, reproduction command. Классификация: product defect, fixture defect, environment/rate-limit, flaky timing или unknown. Нельзя «исправить» timeout увеличением без доказательства причины; нельзя пропускать тест, который не умеет создать пользователя.

Auth bucket: проверить rate-limit helper и run-ci shard allocation/seed account isolation с T07/T14; уважать Retry-After, не ослаблять production limiter. Geometry: фиксированные browser/DPR/fonts/motion, реальные frame measurements, сохранять thresholds только если изменился согласованный продуктовый контракт. Проверить что повторный запуск не зависит от data предыдущего shard.

### T13.4 / P2 — coverage и bounded stress

Измерить actual per-file branch gaps, выбрать непокрытые критические переходы; ratchets только повышать после устойчивого результата. Mutation testing лишь critical predicates по существующим `stryker-auth.json`/`stryker-config.json` после просмотра конфигурации, bounded time/CPU, отдельная scheduled/release среда. Не внедрять новый инструмент автоматически.

Property-style тесты без новой библиотеки: детерминированный seed для сортировки/Unicode/malformed API wrappers/time boundaries; сначала обосновать oracle. Timer leak check через количество pending timers после unmount/logout, listeners и room refs; node heap/load отдельно T16, не нагрузка на production.

### T13.5 / P2 — file review continuation

Используй frontend-files.json: приоритет pending tests соответствующих security paths, затем page/component assertions, затем tooling/visual fixtures. Каждый прочитанный файл — статус READ/REVIEWED с диапазонами и конкретным pass; rg hits не отмечать full read. Отдельно проверить `test.skip`, `.only`, unconditional mocks, assertions отсутствующего error UI, test that merely mirrors implementation. Существование всего набора не даёт права заявить полный семантический аудит.

## Runbook и evidence

```powershell
Set-Location F:\Projects\Planora
git status --short
git rev-parse HEAD
dotnet --version
node --version
npm --version
Set-Location frontend
npm exec -- vitest run src/test/store/auth.test.ts src/test/store/notifications.test.ts src/test/lib/realtime-hooks.test.tsx src/test/hooks/use-friends.test.tsx src/test/hooks/use-categories.test.tsx --maxWorkers=2
npm run test:coverage
npm run lint
npm run type-check
node --test e2e/run-ci.test.cjs e2e/report-redaction.test.cjs e2e/report-summary.test.cjs e2e/bundle-report.test.mjs
```

Backend commands conditional NOT_VERIFIED until build inputs/SDK/disposable settings inspected; actual projects exist:

```powershell
Set-Location F:\Projects\Planora
dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --no-restore
dotnet test tests/Planora.ErrorHandlingTests/Planora.ErrorHandlingTests.csproj --no-restore
```

Не запускать tests, если их config выбирает рабочую DB. В текущем planning проходе shell source harness D-FE-1..3 exit0 доказал races, но это не официальные Vitest RED и не substitutes integration tests. Focused Vitest попытка была начата, после прерывания session handle недоступен; без final output нет green evidence.

E2E команда `npm run e2e -- --project=api` или `--project=ui <spec>` только после T14 disposable environment. Не включать traces/secret-bearing auth screenshots без redaction contract; outputs хранить по workflow retention, не коммитить users/tokens/huge logs.

## Acceptance / checklist

- [ ] Каждому confirmed finding сопоставлен regression test с observable outcome и RED/GREEN evidence.
- [ ] Tests не обращаются к реальному gateway по умолчанию; networking/timers/listeners закрыты после каждого case.
- [ ] Backend transactions/uniqueness доказаны на PostgreSQL где необходимо; mock-only ограничения явно отмечены.
- [ ] Baseline E2E failures разобраны по отдельным причинам, targeted rerun воспроизводим; unknown остаётся blocker.
- [ ] Exact commands совпадают с CI scope; jobs statuses не выводятся из local result.
- [ ] Coverage ratchets сохранены, новые excludes/skip/continue-on-error отсутствуют.
- [ ] Browser matrix честно ограничена; screenshots/geometry и runtime a11y не заменены jsdom.
- [ ] Final matrix содержит not-run/blocked и cleanup/retention; T16 получает готовый fixture manifest.

## Риски / rollback / оценка / отчёт

Риски: слишком тяжёлый PR suite, ложный green из mocks, real network в unit tests, retries скрывают flaky product defect, fixture mutation рабочих данных. PR tier: быстрые unit/contract/targeted; scheduled/release: full browser/distributed/failure injection/mutation. Существующие обязательные CI checks не убирать для ускорения.

Rollback: только собственные fixtures/config commits; не удалять regressions, которые выявляют действующий баг. Production/schema изменений у T13 нет. Оценка 2–5 дней, 30–50k контекста; отдельные reviewers frontend/backend/E2E могут работать параллельно при не пересекающихся файлах. Отчёт: matrix diff, test files, assertions/RED/GREEN, command/cwd/exit/duration, branch coverage before/after, flaky rates с числом прогонов, CI links, unresolved blockers и права на следующие операции.
