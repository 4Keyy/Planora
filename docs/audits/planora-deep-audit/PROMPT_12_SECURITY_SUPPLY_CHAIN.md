# T12 — Security triage и supply chain

## Роль, цель и автономный контракт

Ты инженер-владелец пакета T12. Цель: Security triage и supply chain. Приоритет — privacy/data integrity, отсутствие регрессий, затем простота. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md) целиком, [findings](03_FINDINGS_REGISTER.md), [архитектуру](01_ARCHITECTURE_AND_DATA_FLOW.md) и результаты dependencies. Минимальный автономный контракт: сначала verify SHA/paths, RED regression, минимальный fix, targeted→broader checks, evidence; не менять внешний дизайн/контракты незаметно, не использовать production, не читать secrets, не push/merge/deploy/DB migrate без нового разрешения. Не удалять failing tests/coverage gates.

## Baseline и inputs

Repository `4Keyy/Planora`, `main`, SHA `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Перепроверь `git status --short`, `git rev-parse HEAD`, `git diff --name-only dc6b1781a24d43d967c418de30acda10fcafb8f9 HEAD`. Чужой `frontend/next-env.d.ts` сохранить. При drift остановить только устаревший пункт и переоценить доказательства.

Блокирующие predecessors: нет. Входы: TASKS.json, findings, per-file index и results каждого predecessor. Выход: `results/T12.md`, scoped code/test diff, doc deltas для T15.

## Архитектурное решение

66 scanner matches классифицировать по fingerprints и provenance, не по raw values. Не расширять allowlist на все tests или compose. Обновления зависимостей через совместимый upstream, минимальный lock diff, обе audit команды, tests/build; запрет npm audit fix --force. PR144 сначала inspect final diff и CI SHA, не merge. Проверить NuGet transitive report, SPDX/license metadata: факт лицензии не равен правовому заключению. Новые версии инструментов предложить T14 вместе с source/checksum/update policy. Production secret rotation — отдельное действие владельца.

## Change boundaries и ownership

- `.gitleaks.toml`
- `.gitleaksignore`
- `.github/security`
- `Directory.Packages.props`
- `frontend/package.json`
- `frontend/package-lock.json`
- `tools/docs/package.json`
- `tools/docs/package-lock.json`

Это область ответственности, а не разрешение массово менять всё внутри неё. Межпакетные файлы из evidence читать можно, менять — после handoff владельца. Общие документы редактирует T15, CI/Compose/Fly — T14, frontend realtime — T10, shared contract — T01. Последовательность DAG не отменяет file lock.

## Работы и доказательства

### OPS-003 / P1 / CONFIRMED — Scheduled gitleaks сообщил 66 совпадений

- `docs/audits/planora-deep-audit/evidence/remote-failures.md:Gitleaks` — Scheduled gitleaks сообщил 66 совпадений: Run41416485392/job125181481709 содержит leaks found:66; сохранены только rule/path/commit метаданные.

Trigger: Scheduled full-history scan.

Impact: Существующий security gate красный; реальные секреты и fixture matches ещё не классифицированы.

Root cause: Run41416485392/job125181481709 содержит leaks found:66; сохранены только rule/path/commit метаданные.

Решение по шагам: Для каждого fingerprint установить происхождение без публикации значения; реальные credentials отозвать отдельным согласованным действием, fixtures разрешать точечно с доказательством. Не переписывать историю и не выключать scanner.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-004 / P2 / CONFIRMED — Полный npm audit содержит moderate minimatch advisory

- `docs/audits/planora-deep-audit/evidence/npm-audit.json:metadata/vulnerabilities` — Полный npm audit содержит moderate minimatch advisory: 16 affected package entries, одна исходная GHSA-g3hv-75wg-m249; production audit=0.

Trigger: Обработка недоверенного glob в dev tooling; достижимость конкретного DoS не проверялась.

Impact: Риск supply chain/dev availability, не доказанная production exploitability.

Root cause: 16 affected package entries, одна исходная GHSA-g3hv-75wg-m249; production audit=0.

Решение по шагам: Проследить npm explain minimatch; обновить совместимый upstream/lock. Не применять предложенный npm major downgrade/force. Проверить clean install, lint, tests и обе audit команды.

Альтернативы: Сохранить текущую реализацию можно только с явно принятым остаточным риском; не скрывать красный gate.

Regression scenarios:

- Детерминированная regression проверка указанного trigger; сохранить current controls и отрицательный сценарий.
- Сопоставить результат с exact SHA и целевой средой, сохранить exit code и counts.

Acceptance:

- Trigger больше не приводит к описанному impact при оговорённой конфигурации.
- Все связанные gates проходят, остаточные ограничения явно перечислены.

Граница доказательства: Доказан факт кода/конфигурации или scanner result. Production state/exploitability не проверялись.

### OPS-010 / P2 / CONFIRMED — Secret scanner allowlist исключает целые runtime config файлы

- `.gitleaks.toml:75-96` — Secret scanner allowlist исключает целые runtime config файлы: docker-compose.yml целиком allowlisted; общий regex test/dummy допускает substring.

Trigger: Настоящий секрет добавлен в исключённый файл или совпадает с широким allowlist.

Impact: Ложный clean security scan.

Root cause: docker-compose.yml целиком allowlisted; общий regex test/dummy допускает substring.

Решение по шагам: Заменить blanket path allowlist проверяемыми placeholder patterns/fingerprints; positive/negative synthetic fixtures, включая real-looking value в compose. Не печатать matched values и не добавлять общий tests/ allowlist.

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
npm --prefix frontend audit --omit=dev --audit-level=high
npm --prefix frontend audit --json
dotnet list Planora.sln package --vulnerable --include-transitive --format json
node --test .github/scripts/nuget-vulnerability-report.test.mjs
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

Формат `results/T12.md`: findings → files → commands/results → tests/coverage → before/after (только измеренное) → acceptance → risks → commits/PR при разрешении. Не объявлять green, если обязательный тест не запускался.

## Размер и разбиение

Оценка: 3–5 дней инженерной работы, не обещание времени модели. Контекст: 2–4 сеанса по 15–30 файлов. Разделять по finding после contract freeze; не параллелить writers одного файла. Завершить continuation batch из индекса для своей области и обновить точный охват.
