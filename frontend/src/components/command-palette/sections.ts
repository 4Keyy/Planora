import {
  CheckCircle2,
  FolderOpen,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  Plus,
  User,
  type LucideIcon,
} from "lucide-react"
import {
  byUrgency,
  fold,
  fuzzyMatch,
  matchTask,
  SMART_VIEWS,
  type PaletteTask,
  type ParsedQuery,
  type SmartView,
  type ViewId,
} from "./search"
import type { RecentEntry } from "./recent"

/**
 * Turns the loaded data and the query into the palette's sections. Pure, so the
 * ranking rules — which group comes first, how many rows each gets, when the
 * "Create task" row appears — are tested without rendering anything.
 */

// ─── Model ──────────────────────────────────────────────────────────────────

export type Tab = "all" | "tasks" | "categories" | "people" | "commands"

export const TABS: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All" },
  { id: "tasks", label: "Tasks" },
  { id: "categories", label: "Categories" },
  { id: "people", label: "People" },
  { id: "commands", label: "Commands" },
]

export type Scope =
  | { kind: "category"; id: string; label: string; color: string | null; icon: string | null }
  | { kind: "person"; id: string; label: string; avatar: string | null }
  | { kind: "view"; id: ViewId; label: string }

export type PaletteAction =
  | { type: "open-task"; taskId: string }
  | { type: "navigate"; href: string; screen: string }
  | { type: "scope"; scope: Scope }
  | { type: "capture"; title?: string }
  | { type: "shortcuts" }

export interface PaletteCategory {
  id: string
  name: string
  description: string | null
  color: string | null
  icon: string | null
  /** Open tasks in it. */
  open: number
}

export interface PalettePerson {
  id: string
  name: string
  email: string | null
  avatar: string | null
  /** Open tasks the two of you share, either way round. */
  shared: number
}

export type ItemKind = "task" | "category" | "person" | "view" | "screen" | "action" | "create"

export interface PaletteItem {
  /** Unique across the whole list: also the option's DOM id suffix. */
  key: string
  kind: ItemKind
  label: string
  hint?: string
  icon?: LucideIcon
  shortcut?: string
  /** Positions in `label` to highlight. */
  indices?: number[]
  task?: PaletteTask
  category?: PaletteCategory
  person?: PalettePerson
  view?: SmartView & { count: number }
  action: PaletteAction
}

export interface PaletteSection {
  id: string
  title: string
  items: PaletteItem[]
  /** How many matched, when the section shows only the best of them. */
  total?: number
}

// ─── Static entries ─────────────────────────────────────────────────────────

interface StaticEntry {
  id: string
  label: string
  hint?: string
  icon: LucideIcon
  shortcut?: string
  action: PaletteAction
}

export const SCREENS: StaticEntry[] = [
  { id: "dashboard", label: "Dashboard", hint: "Today at a glance", icon: LayoutDashboard, action: { type: "navigate", href: "/dashboard", screen: "dashboard" } },
  { id: "tasks", label: "Tasks", hint: "Everything active", icon: ListTodo, action: { type: "navigate", href: "/tasks", screen: "tasks" } },
  { id: "completed", label: "Completed tasks", hint: "The archive", icon: CheckCircle2, action: { type: "navigate", href: "/tasks/completed", screen: "completed" } },
  { id: "categories", label: "Categories", hint: "Colours and icons for your tasks", icon: FolderOpen, action: { type: "navigate", href: "/categories", screen: "categories" } },
  { id: "profile", label: "Profile", hint: "Account, security, friends", icon: User, action: { type: "navigate", href: "/profile", screen: "profile" } },
]

export const ACTIONS: StaticEntry[] = [
  /**
   * One creation entry, and it is the same thing `C` does: quick capture, which
   * asks for a title and nothing else. The heavy composer keeps no entry — its
   * collapsed header is permanently on screen on both routes that have it.
   */
  { id: "capture", label: "Capture a task", hint: "Just a title — details come later", icon: Plus, shortcut: "C", action: { type: "capture" } },
  { id: "shortcuts", label: "Keyboard shortcuts", hint: "Every key the product answers to", icon: Keyboard, shortcut: "?", action: { type: "shortcuts" } },
]

