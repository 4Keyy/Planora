# Claude Code Agents & Skills — Repository Analysis

> Research pass executed June 2026 to extract the strongest, most reusable practices
> from the leading public Claude Code agent/skill repositories, and to ground the
> Planora-specific skill/agent set in `.claude/`. Star counts and dates are as reported
> by web search at time of research and are approximate — treat them as relative
> popularity signals, not exact figures.

## Authoritative format reference (Anthropic docs)

Before copying community patterns, the **official spec** was confirmed from
`code.claude.com/docs`:

### Skills — `.claude/skills/<name>/SKILL.md`
- Required frontmatter: `name`, `description`.
- Optional: `allowed-tools`, `disallowed-tools`, `disable-model-invocation`,
  `user-invocable`, `model`, `context`, `argument-hint`, `arguments`.
- **Auto-trigger mechanism:** Claude reads every skill's `description` and loads the
  body *only when the description matches the request* (progressive disclosure — the
  body costs nothing until used). A rich, trigger-heavy `description` is therefore the
  single most important field.
- Precedence when names collide: **enterprise > personal (`~/.claude`) > project
  (`.claude`)**. Plugin skills are namespaced `plugin-name:skill-name`.
- `disable-model-invocation: true` makes a skill manual-only (`/name`).

### Subagents — `.claude/agents/<name>.md`
- Required frontmatter: `name`, `description`. Optional: `tools` (allowlist),
  `disallowedTools` (denylist), `model`.
- **Auto-delegation mechanism:** Claude delegates when a task matches the
  `description`. Phrasing like *"Use proactively after …"* / *"MUST BE USED when …"*
  measurably increases auto-delegation.
- Identity comes only from the `name` field; duplicate names in one scope are silently
  dropped. Restricting `tools` enforces least privilege and saves context.

---

## The 10 repositories

