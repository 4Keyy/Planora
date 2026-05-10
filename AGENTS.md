# Project Rules

## graphify

- Always check the knowledge graph first before analyzing Planora code: start from `graphify-out/GRAPH_REPORT.md` and `graphify-out/wiki/index.md`.
- Prefer graph structure for navigation and only read raw files when the graph points to a risk, a concrete implementation detail is needed, or fresh evidence is required.
- After substantial code, config, dependency, test, or documentation changes, rebuild the project graph before continuing audit or architectural analysis.
- Rebuilds for this repository should be source-only: include backend, frontend source, tests, gRPC contracts, configs, and docs; exclude `bin/`, `obj/`, `.next/`, `node_modules/`, logs, caches, test results, and build artifacts.
- For a full refresh, run graphify without incremental `--update`; use deep mode and wiki output.

## documentation

- After every behavior, configuration, API, CI/CD, dependency, startup, deployment, test, or security change, update the relevant documentation in the same task before reporting completion.
- Keep documentation traceable to real repository evidence: code, config, scripts, tests, workflows, env templates, or generated graph output.
- Do not document invented behavior. If behavior is not confirmed by project files, mark it as "not confirmed by code" or "requires owner clarification".
- Keep root summaries and deep docs synchronized: `README.md`, `SECURITY.md`, `TESTING.md`, `CONTRIBUTING.md`, `docs/index.md`, and topic files under `docs/`.
- After documentation changes, run markdown lint/link checks when available and rebuild Graphify after substantial updates.

## repository hygiene

- Treat `AGENTS.md` as the only repository-level agent policy file; keep personal prompts, local agent state, Claude/Codex/Cursor/Gemini settings, MCP config, chat logs, and generated assistant artifacts out of Git.
- Use `AGENTS.local.md` or tool-specific local files for machine-specific instructions; these files are ignored by repository policy.
