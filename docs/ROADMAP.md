# Roadmap And Open Questions

This file separates confirmed gaps from recommendations. It is not a promise of future work.

## Confirmed Gaps

| Area | Gap | Evidence |
|---|---|---|
| Production deployment automation | no production deployment/promotion workflow found | CI/e2e workflows validate only |
| Frontend containerization | frontend is not in `docker-compose.yml` | Compose only defines infra/backend/gateway |
| Browser-rendered E2E testing | Playwright covers the critical gateway API flow, not full UI navigation | `frontend/e2e` uses APIRequestContext |
| Todo description length | validator allows 5000, EF config stores 2000 | Todo validators vs `TodoItemConfiguration.cs` |
| CORS env ergonomics | `.env.example` has comma-style `CORS_ALLOWED_ORIGINS`, services read configuration arrays | appsettings/service startup |
| Security contact enablement | policy names GitHub Private Vulnerability Reporting, but repository settings are not visible in code | `SECURITY.md` |

## Recommended Next Work

| Priority | Recommendation | Why |
|---|---|---|
| High | Reconcile Todo description length in validator and EF config | avoid runtime persistence surprises |
| High | Implement production deployment automation once hosting is chosen | baseline exists, but deploy/promotion is still manual |
| Medium | Add browser-rendered E2E for auth/todo/share/hidden screens | current Playwright suite covers gateway/services, not UI selectors |
| Medium | Containerize or document frontend deployment target | Compose starts backend only |
| Medium | Clarify CORS environment override pattern | avoid false confidence in `CORS_ALLOWED_ORIGINS` |
| Medium | Enable GitHub Private Vulnerability Reporting or add a real security email | policy exists, but owner must configure the external reporting channel |
| Low | Add OpenAPI export or generated route tests | keep API docs synchronized |

## Already Documented Architecture Decisions

- [`DECISIONS/0001-microservices.md`](DECISIONS/0001-microservices.md)
- [`DECISIONS/0002-http-only-refresh-cookies.md`](DECISIONS/0002-http-only-refresh-cookies.md)
- [`DECISIONS/0003-csrf-double-submit.md`](DECISIONS/0003-csrf-double-submit.md)
- [`DECISIONS/0004-viewer-specific-todo-visibility.md`](DECISIONS/0004-viewer-specific-todo-visibility.md)
