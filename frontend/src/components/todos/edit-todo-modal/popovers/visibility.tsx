"use client"

import { RefObject } from "react"
import { Popover, PopoverHeader } from "../popover"
import { AudienceMap } from "@/components/todos/audience/audience-map"
import type { FriendDto } from "@/types/auth"

/**
 * Who can see a task: the audience map (`components/todos/audience`) — the landing page's circle
 * with the owner's friends in its seats — in a popover under the task editor's visibility token
 * and under the New task panel's Share plate, and always open in the sidebar of a task's own page.
 *
 * It replaced a Private/Friends switch over a list of check-boxes. The audience it edits, and the
 * callbacks it edits it through, are unchanged.
 */

interface AudienceProps {
  mode: "private" | "friends"
  onModeChange: (m: "private" | "friends") => void
  sharedIds: string[]
  onSharedIdsChange: (ids: string[]) => void
  friends: FriendDto[]
  /** A non-owner viewer: shown as it is, nothing can be changed. */
  readOnly?: boolean
  /** Shared with every accepted friend rather than with the people chosen. */
  allFriends?: boolean
  /** The circle an All friends task was frozen with, when known. */
  allFriendsIds?: readonly string[] | null
}

interface VisibilityPopoverProps extends AudienceProps {
  open: boolean
  onClose: () => void
  containerRef: RefObject<HTMLElement | null>
  align?: "left" | "right" | "center"
  /** Viewport-fixed, for a popover in normal page flow (the New task panel). */
  portal?: boolean
  /**
   * The "Share with" chips under the map. The New task panel leaves them out: the map is the
   * whole control there, its seats the buttons.
   */
  chips?: boolean
}

export function VisibilityPopover({
  open,
  onClose,
  containerRef,
  align = "right",
  portal = false,
  chips = true,
  ...audience
}: VisibilityPopoverProps) {
  const count = audience.allFriends ? null : audience.mode === "private" ? 0 : audience.sharedIds.length
  return (
    <Popover open={open} onClose={onClose} width={368} align={align} containerRef={containerRef} portal={portal}>
      <PopoverHeader
        label="Task access"
        sub={
          <span className="text-caption font-semibold text-ink-muted">
            {count === null ? "all friends" : count === 0 ? "only you" : `${count} of ${audience.friends.length}`}
          </span>
        }
      />
      <div className="p-3">
        <AudienceMap {...toMapProps(audience)} size="popover" chips={chips} />
      </div>
    </Popover>
  )
}

interface VisibilityPanelProps extends AudienceProps {
  /** Kept for callers: the page's sidebar renders its own label above the panel. */
  headless?: boolean
}

/** The same map, always open, for the sidebar of a task's own page. */
export function VisibilityPanel({ headless: _headless, ...audience }: VisibilityPanelProps) {
  return (
    <div className="p-3">
      <AudienceMap {...toMapProps(audience)} size="page" />
    </div>
  )
}

function toMapProps({ mode, onModeChange, sharedIds, onSharedIdsChange, friends, readOnly, allFriends, allFriendsIds }: AudienceProps) {
  return {
    mode,
    onModeChange,
    sharedIds,
    onSharedIdsChange,
    friends,
    readOnly: readOnly ?? false,
    allFriends: allFriends ?? false,
    allFriendsIds: allFriendsIds ?? null,
  }
}
