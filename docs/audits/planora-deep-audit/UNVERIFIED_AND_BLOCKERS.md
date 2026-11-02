# Непроверенное и условия продолжения

| Область | Статус | Как получить доказательство / владелец |
| --- | --- | --- |
| Все1558 файлов построчно | NOT_VERIFIED | Продолжить per-file batches; source review каждого файла,не grep-only |
| Live DB transactions/concurrency/migrations | NOT_VERIFIED | T02/T03/T04/T08 disposable Npgsql с fault barriers/restore |
| Actual Rabbit fan-out/DLQ/backlog migration | NOT_VERIFIED | T05 own vhost/container,3 logical subscribers/2 replicas,crash matrix |
| Redis key eviction/stamp failure | NOT_VERIFIED | T09 controlled memory pressure and decrypt drill;no production keys |
| Server WebSocket revoke/expiry | NOT_VERIFIED | T06/T16 live two-account controlled test |
| Full frontend tests/coverage/build locally | NOT_RUN | T13 подготовит isolated checkout и captures;historical CI success отдельно |
| Local browser UX/E2E/cross-browser | NOT_RUN | T11/T16 reproduce red shard,viewports,pointer/keyboard;Firefox/Safari отдельный scope |
| Production Fly topology/DB/data | NOT_ACCESSED | T14 approved staging then production plan;не infer из manifests |
| Performance metrics/EXPLAIN | NOT_MEASURED | T16 bounded synthetic workloads |
| Scanner66 matches are live secrets? | NOT_VERIFIED | T12 fingerprint classification;no raw values;rotation отдельно |
| License inventory/SBOM integrity всех backend images | NOT_VERIFIED | T12 exact lock/SBOM/version provenance;legal interpretation owner |
| OpenAPI runtime surface completeness | NOT_EXTRACTED | T07 isolated metadata build,contract tests |
| Audit agents interrupted | PARTIAL | Их сохранённые reviews/registries содержат фактический охват;не записанные проверки не зачтены |

В planning phase эти ограничения честно отражены и не маскируются «всё проверено». Исправления приложения сейчас не выполнялись. Для реализации конкретного пакета нужен новый scope от владельца; для push/PR/merge/branch cleanup,GitHub settings,secret rotation,deploy и применения миграций нужны отдельные полномочия. Никаких подтверждений ради уже разрешённого read-only исследования не требуется.
