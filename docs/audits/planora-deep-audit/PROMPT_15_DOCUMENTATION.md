# T15 — Maintained docs и DX

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T15. Цель: Maintained docs и DX. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T14. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T15.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Исправить только подтверждённый drift и внедрённые contracts; actual source первичен. INVARIANTS backoff, deployment Todo initial/Realtime startup, migrator reserved comments, SLO provisional не смешивать с production guarantees. Документировать one-source-per-topic, команды Windows/Linux только поддерживаемые; не создавать новый исторический монолит вместо тематических guides. Existing docs parser и lint использовать, не добавлять второй.

## Change boundaries и ownership

- `docs`
- `README.md`
- `TESTING.md`
- `ARCHITECTURE.md`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `deploy/fly/README.md`
- `perf/README.md`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### DIST-010 / P3 / CONFIRMED — Описание outbox backoff в INVARIANTS устарело

- `docs/INVARIANTS.md:73-80` — INV-COMM-3a: Current-code gap говорит NextRetryUtc не проверяется
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs:127-135` — ProcessOutboxMessagesAsync: Pending уже gated NextRetryUtc
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/OutboxRepository.cs:40-44` — GetPendingMessagesAsync: Та же retry eligibility

Trigger: Исполнитель берёт docs/INVARIANTS как описание текущего дефекта.

Impact: Повторное ненужное исправление и риск регрессии корректного retry.

Root cause: После commit 0fd486add085950450b96920466f666a6b127cfa документ не синхронизирован.

Решение по шагам: T15 заменить stale gap на текущий контракт с source/test links, сохранив limitation single processor и at-least-once.

Альтернативы: Не удалять invariant целиком: requirement остаётся важным.

Regression scenarios:

- CanonicalOutboxRepositoryTests.GetPendingMessagesAsync_RespectsScheduledBackoffForPendingRetries
- Docs links validation.

Acceptance:

- Описание соответствует predicate и existing regression test.

Граница доказательства: История и текущий код прочитаны; тест лично этим агентом не запускался.

### OPS-009 / P2 / CONFIRMED — Maintained deployment guide расходится с startup кодом

- `docs/deployment.md:80-104` — Maintained deployment guide расходится с startup кодом: Todo описан как missing initial; Realtime no startup initialization, но реальные helpers и Program уже изменились.

Trigger: Следование руководству для bootstrap/release.

Impact: Ненужные опасные workaround и неверные блокеры.

Root cause: Todo описан как missing initial; Realtime no startup initialization, но реальные helpers и Program уже изменились.

Решение по шагам: Сверить Todo first migration CreateTable и RealtimeDatabaseStartup invocation; заменить stale statements ссылками на существующие тесты, сохранить реальные rollout blockers.

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
node tools/docs/check.mjs --include-untracked
node tools/docs/lint.mjs --include-untracked
node --test tools/docs/check.test.mjs
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

Формат `results/T15.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 2–4 дня инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