const fromStatic = (kind: "screen" | "action", entry: StaticEntry, indices?: number[]): PaletteItem => ({
  key: `${kind}:${entry.id}`,
  kind,
  label: entry.label,
  hint: entry.hint,
  icon: entry.icon,
  shortcut: entry.shortcut,
  indices,
  action: entry.action,
})

// ─── Builders ───────────────────────────────────────────────────────────────

const taskItem = (task: PaletteTask, indices?: number[]): PaletteItem => ({
  key: `task:${task.id}`,
  kind: "task",
  label: task.title,
  indices,
  task,
  action: { type: "open-task", taskId: task.id },
})

const categoryItem = (category: PaletteCategory, indices?: number[]): PaletteItem => ({
  key: `category:${category.id}`,
  kind: "category",
  label: category.name,
  indices,
  category,
  action: { type: "scope", scope: { kind: "category", id: category.id, label: category.name, color: category.color, icon: category.icon } },
})

const personItem = (person: PalettePerson, indices?: number[]): PaletteItem => ({
  key: `person:${person.id}`,
  kind: "person",
  label: person.name,
  indices,
  person,
  action: { type: "scope", scope: { kind: "person", id: person.id, label: person.name, avatar: person.avatar } },
})

const viewItem = (view: SmartView & { count: number }, indices?: number[]): PaletteItem => ({
  key: `view:${view.id}`,
  kind: "view",
  label: view.label,
  hint: view.hint,
  indices,
  view,
  action: { type: "scope", scope: { kind: "view", id: view.id, label: view.label } },
})

/** Finished most recently first. */
const byCompletion = (a: PaletteTask, b: PaletteTask) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")

/** Whether `task` belongs to the scope the palette is narrowed to. */
export function inScope(task: PaletteTask, scope: Scope, now: Date): boolean {
  if (scope.kind === "category") return task.categoryId === scope.id
  if (scope.kind === "person") {
    return task.ownerId === scope.id || task.sharedWith.includes(scope.id) || task.workers.some((w) => w.id === scope.id)
  }
  const view = SMART_VIEWS.find((v) => v.id === scope.id)
  return view ? view.test(task, now) : false
}

export interface BuildInput {
  query: ParsedQuery
  tab: Tab
  scope: Scope | null
  tasks: PaletteTask[]
  categories: PaletteCategory[]
  people: PalettePerson[]
  recent: RecentEntry[]
  now: Date
}

const LIMITS_ALL = { tasks: 6, categories: 3, people: 3, commands: 4 }
const LIMIT_ONE = 50

/** Views with their counts over the open tasks — the chips over an empty query. */
export function countViews(tasks: PaletteTask[], now: Date): Array<SmartView & { count: number }> {
  return SMART_VIEWS.map((view) => ({ ...view, count: tasks.filter((t) => view.test(t, now)).length }))
}

function createSection(text: string): PaletteSection {
  return {
    id: "create",
    title: "Create",
    items: [{
      key: "create",
      kind: "create",
      label: `Create task “${text}”`,
      hint: "Opens quick capture with this title",
      icon: Plus,
      action: { type: "capture", title: text },
    }],
  }
}

function buildScoped(input: BuildInput, scope: Scope): PaletteSection[] {
  const { tasks, query, now } = input
  const scoped = tasks.filter((t) => inScope(t, scope, now))

  if (query.tokens.length > 0) {
    const ranked = scoped
      .map((task) => ({ task, match: matchTask(task, query.tokens) }))
      .filter((x): x is { task: PaletteTask; match: NonNullable<typeof x.match> } => x.match !== null)
      .sort((a, b) => a.match.score - b.match.score)
      .map((x) => taskItem(x.task, x.match.indices))
    const sections: PaletteSection[] = ranked.length ? [{ id: "scoped", title: "Tasks", items: ranked }] : []
    return [...sections, createSection(query.text)]
  }

  const open = scoped.filter((t) => !t.completed).sort(byUrgency).map((t) => taskItem(t))
  const done = scoped.filter((t) => t.completed).sort(byCompletion).map((t) => taskItem(t))
  return [
    ...(open.length ? [{ id: "scoped-open", title: "Open", items: open }] : []),
    ...(done.length ? [{ id: "scoped-done", title: "Done", items: done }] : []),
  ]
}

