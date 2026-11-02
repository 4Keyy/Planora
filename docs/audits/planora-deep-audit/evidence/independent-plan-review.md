# Независимый review исполняемого плана

Reviewer: `/root/frontend_audit`; 2026-11-02; application baseline `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Проверка read-only, исправлений чужих файлов не выполнялось. Область: TASKS.json (16 объектов, зависимости, scope, commands), EXECUTOR_CONTRACT, 09_DEPENDENCIES_AND_CRITICAL_PATH, полные PROMPT 01/06/08/14; сопоставление с собственными PROMPT10/11/13. Другие PROMPT не заявлены независимо reviewed целиком. Это review плана, не повтор backend/security аудита.

**Первичный verdict: NEEDS_PLAN_CORRECTION** для перечисленных границ. Явных безусловных команд production mutation/deletion в рассмотренных runbooks нет. Исполнитель обязан читать общий контракт и не выполнять условные внешние этапы автоматически.

## Проверки, реально выполненные

Python JSON parser: 16 уникальных task_id; все blocked_by существуют; dependencies совпадают с blocked_by; все package paths существуют. Топологическая сортировка успешна: T01,T12,T05,T07,T08,T09,T10,T02,T04,T11,T03,T06,T13,T14,T15,T16. Формального цикла в JSON нет. Проверка prefix overlap owner_scope среди задач без транзитивной зависимости не нашла заявленных пересечений; это не доказывает полноту самих scope.

Mermaid разобран regex `Txx[optional label] --> Tyy`; extra edges=0. В drawing отсутствуют JSON edges T01→T03 и T01→T04. Они транзитивно уже следуют через T05/T08, поэтому порядка не меняют; можно подписать diagram как transitive reduction либо дорисовать для буквальной паритетности.

## Замечания для интегратора

### PLAN-01 / P2 / CONFIRMED — authoritative owner_scope не включает необходимые изменения

`EXECUTOR_CONTRACT.md:33` назначает TASKS.owner_scope источником владения; `TASKS.json:22-26,496-503,630-636` расходится с работами:

- T01 требует shared ready registration (`PROMPT_01_FOUNDATIONS.md:30,40`), но `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/DependencyInjection.cs` есть только в evidence paths, не owner_scope. Необходимо добавить этот файл и конкретный shared test scope.
- T08 требует tracked EF chains (`PROMPT_08_DATABASE.md:15,42,58`), но владеет только Infrastructure/Persistence у трёх сервисов; sibling Infrastructure/Migrations и schema tests не перечислены. Добавить точные будущие migration directories и schema test directories; чтение Messaging/Todo/Realtime отдельно оставить read-only либо назначить последовательный handoff.
- PROMPT10 назначает `hooks/use-categories.ts`, его tests и узкие refresh continuations в profile/verify-email (`PROMPT_10_FRONTEND_CORE.md:14-15`); TASKS T10 их не включает. Добавить явные scope paths и сохранить handoff страниц T10→T11.

Impact: строгий исполнитель остановится на разрешённой работе либо самостоятельно расширит scope. Закрытие: синхронизировать TASKS и PROMPT boundaries, повторить overlap-проверку с учётом вложенных paths.

### PLAN-02 / P2 / CONFIRMED — frontend contract handoff после T06 не имеет назначенного этапа

`PROMPT_06_REALTIME.md:99,112,115` требует timestamp+ID cursor на клиенте и frontend handoff после freeze T06. TASKS T10 blocked_by только T01, T11 только T10 (`TASKS.json:637-642,699-704`), поэтому оба frontend пакета могут закончиться до T06. T13 начинается после T06/T11, но его owner_scope не включает notification store/lib и его инструкция не назначает явное внедрение нового cursor. Добавление T10→T06 обратного ребра недопустимо, если T10 acceptance одновременно ждёт T06.

Закрытие: сохранить ранний T10 privacy fix, а T11 сделать dependent на T06 и передать ему узкий owner scope cursor с завершением T10; либо явно назначить T13 integration handoff с временным единственным frontend writer и acceptance tied-dataset across API/client. Согласовать описание интеграционной приёмки T10. Аналогично T06 schema/index изменение после уже завершённого T08 требует named handoff, а не неявного повторного открытия T08.

### PLAN-03 / P2 / CONDITIONAL — optional atomic claim может вернуть зависимость на T08 в T01

`PROMPT_01_FOUNDATIONS.md:67` допускает atomic claim как отдельное изменение после T08; `:79` принимает single-instance **либо** atomic-claim. T08 заблокирован T01. В JSON цикла нет, но если executor выберет atomic-claim для завершения T01, получится семантический цикл. Закрытие: явно зафиксировать T01 acceptance на additive interface + single-active-processor contract; optional horizontal claim вынести в отдельный post-T08 followup, не блокирующий T01. Если сохранён single-instance вариант, это замечание считается закрытым разъяснением, без нового code change.

### PLAN-04 / P2 / CONFIRMED — специфические gates пока не обеспечены собственными командами пакетов

T08 promises fresh/upgrade/drift tests на Npgsql (`PROMPT_08_DATABASE.md:15,47-54`), но его единственный UnitTests runbook исключает Postgres (`:69`). T06 tied UUID pagination также требует provider integration (`PROMPT_06_REALTIME.md:99`) при таком же исключении (`:126`). T14 требуется проверять changed-path fixtures, immutable-SHA job wiring, YAML и backup/restore, а runbook содержит лишь NuGet-report test и git diff --check. Общий контракт корректно запрещает считать незапущенный gate зелёным; ложного green пока нет, однако runbook не полностью самодостаточен для непосредственного исполнения.

Закрытие: добавить конкретные условные команды существующих provider/project tests с безопасной disposable конфигурацией и nonzero count; если тест ещё будет создан — назвать будущий файл/fixture/команду как planned, а не существующий. Для T14 назвать проверяемые script fixtures и конкретный validate/check workflow с ожидаемым отрицательным сценарием, без remote settings mutation.

## Положительные контроли

Общий контракт сохраняет dirty next-env, различает permits и plan, требует отдельной реализации, запрет production/migration/remote mutation без нового полномочия, не понижает gates, сохраняет per-command exit/count. Compose предупреждает о fixed names/ports, PostgreSQL — о destructive suites. T14 требует backup перед avatar-volume migration и immutable SHA до deploy; не даёт команды recreate. T06 не обещает exactly-once; различает durable row и push. T08 не объявляет deployed schema исследованной. Все эти ограничения нужно сохранить при исправлении плана.

## Проверенные версии planning files

SHA256 нужен, чтобы последующие правки не наследовали verdict автоматически. После исправлений требуется адресный re-review затронутых пунктов.

| Файл | SHA256 |
|---|---|
| `TASKS.json` | `c8db65a52fe3f36a383efc30f56c06ae37bab20f6e37fb01f78ddc063080bd04` |
| `EXECUTOR_CONTRACT.md` | `b1914596dd929cf7c7aedd4c9e4570e1539b29671d99d468e718b26b7946fdf3` |
| `09_DEPENDENCIES_AND_CRITICAL_PATH.md` | `89764bd6439c06fcca6d3879f28a46876eb798c30bea580e72964a15bf876bed` |
| `PROMPT_01_FOUNDATIONS.md` | `0cdfdf7af3a1299e3d897236754342515ca398c609f6c3da5b5f09020a274f34` |
| `PROMPT_06_REALTIME.md` | `28c33a65373cf346c333409042c37843e66b5232db71a7c2a2e62f37ff8fc0b3` |
| `PROMPT_08_DATABASE.md` | `cb597332a92d07d71095d7b229cd0411d666c1855d1b8006cefb8b8531019d07` |
| `PROMPT_14_CI_CD.md` | `58d4ef8ea665202027587a71c387032f07a12ea8a6e4210191274dbb4871827b` |
