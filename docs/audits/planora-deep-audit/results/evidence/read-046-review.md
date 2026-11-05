# READ-046. Docker launcher

Полностью рассмотрен **1 файл и 852 строки**. Снимок `97f10f4c1beddfa3f9ebd376a68b8eab6e92cda7`.

Root назначил стабильные IDs: CONT046001 → OPS-016, CONT046002 → OPS-017.
Runtime gates остаются открытыми в T14.

## Наблюдения

- **CONT046001 / P2. Docker launcher может останавливать чужие процессы по имени или переиспользованному PID.** Все три Get-PortOwner calls опускают RepoRoot. Helper использует name regex dotnet|Planora|node вместо provenance, после чего launcher вызывает Stop-Process -Force. Первая PID-фаза также проверяет лишь живость числа PID, без executable/command-line/start-time ownership; stale PID может указать на другой процесс. Нормальный локальный запуск способен завершить соседний проект. Реальный чужой процесс не создавался и не останавливался, runtime NOT_VERIFIED.
- **CONT046002 / P2. Режим -Stop возвращает успех даже при отказе docker compose down.** Stop-DockerStack подавляет output и переводит любой nonzero exit в предупреждение. Caller затем безусловно пишет Shutdown complete и exit 0. Человек/automation получает успешный результат, хотя stack мог остаться запущенным. Не утверждается, что конкретный рабочий контейнер сейчас остался активным: Docker не вызывался.

Операционный launcher использует основной Compose и текущий Docker context. Он не запускался. -ExitAfterHealthCheck завершает frontend, сохраняя контейнеры; несовпадение с общим synopsis относится к OPS-009. Реальные конфигурационные значения не читались.

## Статическая проверка

Windows PowerShell 5.1.26100.9711: только Parser.ParseFile, exit 0, 0 синтаксических ошибок. Target script не исполнялся; helper modules не импортировались, Docker/services/порты не проверялись. Файл ASCII-compatible, UTF8 BOM отсутствует. Это не runtime certification.

## Полнота чтения

| Файл | Строки | SHA-256 |
|---|---|---|
| [Start-Planora-Docker.ps1](../../../../../Start-Planora-Docker.ps1) | 1–852 | `2944ea01f0e5a52d14a08a396e7ca135cd84bfee9b11450ec848ddb940d2d04f` |

Точная parser-only команда, source traces и limitations сохранены в [JSON](read-046-review.json). Все finding/observation refs проверены на существование и конечные строки.

## Границы

- Manifest READ-046 содержит ровно 1 файл Start-Planora-Docker.ps1, 852 строки. Supplemental module/Compose/docs ranges не добавлены к coverage.
- Source соответствует 97f10f4c1beddfa3f9ebd376a68b8eab6e92cda7 с нормализацией CRLF; SHA-256 вычислен по исходным байтам, полный range 1-852.
- Разрешённая parser-only диагностика не исполняла target script. Ни launcher, ни импортированные им модули/функции не запускались; Docker/services/npm/builds не вызывались.
- Не выполнялись port probes/Get-CimInstance process inventory либо остановки процессов. Runtime stop/failure scenarios ещё NOT_VERIFIED.
- Активные .env/OAuth/credentials/user secrets не читались. Process environment и Docker context/daemon не изменялись; фактические connections/volumes/containers не инспектировались.
- OPS-009 и остальные существующие OPS/DIST findings не дублируются. Риск process ownership и ложный exit 0 имеют разные проверяемые triggers и local CONT IDs, stable IDs назначает root.
- Изменены только собственные read-046-review.md/.json. Source, registry, indices, manifest, PROGRESS и чужие файлы сохранены. Следующая пачка не начиналась.