function buildHome(input: BuildInput): PaletteSection[] {
  const { tab, tasks, categories, people, recent, now } = input
  const open = tasks.filter((t) => !t.completed).sort(byUrgency)

  if (tab === "tasks") {
    const done = tasks.filter((t) => t.completed).sort(byCompletion).slice(0, 20)
    return [
      ...(open.length ? [{ id: "open", title: "Open", items: open.slice(0, LIMIT_ONE).map((t) => taskItem(t)) }] : []),
      ...(done.length ? [{ id: "done", title: "Recently done", items: done.map((t) => taskItem(t)) }] : []),
    ]
  }
  if (tab === "categories") {
    return categories.length ? [{ id: "categories", title: "Categories", items: categories.map((c) => categoryItem(c)) }] : []
  }
  if (tab === "people") {
    return people.length ? [{ id: "people", title: "People", items: people.map((p) => personItem(p)) }] : []
  }
  if (tab === "commands") {
    return [
      { id: "views", title: "Views", items: countViews(tasks, now).map((v) => viewItem(v)) },
      { id: "actions", title: "Actions", items: ACTIONS.map((a) => fromStatic("action", a)) },
      { id: "screens", title: "Go to", items: SCREENS.map((s) => fromStatic("screen", s)) },
    ]
  }

  // "All" with nothing typed: where you were, what is next, what you can do.
  const recentItems: PaletteItem[] = []
  for (const entry of recent) {
    if (entry.kind === "task") {
      const task = tasks.find((t) => t.id === entry.id)
      if (task) recentItems.push(taskItem(task))
    } else if (entry.kind === "screen") {
      const screen = SCREENS.find((s) => s.id === entry.id)
      if (screen) recentItems.push(fromStatic("screen", screen))
    } else if (entry.kind === "category") {
      const category = categories.find((c) => c.id === entry.id)
      if (category) recentItems.push(categoryItem(category))
    } else {
      const person = people.find((p) => p.id === entry.id)
      if (person) recentItems.push(personItem(person))
    }
    if (recentItems.length === 4) break
  }
  const recentKeys = new Set(recentItems.map((i) => i.key))
  const upNext = open.filter((t) => !recentKeys.has(`task:${t.id}`)).slice(0, 5).map((t) => taskItem(t))

  return [
    ...(recentItems.length ? [{ id: "recent", title: "Recent", items: recentItems }] : []),
    ...(upNext.length ? [{ id: "next", title: "Up next", items: upNext }] : []),
    { id: "actions", title: "Actions", items: ACTIONS.map((a) => fromStatic("action", a)) },
    { id: "screens", title: "Go to", items: SCREENS.map((s) => fromStatic("screen", s)) },
  ]
}

type Scored = { item: PaletteItem; score: number }

/** Every token must match `label`; the scores add up and the matched letters are kept. */
function matchLabel(label: string, tokens: string[]): { score: number; indices: number[] } | null {
  let score = 0
  const indices: number[] = []
  for (const token of tokens) {
    const m = fuzzyMatch(label, token)
    if (!m) return null
    score += m.score
    indices.push(...m.indices)
  }
  return { score, indices }
}

/**
 * A command matches by its label, fuzzily, or by its hint — but only as whole
 * fragments there: a sentence holds almost any scattered letters, and "trav" must
 * not find "Tasks" through the v of "Everything active".
 */
function matchCommand(label: string, hint: string | undefined, tokens: string[]) {
  const byLabel = matchLabel(label, tokens)
  if (byLabel) return byLabel
  const text = fold(`${label} ${hint ?? ""}`)
  return tokens.every((token) => text.includes(fold(token))) ? { score: 25, indices: [] } : null
}

const byScore = (a: Scored, b: Scored) => a.score - b.score

function scoreTasks(tasks: PaletteTask[], tokens: string[]): Scored[] {
  const scored: Scored[] = []
  for (const task of tasks) {
    const match = matchTask(task, tokens)
    if (match) scored.push({ item: taskItem(task, match.indices), score: match.score })
  }
  return scored.sort(byScore)
}

