# Threat model и security verification

Активы: private tasks/categories/comments, session/refresh credentials, friendship graph, notification payloads, avatars, 2FA protected secrets, durable events, backups, build/deploy credentials. Акторы: anonymous, owner, friend, бывший friend, authenticated stranger, compromised browser, internal service и привилегированный оператор CI. Границы: browser→gateway, gateway→service, service→gRPC, service→DB/Redis/broker, publisher→consumer, runner→deployment.

| Угроза | Evidence / confidence | Контроль и проверка |
| --- | --- | --- |
| Чужая session после logout/account switch | FE-001/002,CONFIRMED in-memory | Epoch на всех continuations; deferred success/reject и no stale mutation retry |
| Refresh replay/concurrent consume | BE-003 LIKELY,BE-004 static | Hash/reuse detection уже есть; two-context CAS и expired device regression |
| Revoked branch продолжает receive | DIST-004 static | Current audience на send; expiry/revocation; live two-account WebSocket test |
| Erasure не доходит доменам | DIST-001 static | Stable subscriber queues, replay/idempotency и end-to-end erasure matrix |
| Lost event / DLQ loss | BE-001/002,DIST-002 | One DB commit, durable DLQ bindings, crash/ack matrix |
| Spoofed proxy/limit partition | DIST-007 LIKELY | Validate config before middleware; trusted/untrusted XFF tests |
| Credentials в истории | OPS-003 scan result |66 fingerprints classify; no raw values; реальный secret требует rotation |
| Scanner blind spots | OPS-010 static | Narrow allowlists, positive/negative synthetic fixtures |
| Supply chain/tool drift | OPS-004/005 | SCA и version pin; affected dev graph отдельно от production |
| Deploy обход QA | OPS-001/006/012 | Immutable SHA, exact required checks, protected environment после разрешения |
| Key/upload loss | OPS-007; Redis configuration risk | Backup/restore before storage move; T09 проверяет eviction/decryption |

## Permissions matrix

Для каждого task/category/comment/notification API прогнать owner/friend/stranger/anonymous; добавить former-friend, deleted-user, expired/revoked token. Матрица проверяет read/list/mutate/delete/subscribe и прямой ID чужого объекта. Author-self policy и page-specific privacy не нормализовать на основании названия IsPublic. Category owner controls и Collaboration reply TaskId проверены статически; они являются положительными контролями, не поводом исключить regression.

CSRF, CORS, JWT, CSP, upload validators, error logging и reset/email paths исследованы выборочно. Полного DAST, source-to-sink XSS/SSRF/path-traversal обзора всех файлов, license audit, pen-test, доказательства production headers и retention erasure не выполнено. Эти проверки — T12/T13/T16 и точные continuation batches. Никакой «ASVS compliant» декларации.

## Стандарты и первичные источники

Проверены 2026-11-02: [OWASP ASVS5.0.0](https://asvs.owasp.org/) — каталог verification requirements; [API Security Top10 2023](https://api-security.owasp.org/editions/2023/en/0x00-header/) — BOLA/BFLA, resource limits и trust. Применяем как checklist к реальным boundaries, без выдуманных номеров требований. CWE-862/863 для отсутствующей/неправильной authorization, CWE-362 для races, CWE-613 для lifetime — классификация рисков, не оценка exploitability.

[GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use) обосновывает минимальные job permissions и immutable action refs; action SHA не фиксирует скачиваемую им версию CLI. [EF transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions) объясняет single SaveChanges boundary. [Rabbit publish/subscribe](https://www.rabbitmq.com/tutorials/tutorial-three-dotnet) различает fan-out и competing consumers. [Redis eviction](https://redis.io/docs/latest/develop/reference/eviction/) подтверждает необходимость отделять disposable cache от единственной копии ключа. [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) сверено с npm report; forced downgrade не принят как исправление.
