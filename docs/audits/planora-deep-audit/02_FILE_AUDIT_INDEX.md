# Фактический охват файлов

Продолжение исполнения: [актуальный индекс](02_FILE_AUDIT_INDEX.csv),
[READ-011](results/evidence/read-011-review.md),
[READ-012](results/evidence/read-012-review.md),
[READ-014](results/evidence/read-014-review.md),
[READ-033](results/evidence/read-033-review.md),
[READ-034](results/evidence/read-034-review.md),
[READ-038](results/evidence/read-038-review.md),
[READ-040](results/evidence/read-040-review.md). После дополнительного чтения
175 файлов суммарно READ/REVIEWED 405 из исходных 1558 (25.99%).
Осталось 73 пачки. Runtime-проверки учитываются отдельно.
Исходная таблица ниже сохраняет исторический baseline, а не текущий прогресс.

[CSV — каждый tracked файл](02_FILE_AUDIT_INDEX.csv), [исходная инвентаризация](evidence/inventory.json), [пачки продолжения](evidence/continuation-batches.json).

Baseline содержит 1558 tracked файлов. READ/REVIEWED: 230 (14.76%). Это доля файлов, не строк и не доказательство полноты тестирования. REVIEWED может относиться к указанным ranges; столбец lines первичен.

| Статус | Число |
| --- | --- |
| REVIEWED | 185 |
| NEEDS_DEEP_REVIEW | 1321 |
| READ | 45 |
| EXCLUDED_WITH_REASON | 6 |
| BLOCKED | 1 |

NEEDS_DEEP_REVIEW включает inventory-only и частично прочитанные файлы; различие в pass/lines/note. EXCLUDED_WITH_REASON — assets/generated fragments с причиной. Full raw reading скриптом для hash/symbol scan не повышает статус. JSON реестры трёх исследователей и root сохранены для provenance.

У всех исходных файлов сохранён SHA256; foreign dirty next-env отражает working tree, baseline HEAD для сравнения отдельно. Значимые untracked источники на старте не обнаружены; локальные инструкции и codex-protocol прочитаны, в published inventory не включены. .env и credentials не читались. Ignored bin/obj/node_modules/.next/logs — runtime artifacts, не исходный audit scope. Поиск ignored service migrations не выявил дополнительных файлов.

Продолжить 80 пачек максимум по25 файлов; сначала privacy/transactions/broker, затем остальные handlers/validators/DTO, migrations, tests, UI, tooling. Для каждого файла записать callers, trust boundary, errors/cancellation, concurrency, tests и точное доказательство. Наличие task или passing suite не меняет статус файла автоматически.
