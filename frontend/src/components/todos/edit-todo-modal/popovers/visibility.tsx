"use client"

import Link from "next/link"
import { RefObject } from "react"
import { Lock, Users, UsersRound } from "lucide-react"
import { Popover, PopoverHeader } from "../popover"
import { FriendAvatar } from "../friend-avatar"
import type { FriendDto } from "@/types/auth"

// Both visibility modes (Private / Friends) render their body at this CONSTANT height, so switching
// modes never resizes the panel. That stops the meta sidebar from gaining/losing a scrollbar — which
// would otherwise reflow the calendar below it — and makes the two states equally tall, as required.
const VIS_BODY_HEIGHT = 200

interface VisibilityPopoverProps {
  open: boolean
  onClose: () => void
  mode: "private" | "friends"
  onModeChange: (m: "private" | "friends") => void
  sharedIds: string[]
  onSharedIdsChange: (ids: string[]) => void
  friends: FriendDto[]
  containerRef: RefObject<HTMLElement | null>
  /** When true the access controls are shown muted and non-interactive (non-owner viewer). */
  readOnly?: boolean
  /** Shared with every accepted friend rather than with the people ticked below. */
  allFriends?: boolean
}

function friendName(f: FriendDto): string {
  const full = [f.firstName, f.lastName].filter(Boolean).join(" ").trim()
  return full || f.email.split("@")[0]
}

export function VisibilityPopover({
  open, onClose, mode, onModeChange, sharedIds, onSharedIdsChange, friends, containerRef, readOnly, allFriends,
}: VisibilityPopoverProps) {
  return (
    <Popover open={open} onClose={onClose} width={340} align="right" containerRef={containerRef}>
      <VisibilityPanel
        mode={mode}
        onModeChange={onModeChange}
        sharedIds={sharedIds}
        onSharedIdsChange={onSharedIdsChange}
        friends={friends}
        readOnly={readOnly}
        allFriends={allFriends}
      />
    </Popover>
  )
}

interface VisibilityPanelProps {
  mode: "private" | "friends"
  onModeChange: (m: "private" | "friends") => void
  sharedIds: string[]
  onSharedIdsChange: (ids: string[]) => void
  friends: FriendDto[]
  readOnly?: boolean
  /** Drops the internal "Task access" header — the always-open sidebar renders its own label. */
  headless?: boolean
  /** Shared with every accepted friend; ticking a person turns it into a share with just them. */
  allFriends?: boolean
}

/**
 * The visibility body (private/friends mode picker + friend access list), extracted from
 * {@link VisibilityPopover} so it can render always-open inline in the branch page's meta sidebar.
 */
