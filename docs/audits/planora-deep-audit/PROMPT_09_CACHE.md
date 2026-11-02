# T09 — Redis/cache consistency и key durability

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T09. Цель: Redis/cache consistency и key durability. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T01. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T09.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

L1 invalidation выполнить даже при L2 failure; OperationCanceledException не поглощать. Зафиксировать зависимости security stamp/rate limits/DataProtection от Redis. Compose allkeys-lru может вытеснять non-expiring key ring: исследовать same-instance binding Auth DI и подготовить решение dedicated durable storage/non-evicting instance для T02/T14. Нельзя просто включить noeviction для всего cache без capacity/error validation. Не вводить cache в auth predicates и не обещать cross-instance invalidation от одного MemoryCache.Remove.

## Change boundaries и ownership

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching`
- `tests/Planora.UnitTests/Services/Infrastructure`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### DIST-008 / P3 / CONFIRMED — L1 cache может сохранять stale value при failed remove

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/CacheService.cs:186-202` — RemoveAsync: L1 remove стоит после awaited L2 remove; catch поглощает исключение

Trigger: ICacheService L1 содержит value; IDistributedCache.RemoveAsync throws; повторный GetAsync возвращает L1.

Impact: Нарушение primitive invalidate contract до L1 TTL. На baseline не найден application caller ICacheService, поэтому не заявляется текущая утечка private data.

Root cause: Best-effort L2 error пропускает независимую локальную invalidation.

Решение по шагам: Всегда удалять L1 независимо от результата L2; cancellation отдельно propagates. Зафиксировать failure contract (лог/метрика или result), не объявлять успешную invalidation в CacheInvalidator после swallowed failure. Не подключать generic cache к authorization paths.

Альтернативы: Отключить UseLocalCache для sensitive paths, если они появятся, вместо distributed invalidation framework.

Regression scenarios:

- Faulting fake IDistributedCache.RemoveAsync: next read не hit_l1.
- Cancellation не превращается в cache miss/успех.
- Две независимые CacheService instances демонстрируют границы локальной invalidation без claims global consistency.

Acceptance:

- Primitive test красный до и зелёный после.
- Документирован список реальных runtime callers; если по-прежнему 0, priority остаётся P3.
- Нет новых caching callers или dependencies.

Граница доказательства: Дефект primitive confirmed static; продуктовое воздействие NOT_VERIFIED. Сервисы используют отдельные IMemoryCache/Redis implementations, не этот wrapper.

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

Формат `results/T09.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 2–4 дня инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
