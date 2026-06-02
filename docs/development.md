# Development Guide

This guide is for contributors working inside the Planora codebase.

> **Read [`INVARIANTS.md`](INVARIANTS.md) before opening a PR.** It records the closed-form architectural rules every reviewer enforces (service ownership, gRPC trust, outbox/inbox correctness, auth storage, observability conventions, migration governance). Code style itself is governed by [`.editorconfig`](../.editorconfig); the build runs under `-warnaserror` via [`Directory.Build.props`](../Directory.Build.props).

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

For migration-touching changes:

```powershell
# Preview pending migrations without applying them
dotnet run --project tools/Planora.Migrator -- --all --list-pending

# Apply, after setting ConnectionStrings__*Database env vars
dotnet run --project tools/Planora.Migrator -- --all
```

For performance regression sniffing:

```powershell
docker compose --env-file .env up -d --build
k6 run perf/k6/scenarios/todo-list.js -e API_BASE_URL=http://127.0.0.1:5132
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

### Bundle-size discipline

Pages that ship heavy components only reached after user interaction
(modals, drawers, infrequent panels) lazy-load them via `next/dynamic`.
The currently lazy-loaded surfaces are:

| Component | Loaded on | Loaded from |
|---|---|---|
| `EditTodoModal` | first click of an edit affordance | `tasks/page.tsx`, `dashboard/page.tsx`, `tasks/completed/page.tsx` |
| `CreateTodoPanel` | first time the create panel opens | `tasks/page.tsx`, `dashboard/page.tsx` |
| `ColorBends` (WebGL background) | hydration of `ColorBendsLayer` | `app/layout.tsx` |

When adding a new heavy component (rule of thumb: > 10 kB gzipped, or
pulls in framer-motion or three.js), prefer:

```tsx
const HeavyModal = dynamic(
  () => import("@/components/.../heavy-modal").then((m) => ({ default: m.HeavyModal })),
  { ssr: false },
)
```

`ssr: false` is appropriate when the component is rendered in a
`"use client"` page and never needs SSR-pre-rendered markup. The
framer-motion enter animation on conditionally-rendered modals absorbs
the chunk fetch, so there is no visible delay on first open.

### API origin preconnect

`frontend/src/app/layout.tsx` emits `<link rel="preconnect">` and
`<link rel="dns-prefetch">` for the API gateway origin (read from
`NEXT_PUBLIC_API_URL` at build time). This opens the TCP + TLS
connection in parallel with the page render so the first auth call
saves the handshake (~100-300 ms on a cold connection). If the URL is
malformed the tag is omitted; the hint is a hint, never a hard
dependency.

### Avatar `priority` for LCP-critical surfaces

The `Avatar` component (`frontend/src/components/ui/avatar.tsx`) wraps
`next/image`, which is lazy by default. Most avatars (lists, friend
multi-select, comment authors) want to stay lazy and out of the LCP
budget. The one exception is the navbar's current-user avatar — it
sits above the fold on every authenticated page and is an LCP
candidate. Pass `priority` there:

```tsx
<Avatar
  src={user?.profilePictureUrl}
  firstName={user?.firstName}
  lastName={user?.lastName}
  email={user?.email}
  size={32}
  priority   // ← only the navbar avatar
/>
```

Set `priority` **only** for above-the-fold avatars on critical pages.
Setting it elsewhere wastes network on images the user never sees,
and Next.js will warn in dev when more than one `priority` image is
visible at once.

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
| Backend target | `.NET 10`, nullable enabled, implicit usings enabled |
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
- production deployment assumptions, secret names, license terms, or vulnerability disclosure policy.

## Repository Hygiene

The repository ignores generated and machine-local state:

- `bin/`, `obj/`, `.next/`, coverage, test results, Playwright reports;
- `*.tsbuildinfo`;
- `build_output.txt` and other generated command output captures;
- generated EF `Migrations/` folders;
- local AI/agent/editor state such as `.claude/`, `.codex/`, `.agents/`, `.cursor/`, `.gemini/`, `.mcp/`, `.roo/`, `.kiro/`, and local Claude/Codex/Gemini/OpenCode/Qwen JSON files;
- local knowledge-base/editor workspace state such as `.obsidian/`.

`AGENTS.md` is intentionally the repository-level policy file for documentation discipline. Put machine-local or personal agent instructions in `AGENTS.local.md` or tool-specific local files instead.

Do not commit local agent settings, generated build outputs, secrets, database files, Docker override files, or generated migration folders.

Mark uncertain behavior as "requires owner clarification" instead of documenting guesses.

## Pull Request Checklist

- [ ] Change is scoped to one clear behavior or documentation area.
- [ ] Backend build/tests pass if backend changed.
- [ ] Frontend lint/type-check/tests pass if frontend changed.
- [ ] Playwright e2e passes if auth/todos/sharing/hidden behavior changed.
- [ ] Markdown docs checks pass if docs changed.
- [ ] API docs updated for route/DTO/status changes.
- [ ] Database docs updated for EF/schema changes.
- [ ] Security docs updated for auth/session/CSRF/JWT/CORS changes.
- [ ] Production/secret docs updated for deployment or secret changes.
- [ ] No secrets or generated artifacts are included.
