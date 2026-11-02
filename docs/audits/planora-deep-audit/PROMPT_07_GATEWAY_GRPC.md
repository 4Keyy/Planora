# T07 — Gateway, gRPC и rate-limit

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T07. Цель: Gateway, gRPC и rate-limit. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T01. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T07.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

До включения forwarded middleware валидировать allowlist целиком: invalid/whitespace/CIDR нельзя молча превращать в empty trust. Сохранить ForwardLimit=1 до проверки topology. Реальный middleware test spoofed XFF, trusted/untrusted proxy, principal partition, Retry-After. Rate limit не повышать ради тестов. Подготовить production route/listener matrix для T14: REST и h2c отдельные effective endpoints; Production не должен брать localhost map. Не заменять shared key на mTLS без отдельной доказанной потребности/плана.

## Change boundaries и ownership

- `Planora.ApiGateway`
- `GrpcContracts`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### DIST-007 / P1 / LIKELY — Некорректный KnownProxies может включить доверие всем forwarded headers

- `Planora.ApiGateway/Program.cs:61-82,251-265` — ForwardedHeaders configuration: Nonempty raw array активирует middleware; оба trusted lists очищены; invalid IP silently skipped; warning советует CIDR, хотя IPAddress.TryParse не принимает CIDR

Trigger: KnownProxies содержит только CIDR либо invalid value. Исходный array nonempty, parsed KnownProxies empty и KnownIPNetworks empty.

Impact: При стандартной ASP.NET forwarded-header semantics пустые trusted lists снимают peer restriction; spoofed XFF меняет rate-limit identity и XFP/XFH. Нужен regression на используемом runtime.

Root cause: Включение по raw values вместо validated allowlist; silent parse failure; противоречивая подсказка конфигурации.

Решение по шагам: Парсить/валидировать список до registration. Любая непустая invalid запись fail startup с безопасным именем key; при поддержке CIDR использовать KnownIPNetworks явно и тестировать. Включать middleware только при validated allowlist >0. Убрать неверный CIDR совет, сохранить ForwardLimit=1 пока topology не доказана.

Альтернативы: Оставить middleware выключенным при всех invalid значениях безопаснее trust-all, но скрывает misconfiguration; fail-fast предпочтителен.

Regression scenarios:

- KnownProxies=[] не доверяет spoof XFF.
- Valid proxy only: trusted accepted, untrusted ignored.
- CIDR/invalid/all-whitespace configuration не приводит к empty-trust middleware.
- Статус 429/Retry-After для двух реальных forwarded client IP остаётся раздельным.

Acceptance:

- Ни одна разрешённая конфигурация не означает implicit trust-all.
- Сценарии проверены на .NET SDK baseline.
- TLS/host trust не расширены.

Граница доказательства: Статически доказан empty-list configuration; middleware consequence проверяется host test, поэтому LIKELY. Production config не читалась.

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

Формат `results/T07.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 3–5 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
