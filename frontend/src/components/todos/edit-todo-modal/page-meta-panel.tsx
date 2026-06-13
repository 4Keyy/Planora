"use client"

import { useRef, type RefObject, type ReactNode } from "react"
import { Calendar, Globe2, Lock, ChevronDown } from "lucide-react"
import { PriorityPopover }   from "./popovers/priority"
import { DateCalendar }      from "./popovers/date"
import { CategoryPopover }   from "./popovers/category"
import { VisibilityPopover } from "./popovers/visibility"
import { ICON_MAP }          from "@/lib/icon-map"
import { Category }          from "@/types/category"
import { FriendDto }         from "@/types/auth"
import {
  getPriorityColor,
  getPriorityLabel,
  formatDatePretty,
  formatRelativeRu,
} from "./utils"

type OpenPopover = "priority" | "date" | "category" | "visibility" | null

interface PageMetaPanelProps {
  priority: string
  onPriorityChange: (v: string) => void
  dueDate: string
  onDueDateChange: (v: string | null) => void
  categoryId: string | null
  onCategoryChange: (v: string | null) => void
  categories: Category[]
  onCreateCategory: () => Promise<void>
  canEditCategory: boolean
  authorCategoryName?: string | null
  authorCategoryColor?: string | null
  authorCategoryIcon?: string | null
  isOwner: boolean
  visMode: "private" | "friends"
  onVisModeChange: (v: "private" | "friends") => void
  sharedIds: string[]
  onSharedIdsChange: (ids: string[]) => void
  friends: FriendDto[]
  openPopover: OpenPopover
  setOpenPopover: (v: OpenPopover) => void
}

/** Small uppercase section label. */
function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7, paddingLeft: 2 }}>
      <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: "#a3a3a3" }}>
        {children}
      </span>
      {action}
    </div>
  )
}

interface MetaButtonProps {
  onClick: () => void
  isOpen: boolean
  muted?: boolean
  label: ReactNode
  popover?: ReactNode
  containerRef: RefObject<HTMLDivElement | null>
}

/** A full-width row button (the vertical-panel cousin of the modal's InlineToken). */
function MetaButton({ onClick, isOpen, muted, label, popover, containerRef }: MetaButtonProps) {
  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-disabled={muted || undefined}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "9px 11px", borderRadius: 12,
          border: `1px solid ${isOpen ? "#e5e5e5" : "#f0f0f0"}`,
          cursor: muted ? "default" : "pointer",
          background: isOpen ? "#fafafa" : "white",
          color: "#262626", textAlign: "left",
          opacity: muted ? 0.5 : 1,
          fontSize: 12.5, fontWeight: 700, letterSpacing: "-0.005em",
          transition: "background 120ms, border-color 120ms",
        }}
        onMouseEnter={(e) => { if (!muted) (e.currentTarget as HTMLButtonElement).style.background = "#fafafa" }}
        onMouseLeave={(e) => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = "white" }}
      >
        {label}
        <ChevronDown size={13} strokeWidth={2} color="#a3a3a3" style={{ marginLeft: "auto", flexShrink: 0, transition: "transform 160ms", transform: isOpen ? "rotate(180deg)" : "none" }} />
      </button>
      {popover}
    </div>
  )
}

/**
 * Vertical task-meta panel for the branch PAGE's left sidebar. Same controls as the modal's
 * horizontal InlineTokenStrip — priority, due date, category, visibility — but laid out to fill the
 * page's empty left column, with the **due-date calendar always open** so the date is set in one
 * click without a popover. Compact width so the branch keeps the room.
 */
