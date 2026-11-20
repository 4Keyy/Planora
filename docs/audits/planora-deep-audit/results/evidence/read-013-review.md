# READ-013 — shared HTTP, inbox и logging boundaries

Полностью рассмотрены 25 файлов, 1647 строк исходного snapshot `145eeea5`:
[первая половина](read-013a-review.md), [вторая половина](read-013b-review.md).
Source hashes и точные ranges сохранены в [общем JSON](read-013-review.json).
CSV теперь содержит 647 READ/REVIEWED из 1558, 41.53%; 61 пачка pending.
Новые тестовые файлы не добавляются в исторический знаменатель.

## Результат

BE-035/P1 воспроизведён: encoded sensitive query names раскрывали синтетическое
значение в Path request/response logger. Только ключ сравнения теперь проходит
form URL decode; raw query representation и контрольные символы обрабатываются
по прежнему контракту. RED7F/2P → GREEN9P, без skips. Полный backend:
1546 unit passed, 2 отдельно оркестрируемых restart facts skipped в общем вызове,
94 ErrorHandling passed; incremental Release build0 warnings/0 errors.
Независимый reviewer проверил diff и TRX, блокеров не нашёл.
[Проверки и ограничения](read-013-query-redaction-verification.json).

BE-036/P2: non-gRPC response buffering, disposed Body и отсутствие cancellation
в copy подтверждены исходником; возможное влияние SSE требует отдельного
transport regression. Текущий frontend использует WebSockets.
BE-037/P3: response logger читает только raw sub, поэтому mapped
NameIdentifier может остаться Anonymous. Это audit correlation defect,
не authorization bypass; runtime пока не выполнен.

Три dormant/legacy кандидата первой половины не получили новых IDs:
production activation idempotent decorator и producer legacy authorization
code не найдены. Они сохранены с условиями и не названы действующими сбоями.
OPS-015 logging-content evidence дополнено без дублирования findings.

## Границы

Ни один production log, credential, пользовательская БД или рабочий runtime
не читался. Query tests используют искусственные маркеры и captured logger.
Другие HTTP body/claim нарушения этим узким исправлением не устранены.
Дальнейший порядок задают PROGRESS и TASKS; этот review не сертифицирует
полноту всех файлов, E2E, restore или production rollout.

## BE-036 and BE-037 follow-up

On 2026-11-20 the original HTTP logger failed four new cases. A flush of
the first event did not reach the original response stream before the handler
returned, and an exception left a disposed stream attached to the response.
A mapped subject recorded `Anonymous`. The raw subject case also showed
that the old byte count came from the buffer rather than the declared length.

The middleware now leaves the response stream in place, reports the declared
length when available and resolves both subject claim forms. It still
rethrows the original handler exception. Local verification used isolated
in-process xUnit case invocation against the built test assembly: 13 HTTP
logging cases passed (including all nine redaction cases) and 59 Collaboration
cases passed. The Release solution build completed with zero errors and
12 existing deprecation warnings. Live transport and production rollout remain open.
