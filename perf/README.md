# Performance Scenarios

Two committed k6 scenarios measure login and authenticated Todo list reads.
Their thresholds are absolute gates defined in the scripts. The repository
has no committed numerical baseline or automated `+20%` regression comparison;
`perf/baselines/local.md` does not exist in the audited checkout.

## Workloads and thresholds

| Scenario | Profile | Script-enforced thresholds |
|---|---|---|
| `login.js` | 1 VU for 10 s; ramp to 5 over 20 s; 10 VUs for 30 s | Login steady p95 < 800 ms, p99 < 1500 ms; CSRF p95 < 200 ms; HTTP failures < 1% |
| `todo-list.js` | 1 VU for 10 s, then 10 VUs for 30 s | Todo steady p95 < 400 ms, p99 < 800 ms; HTTP failures < 1% |

`lib/api.js` bootstraps CSRF and registration/login. The login scenario uses
one account for all VUs. Todo setup registers one reader and does not seed
tasks, categories, friends or shares: the default workload measures an empty
list, not a populated collaboration workload. k6 helpers make real writes;
run them in an isolated disposable environment.

## Local invocation

Prerequisites: k6, a reachable gateway and a healthy backend/schema. Set up
the stack following [Deployment](../docs/deployment.md), including its
fresh-database migration caveat; an arbitrary copied env file does not repair
the schema chain.

```powershell
k6 run -e API_BASE_URL=http://127.0.0.1:5132 perf/k6/scenarios/login.js
k6 run -e API_BASE_URL=http://127.0.0.1:5132 perf/k6/scenarios/todo-list.js
```

For reproducible comparison, record commit, k6 version, hardware, pool limits,
rate-limit settings, data cardinality, warm-up state and elapsed time. Create
an output directory before exporting results:

```powershell
New-Item -ItemType Directory -Force perf/results | Out-Null
k6 run -e API_BASE_URL=http://127.0.0.1:5132 `
  --summary-export=perf/results/todo-list-summary.json `
  --out json=perf/results/todo-list.json perf/k6/scenarios/todo-list.js
```

Generated performance results are not currently ignored by a dedicated
`perf/results/` rule; inspect Git status and keep local runs out of commits.

## Interpretation and known limitations

- Gateway permits 100 requests/min/IP overall and 30/min/IP on Auth routes;
  its counters also cover CSRF fetches. These scenario rates can intentionally
  hit `429` before measuring sustainable handler throughput. Document the
  rate-limit configuration used in any result instead of attributing all
  failures to server performance.
- Repeated login also grows session/token history for the same account.
- The Todo setup returns a k6 cookie-jar object together with serializable
  token fields. Validate setup-data serialization in the installed k6 version;
  cookie state is not automatically portable between setup and VU contexts.
- The scenarios load `uuidv4` from a remote k6-utils URL; offline operation
  needs that dependency available.
- Absolute k6 thresholds can match SLO targets, but they do not implement the
  rolling-window/error-budget policy in [SLOs](../docs/slo.md).

## CI

[`perf-smoke.yml`](../.github/workflows/perf-smoke.yml) runs only on manual
dispatch with `login`, `todo-list`, or `all`. It creates temporary secrets,
starts Compose, polls selected health endpoints, installs k6, runs the selected
scripts and uploads summary/raw JSON for 30 days. A failed script threshold
fails that run. It does not seed representative data, compare a historical
baseline, prove startup correctness, or gate every pull request.
