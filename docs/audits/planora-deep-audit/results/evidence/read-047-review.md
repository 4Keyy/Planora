# READ-047. Local launcher

Полностью рассмотрен **1 файл и 1690 строк**. Source snapshot `1c0d82fc6ea8768d234e9cab974549382f6057c6`. Исходник не изменён.

## Новая находка

**OPS-018 (CONT047001) / P2 — LAN firewall verifier не проверяет заявленные TCP и LocalSubnet.** `Test-LanFirewallRule` читает Enabled/Inbound/Allow и LocalPort. Уже существующее same-name правило с UDP вместо TCP либо Any remote scope может считаться корректным. Тогда repair пропускается, а вывод называет inbound TCP + LocalSubnet verified. Наличие порта и TCP self-probe на той же машине не подтверждают remote-peer reachability или правило нужной области. Это source-confirmed дефект проверки; firewall/runtime не инспектировались.

T14 нужен harness со stub firewall objects, без изменения реальных правил: UDP-only, широкий/неверный remote scope, другие filters/profiles и корректное TCP/LocalSubnet правило. Реестр: OPS-018.

## Существующие находки и опровержения

- **OPS-016:** числовые PID records не сохраняют process identity; Local также глобально останавливает SDK build servers после timeout, без checkout boundary. При этом все четыре Local port-owner calls передают RepoRoot: Docker name-only fallback на эти calls не переносится.
- **OPS-017:** Local не вызывает Compose down, но игнорирует stop outcomes, подавляет ошибки, очищает PID records и возвращает0. Это родственная stop-verification граница, отдельный stable ID не добавлен.
- **OPS-009:** synopsis Local ошибочно говорит, что companion Docker launcher удаляет volumes; actual down не имеет --volumes.
- Backend build failure останавливает startup; failed health делает ExitAfterHealthCheck nonzero. Игнорирование этих ошибок не подтверждено.
- Env/SDK/Docker/LAN setup traced по исходнику; активные env/credentials не читались. Fixed infra и процессная очистка делают launcher неподходящим для audit fixture.

## Статическая проверка

Windows PowerShell 5.1.26100.9711: только Parser.ParseFile, exit0,0errors. Target script не исполнялся, modules не импортировались. Docker, процессы, сеть, firewall, installer/build/npm не запускались. UTF8 source без BOM содержит non-ASCII комментарии; parse не доказывает runtime/encoding correctness.

## Полнота чтения

| Файл | Строки | SHA-256 |
|---|---|---|
| [Start-Planora-Local.ps1](../../../../../Start-Planora-Local.ps1) |1–1690|`71d93ccb90116f10f24fe996e1ced9048887747126b97ab412b1fe17a80def05`|

Точная команда, версии, file traces, proposed synthetic regressions и limitations сохранены в [JSON](read-047-review.json). Supplemental module/docs ranges не увеличивают manifest coverage. Runtime gates остаются открытыми в T14. Source, registry, index, manifest, PROGRESS и чужие изменения сохранены.
