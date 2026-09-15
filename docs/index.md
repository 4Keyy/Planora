# Planora Documentation

The project knowledge base for users, developers, operators, and
contributors. Every page documents behaviour that is observable in code,
configuration, tests, scripts, CI, or shipped artefacts.

> If a behaviour is not confirmed by project files, the docs mark it as
> "not confirmed by code" or "requires owner clarification" instead of
> inventing a contract.

## Pick your reading path

| Reader | Start here | Then read |
|---|---|---|
| First-time user | [`getting-started.md`](getting-started.md) | [`features.md`](features.md), [`troubleshooting.md`](troubleshooting.md), [`faq.md`](faq.md) |
| Frontend developer | [`frontend.md`](frontend.md) | [`design-system.md`](design-system.md), [`features.md`](features.md), [`API.md`](API.md), [`testing.md`](testing.md) |
| Designer | [`design-system.md`](design-system.md) | [`ui-audit/BLUEPRINT.md`](ui-audit/BLUEPRINT.md), [`ui-audit/TARGET.md`](ui-audit/TARGET.md), [`frontend.md`](frontend.md) |
| Backend developer | [`architecture.md`](architecture.md) | [`API.md`](API.md), [`database.md`](database.md), [`auth-security.md`](auth-security.md), [`INVARIANTS.md`](INVARIANTS.md) |
| Operator / on-call | [`OPERATIONS.md`](OPERATIONS.md) | [`configuration.md`](configuration.md), [`deployment.md`](deployment.md), [`production.md`](production.md), [`secrets-management.md`](secrets-management.md), [`observability.md`](observability.md), [`slo.md`](slo.md) |
| Security reviewer | [`auth-security.md`](auth-security.md) | [`security-idor-coverage.md`](security-idor-coverage.md), [`secrets-management.md`](secrets-management.md), [`INVARIANTS.md`](INVARIANTS.md) |
| Contributor | [`codebase-map.md`](codebase-map.md) | [`development.md`](development.md), [`testing.md`](testing.md), [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`INVARIANTS.md`](INVARIANTS.md) |
| Architect | [`architecture.md`](architecture.md) | [`INVARIANTS.md`](INVARIANTS.md), [`DECISIONS/`](DECISIONS/), [`caching.md`](caching.md) |

## Documentation map

### Product

| File | Purpose |
|---|---|
| [`overview.md`](overview.md) | Product, domain model, scenarios, boundaries |
| [`features.md`](features.md) | Feature behaviour with code references |
| [`getting-started.md`](getting-started.md) | Local setup, first successful path |
| [`faq.md`](faq.md) | Common user / developer questions |
| [`troubleshooting.md`](troubleshooting.md) | Known startup and runtime failures, fixes |
| [`glossary.md`](glossary.md) | Project terms with file references |

### Architecture & code

| File | Purpose |
|---|---|
| [`architecture.md`](architecture.md) | Service boundaries, data flow, patterns, diagrams |
| [`codebase-map.md`](codebase-map.md) | Directory and critical-file map |
| [`frontend.md`](frontend.md) | Next.js architecture, rendering model, data access, state, realtime, component conventions, the pre-commit checklist |
| [`design-system.md`](design-system.md) | Every design token with its measured contrast, the five enforced rules, primitives, and the failure modes the system is built against |
| [`INVARIANTS.md`](INVARIANTS.md) | Closed-form rules enforced across the codebase |
| [`API.md`](API.md) | Gateway route map and endpoint reference |
| [`database.md`](database.md) | EF Core contexts, tables, schema bootstrap |
| [`caching.md`](caching.md) | Cache layers, naming, TTL, invalidation |
| [`DECISIONS/`](DECISIONS/) | Architecture Decision Records (ADRs) |

### Interface audit

