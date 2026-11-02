# Критерии приёмки

G0: конкретный пакет санкционирован; baseline/drift/ownership verified. G1: каждый confirmed fix имеет RED→GREEN. G2: privacy/data invariants. G3: targeted + relevant broader tests. G4: docs/evidence/review. G5: integration/rollback. G6: отдельное разрешение remote/deployment. Нет перехода к G6 по одному успешному build.

| Проверка | Команда / условие | Приёмка |
| --- | --- | --- |
| Scope | `git status --short`; `git diff --check` | Нет чужих staged paths,секретов,лишних изменений |
| .NET | `dotnet build Planora.sln --configuration Release`; `dotnet test Planora.sln --no-build --configuration Release` | SDK10; ненулевые tests; Postgres только disposable; counts/skips раскрыты |
| Frontend | `npm --prefix frontend run lint`; `npm --prefix frontend run type-check` | exit0; zero warnings policy |
| Coverage | `npm --prefix frontend run test:coverage` | Все текущие directory ratchets сохранены |
| Build | `npm --prefix frontend run build` | Изолированный checkout/output,нет overwrite чужого next-env |
| Browser | `npm --prefix frontend run e2e` | Явные собственные endpoints;6 CI shards,red baseline tests исправлены,skips/retries review |
| Docs | `node tools/docs/check.mjs --include-untracked`; `node tools/docs/lint.mjs --include-untracked` | Ссылки,anchors,lint PASS |
| SCA | `npm --prefix frontend audit --omit=dev --audit-level=high`; полный audit; NuGet transitive JSON | High/critical нет либо конкретный reviewed exception policy;moderate disclosed |
| Delivery | Npgsql/Rabbit/Redis isolated experiments | Нет partial commit;fan-out всем logical subscribers;DLQ durable;idempotent replay |
| Migrations | Fresh,prior supported,compatible unmanaged,unknown/drift | Нет data loss;unknown fail-closed;restore proof |

Эти будущие команды не все запускались аудитом; фактический baseline отдельно. Полный build при текущем dirty checkout не запускать вслепую. PowerShell проверяет exit после каждого шага. Если нет prerequisite, результат BLOCKED, не PASS.

UX: desktop/mobile/tablet,normal/reduced motion,keyboard-only/pointer,loading/empty/error/offline; неизменные layout/copy/navigation/motion. Допустимое visual изменение должно иметь исходный defect screenshot и узкое утверждённое исключение. jsdom не доказывает pixel/focus equivalence. API:owner/friend/stranger/anonymous,revocation/expiry,400/401/403/404/409/429/5xx,no PII;compat old/new event readers.

Operational: backup включает PostgreSQL,Redis key ring,Rabbit backlog,avatars; проверенный restore перед migration/storage move. Нельзя откатывать schema автоматическим Down после новых writes. Измерения performance должны сохранять correctness; не повышать лимиты ради зелёного k6.
