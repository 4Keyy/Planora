# Troubleshooting

Use this guide from the symptom outward. Prefer gateway URLs for browser/API checks unless you are debugging a specific service directly.

## Startup Problems

| Symptom | Likely cause | Fix | Evidence |
|---|---|---|---|
| `docker compose` reports missing variable | `.env` missing or placeholders still present | copy `.env.example` to `.env` and fill required values | `docker-compose.yml` uses `${VAR:?message}` |
| PostgreSQL connection refused on `5432` | Compose maps PostgreSQL to host `5433` | use `localhost:5433` from host tools | `docker-compose.yml` |
| Redis auth failure | Redis started with `requirepass`, service connection string lacks password | set `REDIS_PASSWORD` and password-bearing Redis connection strings | `docker-compose.yml` |
| RabbitMQ login fails | wrong `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | update `.env`, recreate RabbitMQ container if credentials were initialized differently | `docker-compose.yml` |
| Service exits on JWT config | `JwtSettings:Secret` missing or too short | set `JWT_SECRET` with at least 32 chars | `ConfigurationValidator.cs`, service startup |
| Service exits on gRPC service-key startup validation | `GrpcSettings:ServiceKey` (`GRPC_SERVICE_KEY`) is missing or shorter than 16 characters | generate a key (`openssl rand -base64 32`) and set it on every service AND the gateway to the same value | `ServiceKey*Interceptor.cs` |
| `/health/ready` returns 503 but `/health/live` returns 200 | the process is alive but a dependency (Postgres, Redis, RabbitMQ) is unreachable or warming up — readiness intentionally holds traffic off | inspect the response body for the per-check status; check the dependency container logs | `BuildingBlocks/.../HealthCheckExtensions.cs`, `docs/deployment.md` |
| Probe traffic floods trace backend | `/health*` paths leaking into traces | the OpenTelemetry pipeline already filters every `/health*` path; verify the configured exporter is not adding its own instrumentation | `BuildingBlocks/.../Logging/TelemetryConfiguration.cs` |
| Docker launcher says `.env` missing | file was not copied from template | `Copy-Item .env.example .env` | `Start-Planora-Docker.ps1` |
| Launcher fails to import `PidManager`, `PortChecker`, or `HealthChecker` with a parser error | Windows PowerShell can misread UTF-8 script files that contain non-ASCII punctuation | keep `Start-Planora-*.ps1` and `scripts/*.psm1` ASCII-compatible, then rerun `.\Start-Planora-Local.ps1` or `.\Start-Planora-Docker.ps1` | `Start-Planora-Local.ps1`, `scripts/PidManager.psm1`, `scripts/PortChecker.psm1`, `scripts/HealthChecker.psm1` |
| Auth API exits with PostgreSQL `42P17: functions in index predicate must be marked IMMUTABLE` | a partial index filter contains a non-immutable expression such as `NOW()` | keep refresh-token partial indexes filtered only by immutable column predicates, then recreate the local Auth database/volume if it was left partially bootstrapped | `RefreshTokenConfiguration.cs`, `docs/database.md` |
| Frontend says `Cannot find module ...node_modules\next\dist\bin\next` | `node_modules` has a stale Next.js command shim but the Next package payload is incomplete | rerun the launcher; it removes the incomplete `node_modules/next` package and stale Next shims before reinstalling dependencies | `Start-Planora-Local.ps1`, `Start-Planora-Docker.ps1` |
| Clean install has no EF migration files | generated `Migrations/` folders are ignored by repo policy | startup creates schema from the current EF model through `DatabaseStartup.EnsureReadyAsync`; generate local migrations only if you need migration history | `DatabaseStartup.cs`, `docs/database.md` |
| Later local migrations fail against an existing clean-install DB | the DB was originally created through `EnsureCreatedAsync`, so EF migration history is absent | recreate the local DB/volume or create a baseline migration strategy before switching to migrations | `docs/database.md` |

## Authentication Problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Login works but todo/category calls return `401` | JWT secret/issuer/audience mismatch between Auth and consumers | ensure all services receive the same `JwtSettings__Secret`, issuer, and audience |
| `POST /auth/...` returns `403 CSRF_VALIDATION_FAILED` | missing or stale `X-CSRF-Token` / `XSRF-TOKEN` | call `GET /auth/api/v1/auth/csrf-token`, then retry mutation |
| Refresh returns `204 No Content` | no refresh cookie was sent; this is expected before login or after session expiry | log in again; use gateway URL consistently and inspect `refresh_token` cookie path `/auth/api/v1/auth` if a remembered session should exist |
| Profile email verification returns `400 Verification token is required` | old frontend called the token-confirm endpoint without a token | use the updated profile action, which sends a fresh verification link through `POST /auth/api/v1/users/me/verify-email` |
| Verification email only appears in logs | `Email__Provider` is still `Log` | set `Email__Provider=GmailSmtp`, `Email__Username`, and `Email__Password` in `.env`, then restart Auth API |
| Gmail SMTP send fails authentication | normal Google password used, 2-Step Verification disabled, or App Password revoked | enable 2-Step Verification and create a Google App Password for `Email__Password` |
| Verification link works on the laptop but not on phone/tablet in the same Wi-Fi | email link or frontend bundle still uses `localhost`, or Windows Firewall blocks inbound traffic on a `Public` network profile | run `.\Start-Planora-Local.ps1 -Lan` — it auto-syncs `Frontend__BaseUrl` / `NEXT_PUBLIC_API_URL` to the current LAN IP and opens the firewall for `3000`/`5132` across all profiles; if the other device still cannot open the LAN URL see the proxy/VPN row below |
| Phone/laptop cannot open `http://<laptop-lan-ip>:3000` at all, even with `-Lan` (URL times out) | a VPN/proxy client on the host (e.g. sing-box / xray / Clash TUN, or a system HTTP proxy with `ProxyEnable=1` and `ProxyOverride` not covering the LAN) routes the host's own LAN IP into the tunnel and blackholes it — the server is actually healthy | use the VPN's split-tunnel / LAN-bypass mode, add `<local>;192.168.*;<laptop-lan-ip>` to the proxy bypass list, or disable the VPN/proxy while sharing; also open the **exact** URL `-Lan` prints (the DHCP IP changes between sessions), and confirm both devices are on the same non-guest Wi-Fi. `-Lan` now warns when it detects an interfering proxy/TUN |
| Browser blocks `https://<laptop-lan-ip>:5132/...` with a CSP `connect-src` error | frontend CSP is upgrading local HTTP API calls to HTTPS | use the updated frontend CSP, restart Next.js, and confirm the response header no longer contains `upgrade-insecure-requests` in development |
| Browser opened on `localhost:3000` gets CSRF/CORS failures while API points at `<laptop-lan-ip>:5132` | frontend and API hosts are mixed, so CSRF/auth cookies are scoped to a different browser host | use the updated frontend config; it maps `localhost:3000` to `localhost:5132` and `<laptop-lan-ip>:3000` to `<laptop-lan-ip>:5132`; restart Next.js after config changes |
| Verified email status stays stale after clicking link | browser is using an older frontend bundle or token refresh failed | hard-refresh the frontend; current `/auth/verify-email?token=...` auto-verifies and refreshes the session when possible |
| Session does not restore after reload | refresh cookie absent/expired, or an old frontend build is racing CSRF or refresh-token rotation | log in again; verify `rememberMe` behavior, hard-refresh the frontend, and confirm `frontend/src/lib/auth-public.ts` is serializing refresh calls |
| 2FA code rejected | code missing or not 6 chars, or setup secret not confirmed | restart enable/confirm flow |

## Todo And Category Problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Todo create/update rejects category | category does not belong to current user or Category gRPC unavailable | verify category id and `GrpcServices__CategoryApi` |
| Shared user cannot be added | users are not accepted friends | send and accept friend request first |
| Public/shared todo not visible to friend | friendship check failed, task is not `isPublic`, and no direct share row exists | verify accepted friendship, `isPublic`, and `sharedWithUserIds` |
| Hidden shared task shows `Hidden task` with empty metadata | expected redaction | reveal/unhide explicitly to fetch full detail |
| Long todo description fails persistence | validator/EF length mismatch | keep descriptions <= 2000 until code is reconciled |
| Category list response shape surprises frontend | controller returns wrapper/result shape | use `parseApiResponse` / `toCategoryList` |

## Messaging And Realtime Problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Message send fails validation | missing recipient/subject/body or subject/body too long | subject <= 200, body <= 10000, recipient id required |
| Message pagination fails | page/pageSize invalid | page > 0, pageSize 1-100 |
| SignalR auth fails | token not supplied for hub connection | pass `access_token` query parameter for `/hubs` paths |
| `Failed to start the connection: WebSocket failed to connect` at login | realtime service still booting / momentary gateway WS-upgrade hiccup; `withAutomaticReconnect()` does NOT retry a failed *initial* connect | the frontend client now retries the initial connect with backoff (2s/5s/10s/30s) and self-heals; if it keeps failing, verify RealtimeApi is up and the gateway `/realtime` ws route is reachable |
| Active connections empty | user has no active hub connection or different token/user | reconnect frontend and verify bearer token |
| Broadcast rejected | user is not Admin | use an admin account |

## Frontend Problems

| Symptom | Likely cause | Fix |
|---|---|---|
| API URL falls back to localhost | `NEXT_PUBLIC_API_URL` invalid | set origin-only URL, no path/query/hash |
| Browser requests `/favicon.ico` | some browsers and cached tabs still probe the legacy ICO path | `/favicon.ico` rewrites to `/favicon.svg`; hard-refresh if the browser cached the old 404 |
| Frontend build fails on lint separately | lint is explicit CI gate, Next build ignores build-time lint hook | run `npm --prefix frontend run lint` |
| Auth interceptor loops | public auth calls accidentally used main API client | use `frontend/src/lib/auth-public.ts` for refresh/validate/auth bootstrap |
| Category filter stuck | localStorage contains old filter state | clear `todos-cat-filter` localStorage key |

## CI Problems

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend build fails on warnings | repo treats warnings as errors | fix warning or update project-wide rules intentionally |
| npm audit fails | HIGH or CRITICAL vulnerability | update dependency or document accepted risk |
| Gitleaks fails | secret-like value committed | rotate secret if real; replace committed value with placeholder |

## Diagnostic Commands

```powershell
docker compose --env-file .env config --quiet
docker compose ps
docker compose logs api-gateway --tail=100
docker compose logs auth-api --tail=100
Invoke-WebRequest http://localhost:5132/health
Invoke-WebRequest http://localhost:5132/auth/health
```

Frontend:

```powershell
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
```

Backend:

```powershell
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings
```
