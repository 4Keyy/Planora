# T16 — E2E, performance и acceptance

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T16. Цель: E2E, performance и acceptance. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: T15. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T16.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

Выполнить полную owner/friend/stranger/anonymous matrix, revoke while connected, account switch, crash-before/after-commit/ACK, replay и restore в изоляции. Performance baseline: bounded synthetic 1000 tasks,100 categories,20 friends,3 viewers; проверить seed semantics, затем 1/5/10 VU максимум60s. Отдельные limiter и handler experiments; не меняется production policy. Report p50/p95/p99, errors/429, query counts/CPU/RAM, browser interaction и Web Vitals cold/warm с одинаковыми browser/hardware. Временный regression guard <=10% p95/p99 и 0 correctness regression после >=5 повторов — proposed threshold, согласовать по шуму; исходные absolute gates сохраняются. Последний gate review/rollback, никакого автоматического deploy.

## Change boundaries и ownership

- `perf`
- `frontend/e2e`
- `docs/audits/planora-deep-audit/results`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### OPS-008 / P2 / CONFIRMED — Performance scripts не дают baseline реального списка

- `perf/k6/scenarios/todo-list.js:35-39` — Performance scripts не дают baseline реального списка: setup создаёт пустого reader, нет seed tasks/shares; login.js переиспользует один account, бюджеты лимитера документированы.

Trigger: Запуск текущих k6 scripts и вывод об app throughput.

Impact: Пустой список и 429 искажают выводы; численного before/after нет.

Root cause: setup создаёт пустого reader, нет seed tasks/shares; login.js переиспользует один account, бюджеты лимитера документированы.

Решение по шагам: Создать bounded synthetic dataset и раздельно измерять limiter и handler throughput; 1/5/10 VU, 60s cap, warm/cold, p50/p95/p99,error/429,query counts. Сохранять SHA/версии/данные; не ослаблять production limits.

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
npm --prefix frontend run e2e
k6 run -e API_BASE_URL=http://127.0.0.1:5132 perf/k6/scenarios/todo-list.js
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

Формат `results/T16.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 4–8 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