export function VisibilityPanel({
  mode, onModeChange, sharedIds, onSharedIdsChange, friends, readOnly, headless, allFriends = false,
}: VisibilityPanelProps) {
  const toggleFriend = (id: string) => {
    if (readOnly) return
    onSharedIdsChange(
      sharedIds.includes(id) ? sharedIds.filter((x) => x !== id) : [...sharedIds, id]
    )
  }

  const allSelected  = friends.length > 0 && friends.every((f) => sharedIds.includes(f.id))
  const toggleAll    = () => {
    if (readOnly) return
    if (allSelected) onSharedIdsChange([])
    else onSharedIdsChange(friends.map((f) => f.id))
  }
  const changeMode = (m: "private" | "friends") => { if (readOnly) return; onModeChange(m) }

  const sub: React.ReactNode = mode === "private"
    ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--pl-ink-muted)" }}>only you</span>
    : <span style={{ fontSize: 12, fontWeight: 600, color: "var(--pl-ink-muted)" }}>
        {allFriends ? "all friends" : `${sharedIds.length} of ${friends.length}`}
      </span>

  return (
    <>
      {!headless && <PopoverHeader label="Task access" sub={sub} />}

      <div style={{ opacity: readOnly ? 0.55 : 1, pointerEvents: readOnly ? "none" : "auto" }}>

      {/* Mode picker */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, padding: "10px 10px 6px" }}>
        {([
          { key: "private" as const, Icon: Lock,   label: "Private" },
          { key: "friends" as const, Icon: UsersRound, label: "Friends" },
        ] as const).map(({ key, Icon, label }) => {
          const isActive = mode === key
          return (
            <button
              key={key}
              onClick={() => changeMode(key)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: "8px 4px", borderRadius: 11, border: "none", cursor: "pointer",
                gap: 4,
                background: isActive ? "var(--pl-ink)" : "var(--pl-paper-sunken)",
                color: isActive ? "var(--pl-paper)" : "var(--pl-ink)",
                transition: "background 120ms, color 120ms",
              }}
            >
              <Icon size={15} />
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Body — a CONSTANT height across modes (see VIS_BODY_HEIGHT) so toggling Private/Friends
          never changes the panel's size; the friend list scrolls *inside* this fixed area. */}
      <div style={{ height: VIS_BODY_HEIGHT }}>
      {mode === "private" ? (
        <div style={{
          height: "100%",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          padding: "0 20px", gap: 8, textAlign: "center",
        }}>
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: "var(--pl-paper-sunken)", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Lock size={18} color="var(--pl-ink-subtle)" />
          </div>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--pl-ink)", margin: 0, letterSpacing: "-0.01em" }}>
            Only you can see this task
          </p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--pl-ink-muted)", margin: 0 }}>
            None of your friends have access
          </p>
        </div>
      ) : friends.length === 0 ? (
        // The same shape as the private state above — a disc, a line, a way forward — instead
        // of one small grey sentence floating in the middle of an empty box.
        <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center">
          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-paper-sunken text-ink-muted">
            <Users size={18} />
          </span>
          <p className="text-body-sm font-bold text-ink">No friends to share with yet</p>
          <p className="text-caption font-semibold text-ink-muted">
            Add them on your{" "}
            <Link href="/profile#friends" className="touch-target rounded-sm text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              profile
            </Link>
            , then share this task.
          </p>
        </div>
      ) : (
        /* Friends list — header pinned, rows scroll within the fixed body height */
        <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Header row inside body */}
          <div style={{
            padding: "6px 14px 4px", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--pl-ink-muted)" }}>
              Shared with
            </span>
            <button
              onClick={toggleAll}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 700, letterSpacing: "0.05em",
                textTransform: "uppercase", color: "var(--pl-ink)", padding: 0,
              }}
            >
              {allSelected ? "NONE" : "ALL"}
            </button>
          </div>

          <div data-cascade style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarGutter: "stable", padding: "0 6px 6px" }}>
            {friends.map((f) => {
                  const isSelected = sharedIds.includes(f.id)
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleFriend(f.id)}
                      aria-label={friendName(f)}
                      role="checkbox"
                      aria-checked={isSelected}
                      style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                        padding: "7px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                        background: isSelected ? "var(--pl-paper-sunken)" : "transparent",
                        textAlign: "left", transition: "background 100ms",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--pl-gray-100)" }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isSelected ? "var(--pl-paper-sunken)" : "transparent" }}
                    >
                      <FriendAvatar friend={f} size={24} />
                      <span style={{
                        flex: 1, fontSize: 12, fontWeight: 700, letterSpacing: "-0.005em", color: "var(--pl-ink)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {friendName(f)}
                      </span>
                      {/* Access dot */}
                      <div style={{
                        width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: isSelected ? "var(--pl-ink)" : "transparent",
                        boxShadow: isSelected ? "none" : "inset 0 0 0 1.5px var(--pl-line)",
                        fontSize: 12, fontWeight: 700, color: "var(--pl-paper)",
                        transition: "background 100ms, box-shadow 100ms",
                      }}>
                        {isSelected ? "✓" : ""}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
      </div>
      </div>
    </>
  )
}