function scoreCategories(categories: PaletteCategory[], tokens: string[]): Scored[] {
  const scored: Scored[] = []
  for (const category of categories) {
    const m = matchLabel(category.name, tokens)
    if (m) scored.push({ item: categoryItem(category, m.indices), score: m.score })
  }
  return scored.sort(byScore)
}

function scorePeople(people: PalettePerson[], tokens: string[]): Scored[] {
  const scored: Scored[] = []
  for (const person of people) {
    const m = matchLabel(person.name, tokens)
    if (m) scored.push({ item: personItem(person, m.indices), score: m.score })
    else if (person.email && tokens.every((t) => person.email!.toLowerCase().includes(t.toLowerCase()))) {
      scored.push({ item: personItem(person), score: 30 })
    }
  }
  return scored.sort(byScore)
}

function scoreCommands(tasks: PaletteTask[], tokens: string[], now: Date): Scored[] {
  const scored: Scored[] = []
  for (const view of countViews(tasks, now)) {
    const m = matchCommand(view.label, view.hint, tokens)
    if (m) scored.push({ item: viewItem(view, m.indices), score: m.score })
  }
  for (const action of ACTIONS) {
    const m = matchCommand(action.label, action.hint, tokens)
    if (m) scored.push({ item: fromStatic("action", action, m.indices), score: m.score })
  }
  for (const screen of SCREENS) {
    const m = matchCommand(screen.label, screen.hint, tokens)
    if (m) scored.push({ item: fromStatic("screen", screen, m.indices), score: m.score })
  }
  return scored.sort(byScore)
}

export type MatchCounts = Record<Exclude<Tab, "all">, number>

/**
 * How many results each tab holds for the query — the numbers on the tabs, so the
 * reader sees where the matches are before switching. Null with nothing typed.
 */
export function countMatches(input: Pick<BuildInput, "query" | "tasks" | "categories" | "people" | "now">): MatchCounts | null {
  const { query, tasks, categories, people, now } = input
  if (query.tokens.length === 0) return null
  return {
    tasks: scoreTasks(tasks, query.tokens).length,
    categories: scoreCategories(categories, query.tokens).length,
    people: scorePeople(people, query.tokens).length,
    commands: scoreCommands(tasks, query.tokens, now).length,
  }
}

/** Which tab a search section's "Show all" opens. */
export const SECTION_TAB: Record<string, Exclude<Tab, "all">> = {
  tasks: "tasks",
  categories: "categories",
  people: "people",
  commands: "commands",
}

export function buildSections(input: BuildInput): PaletteSection[] {
  const { query, scope, tasks, categories, people, now } = input
  if (scope) return buildScoped(input, scope)
  if (query.tokens.length === 0 && !query.narrow) return buildHome(input)

  const tab: Tab = query.narrow ?? input.tab
  if (query.tokens.length === 0) return buildHome({ ...input, tab })

  const one = tab !== "all"
  const ranked: Array<{ section: PaletteSection; best: number; order: number }> = []
  const add = (id: keyof typeof LIMITS_ALL, title: string, order: number, scored: Scored[]) => {
    if (scored.length === 0) return
    const items = scored.slice(0, one ? LIMIT_ONE : LIMITS_ALL[id]).map((x) => x.item)
    ranked.push({ section: { id, title, items, total: scored.length }, best: scored[0].score, order })
  }

  if (tab === "all" || tab === "tasks") add("tasks", "Tasks", 0, scoreTasks(tasks, query.tokens))
  if (tab === "all" || tab === "categories") add("categories", "Categories", 1, scoreCategories(categories, query.tokens))
  if (tab === "all" || tab === "people") add("people", "People", 2, scorePeople(people, query.tokens))
  if (tab === "all" || tab === "commands") add("commands", "Commands", 3, scoreCommands(tasks, query.tokens, now))

  // The group holding the single best match comes first, so Enter on a fresh
  // query always lands on the obvious result, whatever kind it is.
  ranked.sort((a, b) => a.best - b.best || a.order - b.order)
  const sections = ranked.map((r) => r.section)
  if (!query.narrow && (tab === "all" || tab === "tasks")) sections.push(createSection(query.text))
  return sections
}

/** Every selectable row, in display order. */
export function flatten(sections: PaletteSection[]): PaletteItem[] {
  return sections.flatMap((s) => s.items)
}
