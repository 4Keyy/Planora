# Claude Code Skills & Agents — Public Repository Research

> Prepared for the Planora tooling effort. Goal: extract proven patterns from the best public
> Claude Code skill/agent repositories and turn them into a Planora-specific production set.
>
> Format facts below were verified against the official documentation, not memory:
> - Skills: <https://code.claude.com/docs/en/skills>
> - Subagents: <https://code.claude.com/docs/en/sub-agents>
> - Hooks/settings: <https://code.claude.com/docs/en/hooks>
>
> Star counts and dates are as reported on 2026-06-16 and will drift; treat them as relative
> popularity signals, not exact figures.

---

## Verified format facts (the ground truth we build on)

**Skill** — `.claude/skills/<kebab-name>/SKILL.md`
- The **directory name** becomes the `/command` and the auto-load identity. The frontmatter `name`
  is the display label (it does *not* change the command except for a plugin-root `SKILL.md`).
- Frontmatter fields: `name`, `description` (recommended — drives auto-invocation), optional
  `when_to_use`, `allowed-tools` (space/comma/YAML-list — *grants* permission, does not restrict),
  `disallowed-tools`, `effort`, `arguments`.
- The combined `description` + `when_to_use` is **truncated at 1,536 characters** in the skill
  listing. Put the highest-value trigger first.
- Progressive disclosure: keep `SKILL.md` thin; reference `references/*.md`, `scripts/*`,
  `templates/*` from the body so Claude loads them only when needed. Use `${CLAUDE_SKILL_DIR}`
  inside bash/PowerShell snippets to locate bundled files regardless of cwd.
- Project-level `allowed-tools` only takes effect after the workspace-trust dialog is accepted.

**Subagent** — `.claude/agents/<name>.md`
- Frontmatter: `name`, `description`, `tools` (comma-separated allowlist; inherits all if omitted),
  `disallowedTools` (denylist), `model` (`sonnet` | `opus` | `haiku` | `fable` | full id | `inherit`;
  default `inherit`), `effort`, `isolation: worktree`, `initialPrompt`.
- The **description drives delegation**. Phrases like "Use PROACTIVELY" / "MUST BE USED" push Claude
  to delegate without being asked.
- Body after the frontmatter = the subagent's system prompt.

**Hooks** — `settings.json` → `"hooks"` object keyed by event (`SessionStart`, `PreToolUse`,
`PostToolUse`, `UserPromptSubmit`, `Stop`, …). Each entry has an optional `matcher` and a `hooks`
array of `{ "type": "command", "command": ..., "shell": "powershell" | "bash", ... }`.
- `SessionStart` hook **stdout is injected into context** automatically (great for "always remind").
- `command` hooks accept `shell: "powershell"` — required for first-run correctness on Windows.
- `${CLAUDE_PROJECT_DIR}` resolves to the repo root inside hook commands.
- Exit 0 = ok (stdout JSON parsed for decisions); exit 2 = blocking; other = non-blocking warning.

---

## The 10 repositories

### 1. anthropics/skills — ⭐ ~152k — actively maintained
- **Link:** <https://github.com/anthropics/skills>
- **Layout:** `skills/<name>/SKILL.md` grouped by theme (Creative & Design, Development &
  Technical, Document Skills: `docx/pdf/pptx/xlsx`), plus `spec/` (the Agent Skills spec) and
  `template/` (a starter skill).
- **Real frontmatter (the `pdf` skill, verbatim):**
  ```yaml
  ---
  name: pdf
  description: Use this skill whenever the user wants to do anything with PDF files. This includes reading or extracting text/tables from PDFs, combining or merging multiple PDFs into one, splitting PDFs apart, rotating pages, adding watermarks, creating new PDFs, filling PDF forms, encrypting/decrypting PDFs, extracting images, and OCR on scanned PDFs to make them searchable. If the user mentions a .pdf file or asks to produce one, use this skill.
  license: Proprietary. LICENSE.txt has complete terms
  ---
  ```
