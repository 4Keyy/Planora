# T14 — CI parity и deployment gates

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T14. Цель: CI parity и deployment gates. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T07, T08, T09, T12, T13. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T14.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Все checks привязать к одному resolved SHA. E2E triggers включают common build inputs; skipped check не равен success. Runtime tools закрепить отдельно от action SHA; OIDC только в job, где нужен. CD explicit needs вместо предположения о matrix order, approved environment, migration rehearsal и readiness. Avatar storage переносить только после backup/restore; production route/listener matrix от T07. Подготовить JSON settings change и rollback для владельца, не менять remote автоматически. Изоляция тестового Compose требует убрать fixed names, проверить порты/volumes; не запускать рабочий стек.

## Change boundaries и ownership

- `.github/workflows`
- `docker-compose.yml`
- `deploy/fly`
- `scripts`
- `Start-Planora-Local.ps1`
- `Start-Planora-Docker.ps1`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### OPS-001 / P1 / CONFIRMED — main допускает обход обязательных проверок

- `docs/audits/planora-deep-audit/evidence/github-state.json:protection/rulesets` — main допускает обход обязательных проверок: required_status_checks и review gate отсутствуют; force push разрешён, admin enforcement false; rulesets пусты.

Trigger: Push непроверенного commit уполномоченным пользователем.

Impact: Красный E2E не блокирует изменение main.

Root cause: required_status_checks и review gate отсутствуют; force push разрешён, admin enforcement false; rulesets пусты.

Решение по шагам: Подготовить конкретный набор required checks, запрет force push и policy bypass; применить GitHub settings только после отдельного разрешения. Проверить GET после изменения, не считать YAML настройкой branch protection.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-005 / P2 / CONFIRMED — CI инструменты разрешаются по плавающим версиям

- `.github/workflows/security.yml:190,208` — CI инструменты разрешаются по плавающим версиям: CycloneDX .NET без версии; npx cyclonedx-npm без pin; openapi.yml:188 spectral-cli@latest.

Trigger: Повтор pipeline с тем же application SHA в другой день.

Impact: Невоспроизводимое сканирование и исполнение непроверенного нового tooling.

Root cause: CycloneDX .NET без версии; npx cyclonedx-npm без pin; openapi.yml:188 spectral-cli@latest.

Решение по шагам: Закрепить совместимые версии и lockfile/checksum где применимо; scoped job permissions для OIDC/attestations только SBOM. Проверить update policy; не вводить новые scanners без пользы.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-006 / P1 / CONFIRMED — CD не связывает deploy с проверенным immutable SHA

- `.github/workflows/cd.yml:70-203` — CD не связывает deploy с проверенным immutable SHA: Каждый job checkout inputs.ref||github.ref; нет quality gate/environments; API вернул environments=0.

Trigger: Manual deploy движущейся ветки или tag без успешных checks.

Impact: Разные jobs могут развернуть разные revisions; release может обойти E2E/security.

Root cause: Каждый job checkout inputs.ref||github.ref; нет quality gate/environments; API вернул environments=0.

Решение по шагам: Resolve ref один раз в SHA, передать jobs output; проверить полный набор successful checks этого SHA; явные needs для порядка, staging migration/health gates. Production environment и approvals подготовить отдельно; деплой сейчас запрещён.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-007 / P1 / CONFIRMED — Compose не сохраняет Auth avatars при пересоздании контейнера

- `docker-compose.yml:188-228` — Compose не сохраняет Auth avatars при пересоздании контейнера: У auth-api отсутствует volumes; writable webroot не персистентен. docs/backup-recovery.md подтверждает operational caveat.

Trigger: Пересоздание Auth container с уже загруженными аватарами.

Impact: Потеря пользовательских файлов.

Root cause: У auth-api отсутствует volumes; writable webroot не персистентен. docs/backup-recovery.md подтверждает operational caveat.

Решение по шагам: Сначала безопасный backup текущего writable layer с SHA256 manifest; выбрать persistent mount, permissions для nonroot, перенести и проверить restore. Только затем recreate по отдельному разрешению; не монтировать пустой volume поверх единственной копии.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-011 / P2 / CONFIRMED — E2E path filters пропускают общие build inputs

- `.github/workflows/e2e.yml:7-27` — E2E path filters пропускают общие build inputs: Нет Directory.Packages.props, Directory.Build.props, global.json, tests/tooling в фильтрах.

Trigger: Изменён общий .NET dependency graph без Services/** diff.

Impact: E2E не запустится для потенциально несовместимого графа.

Root cause: Нет Directory.Packages.props, Directory.Build.props, global.json, tests/tooling в фильтрах.

Решение по шагам: Добавить реальные build/config inputs или reusable path classifier; проверить changed-files fixtures и required-check поведение при skip, не считать skipped run green.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-012 / P1 / CONFIRMED — Production route selection остаётся локальной

- `Planora.ApiGateway/Program.cs:37-39` — Production route selection остаётся локальной: Production выбирает ocelot.json, содержащий loopback targets; deploy manifests требуют отдельных Fly apps.

Trigger: Запуск committed Production deployment без дополнительного route override.

Impact: Gateway не маршрутизирует к нужным сервисам.

Root cause: Production выбирает ocelot.json, содержащий loopback targets; deploy manifests требуют отдельных Fly apps.

Решение по шагам: T07 фиксирует route/listener contract; T14 добавляет отдельную проверенную production конфигурацию, checks против loopback, REST/HTTP2 портов и приватной topology. Без live Fly доступа статус deployment NOT_VERIFIED.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

## Исполнимый runbook

1. Сохранить baseline/dirty paths, проверить реальные symbols и dependency result files.
2. Написать regression минимального trigger; показать красный результат на исходном коде. Статический finding без runtime воспроизведения не даёт права заявить exploit.
3. Реализовать решение выше небольшими шагами; каждый commit держит совместимость consumers.
4. Выполнить команды из корня (SDK/dependencies уже должны быть подготовлены):

```powershell
node --test .github/scripts/nuget-vulnerability-report.test.mjs
git diff --check
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

Формат `results/T14.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 4–7 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.

## Конкретные contract gates после review

Существующая проверка: `dotnet test tests/Planora.UnitTests/Planora.UnitTests.csproj --configuration Release --filter "FullyQualifiedName~RuntimeContractTests"`. Создать новый `tests/Planora.UnitTests/Quality/DeploymentContractTests.cs` (proposed, отсутствует на baseline): fixtures проверяют один resolved SHA на все jobs, отсутствие loopback в Production routes, complete E2E path filters, service REST/h2 ports и исключение reserved worker из runnable set. После создания выполнить filter FullyQualifiedName~DeploymentContractTests, ненулевой count обязателен.

TOML syntax проверить стандартным Python3.11+ tomllib; YAML structure — существующим CI/provider parser или reviewable test parser после justified tool decision T12. Не объявлять echo/grep полноценной YAML validation. Прогон GitHub workflows и Fly config validation требует доступного CLI/санкционированной среды; записать NOT_VERIFIED, если их нет. Restore acceptance: evidence T08/T09 плюс avatar file counts/SHA256 в disposable storage, рабочий container recreate запрещён до backup/permission.
