"use client"

import { useRef, type RefObject } from "react"
import { Calendar, Globe2, Lock } from "lucide-react"
import { PriorityPopover }   from "./popovers/priority"
import { DatePopover }       from "./popovers/date"
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

interface InlineTokenStripProps {
  // Priority
  priority: string
  onPriorityChange: (v: string) => void

  // Date
  dueDate: string          // YYYY-MM-DD or ""
  onDueDateChange: (v: string | null) => void

  // Category
  categoryId: string | null
  onCategoryChange: (v: string | null) => void
  categories: Category[]
  onCreateCategory: () => Promise<void>
  canEditCategory: boolean

  // Visibility
  visMode: "private" | "friends"
  onVisModeChange: (v: "private" | "friends") => void
  sharedIds: string[]
  onSharedIdsChange: (ids: string[]) => void
  friends: FriendDto[]

  openPopover: OpenPopover
  setOpenPopover: (v: OpenPopover) => void

  disabled?: boolean
}

function Dot() {
  return (
    <div style={{
      width: 3, height: 3, borderRadius: "50%", background: "#d4d4d4",
      flexShrink: 0, marginLeft: 2, marginRight: 2,
    }} />
  )
}

interface InlineTokenProps {
  onClick: () => void
  isOpen: boolean
  children: React.ReactNode
  containerRef: RefObject<HTMLDivElement | null>
}

function InlineToken({ onClick, isOpen, children, containerRef }: InlineTokenProps) {
  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} style={{ position: "relative" }}>
      <button
        onClick={onClick}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          padding: "5px 10px", borderRadius: 9, border: "none", cursor: "pointer",
          background: isOpen ? "#fafafa" : "transparent",
          color: isOpen ? "#0a0a0a" : "#525252",
          fontSize: 11.5, fontWeight: 800, letterSpacing: "-0.005em",
          whiteSpace: "nowrap",
          transition: "background 120ms, color 120ms",
        }}
        onMouseEnter={(e) => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = "#f5f5f5" }}
        onMouseLeave={(e) => { if (!isOpen) (e.currentTarget as HTMLButtonElement).style.background = "transparent" }}
      >
        {children}
      </button>
    </div>
  )
}

export function InlineTokenStrip({
  priority, onPriorityChange,
  dueDate, onDueDateChange,
  categoryId, onCategoryChange, categories, onCreateCategory, canEditCategory,
  visMode, onVisModeChange, sharedIds, onSharedIdsChange, friends,
  openPopover, setOpenPopover,
  disabled,
}: InlineTokenStripProps) {
  const priorityRef   = useRef<HTMLDivElement>(null)
  const dateRef       = useRef<HTMLDivElement>(null)
  const categoryRef   = useRef<HTMLDivElement>(null)
  const visibilityRef = useRef<HTMLDivElement>(null)

  const toggle = (key: OpenPopover) =>
    setOpenPopover(openPopover === key ? null : key)

  const close = () => setOpenPopover(null)

  // Derived display values
  const priorityColor = getPriorityColor(priority)
  const priorityLabel = getPriorityLabel(priority)

  const activeCat = categories.find((c) => c.id === categoryId)
  const CatIcon   = activeCat?.icon ? (ICON_MAP[activeCat.icon] ?? null) : null

  const visLabel = visMode === "private"
    ? "приватно"
    : `публично · ${sharedIds.length}`

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>

      {/* ── Priority token ── */}
      <InlineToken
        onClick={() => !disabled && toggle("priority")}
        isOpen={openPopover === "priority"}
        containerRef={priorityRef}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: priorityColor, flexShrink: 0 }} />
        {priorityLabel}
        <PriorityPopover
          open={openPopover === "priority"}
          onClose={close}
          value={priority}
          onChange={(v) => { onPriorityChange(v); close() }}
          containerRef={priorityRef as RefObject<HTMLElement | null>}
        />
      </InlineToken>

      <Dot />

      {/* ── Date token ── */}
      <InlineToken
        onClick={() => !disabled && toggle("date")}
        isOpen={openPopover === "date"}
        containerRef={dateRef}
      >
        <Calendar size={14} strokeWidth={1.4} />
        {dueDate ? (
          <>
            {formatDatePretty(dueDate)}
            <span style={{ color: "#a3a3a3", fontWeight: 600, marginLeft: 2 }}>
              · {formatRelativeRu(dueDate)}
            </span>
          </>
        ) : (
          "Срок"
        )}
        <DatePopover
          open={openPopover === "date"}
          onClose={close}
          value={dueDate}
          onChange={(v) => { onDueDateChange(v); close() }}
          containerRef={dateRef as RefObject<HTMLElement | null>}
        />
      </InlineToken>

      <Dot />

      {/* ── Category token ── */}
      <InlineToken
        onClick={() => !disabled && toggle("category")}
        isOpen={openPopover === "category"}
        containerRef={categoryRef}
      >
        {activeCat ? (
          <>
            <div style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              background: activeCat.color ? `${activeCat.color}22` : "#f0f0f0",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {CatIcon && <CatIcon size={9} color={activeCat.color ?? "#525252"} />}
            </div>
            {activeCat.name}
          </>
        ) : (
          "Категория"
        )}
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
      </InlineToken>

      {/* ── Visibility token (pushed right) ── */}
      <div style={{ marginLeft: "auto" }}>
        <InlineToken
          onClick={() => !disabled && toggle("visibility")}
          isOpen={openPopover === "visibility"}
          containerRef={visibilityRef}
        >
          {visMode === "private"
            ? <Lock size={12} strokeWidth={2} />
            : <Globe2 size={12} strokeWidth={2} />
          }
          {visLabel}
          <VisibilityPopover
            open={openPopover === "visibility"}
            onClose={close}
            mode={visMode}
            onModeChange={onVisModeChange}
            sharedIds={sharedIds}
            onSharedIdsChange={onSharedIdsChange}
            friends={friends}
            containerRef={visibilityRef as RefObject<HTMLElement | null>}
          />
        </InlineToken>
      </div>
    </div>
  )
}