- **Trigger style:** one conditional opener ("Use this skill whenever the user wants to do anything
  with X") followed by an **enumerated gerund list** of concrete operations, ending with a
  filename/extension cue (".pdf"). This maximizes recall: any phrasing the user picks hits one of
  the listed verbs.
- **Strong techniques:** textbook **progressive disclosure** — the thin `SKILL.md` body carries the
  happy path; deep material lives in `REFERENCE.md` / `FORMS.md` referenced by name so Claude pulls
  them only when relevant. Executable helpers in `scripts/` keep token-heavy logic out of context.
- **3 to steal:** (1) enumerate concrete trigger verbs + a file/extension cue; (2) thin body +
  named reference files; (3) ship runnable scripts instead of inlining long procedures.
- **1 to avoid:** the document skills are deliberately generic/source-available "demos" — copying
  their broad, catch-all descriptions verbatim into a focused project would over-trigger.

### 2. anthropics/claude-code (+ official docs) — ⭐ ~132k — actively maintained
- **Link:** <https://github.com/anthropics/claude-code> · docs at <https://code.claude.com/docs>
- **Layout:** the tool itself; the docs define the canonical SKILL.md / subagent / hooks schema
  used by every other repo here. Built-in subagents (Explore, Plan, general-purpose) model the
  read-only-vs-full tool split.
- **Trigger style:** docs example — `description: Reviews code for quality and best practices` with
  `tools: Read, Glob, Grep` and `model: sonnet`; the "Use proactively" idiom is documented here.
- **Strong techniques:** least-privilege tool lists; model routing (Haiku for fast lookups, Sonnet
  for analysis, Opus for hard reasoning); `isolation: worktree` for parallel-safe agents.
- **3 to steal:** (1) restrict `tools` to the minimum a job needs; (2) route model by task cost;
  (3) keep a read-only "explore" agent separate from anything that can write.
- **1 to avoid:** the built-in agents are intentionally generic — don't reimplement them; build
  only project-specific specialists.

### 3. obra/superpowers — ⭐ ~230k (v6.0.0, Jun 2026) — actively maintained
- **Link:** <https://github.com/obra/superpowers>
- **Layout:** `skills/<name>/SKILL.md`, implementation-agnostic across Claude Code / Cursor /
  Copilot / Gemini. `skills/writing-skills/SKILL.md` is itself the spec for authoring skills.
- **Strong techniques:** a disciplined 7-phase workflow — Brainstorm → Spec → Plan (2–5 min tasks)
  → TDD (RED-GREEN-REFACTOR) → subagent-driven execution with review checkpoints → severity-based
  code review → branch finalize. Principles: "systematic over ad-hoc", "evidence over claims",
  "complexity reduction".
- **3 to steal:** (1) **TDD-first** skill bodies (write/inventory the failing test before code);
  (2) **severity-tagged review** (block vs. nit); (3) "evidence over claims" — a skill must end
  with a concrete verification command, not a vibe.
- **1 to avoid:** its heavy "fresh subagent per micro-task" model adds coordination overhead and
  context loss; for a solo project that is over-engineering. Borrow the *phases*, not the swarm.

### 4. ruvnet/claude-flow — ⭐ ~59k — actively maintained
- **Link:** <https://github.com/ruvnet/claude-flow>
- **Layout:** an orchestration platform — agents grouped by role with a coordinator that fans work
  out and reduces it back in.
- **Strong techniques:** explicit orchestration/“swarm” topology, shared memory between agents,
  role specialization.
- **3 to steal:** (1) a single coordinating entry point that delegates; (2) durable shared state
  across steps; (3) role separation (planner/worker/reviewer).
- **1 to avoid:** enterprise multi-agent orchestration is far past a single-repo's needs — the
  infra cost and indeterminism aren't worth it here.

### 5. hesreallyhim/awesome-claude-code — ⭐ ~46k — actively maintained
- **Link:** <https://github.com/hesreallyhim/awesome-claude-code>
- **Layout:** a curated index of skills, hooks, slash-commands, agent orchestrators, plugins and
  tooling, with quality/security/original-contribution standards for inclusion.
- **Strong techniques:** category taxonomy; curation bar (quality + security); pointers to
  CLAUDE.md / hooks best practice.
- **3 to steal:** (1) categorize the toolset so each item has a clear lane; (2) hold a quality bar
  (no half-built entries); (3) pair every automation with a security note.
- **1 to avoid:** it's a link farm — breadth over depth; don't mistake "listed" for "vetted for
  your stack".

### 6. wshobson/agents — ⭐ ~37k — actively maintained
- **Link:** <https://github.com/wshobson/agents>
- **Layout:** a multi-harness plugin marketplace. `plugins/<plugin>/{agents,commands,skills}/`,
  e.g. `python-development` ships `python-pro`, `django-pro`, `fastapi-pro`.
- **Real frontmatter (`python-pro`, verbatim):**
  ```yaml
  name: python-pro
  description: Master Python 3.12+ with modern features, async programming,
    performance optimization, and production-ready practices. Expert in the latest
    Python ecosystem including uv, ruff, pydantic, and FastAPI.
  model: opus
  ```
- **Trigger style:** identity + version-pinned expertise ("Python 3.12+", "uv, ruff, pydantic")
  so the agent fires on concrete tech names, not vague topics.
- **Strong techniques:** body is highly structured — numbered competency sections, **behavioral
  traits**, a **knowledge base** block, a **response-approach checklist**, and **few-shot example
  interactions**. Model is chosen per agent (`opus` for the hard specialist).
- **3 to steal:** (1) version/tool-pinned descriptions; (2) a "response approach" checklist inside
  the system prompt; (3) few-shot example interactions to lock in behavior.
- **1 to avoid:** ~50 overlapping agents create routing ambiguity — too many near-duplicate
  descriptions make Claude pick wrong. Keep the set small and non-overlapping.

### 7. VoltAgent/awesome-claude-code-subagents — ⭐ ~22k — actively maintained
- **Link:** <https://github.com/VoltAgent/awesome-claude-code-subagents>
- **Layout:** 100+ subagents in 10 numbered categories (`categories/01-core-development` …
  `10-research-analysis`), file-per-agent `python-pro.md`, `kubernetes-specialist.md`, each mapped
  to a plugin (`voltagent-lang`, `voltagent-infra`).
- **Real frontmatter shape (verbatim):**
  ```yaml
  ---
  name: subagent-name
  description: When this agent should be invoked
  tools: Read, Write, Edit, Bash, Glob, Grep
  model: sonnet
  ---
  ```
- **Trigger style:** role nouns + tech versions ("REST/GraphQL API architect", ".NET 8",
  "Vue 3 Composition API", "incident response").
- **3 to steal:** (1) numbered category taxonomy for discoverability; (2) version-specific triggers;
  (3) explicit `tools` per agent.
- **1 to avoid:** same as wshobson — sheer volume causes trigger collisions; quantity ≠ quality.

### 8. davila7/claude-code-templates — ⭐ ~28k (v1.28.3, Nov 2025) — actively maintained
- **Link:** <https://github.com/davila7/claude-code-templates>
- **Layout:** installable components — `agents/`, `commands/`, `mcps/`, `settings/`, `hooks/`,
  `skills/`, plus a browse dashboard and `npx` installer.
- **Strong techniques:** treats **settings + hooks** as first-class shippable units (pre-commit
  validation hooks, timeout/memory settings), and respects upstream licenses when aggregating.
- **3 to steal:** (1) ship `settings.json` + hooks alongside skills, not just prose; (2) pre-commit
  / pre-action validation hooks; (3) keep each component independently installable.
- **1 to avoid:** the "install 100+ components" mindset bloats a project; install only what the
  stack needs.

### 9. ComposioHQ/awesome-claude-skills — ⭐ curated collection — actively maintained
- **Link:** <https://github.com/ComposioHQ/awesome-claude-skills>
- **Layout:** 50+ skills/integrations organized by category and workflow type for comparison.
- **Strong techniques:** workflow-type grouping makes it easy to see overlap and pick one
  canonical skill per job.
- **3 to steal:** (1) one canonical skill per workflow (no clones); (2) describe skills by the
  *job-to-be-done*; (3) cross-link related skills.
- **1 to avoid:** integration-heavy skills pull in external SaaS; keep Planora skills
  self-contained to the local stack.

### 10. lst97/claude-code-sub-agents + agentskills.io spec — ⭐ growing — actively maintained
- **Link:** <https://github.com/lst97/claude-code-sub-agents> · spec: <https://agentskills.io>
- **Layout:** a full-stack personal agent set; agentskills.io is the open standard
  anthropics/skills follows.
- **Strong techniques:** end-to-end coverage (frontend/backend/db/devops) with a single coherent
  naming scheme; the spec defines the portable SKILL.md contract.
- **3 to steal:** (1) consistent `<scope>-<role>` naming; (2) conform to the open spec for
  portability; (3) one agent per architectural layer.
- **1 to avoid:** "personal use, full-stack" sets encode one person's habits — don't import opinions
  that contradict the host project's invariants.

---

## Best-of: top 15 practices to steal (and their source)

| # | Practice | Why it matters | Source repos |
|---|----------|----------------|--------------|
| 1 | Thin `SKILL.md` body + named `references/*.md` & `scripts/*` (progressive disclosure) | Long material costs ~0 tokens until needed | anthropics/skills, superpowers |
| 2 | Description = conditional opener + enumerated trigger verbs + a file/keyword cue | Maximizes auto-invocation recall across phrasings | anthropics/skills (pdf) |
| 3 | Put the highest-value trigger first (1,536-char listing cap) | Truncation can't hide the key use case | docs + anthropics/skills |
| 4 | Version/tool-pinned triggers (".NET 8", "EF Core", "RabbitMQ", "Next.js 15") | Fires on concrete tech names, not vague topics | wshobson, VoltAgent |
| 5 | Least-privilege `tools` allowlist per agent | A read-only reviewer can't accidentally write | docs, VoltAgent |
| 6 | Model routing per agent (haiku lookup / sonnet review / opus design) | Cost + latency control without losing capability | docs, wshobson |
| 7 | Read-only "explore" agent separated from anything that writes | Context isolation + safety | claude-code built-ins |
| 8 | TDD-first / evidence-over-claims: every skill ends with a real verify command | "Done" must be provable, not asserted | superpowers |
| 9 | Severity-tagged review output (BLOCK vs. nit) | Triage signal, not a wall of equal findings | superpowers |
| 10 | Structured agent body: competencies → checklist → anti-patterns → few-shot | Locks in consistent behavior | wshobson |
| 11 | Ship `settings.json` + hooks as first-class units, not just prose | Real automation > "remember to…" | davila7 |
| 12 | Pre-action / pre-commit validation hooks | Catches regressions before they land | davila7 |
| 13 | `SessionStart` hook stdout injection for "always-on" reminders | The only memory-free way to make guidance always present | docs |
| 14 | Small, non-overlapping set; one canonical item per job | Avoids trigger collisions that misroute Claude | ComposioHQ, anti-pattern of wshobson/VoltAgent |
| 15 | Category taxonomy + consistent `<scope>-<role>` naming | Discoverability and a clear lane per tool | VoltAgent, lst97 |

### Cross-cutting anti-patterns we will NOT copy
- **Agent sprawl** (50–100 near-duplicate agents) → trigger collisions and misrouting.
- **Multi-agent swarm orchestration** for a solo repo → indeterminism + overhead with no payoff.
- **Catch-all generic descriptions** → over-triggering on unrelated prompts.
- **Inlining long procedures** into the body → wastes the context budget every load.
