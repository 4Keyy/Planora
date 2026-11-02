# Performance baseline

Численной runtime baseline продукта в этой сессии нет. Не измерены p50/p95/p99 API,query plans,RPS,CPU/RAM,Web Vitals,bundle/startup,search first frame,reconnect latency. Время lint/test не используется как performance приложения. Предыдущие claims/документы не выданы за текущий замер.

Существуют k6 login/todo-list и bundle report. Todo setup создаёт пустого читателя; login делит один account между VU. Общие лимиты могут дать429 задолго до handler saturation. Нет committed perf/baselines/local.md, несмотря на старую ссылку workflow. `docs/slo.md` — proposed targets, не доказательство активных dashboards.

## Протокол T16

Отдельная disposable среда с seed1000 tasks/100 categories/20 friends/3 viewer roles; размеры — предлагаемые bounded значения, не результаты. Сохранить SHA,lock versions,CPU/RAM,DB settings,pool sizes,rate limits,cardinality,seed и clock. Warm-up10s, затем1/5/10VU максимум60s;5 повторов одинакового before/after. Отдельно cold/warm и limiter verification. Не отключать production security для benchmark.

API: p50/p95/p99,error/429,Retry-After,query count/rows/EXPLAIN ANALYZE в одноразовой БД. UI: cold/warm navigation,search open first frame,typing latency,notification render,layout shifts; desktop1440×900,mobile390×844,tablet768×1024; normal/reduced motion. Broker: publish→persist→client receipt различать; pending age,DLQ depth,replay/duplicates,reconnect.

Сохранять исходные абсолютные k6 gates(p95 list400ms,login800ms,p99 list800ms/login1500ms,error<1%). Дополнительный before/after guard<=10% p95/p99 — предложение, применять только после оценки шума. Достоверная деградация correctness/privacy всегда FAIL независимо от ускорения. Bundle budget сейчас advisory; не называть его обязательным. Полные Redis/DB query performance hypotheses остаются NOT_VERIFIED до измерения.