export function PageMetaPanel({
  priority, onPriorityChange,
  dueDate, onDueDateChange,
  categoryId, onCategoryChange, categories, onCreateCategory, canEditCategory,
  authorCategoryName, authorCategoryColor, authorCategoryIcon,
  isOwner,
  visMode, onVisModeChange, sharedIds, onSharedIdsChange, friends,
  openPopover, setOpenPopover,
}: PageMetaPanelProps) {
  const priorityRef   = useRef<HTMLDivElement>(null)
  const categoryRef   = useRef<HTMLDivElement>(null)
  const visibilityRef = useRef<HTMLDivElement>(null)

  const toggle = (key: OpenPopover) => setOpenPopover(openPopover === key ? null : key)
  const close = () => setOpenPopover(null)

  const ownerLocked    = !isOwner
  const categoryLocked = !canEditCategory

  const priorityColor = getPriorityColor(priority)
  const priorityLabel = getPriorityLabel(priority)

  const activeCat      = categories.find((c) => c.id === categoryId)
  const CatIcon        = activeCat?.icon ? (ICON_MAP[activeCat.icon] ?? null) : null
  const AuthorCatIcon  = authorCategoryIcon ? (ICON_MAP[authorCategoryIcon] ?? null) : null
  const showAuthorHint = !activeCat && !isOwner && !!authorCategoryName

  const dateClearable = !!dueDate && !ownerLocked

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* ── Priority ── */}
      <div>
        <SectionLabel>Priority</SectionLabel>
        <MetaButton
          onClick={() => toggle("priority")}
          isOpen={openPopover === "priority"}
          muted={ownerLocked}
          containerRef={priorityRef}
          label={
            <>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: priorityColor, flexShrink: 0 }} />
              {priorityLabel}
            </>
          }
          popover={
            <PriorityPopover
              open={openPopover === "priority"}
              onClose={close}
              value={priority}
              onChange={(v) => { onPriorityChange(v); close() }}
              containerRef={priorityRef as RefObject<HTMLElement | null>}
              readOnly={ownerLocked}
            />
          }
        />
      </div>

      {/* ── Category ── */}
      <div>
        <SectionLabel>Category</SectionLabel>
        <MetaButton
          onClick={() => toggle("category")}
          isOpen={openPopover === "category"}
          muted={categoryLocked}
          containerRef={categoryRef}
          label={
            activeCat ? (
              <>
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  background: activeCat.color ? `${activeCat.color}22` : "#f0f0f0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {CatIcon && <CatIcon size={10} color={activeCat.color ?? "#525252"} />}
                </div>
                {activeCat.name}
              </>
            ) : showAuthorHint ? (
              <>
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0, opacity: 0.5,
                  background: authorCategoryColor ? `${authorCategoryColor}22` : "#f0f0f0",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {AuthorCatIcon && <AuthorCatIcon size={10} color={authorCategoryColor ?? "#525252"} />}
                </div>
                <span style={{ opacity: 0.55, fontStyle: "italic" }}>Author · {authorCategoryName}</span>
              </>
            ) : (
              <span style={{ color: "#a3a3a3" }}>No category</span>
            )
          }
          popover={
            <CategoryPopover
              open={openPopover === "category"}
              onClose={close}
              value={categoryId}
              onChange={onCategoryChange}
              categories={categories}
              onCreateCategory={onCreateCategory}
              containerRef={categoryRef as RefObject<HTMLElement | null>}
              canEdit={canEditCategory}
            />
          }
        />
      </div>

      {/* ── Visibility ── */}
      <div>
        <SectionLabel>Visibility</SectionLabel>
        <MetaButton
          onClick={() => toggle("visibility")}
          isOpen={openPopover === "visibility"}
          muted={ownerLocked}
          containerRef={visibilityRef}
          label={
            <>
              {visMode === "private" ? <Lock size={13} strokeWidth={2} /> : <Globe2 size={13} strokeWidth={2} />}
              {visMode === "private" ? "Private" : `Shared · ${sharedIds.length}`}
            </>
          }
          popover={
            <VisibilityPopover
              open={openPopover === "visibility"}
              onClose={close}
              mode={visMode}
              onModeChange={onVisModeChange}
              sharedIds={sharedIds}
              onSharedIdsChange={onSharedIdsChange}
              friends={friends}
              containerRef={visibilityRef as RefObject<HTMLElement | null>}
              readOnly={ownerLocked}
            />
          }
        />
      </div>

      {/* ── Due date (always-open calendar — fills the empty space) ── */}
      <div>
        <SectionLabel
          action={dateClearable ? (
            <button
              onClick={() => onDueDateChange(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 9, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a3a3a3", padding: 0 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#525252" }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#a3a3a3" }}
            >
              Clear
            </button>
          ) : undefined}
        >
          Due date
        </SectionLabel>

        {/* Current selection summary */}
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 2px 9px", color: dueDate ? "#262626" : "#a3a3a3", fontSize: 12.5, fontWeight: 700 }}>
          <Calendar size={14} strokeWidth={1.8} />
          {dueDate ? (
            <>
              {formatDatePretty(dueDate)}
              <span style={{ color: "#a3a3a3", fontWeight: 600 }}>· {formatRelativeRu(dueDate)}</span>
            </>
          ) : "No due date"}
        </div>

        {/* The calendar itself — always visible. */}
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 14, overflow: "hidden", background: "white" }}>
          <DateCalendar value={dueDate} onChange={onDueDateChange} readOnly={ownerLocked} headless hideQuickPicks />
        </div>
      </div>
    </div>
  )
}