| File | Purpose |
|---|---|
| [`ui-audit/RESEARCH.md`](ui-audit/RESEARCH.md) | The full interface audit: 19 blocks covering design system, typography, colour, space, components, interaction, motion, phone and desktop, WCAG 2.2 AA, performance, edge cases, information architecture, copy, consistency, and comparison with reference products. Every claim carries a confidence marker |
| [`ui-audit/DEFECTS.md`](ui-audit/DEFECTS.md) | The defect register — evidence, the rule broken, the target state, and how to verify the fix |
| [`ui-audit/TARGET.md`](ui-audit/TARGET.md) | Target state as rule → number → automated check |
| [`ui-audit/INVENTORY.md`](ui-audit/INVENTORY.md) | Routes × states, the `ui/` components, overlays, icons |
| [`ui-audit/BLUEPRINT.md`](ui-audit/BLUEPRINT.md) | The design blueprint: product thesis, the two-device behavioural model, tokens, primitives, the task card, presence and redaction, the motion system, and twelve signature moments |
| [`ui-audit/EXECUTION.md`](ui-audit/EXECUTION.md) | The execution plan, phase by phase, with verification commands |
| [`ui-audit/RESULTS.md`](ui-audit/RESULTS.md) | What was actually changed, measured before and after — including the audit's own errors, where the implementation departs from the blueprint and why, and what is still not built. Written in Russian |
| [`ui-audit/tools/`](ui-audit/tools/) | The measurement harness. Every one exits non-zero on a finding, so any of them can gate a commit: `static-scan` (scales, colour literals, rule violations), `contrast-scan` (WCAG ratios from the tokens), `live-scan` (the browser matrix — routes x viewports x modes), `focus-scan` (every focus stop, measured against 2.4.11), `class-audit` (Tailwind classes that emit no CSS), `a11y-static` (unnamed controls, div-with-onClick), `link-check` (every relative markdown link and anchor in the repo), `mock-api` (deterministic fixtures, so the authenticated routes are measurable without the backend) |

### Research (pre-implementation)

| File | Purpose |
|---|---|
| [`eco/RESEARCH.md`](eco/RESEARCH.md) | Personal-finance domain research for the planned Eco / Ledger service: industry landscape, abandonment causes, money & ledger modelling, metrics, interface language, storage, Planora integration, naming. Research only — no implementation plan |
| [`eco/UX-BLUEPRINT.md`](eco/UX-BLUEPRINT.md) | Layout and interaction specification for the same service on desktop and phone web: grid and breakpoints, screen inventory, per-screen wireframes with pixel sizes, component inventory, frame-by-frame interaction choreography, chart specs, performance budgets, accessibility, design-token additions |

### Security

| File | Purpose |
|---|---|
| [`auth-security.md`](auth-security.md) | Auth model, CSRF, JWT, sessions, security stamp |
| [`security-idor-coverage.md`](security-idor-coverage.md) | IDOR-resistant endpoints and the tests that pin them |
| [`secrets-management.md`](secrets-management.md) | Secret inventory, storage, rotation |
| [`../SECURITY.md`](../SECURITY.md) | Vulnerability disclosure policy |

### Operations

| File | Purpose |
|---|---|
| [`OPERATIONS.md`](OPERATIONS.md) | Runbook entry point |
| [`configuration.md`](configuration.md) | Environment variables, appsettings, ports |
| [`deployment.md`](deployment.md) | Docker Compose, CI/CD, Fly deployment |
| [`production.md`](production.md) | Production baseline, readiness checklist |
| [`observability.md`](observability.md) | OpenTelemetry, Loki, Grafana, custom metrics |
| [`slo.md`](slo.md) | Service-level objectives and error budgets |

### Engineering workflow

| File | Purpose |
|---|---|
| [`development.md`](development.md) | Local workflows for adding features, endpoints, components |
| [`testing.md`](testing.md) | Suites, commands, coverage, OpenAPI lint |
| [`plans/`](plans/) | Working plans and research prompts for upcoming work |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | PR checklist, branch hygiene, CODEOWNERS |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Released changes, conventional-commit log |

## Key code references

