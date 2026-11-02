# CI/CD parity

Все8 workflow прочитаны. Local commands exact cwd важен: bundle-report test из repo root падает из-за относительного пути; из frontend8/8 PASS. Это ошибка invocation аудитора, не новая регрессия приложения.

| Workflow | Реальный scope | Расхождение/задача |
| --- | --- | --- |
| ci.yml | docs parser/lint/audit; .NET10 Release tests + Postgres; Node22 lint/type/coverage/build | Local backend исключил Postgres; build/coverage frontend локально не повторены; backend cache без package locks |
| e2e.yml | main/path filtered;6 shards,75min; disposable SMTP; production Next build; retries2 | Baseline shard6 red; common build props отсутствуют в paths; local full stack не запускался |
| security.yml | gitleaks full history, NuGet,npm production,CodeQL,Trivy,SBOM | Scheduled gitleaks66 matches; full npm advisory; global OIDC/attest permissions; mutable CLI versions |
| migrations.yml |6 services; EF CLI10.0.8; idempotent SQL artifacts | Script presence/markers не доказывают fresh/upgrade success; small script bypass documented |
| openapi.yml |6 services; Testing metadata extraction; Postgres/Redis/Rabbit | Schema generation не permission test; spectral latest |
| perf-smoke.yml | manual only;2 k6 scripts;30min cap | Empty data,rate limits,remote helper/tool drift; no measured baseline |
| cd.yml | v* tag/manual; migrate→services→gateway→smoke | No immutable resolved SHA gate,env approval or required CI; matrix max-parallel не dependency graph |
| nuget-vuln-pr.yml | daily/manual,one tracking issue | Parser fail-closed tested; restore disables audit только для report; mutations не запускались аудитом |

Third-party actions pinned to SHA — positive control. Secrets в temporary E2E env, trace/video disabled, screenshots retention3days — positive controls; снимки всё равно нужно проверять на PII. Основной CI contents:read. Security job-level privilege нужно сузить. Не добавлять continue-on-error к обязательным gates; existing bundle/full-dev-audit advisory раскрывать честно.

Remote state: required checks/reviews на main отсутствуют, force push разрешён, admin bypass включён фактически через enforce_admins=false; rulesets0,environments0. Подготовить settings diff отдельно, не применять автоматически. CD GitHub config не доказывает запущенный Fly deployment. Source topology blockers: Production Ocelot выбирает loopback; effective REST/h2 ports и avatar persistent storage требуют acceptance.

T14 принимает contract/test outputs T07/T08/T09/T12/T13, исправляет только owned workflows/infra. Rerun должен проверять final SHA, все6 E2E shard statuses и first-pass/retry counts. Migration rollout и restore требуют отдельного изолированного drill; зелёный YAML lint этого не заменяет.
