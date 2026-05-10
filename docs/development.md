# Development Guide

This guide is for contributors working inside the Planora codebase.

## Start With The Graph

Project rules require checking the knowledge graph first:

1. read `graphify-out/GRAPH_REPORT.md`;
2. navigate `graphify-out/wiki/index.md`;
3. inspect raw files only when the graph points to a concrete implementation detail or when fresh evidence is required.

After substantial code, config, dependency, test, or documentation changes, rebuild the graph.

## Local Workflow

Recommended loop:

```powershell
.\Start-Planora-Local.ps1
```

For frontend-only work:

```powershell
Push-Location frontend
npm install
Pop-Location
npm --prefix frontend run dev
npm --prefix frontend run lint
npm --prefix frontend run type-check
npm --prefix frontend run test
```

For backend-only work:

```powershell
dotnet restore Planora.sln
dotnet build Planora.sln
dotnet test Planora.sln --settings coverage.runsettings
```

For e2e changes:

```powershell
docker compose --env-file .env up -d --build
npm --prefix frontend run e2e
```

For documentation-only changes:

```powershell
npx markdownlint-cli2 README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md TESTING.md ARCHITECTURE.md "docs/**/*.md"
# CI also runs lychee in offline mode for local Markdown links.
```

## Backend Patterns

Most backend features follow:

```text
Controller -> MediatR command/query -> handler -> repository/service/gRPC -> Result/DTO
```

Common locations:

| Concern | Where |
|---|---|
| request/response DTOs | `*.Application/DTOs` or feature folders |
| validation | `*.Application/Features/**/Validators` |
| domain invariants | `*.Domain` |
| persistence | `*.Infrastructure/Persistence` |
| service startup | service `Program.cs` |
| cross-service gRPC | `GrpcContracts/Protos`, service gRPC clients/services |
| shared middleware | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware` |

## Adding A Backend Endpoint

1. Add command/query and handler in the service `Application` project.
2. Add FluentValidation validator if input is user-controlled.
3. Add/update DTOs and AutoMapper profile if needed.
4. Add repository/domain methods only inside the owning service.
5. Add controller action in the service API project.
6. Add gateway route if the endpoint is browser-facing.
7. Add/update tests.
8. Update `docs/API.md`, `docs/features.md`, and related docs.

Do not let one service query another service's database directly. Use gRPC for synchronous checks or RabbitMQ integration events for async propagation.

## Adding A Todo Feature

Start from:

- `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos`
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs`
- `Services/TodoApi/Planora.Todo.Infrastructure/Persistence/TodoDbContext.cs`

If the feature changes sharing or hidden behavior, also inspect:

- `TodoViewerStateResolver.cs`
- `HiddenTodoDtoFactory.cs`
- `UserTodoViewPreference.cs`
- `docs/DECISIONS/0004-viewer-specific-todo-visibility.md`

## Adding A Frontend Feature

1. Add or update route under `frontend/src/app`.
2. Keep API calls in `frontend/src/lib` or a dedicated hook.
3. Use existing DTO/type helpers under `frontend/src/types`.
4. Use existing UI components under `frontend/src/components`.
5. Add tests in `frontend/src/test`.
6. Run lint, type-check, and tests.

Important frontend files:

- `frontend/src/lib/api.ts` - main authenticated API client and refresh retry logic.
- `frontend/src/lib/auth-public.ts` - auth calls that must avoid interceptor recursion.
- `frontend/src/lib/csrf.ts` - CSRF token handling.
- `frontend/src/store/auth.ts` - token/user/session state.
- `frontend/src/types/todo.ts` - todo status/priority type conversions.

## Database Changes

1. Change the domain/entity in the owning service.
2. Change EF configuration in that service's Infrastructure project.
3. If schema evolution must be auditable, generate a local migration in the owning service.
4. Update `docs/database.md`.
5. Add repository/handler tests if behavior changes.

Do not create cross-service foreign keys. IDs may reference another service's concept, but the owning service must validate through service contracts.

Generated `Migrations/` folders are ignored by repository policy. Clean local/Docker installs work without committed migrations because startup creates schema from the current EF model when no migrations are present. For production-grade schema evolution, generate and manage migrations in the deployment branch/environment that owns the database.

## gRPC Contract Changes

1. Update the `.proto` file in `GrpcContracts/Protos`.
2. Update generated clients/services through the normal build.
3. Update service handlers/clients.
4. Add contract tests.
5. Update `docs/API.md` if HTTP behavior changes and `docs/architecture.md` if cross-service flow changes.

## Coding Conventions Confirmed By Repo

| Area | Convention |
|---|---|
| Backend target | `.NET 9`, nullable enabled, implicit usings enabled |
| Warnings | treated as errors, with NuGet advisory warnings excluded from error mode |
| Packages | central package management in `Directory.Packages.props` |
| Backend validation | FluentValidation |
| Backend request dispatch | MediatR |
| Backend result pattern | `Result<T>` / `Error` |
| Frontend | Next.js App Router, React 18, TypeScript |
| Frontend state | Zustand |
| Frontend validation/forms | Zod, React Hook Form where used |
| Frontend tests | Vitest + Testing Library |
| E2E tests | Playwright APIRequestContext through API Gateway |
| Docs checks | markdownlint-cli2 and lychee in CI |

## Documentation Rules

When changing behavior, update docs in the same change:

- endpoint changed -> `docs/API.md`;
- env/config changed -> `docs/configuration.md`;
- DB/migration changed -> `docs/database.md`;
- auth/security changed -> `docs/auth-security.md`, `SECURITY.md`;
- frontend workflow changed -> `docs/features.md`, `docs/development.md`;
- test command/coverage changed -> `docs/testing.md`, `TESTING.md`.
- e2e or CI workflow changed -> `docs/testing.md`, `docs/deployment.md`, `README.md`.
- production/secret process changed -> `docs/production.md`, `docs/secrets-management.md`, `SECURITY.md`.

## Repository Hygiene

The repository ignores generated and machine-local state:

- `bin/`, `obj/`, `.next/`, coverage, test results, Playwright reports;
- `*.tsbuildinfo`;
- `build_output.txt` and other generated command output captures;
- generated EF `Migrations/` folders;
- local AI/agent/editor state such as `.claude/`, `.codex/`, `.agents/`, `.cursor/`, `.gemini/`, `.mcp/`, `.roo/`, `.kiro/`, and local Claude/Codex/Gemini/OpenCode/Qwen JSON files;
- local knowledge-base/editor workspace state such as `.obsidian/`.

`AGENTS.md` is intentionally the repository-level policy file for Graphify and documentation discipline. Put machine-local or personal agent instructions in `AGENTS.local.md` or tool-specific local files instead.

Do not commit local agent settings, generated build outputs, secrets, database files, Docker override files, or generated migration folders.

Mark uncertain behavior as "requires owner clarification" instead of documenting guesses.