| # | Repo | Popularity (approx) | What it is | Best idea to steal |
|---|------|--------------------|-----------|--------------------|
| 1 | [obra/superpowers](https://github.com/obra/superpowers) | ~41k★ | Composable full-SDLC skill framework | Skills as **mandatory chained workflows**, not suggestions |
| 2 | [wshobson/agents](https://github.com/wshobson/agents) | large, ~76 agents | Production subagent collection | **Per-agent model tiering** (Haiku/Sonnet/Opus by complexity) |
| 3 | [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | curated 50+ | Curated skill index | Categorize skills by **workflow stage**, not by tech |
| 4 | [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | curated 200+ | Hand-picked skill list | Description-first authoring; one skill = one job |
| 5 | [sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills) | ~1200 skills | Largest skill dump | Thin `SKILL.md` + heavy `references/` (progressive disclosure) |
| 6 | [ruvnet/claude-flow](https://github.com/ruvnet/claude-flow) | ~59k★ | Enterprise AI orchestration | Explicit **orchestration patterns**: sequential/parallel/review |
| 7 | [rahulvrane/awesome-claude-agents](https://github.com/rahulvrane/awesome-claude-agents) | curated | Subagent collection | Read-only tool allowlists for "explorer/reviewer" roles |
| 8 | [anthropics/skills](https://github.com/anthropics/skills) | official | Anthropic's reference skills | Canonical frontmatter + checklists + anti-patterns sections |
| 9 | [anthropics/claude-code](https://github.com/anthropics/claude-code) | official | The product + docs/examples | Hooks (`SessionStart`) for always-on context injection |
| 10 | [chusri/claude-code-agents](https://github.com/chusri/claude-code-agents) (mirror of wshobson) | mirror | Production subagents | Flat one-file-per-agent layout; checked into VCS |

---

## Per-repo detail

### 1. obra/superpowers — the gold standard for *workflow* skills
- **Layout:** `/skills` (one dir per skill), `/hooks` (a `SessionStart` hook auto-activates
  the framework), `/docs`, `/evals` (a behavior-eval harness — skills are *tested*).
- **Chain:** brainstorming → using-git-worktrees → writing-plans →
  subagent-driven-development → test-driven-development → requesting-code-review →
  finishing-a-development-branch.
- **Killer practices:**
  1. *"The agent checks for relevant skills before any task. Mandatory workflows, not
     suggestions."* — enforcement via hook + imperative language.
  2. Plans decomposed into **2–5 minute tasks** with exact file paths.
  3. **TDD RED-GREEN-REFACTOR** is non-negotiable: write failing test → watch it fail →
     minimal code → refactor.
  4. **Two-stage review** (spec compliance, then quality); critical issues block.
  5. A meta `writing-skills` skill encodes how to author new skills.
- **Avoid copying:** the full git-worktree-per-task ceremony — overkill for a solo repo
  and conflicts with Planora's "never create branches without instruction" rule.

### 2. wshobson/agents — production subagents
- Flat collection, one `.md` per agent; each declares role, invocation criteria, and a
  **preferred model tier**. Orchestrated sequentially / in parallel / conditionally /
  review-based.
- **Steal:** route cheap, high-volume work (test runs, exploration) to faster models;
  reserve Opus for design/review.
- **Avoid:** breadth-for-breadth's-sake (76 agents) — most teams use <6.

### 3–5. Curated lists / large dumps (Composio, VoltAgent, sickn33)
- Confirm the community consensus: **description quality drives triggering**, one skill
  should do one job, and big reference material belongs in `references/` files loaded on
  demand — never inline in the always-read index.
- **Avoid:** quantity over curation; overlapping skills that fight for the same trigger.

### 6. claude-flow — orchestration
- Names the orchestration topologies explicitly (sequential, parallel, conditional,
  review-gated). **Steal:** make orchestration a first-class, documented concept in
  `AGENTS.md`. **Avoid:** its heavyweight platform/runtime — out of scope here.

### 8–9. Anthropic official
- Canonical frontmatter; skills structured as **Purpose → Procedure → Checklist →
  Anti-patterns**. Hooks (`SessionStart`, `UserPromptSubmit`) are the *real* mechanism
  for "always do X" — preferences/memory cannot enforce automation; the harness runs
  hooks.

---

## Top 15 best practices distilled (the "best-of")

1. **Description is everything** — pack real trigger phrases (EN + RU) into every
   `description`. (Composio, VoltAgent, Anthropic)
2. **One skill = one job.** No overlapping triggers. (VoltAgent)
3. **Progressive disclosure** — thin `SKILL.md`, heavy `references/`. (sickn33, Anthropic)
4. **Skills as mandatory procedures**, enforced with imperative language + a hook. (Superpowers)
5. **Structure each skill**: Purpose → When it fires → Procedure → Checklist → Anti-patterns. (Anthropic)
6. **TDD RED-GREEN-REFACTOR** as an explicit, ordered loop. (Superpowers)
7. **Pre-commit gate** as a checklist skill (build/test/docs/secrets). (Superpowers, Anthropic)
8. **Two-stage review**: spec-compliance pass, then quality pass. (Superpowers)
9. **Least-privilege subagents** — restrict `tools` per role. (rahulvrane, Anthropic)
10. **Model tiering** — Haiku/Sonnet for volume, Opus for judgement. (wshobson)
11. **Read-only explorer subagent** to protect the main context window. (rahulvrane)
12. **Name orchestration patterns** explicitly. (claude-flow)
13. **`SessionStart` hook** to inject always-on context. (Superpowers, Anthropic)
14. **Eval/verify skills** before trusting them. (Superpowers)
15. **Check skills into VCS** so they evolve with the codebase. (wshobson) — *Planora
    caveat: `.claude/` is gitignored here, so this one is intentionally not applied.*

---

## How this maps to Planora

Planora **already has broad *knowledge* skills** at the user level (`code-auditor`,
`security-guardian`, `perf-optimizer`, `design-master`, `growth-strategist`, `graphify`).
The gap is **repo-specific, enforceable *procedures*** — exactly Superpowers' strength.
So the project-local set below is deliberately procedural and does not re-implement the
knowledge skills; instead the procedures *invoke* them at the right step.

See `.claude/skills/` (dev-workflow, pre-commit-gate, tdd-loop, ef-migration, doc-sync),
`.claude/agents/` (planora-explorer, planora-reviewer, planora-test-runner), root
`AGENTS.md`, and `.claude/settings.json` (SessionStart enforcement hook).
