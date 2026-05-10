# Getting Started

This guide takes a clean local checkout to a running Planora app.

## Prerequisites

| Requirement | Recommended version | Used by |
|---|---:|---|
| .NET SDK | 9.x | backend services and xUnit tests |
| Node.js | current LTS compatible with Next.js 15 | frontend |
| npm | bundled with Node | frontend dependencies/scripts |
| Docker Desktop | recent stable | PostgreSQL, Redis, RabbitMQ, optional backend containers |
| PowerShell | 7.x recommended; Windows PowerShell can run the scripts when launcher/helper files remain ASCII-compatible | launch scripts |

Evidence:

- `Directory.Build.props` sets `TargetFramework` to `net9.0`.
- `frontend/package.json` uses `next` `^15.5.15`, React `18.3.1`, TypeScript `^5.7.2`.
- `docker-compose.yml` defines PostgreSQL 16, Redis 7, RabbitMQ 3.13, and backend containers.
- `Start-Planora-*.ps1` imports helper modules from `scripts/*.psm1`; those files avoid non-ASCII punctuation so Windows PowerShell can parse them reliably.

## 1. Create `.env`

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace placeholders. At minimum Docker Compose requires:

```env
POSTGRES_PASSWORD=<strong-password>
REDIS_PASSWORD=<strong-password>
RABBITMQ_USER=<user>
RABBITMQ_PASSWORD=<strong-password>
JWT_SECRET=<at-least-32-characters>
```

`JWT_SECRET` must be shared by every backend service. If it differs between services, login can succeed but downstream calls return `401`.

## 2. Choose A Launch Mode

### Option A: Docker Backend + Local Frontend

```powershell
.\Start-Planora-Docker.ps1
```

What the script does:

- loads `.env` into the process environment;
- verifies Docker, `.env`, `JWT_SECRET`, Node, and npm;
- stops existing Planora processes;
- starts `postgres`, `redis`, `rabbitmq`, all backend services, and the API Gateway through Docker Compose;
- runs the Next.js frontend locally on port `3000`;
- checks health endpoints.

Evidence: `Start-Planora-Docker.ps1`, `docker-compose.yml`.

### Option B: Docker Infrastructure + Local .NET Services

```powershell
.\Start-Planora-Local.ps1
```

What the script does:

- starts PostgreSQL, Redis, and RabbitMQ containers;
- runs each .NET service locally with `dotnet run`;
- rewrites Docker-style env values to local host/port values where needed;
- runs the frontend locally, installing dependencies first when the Next.js command shim or runtime package is missing.

Use this mode when actively debugging backend services.

Evidence: `Start-Planora-Local.ps1`, `scripts/PidManager.psm1`, `scripts/PortChecker.psm1`, `scripts/HealthChecker.psm1`.

### Clean Mode

Both launch scripts support `-Clean`:

```powershell
.\Start-Planora-Docker.ps1 -Clean
.\Start-Planora-Local.ps1 -Clean
```

The scripts describe `-Clean` as a rebuild/cleanup of code artifacts or images. They explicitly do not wipe database volumes.

On a first clean database start, Auth, Todo, Category, and Messaging initialize their schemas automatically. If local EF migrations exist, they are applied. If no migrations exist, startup creates the schema from the current EF model. This is intentional because generated `Migrations/` folders are not committed.

## 3. Verify The System

Expected local URLs:

| Target | URL |
|---|---|
| Frontend | `http://localhost:3000` |
| API Gateway | `http://localhost:5132` |
| Gateway health | `http://localhost:5132/health` |
| Auth health via gateway | `http://localhost:5132/auth/health` |
| Todo health via gateway | `http://localhost:5132/todos/health` |
| Category health via gateway | `http://localhost:5132/categories/health` |
| Messaging health via gateway | `http://localhost:5132/messaging/health` |
| Realtime health via gateway | `http://localhost:5132/realtime/health` |
| RabbitMQ UI | `http://localhost:15672` |

The frontend calls the gateway through `NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:5132` in `frontend/next.config.js`.

## 4. First Successful User Flow

1. Open `http://localhost:3000`.
2. Register a new user.
3. Create a category.
4. Create a todo assigned to that category.
5. Mark the todo as done or move it through status changes.
6. Open the profile/security page and confirm the user profile loads.

Relevant implementation:

- frontend routes: `frontend/src/app/auth/register/page.tsx`, `frontend/src/app/todos/page.tsx`, `frontend/src/app/categories/page.tsx`, `frontend/src/app/profile/page.tsx`
- API client: `frontend/src/lib/api.ts`
- auth store: `frontend/src/store/auth.ts`
- backend controllers: `AuthenticationController.cs`, `TodosController.cs`, `CategoriesController.cs`, `UsersController.cs`

## Manual Commands

Use these when you do not need the full launcher.

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings
```

```powershell
Push-Location frontend
npm install
Pop-Location
npm --prefix frontend run dev
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
npm --prefix frontend run build
```

The frontend script names are defined in `frontend/package.json`.

## Known Startup Caveats

| Caveat | Why it matters | Source |
|---|---|---|
| `.env.example` placeholders must be replaced before Compose can resolve required variables. | Compose uses `${VAR:?message}` for required secrets. | `docker-compose.yml` |
| PostgreSQL host port is `5433` in Docker Compose, while some launch profile examples still mention `5432`. | Local scripts convert DB connection strings to `Port=5433`; manual runs must use the correct port. | `docker-compose.yml`, `Start-Planora-Local.ps1`, `*/launchSettings.json` |
| Auth service local REST routing goes through port `5030` in Ocelot, while Docker host mapping exposes auth on `5031`. | Use gateway URLs for browser/API testing to avoid mixing internal service ports. | `Planora.ApiGateway/ocelot.json`, `docker-compose.yml` |
| State-changing auth requests require CSRF even when anonymous. | Login/register/refresh/reset can fail with `403` if the frontend CSRF bootstrap is bypassed. | `CsrfProtectionMiddleware.cs`, `frontend/src/lib/csrf.ts` |

More fixes: [`troubleshooting.md`](troubleshooting.md).
