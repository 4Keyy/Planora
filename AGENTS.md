# Project Rules

## graphify

- Always check the knowledge graph first before analyzing Planora code: start from `graphify-out/GRAPH_REPORT.md` and `graphify-out/wiki/index.md`.
- Prefer graph structure for navigation and only read raw files when the graph points to a risk, a concrete implementation detail is needed, or fresh evidence is required.
- After substantial code, config, dependency, test, or documentation changes, rebuild the project graph before continuing audit or architectural analysis.
- Rebuilds for this repository should be source-only: include backend, frontend source, tests, gRPC contracts, configs, and docs; exclude `bin/`, `obj/`, `.next/`, `node_modules/`, logs, caches, test results, and build artifacts.
- For a full refresh, run graphify without incremental `--update`; use deep mode and wiki output.

## documentation

**Documentation is part of every task — not an optional afterthought.**

The sequence is: implement → verify tests pass → update docs → commit. Never commit code changes without the corresponding documentation update in the same commit (or the immediate next one before moving to any other topic).

### What to update, and when

| Change type | Files to update |
|---|---|
| New API endpoint or behavior change | `docs/API.md` endpoint table + detail section |
| New feature or feature behavior change | `docs/features.md` relevant section |
| New entity, column, index, or migration | `docs/database.md` relevant table row + migration table |
| Architecture / new service / new dependency | `docs/architecture.md`, `docs/overview.md`, `README.md` |
| Configuration / env var added | `docs/configuration.md`, `.env.example`, `README.md` |
| Security change | `docs/auth-security.md`, SECURITY.md |
| Bug fix | `docs/features.md` Key Rules if behavior changed |
| Test changes | `docs/testing.md` if coverage/strategy changed |
| Breaking change | `CHANGELOG.md` with migration guide |

### Quality standards

- Documentation must reflect the actual code — no placeholder text, no invented behavior.
- Every public API endpoint must have: method, path, auth requirement, request shape, success response shape, and error codes.
- Every DB table must have: purpose, composite key if any, important columns and constraints, and any unique invariants.
- Keep `README.md`, `docs/index.md`, `docs/features.md`, `docs/API.md`, `docs/database.md` synchronized after every relevant change.
- After substantial docs changes, rebuild Graphify.

## git hygiene

**Always read `.gitignore` before staging files.** This is a non-negotiable pre-commit check.

### Rules

- Before every `git add`, check whether the target paths match any `.gitignore` rule.
- **Never use `git add -f` / `--force`** to override `.gitignore` unless the user explicitly asks for it in that specific session. A file in `.gitignore` is there intentionally.
- If a file must be tracked despite being ignored (e.g., a seed script), ask the user first and update `.gitignore` with a targeted negation rule instead of using force-add.
- Generated artifacts that belong in `.gitignore`: `**/Migrations/**`, `**/bin/**`, `**/obj/**`, `**/.next/**`, `**/node_modules/**`, `*.user`, build outputs, local secrets.
- Before reporting a commit as complete, verify with `git status` that no unintended files were staged.

### Pre-commit checklist (mental model — run through this before every commit)

1. `git diff --cached --name-only` — confirm the staged file list matches intent.
2. Cross-reference each staged path against `.gitignore` rules — if any path is normally ignored, stop and investigate.
3. Confirm no secrets, credentials, or `.env` files are staged.
4. Confirm documentation is updated.
5. Confirm tests are updated and the build passes (`dotnet build` / `npm run build`).

## repository hygiene

- Treat `AGENTS.md` as the only repository-level agent policy file; keep personal prompts, local agent state, Claude/Codex/Cursor/Gemini settings, MCP config, chat logs, and generated assistant artifacts out of Git.
- Use `AGENTS.local.md` or tool-specific local files for machine-specific instructions; these files are ignored by repository policy.