| Topic | Files |
|---|---|
| Gateway routes | `Planora.ApiGateway/ocelot.json`, `Planora.ApiGateway/ocelot.Docker.json` |
| Frontend API client | `frontend/src/lib/api.ts`, `frontend/src/lib/auth-public.ts`, `frontend/src/lib/csrf.ts`, `frontend/src/store/auth.ts` |
| Design tokens | `frontend/src/lib/design-tokens.ts`, `frontend/tailwind.config.ts`, `frontend/src/app/globals.css`, `frontend/src/lib/animations.ts` |
| UI primitives | `frontend/src/components/ui/` — `button`, `field`, `status-panel`, `overlay`, `priority-meter`, `confirm-dialog`, `toast`, `card`, `avatar` |
| Motion primitives | `frontend/src/components/ui/number-roll.tsx`, `ink-check.tsx`, `week-bars.tsx`, `undo-bar.tsx` |
| Collaboration primitives | `frontend/src/components/ui/presence-row.tsx` (who is in a task, and arrival as an event), `redaction-badge.tsx` (audience as an arc that opens and closes) |
| Realtime display policy | `frontend/src/components/ui/update-pill.tsx` — `UpdatePill` and `useDeferredUpdates`: apply live only at the top of the list with nothing open, queue everywhere else |
| Keyboard model | `frontend/src/hooks/use-list-navigation.ts` (cursor, multi-select), `frontend/src/components/ui/shortcuts-overlay.tsx` (`SHORTCUT_GROUPS` — the single source of truth for every key), `frontend/src/components/command-palette.tsx` |
| Selection and capture | `frontend/src/components/ui/selection-bar.tsx`, `frontend/src/components/todos/quick-capture.tsx` |
| Card → dialog transition | `frontend/src/lib/shared-origin.ts`, consumed in `frontend/src/components/todos/edit-todo-modal/modal.tsx` |
| Frontend hooks | `frontend/src/hooks/` — `use-list-navigation`, `use-focus-trap`, `use-scroll-lock`, `use-autosave`, `use-collapse-scroll`, `use-friends` |
| Design-system enforcement | `frontend/src/test/quality/design-tokens.contract.test.ts`, `docs/ui-audit/tools/class-audit.mjs`, `docs/ui-audit/tools/a11y-static.mjs`, `docs/ui-audit/tools/focus-scan.mjs` |
| Documentation enforcement | `docs/ui-audit/tools/link-check.mjs` — 375 relative links across 67 files, checked file and anchor |
| Auth endpoints | `Services/AuthApi/Planora.Auth.Api/Controllers` |
| Todo endpoints & sharing | `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`, `Services/TodoApi/Planora.Todo.Application/Features/Todos` |
| Category endpoints | `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs` |
| Messaging endpoints | `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs` |
| Collaboration (comment timeline) endpoints | `Services/CollaborationApi/Planora.Collaboration.Api/Controllers/CommentsController.cs` |
| Realtime endpoints & hubs | `Services/RealtimeApi/Planora.Realtime.Api/Controllers`, `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs` |
| Database models | `*/Infrastructure/Persistence/*DbContext.cs`, `*/Infrastructure/Persistence/Configurations` |
| Backend tests | `tests/Planora.UnitTests`, `tests/Planora.ErrorHandlingTests` |
| Frontend tests | `frontend/src/test`, `frontend/playwright.config.ts`, `frontend/e2e` |
| Observability wiring | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs` |
| Health probes | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/HealthCheckExtensions.cs` |
| Migration runner | `tools/Planora.Migrator/`, `.github/workflows/migrations.yml` |
| Fly.io deployment | `deploy/fly/`, `deploy/fly/README.md` |
| Continuous delivery | `.github/workflows/cd.yml` |
| Loki Serilog sink | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SerilogConfiguration.cs` (`TryAddLokiSink`) |
| Frontend trace propagation | `frontend/src/lib/trace.ts`, axios interceptor in `frontend/src/lib/api.ts` |
| Performance baseline | `perf/k6/`, `perf/README.md`, `.github/workflows/perf-smoke.yml` |

## Maintenance checklist

Update docs when changing:

- gateway routes or controller actions;
- DTOs, validators, response wrappers, or error behaviour;
- environment variables, ports, scripts, Docker Compose, or appsettings;
- database entities, EF configurations, schema bootstrap, indices, or seed data;
- frontend routes, auth-token handling, API-client behaviour, hidden-task behaviour;
- design tokens, UI primitives, motion, or anything else in [`design-system.md`](design-system.md);
- keyboard shortcuts — any change to `SHORTCUT_GROUPS` or to the keys `use-list-navigation.ts`
  answers to, including a key that moves from one owner to another. The `?` overlay prints that
  array, so a binding the code no longer serves becomes a printed promise the product breaks;
- what realtime does to a list on arrival, or what counts as "busy" for `useDeferredUpdates` —
  the rule decides whether someone else's change moves rows under a click already committed to;
- whether a destructive action is guarded by confirmation or by the undo window, on any screen.
  The two must not disagree about the same object: [`features.md`](features.md) records which
  screen uses which and why;
- a signature moment from [`ui-audit/BLUEPRINT.md`](ui-audit/BLUEPRINT.md) being built, changed,
  or deliberately built differently from its spec — the deviation and its reason belong in
  [`ui-audit/RESULTS.md`](ui-audit/RESULTS.md), not only in a code comment;
- tests, CI jobs, security checks, or launch scripts;
- production deployment assumptions, secret names, license terms, or vulnerability disclosure policy.
