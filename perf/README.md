# Performance Baseline

k6 load-test scripts establishing the **regression-detection baseline** for
Planora's hot endpoints. The pipeline pattern is: stand up the local Docker
stack, run a scenario, compare its p95/p99 latency and error rate against the
documented baseline. Any P95 regression > +20% on the same hardware fails the
gate. This is the foundation Phase 0 T0.1 leaves in place for every subsequent
phase to lean on.

## What is measured

| Scenario | Endpoint(s) | Stage profile | Key thresholds |
|---|---|---|---|
| `login.js` | `POST /auth/api/v1/auth/login` (with prior CSRF + register) | warm-up 10s @ 1 VU → ramp 20s @ 5 VUs → steady 30s @ 10 VUs | `http_req_duration{stage:steady} p95<800ms`, `http_req_failed<1%` |
| `todo-list.js` | `GET /todos/api/v1/todos?pageNumber=1&pageSize=20` | warm-up 10s @ 1 VU → steady 30s @ 10 VUs | `http_req_duration{name:todo_list} p95<400ms`, `http_req_failed<1%` |

Both scenarios share `lib/api.js` for CSRF + register + login bootstrapping.
Each scenario emits per-request tags so JSON output can be sliced after the run.

## Prerequisites

- k6 v0.49+ — install via `winget install k6` (Windows) or `brew install k6` (macOS).
- The Planora Docker stack must be running:

  ```powershell
  docker compose --env-file .env.e2e up -d --build
  # wait for /health on the gateway
  ```

  Use the same `.env.e2e` shape as `.github/workflows/e2e.yml` so every scenario
  hits the same secret-derived stack the CI E2E job exercises.

## Running locally

```powershell
# One scenario:
k6 run perf/k6/scenarios/todo-list.js -e API_BASE_URL=http://127.0.0.1:5132

# With JSON output for later diff:
k6 run --out json=perf/results/todo-list.json `
  perf/k6/scenarios/todo-list.js `
  -e API_BASE_URL=http://127.0.0.1:5132
```

The `--out json=...` flag writes per-request samples. Pair it with a tracked
baseline file under `perf/baselines/` (created on first prod-shape run) to
compute deltas in CI.

## Running in CI

`.github/workflows/perf-smoke.yml` runs on `workflow_dispatch` only — load tests
should not block routine PR merges, but should be exercised before any release
that touches a hot path. The job stands up the full Docker stack, runs every
scenario, uploads the k6 summary, and fails if a threshold is breached.

## Baselines

| File | When refreshed | Owner |
|---|---|---|
| `perf/baselines/local.md` | Whenever the hot path materially changes (handler rewrite, schema migration with hot-table impact, new gRPC hop) | The author of the change |

The baseline is intentionally **per-machine hardware-bound** — absolute numbers
are not portable. Use them only for delta comparison on the same runner class.

## Why k6

- Pure JavaScript scenarios — no learning curve for a TS-heavy team.
- Native Prometheus exporter (`--out experimental-prometheus-rw`) when the
  observability stack is up, so a perf run shows up as spikes on the same
  Grafana dashboards as production traffic.
- Threshold expressions live in the script itself — no separate gating
  configuration to drift from the scenario.
- Free, open source, single binary.
