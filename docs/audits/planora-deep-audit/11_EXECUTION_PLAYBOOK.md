# Запуск и интеграция пакетов

## Старт без дополнительного проектирования

1. Открой [README](README.md), [baseline](00_BASELINE_AND_SCOPE.md), [контракт](EXECUTOR_CONTRACT.md) и [TASKS](TASKS.json).
2. Выбери T01. Передай модели `PROMPT_01_FOUNDATIONS.md` вместе с доступом к каталогу аудита. Все PROMPT содержат минимальный автономный контракт; полный пакет evidence остаётся входом для проверки точных исправлений.
3. Отдельным сообщением санкционируй реализацию конкретного пакета. Например: «Выполни T01 из docs/audits/planora-deep-audit/PROMPT_01_FOUNDATIONS.md; прочитай EXECUTOR_CONTRACT.md, сохрани results/T01.md. Не выполняй push, deploy и миграции». Это пример будущего задания, не текущее разрешение.
4. Проверяющий принимает каждый пункт acceptance и записывает SHA результата. Следующий исполнитель читает result-файлы всех `blocked_by`.

```powershell
Get-Content docs/audits/planora-deep-audit/EXECUTOR_CONTRACT.md -Raw
Get-Content docs/audits/planora-deep-audit/PROMPT_01_FOUNDATIONS.md -Raw
$tasks = Get-Content docs/audits/planora-deep-audit/TASKS.json -Raw | ConvertFrom-Json
$tasks.tasks | Select-Object task_id, package, priority, status
```

## Работа с drift и неполным аудитом

Сначала сравнить HEAD и реальный code path. Если finding уже исправлен, добавить targeted verification и evidence, не возвращать старую ошибку ради выполнения плана. Файлы `NEEDS_DEEP_REVIEW` в CSV — обязательный continuation backlog; пакеты не получают разрешение объявить их reviewed по одному `rg`. Отмечать фактические строки, callers, tests и checked invariants. [Continuation batches](evidence/continuation-batches.json) распределяют оставшееся по областям и небольшим пачкам.

Реализация проверенных P1 и дальнейшее чтение остальных файлов могут идти одновременно при непересекающемся ownership. Полный комплект планов не означает, что вся система построчно сертифицирована. Новые находки получают новые IDs, старые не перенумеровываются.

## Интеграционная дисциплина

По умолчанию использовать текущий checkout с одним писателем файла. Если владелец отдельно выбирает ветки/PR, создать изолированные checkouts после проверки dirty state, привязать каждый PR к Txx, базовому SHA, red/green и разрешённым исключениям UX. До merge перепроверить required checks на конечном SHA и совместимость соседних пакетов; разрешить конфликты по contracts/tests, не путём принятия одной стороны вслепую.

Ветка `security/nuget-vuln-tracking` и Dependabot PR #144 обнаружены, но не интегрировались и не удалялись. PR #144 нельзя считать безопасным только из-за semver patch/minor: сверить final lock, advisory и frontend contract checks в T12. Репозиторий не имеет подтверждённых обязательных status checks на main; T14 готовит изменение настроек на отдельное утверждение.

Merge, remote push, branch cleanup, environment protection changes и выпуск разрешает владелец после конкретного reviewable результата. Перед удалением ветки доказать, что её commits интегрированы/сохранены, нет нужных unmerged PR или уникальной работы. Не применять force-push и не переписывать историю ради scanner findings; для настоящих секретов сначала rotation.

## Артефакт принятия

`results/Txx.md` содержит таблицу acceptance PASS/FAIL/BLOCKED, список findings, commit, commands, число тестов/skips/retries, visual/perf evidence, doc deltas и остаточные риски. Интегратор не принимает «всё работает» без этих полей. T16 выпускает итоговый release candidate report; production readiness остаётся заблокированной, пока не выполнены deployment/restore checks и не получено разрешение.
