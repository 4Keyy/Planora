"use client"

import { RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { AnimatePresence, LayoutGroup, animate, useReducedMotion } from "framer-motion"
import { Check, Folder, Plus, Search, X } from "lucide-react"
import { Popover } from "../popover"
import { motion } from "@/components/ui/motion"
import { NewCategoryForm, type NewCategoryDraft } from "@/components/categories/new-category-form"
import { DURATION_FAST, DURATION_UI, EASE_OUT_EXPO, SPRING_LAYOUT, SPRING_RESPONSIVE, TAP_PRESS, TWEEN_FAST } from "@/lib/animations"
import { ICON_MAP } from "@/lib/icon-map"
import { isTextEntry } from "@/lib/text-entry"
import { cn } from "@/lib/utils"
import { Category } from "@/types/category"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"

/**
 * One width for the list and the form: the popover never jumps sideways when it turns from one
 * into the other, and the form's nine-across icon grid fits it exactly.
 */
const POPOVER_WIDTH = 344
/** Tiles per row. The arrow keys move by one across and by this much up and down. */
const COLUMNS = 2
/** One visible character in any layout. Space is not one: on a tile, Space presses it. */
const PRINTABLE_KEY = /^\S$/u
/** A category without a colour of its own is drawn in the muted ink. */
const NO_COLOUR = "var(--pl-ink-muted)"

interface CategoryPopoverProps {
  open: boolean
  onClose: () => void
  value: string | null
  onChange: (id: string | null) => void
  categories: Category[]
  onCreateCategory: () => Promise<void>
  /** When provided, each category tile exposes a delete control (create panel only). */
  onDeleteCategory?: (id: string) => void | Promise<void>
  containerRef: RefObject<HTMLElement | null>
  canEdit: boolean
  /** Popover alignment under the trigger. Default "left"; the page sidebar uses "center". */
  align?: "left" | "right" | "center"
  /** Render in a viewport-fixed body portal (create panel / dashboard) so it can't stretch the page. */
  portal?: boolean
}

/** Letters only, whatever their case or accents: "cafe" finds "Café". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/**
 * Where a query sits in a name: a name that starts with it first, then one with a word that does,
 * then one that holds it anywhere. `null` when it is not there at all.
 */
function matchOf(name: string, query: string): { rank: number; start: number } | null {
  if (!query) return { rank: 0, start: -1 }
  const folded = fold(name)
  const start = folded.indexOf(query)
  if (start < 0) return null
  if (start === 0) return { rank: 0, start }
  const word = folded.search(new RegExp(`(^|[^\\p{L}\\p{N}])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u"))
  return word >= 0 ? { rank: 1, start: word === 0 ? 0 : word + 1 } : { rank: 2, start }
}

/** The name with the part the query found drawn in ink and underlined in the category's colour. */
function Highlighted({ name, start, length }: { name: string; start: number; length: number }) {
  if (start < 0 || length === 0) return <>{name}</>
  return (
    <>
      {name.slice(0, start)}
      <mark className="bg-transparent text-ink underline decoration-[var(--cat)] decoration-2 underline-offset-[3px]">
        {name.slice(start, start + length)}
      </mark>
      {name.slice(start + length)}
    </>
  )
}

/**
 * A block whose height follows what it holds on the layout spring, so the sheet narrows and
 * grows with the search instead of snapping a row at a time. Measured by its own observer;
 * the first height, and every height under reduced motion, is taken at once.
 */
function GlidingHeight({ children, reduce }: { children: ReactNode; reduce: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const box = outer.current
    const node = inner.current
    if (!box || !node || typeof ResizeObserver === "undefined") return
    let current: number | null = null
    let glide: ReturnType<typeof animate> | null = null
    const ro = new ResizeObserver(() => {
      const next = node.offsetHeight
      if (current === null || reduce) {
        glide?.stop()
        current = next
        box.style.height = `${next}px`
        return
      }
      if (Math.abs(current - next) < 0.5) return
      glide?.stop()
      glide = animate(current, next, {
        ...SPRING_LAYOUT,
        onUpdate: (h) => {
          current = h
          box.style.height = `${h}px`
        },
      })
    })
    ro.observe(node)
    return () => {
      ro.disconnect()
      glide?.stop()
    }
  }, [reduce])
  return (
    <div ref={outer} className="overflow-hidden">
      <div ref={inner}>{children}</div>
    </div>
  )
}

/**
 * The category picker — wherever a task picks its category: the New task panel, the task
 * editor's token strip and a task's own page.
 *
 * Categories are tiles, two to a row, each washed in its own colour: the icon on a tinted
 * square, the name beside it. Pointing at one lifts its icon and warms the tile in its colour
 * (the glow a task card has on hover); the chosen one carries a ring and a check in its colour,
 * and the ring glides to a new choice rather than blinking across. Nothing lights up by itself
 * when the sheet opens; from then on:
 *
 * - **Typing finds.** The first printable key goes to the search field from anywhere in the
 *   sheet; names that start with the query come first, then a word inside a name, then any
 *   match, with the part that matched underlined. Accents and case do not matter.
 * - **The keyboard picks.** Arrows walk the grid, Enter takes the tile under the cursor —
 *   or, from the search field, the best match.
 * - **A name that is not there can be made at once.** No match offers "Create “name”", which
 *   opens the compact form with the name already in it; Enter does the same.
 *
 * Escape clears a search first and closes the sheet on the next press. Deleting (the New task
 * panel only), creating, and choosing "No category" work as they always have.
 */
export function CategoryPopover({
  open, onClose, value, onChange, categories, onCreateCategory, onDeleteCategory, containerRef, canEdit, align = "left", portal,
}: CategoryPopoverProps) {
  const reduce = useReducedMotion() ?? false
  const haloGroup = useId()
  const listId = useId()
  const [creating,  setCreating]  = useState(false)
  const [draftName, setDraftName] = useState("")
  const [localCats, setLocalCats] = useState<Category[]>(categories)
  const [query, setQuery] = useState("")
  const [wasOpen, setWasOpen] = useState(open)
  const searchRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  if (localCats !== categories && !creating) setLocalCats(categories)
  // Every opening starts from the whole list. Reset as it opens, not as it closes: the sheet
  // stays on screen while it folds away, and must not change under the fold.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setQuery("")
  }

  const folded = fold(query.trim())
  const found = useMemo(() => {
    if (!folded) return localCats.map((cat) => ({ cat, start: -1 }))
    return localCats
      .map((cat, index) => ({ cat, index, match: matchOf(cat.name, folded) }))
      .filter((entry): entry is { cat: Category; index: number; match: { rank: number; start: number } } => entry.match !== null)
      .sort((a, b) => a.match.rank - b.match.rank || a.index - b.index)
      .map(({ cat, match }) => ({ cat, start: match.start }))
  }, [localCats, folded])
  // "No category" is a choice, not a name: it stays out of a search.
  const showNone = !folded

  const selectCategory = (id: string | null) => { onChange(id); onClose() }

  const startCreating = (name = "") => {
    setDraftName(name.trim())
    setCreating(true)
  }

  const createCategory = async ({ name, color, icon }: NewCategoryDraft) => {
    const res = await api.post<ApiResponse<Category>>("/categories/api/v1/categories", {
      name,
      color,
      icon,
      displayOrder: 0,
    })
    const newCat = parseApiResponse<Category>(res.data)
    setLocalCats((prev) => [...prev, newCat])
    onChange(newCat.id)
    setCreating(false)
    await onCreateCategory()
    onClose()
  }

  /* The tiles in grid order, for the arrow keys. */
  const tiles = () => Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-category-tile]") ?? [])

  /*
   * Keys, while the list is on screen. Capture phase on the window, as the create form's
   * type-to-focus does: the sheet opens with the focus still on its trigger, the page under it
   * has its own keys (the task list walks cards on the arrows, `C` opens New task), and a key
   * meant for the sheet must not reach them.
   */
  useEffect(() => {
    if (!open || creating) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const active = document.activeElement
      const inSearch = active === searchRef.current
      const all = tiles()
      const at = all.indexOf(active as HTMLButtonElement)

      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        // In the search field the caret keeps left and right; down (or up) steps into the grid.
        if (inSearch && event.key !== "ArrowDown") return
        if (all.length === 0) return
        // Only while the sheet has the keyboard: the focus inside it, or on the trigger.
        const owns = at >= 0 || inSearch || !!(active && containerRef.current?.contains(active))
        if (!owns) return
        event.preventDefault()
        event.stopPropagation()
        const step = event.key === "ArrowDown" ? COLUMNS : event.key === "ArrowUp" ? -COLUMNS : event.key === "ArrowRight" ? 1 : -1
        if (at < 0) {
          all[event.key === "ArrowUp" ? all.length - 1 : 0]?.focus()
          return
        }
        const next = at + step
        if (next < 0 && event.key === "ArrowUp") { searchRef.current?.focus(); return }
        all[Math.min(Math.max(next, 0), all.length - 1)]?.focus()
        return
      }

      if (!PRINTABLE_KEY.test(event.key)) return
      if ((event.ctrlKey || event.metaKey || event.altKey) && !event.getModifierState("AltGraph")) return
      if (inSearch || isTextEntry(active)) return
      // Type-to-find: the key lands in the search field, and only there.
      searchRef.current?.focus({ preventScroll: true })
      event.stopPropagation()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [open, creating, containerRef])

  /*
   * Escape on a search with something in it clears the search and keeps the sheet. A native
   * listener on the field itself, so it runs — and stops the key — before the popover's own
   * Escape on the document.
   */
  useEffect(() => {
    const field = searchRef.current
    if (!field) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !field.value) return
      event.stopPropagation()
      setQuery("")
    }
    field.addEventListener("keydown", onKeyDown)
    return () => field.removeEventListener("keydown", onKeyDown)
  })

  /*
   * The list and the form slide past each other: the form comes in from the right as the list
   * leaves to the left, and back. The popover's own size follows on its open/close motion only;
   * between the two faces it keeps one width, so nothing jumps sideways.
   */
  const face = (direction: 1 | -1) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, x: 16 * direction },
    animate: { opacity: 1, x: 0, transition: reduce ? { duration: 0 } : { duration: DURATION_UI, ease: EASE_OUT_EXPO } },
    exit: reduce ? { opacity: 0 } : { opacity: 0, x: -16 * direction, transition: { duration: DURATION_FAST } },
  })

  /* A tile coming in or going out of a search: it fades and settles where it lands. */
  const tileMotion = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94 },
    animate: { opacity: 1, scale: 1 },
    exit: reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.94, transition: TWEEN_FAST },
    transition: reduce ? { duration: 0 } : SPRING_RESPONSIVE,
    layout: reduce ? false : ("position" as const),
  }

  const total = localCats.length
  const noMatch = !!folded && found.length === 0

  return (
    <Popover open={open} onClose={onClose} width={POPOVER_WIDTH} align={align} containerRef={containerRef} portal={portal}>
      <AnimatePresence initial={false} mode="popLayout">
      {creating ? (
        /* ── CREATE PANEL ── */
        <motion.div key="create" {...face(1)}>
          <NewCategoryForm initialName={draftName} onCreate={createCategory} onBack={() => setCreating(false)} />
        </motion.div>
      ) : (
        /* ── CATEGORY GRID ── */
        <motion.div key="list" {...face(-1)}>
          {/* Header: the label, and the search — a field shell, never a grey box. */}
          <div className="flex h-12 items-center gap-3 border-b border-gray-100 pl-3.5 pr-2">
            <span className="text-caption font-bold uppercase tracking-[0.05em] text-ink-subtle">Category</span>
            {total > 0 && (
              <label className="field-shell ml-auto flex h-8 min-w-0 max-w-[11.5rem] flex-1 cursor-text items-center gap-1.5 rounded-full border border-transparent bg-paper-sunken pl-2.5 pr-1">
                <Search className="h-3.5 w-3.5 flex-shrink-0 text-ink-subtle" strokeWidth={2.4} aria-hidden="true" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return
                    if (!folded) return
                    event.preventDefault()
                    const best = found[0]?.cat
                    if (best) selectCategory(best.id)
                    else if (canEdit) startCreating(query)
                  }}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={50}
                  placeholder={`Find in ${total}`}
                  aria-label="Find a category"
                  aria-controls={listId}
                  className="field-naked min-w-0 flex-1 border-none bg-transparent p-0 text-caption font-semibold text-ink placeholder:font-semibold placeholder:text-ink-subtle [&::-webkit-search-cancel-button]:hidden"
                />
                <AnimatePresence initial={false}>
                  {query && (
                    <motion.button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => { setQuery(""); searchRef.current?.focus() }}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={reduce ? { duration: 0 } : SPRING_RESPONSIVE}
                      className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full text-ink-subtle transition-colors duration-fast hover:bg-ink/5 hover:text-ink"
                    >
                      <X className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
                    </motion.button>
                  )}
                </AnimatePresence>
              </label>
            )}
          </div>

          <GlidingHeight reduce={reduce}>
            {noMatch ? (
              /* ── Nothing by that name: make it ── */
              <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
                <p className="max-w-full truncate text-body-sm font-bold text-ink">No “{query.trim()}” yet</p>
                {canEdit ? (
                  <>
                    <motion.button
                      type="button"
                      whileTap={TAP_PRESS}
                      onClick={() => startCreating(query)}
                      className="mt-3 inline-flex h-9 max-w-full items-center gap-1.5 rounded-full bg-ink px-4 text-caption font-bold text-paper shadow-md shadow-black/15 transition-opacity duration-fast hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2.6} aria-hidden="true" />
                      <span className="truncate">Create “{query.trim()}”</span>
                    </motion.button>
                    <p className="mt-2 text-caption text-ink-subtle">or press Enter</p>
                  </>
                ) : (
                  <p className="mt-1 text-caption text-ink-muted">Try another name.</p>
                )}
              </div>
            ) : total === 0 ? (
              /* ── No categories at all ── */
              <div className="px-5 pb-4 pt-5 text-center">
                <p className="text-body-sm font-bold text-ink">No categories yet</p>
                <p className="mt-1 text-caption text-ink-muted">Group tasks by area — work, home, travel.</p>
              </div>
            ) : null}

            {!noMatch && (
              <LayoutGroup id={haloGroup}>
                <div
                  ref={gridRef}
                  id={listId}
                  role="group"
                  aria-label="Categories"
                  data-cascade
                  // pb-3: the rows drift 4px on the way in and must drift inside their own box, and the last
                  // row's coloured glow needs the room below it. `relative`: popLayout pins a leaving tile.
                  className="relative grid max-h-[18.5rem] grid-cols-2 gap-1.5 overflow-y-auto overflow-x-hidden overscroll-contain px-2 pb-3 pt-2"
                >
                  <AnimatePresence initial={false} mode="popLayout">
                    {found.map(({ cat, start }) => (
                      <motion.div key={cat.id} {...tileMotion} className="group/tile relative">
                        <CategoryTile
                          name={cat.name}
                          color={cat.color?.trim() || NO_COLOUR}
                          icon={(cat.icon && ICON_MAP[cat.icon]) || Folder}
                          selected={value === cat.id}
                          haloId={haloGroup}
                          reduce={reduce}
                          onSelect={() => selectCategory(cat.id)}
                          label={<Highlighted name={cat.name} start={start} length={folded.length} />}
                        />
                        {/* Sibling (not nested) delete control — a button inside a button is invalid HTML. */}
                        {onDeleteCategory && (
                          <button
                            type="button"
                            aria-label={`Delete ${cat.name}`}
                            onClick={(e) => { e.stopPropagation(); void onDeleteCategory(cat.id) }}
                            className="absolute -right-1 -top-1 z-10 grid h-5 w-5 place-items-center rounded-full border border-line bg-paper text-ink-subtle opacity-0 shadow-sm transition-[opacity,color,background-color,border-color] duration-fast hover:border-alert/40 hover:bg-alert-surface hover:text-alert focus-visible:opacity-100 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100"
                          >
                            <X className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                          </button>
                        )}
                      </motion.div>
                    ))}
                    {showNone && (
                      <motion.div key="__none" {...tileMotion} className="group/tile relative">
                        <CategoryTile
                          name="No category"
                          color={NO_COLOUR}
                          selected={value === null}
                          haloId={haloGroup}
                          reduce={reduce}
                          onSelect={() => selectCategory(null)}
                          label="No category"
                          none
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </LayoutGroup>
            )}
          </GlidingHeight>

          {canEdit && !noMatch && (
            <div className="border-t border-line p-1.5">
              <motion.button
                type="button"
                whileTap={TAP_PRESS}
                onClick={() => startCreating(folded ? query : "")}
                className="flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors duration-fast hover:bg-accent-surface/60"
              >
                <span aria-hidden="true" className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-accent-surface text-accent">
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
                </span>
                <span className="text-caption font-bold text-accent">Create new category</span>
              </motion.button>
            </div>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </Popover>
  )
}

interface CategoryTileProps {
  name: string
  label: ReactNode
  color: string
  icon?: typeof Folder
  selected: boolean
  /** The ring is one element per sheet, so it travels from the old choice to the new one. */
  haloId: string
  reduce: boolean
  onSelect: () => void
  /** "No category": a dashed, empty square instead of a coloured icon. */
  none?: boolean
}

/**
 * One category: its icon on a square washed in its colour, and its name. The colour reaches the
 * tile itself only when it matters — warm under the pointer or the keyboard, ringed and checked
 * when chosen — so a sheet of a dozen colours stays calm until one is pointed at.
 */
function CategoryTile({ name, label, color, icon: Glyph, selected, haloId, reduce, onSelect, none }: CategoryTileProps) {
  return (
    <motion.button
      type="button"
      data-category-tile=""
      aria-pressed={selected}
      title={name.length > 16 ? name : undefined}
      whileTap={TAP_PRESS}
      onClick={onSelect}
      style={{ "--cat": color } as CSSProperties}
      className={cn(
        "relative isolate flex h-12 w-full items-center gap-2.5 rounded-[10px] pl-2 pr-2 text-left outline-none",
        "transition-[background-color,box-shadow] duration-fast",
        "hover:bg-[color-mix(in_srgb,var(--cat)_7%,transparent)] hover:shadow-[0_6px_16px_-10px_color-mix(in_srgb,var(--cat)_60%,transparent)]",
        "focus-visible:bg-[color-mix(in_srgb,var(--cat)_7%,transparent)] focus-visible:shadow-[inset_0_0_0_2px_theme(colors.ink)]",
      )}
    >
      {selected && (
        <motion.span
          layoutId={`category-halo-${haloId}`}
          aria-hidden="true"
          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
          className={cn(
            "absolute inset-0 -z-10 rounded-[10px]",
            none
              ? "bg-paper-sunken"
              : "bg-[color-mix(in_srgb,var(--cat)_11%,var(--pl-paper))] shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--cat)_45%,transparent)]",
          )}
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          "relative grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg transition-transform duration-fast ease-emphasized group-hover/tile:-translate-y-px group-hover/tile:scale-[1.06]",
          none ? "border-[1.5px] border-dashed border-line-strong" : "bg-[color-mix(in_srgb,var(--cat)_14%,var(--pl-paper))] text-[var(--cat)]",
        )}
      >
        {Glyph && <Glyph className="h-4 w-4" strokeWidth={2.2} />}
        {/* The check sits on the icon's corner, as a status sits on an avatar: the name keeps
            the tile's whole width. A 2px paper ring cuts it out of the square under it. */}
        <AnimatePresence initial={false}>
          {selected && (
            <motion.span
              key="check"
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.3 }}
              transition={reduce ? { duration: 0 } : SPRING_RESPONSIVE}
              className={cn(
                "absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full text-paper ring-2 ring-paper",
                none ? "bg-ink" : "bg-[var(--cat)]",
              )}
            >
              <Check className="h-2.5 w-2.5" strokeWidth={3.6} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-body-sm font-bold tracking-tight", none ? "text-ink-muted" : "text-ink")}>
        {label}
      </span>
    </motion.button>
  )
}
