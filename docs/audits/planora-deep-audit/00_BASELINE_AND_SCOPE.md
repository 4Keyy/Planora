# Baseline и границы исследования

Дата: 2026-11-02, Europe/Moscow. Checkout `F:\Projects\Planora`; `main`; HEAD `dc6b1781a24d43d967c418de30acda10fcafb8f9`; origin `https://github.com/4Keyy/Planora`. На старте foreign dirty `frontend/next-env.d.ts`, blob `ce4e94a6b10f160ee021fe18939af160d2927dcf`. Рабочий код не изменялся.

Запрошенного файла в checkout не было; полностью прочитано вложение пользователя (195 строк), копия сохранена как [мастер-промпт](PLANORA_CODEX_MASTER_AUDIT_PROMPT.md). Полностью прочитаны все 20 разделов локального codex-protocol. Graphify wiki/report отсутствуют; карта построена по исходникам, существующему codebase-map и symbol inventory. Новые graph tooling/dependencies не устанавливались.

## Масштаб

1558 tracked файлов, 9 878 000 байт; 878 C# файлов, 32 csproj (2 test projects), 198 ts,263 tsx, 13 page routes, 8 workflows, 5 proto. Шесть API: Auth, Todo, Category, Collaboration, Messaging, Realtime; плюс Gateway и три BuildingBlocks. Автоматический scan нашёл 77 HTTP method attributes,24 proto RPC,33 DbSet declarations,13 integration-event declarations,7 web entrypoints. Это syntax counts, а не runtime OpenAPI endpoint inventory. Routes/projects/migrations/крупнейшие файлы перечислены в [inventory](evidence/inventory.json); entries/jobs/middleware/RPC — в [symbol inventory](evidence/symbol-inventory.json).

Полный per-file inventory выполнен. Семантический review частичный; точные итоговые counts и ranges находятся в [индексе](02_FILE_AUDIT_INDEX.md). Нельзя приравнивать инвентаризацию, прохождение тестов и чтение всех строк. Для оставшегося исходного кода записаны continuation batches; этот комплект готов для реализации доказанных пунктов и дальнейшего аудита, не является сертификацией всей системы.

## Окружение и проверки

Node22.18.0, npm10.9.3, Docker server29.1.2. Системный dotnet видит8.0.133 и не удовлетворяет global.json; установленный `C:\Users\fkeyy\.dotnet\dotnet.exe` имеет SDK10.0.300 и использован для проверки. Manifest требует net10.0, Next16.4.3-range, React19.3.1-range; точное npm resolution — lockfile. NuGet CPM в Directory.Packages.props; packages.lock.json отсутствует. Restore/clean install повторно не выполнялись, новые пакеты не ставились.

| Проверка | Факт |
| --- | --- |
| Frontend lint | exit0,13.67s |
| TypeScript `--incremental false` | exit0 |
| Backend UnitTests Release, no-restore, filter `FullyQualifiedName!~Postgres`, отдельный OutDir | exit0,1207 passed,31 skipped,1238 selected,21s test duration |
| Frontend targeted existing tests | exit0,3 files/53 tests,8.53s; agent evidence |
| Node docs/scanner tooling tests | exit0,21 tests |
| E2E runner/bundle tooling tests | неверный cwd root:7/8, module path failure; повтор в frontend:8/8 PASS |
| Docs baseline links | 51 documents,918 links,0 broken |
| npm audit полный | 16 moderate affected entries,0 high/critical; advisory graph, не16 отдельных CVE |
| npm production audit | exit0,0 vulnerabilities |

См. [evidence](evidence/), [frontend execution](evidence/frontend-review.md). Полная frontend coverage/build, ErrorHandling suite, live PostgreSQL/Rabbit/Redis, browser E2E, визуальная матрица, k6 и restore drill локально не запускались. Причины: текущий planning scope, чужой next-env/live workspace, необходимость выделенной среды, resource limits. Отдельные interrupted sessions без итогового exit не зачтены. Это не препятствует записи планов, но блокирует заявления об исправлениях/production readiness.

## GitHub и история

GitHub connector доступен; metadata сообщает admin/maintain/pull/push — права не расширяют разрешение задачи. Открытый PR144 Dependabot; issue search вернул0 открытых issues. Remote branches:main,security/nuget-vuln-tracking,Dependabot; local main; tagv1.0.0. Submodules отсутствуют. Настройки/SHAs/run metadata сохранены в [github-state](evidence/github-state.json).

HEAD CI push success: [run41368376339](https://github.com/4Keyy/Planora/actions/runs/41368376339). Push Security success: [41368376369](https://github.com/4Keyy/Planora/actions/runs/41368376369). E2E failure: [41368376503](https://github.com/4Keyy/Planora/actions/runs/41368376503), один shard из6 красный. Scheduled Security failure: [41416485392](https://github.com/4Keyy/Planora/actions/runs/41416485392), gitleaks66 matches. Scheduled NuGet success: [41428219316](https://github.com/4Keyy/Planora/actions/runs/41428219316). Успешный исторический run не заменяет проверку будущего diff.

Прочитаны metadata и file churn последних45 commits; сохранены [history-45](evidence/history-45.txt). Адресно сопоставлены текущий cleanup dc6b178 (CI docs checker/Docker exclusions), auth/friend cache fixes0869759/3dcaf9d, rate-limit eae74a7, search86ebd60, notice08f97cb, task-action chain6b3bbb4..84f1bc5, UI49a0f81, E2E0ba18b0/958284a, coverage a863ca5, dependencies830847e/e5956c6, contract e1876e8/189fdec. Не утверждается чтение всех patch hunks45 commits. Последний cleanup удалил прежние audits; их старые статусы не приняты за текущие доказательства.
