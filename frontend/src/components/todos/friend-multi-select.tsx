"use client"

import { useMemo, useCallback } from "react"
import { Check, Globe2, Lock, UserRound, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { FriendDto } from "@/types/auth"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const formatFriendName = (friend: FriendDto) => {
  const fullName = [friend.firstName, friend.lastName].filter(Boolean).join(" ").trim()
  if (fullName) return fullName
  if (friend.email) return friend.email.split("@")[0]
  return friend.id
}

const friendInitials = (friend: FriendDto) => {
  const first = friend.firstName?.trim()?.[0]
  const last = friend.lastName?.trim()?.[0]
  if (first || last) return `${first ?? ""}${last ?? ""}`.toUpperCase()
  if (friend.email) return friend.email.slice(0, 2).toUpperCase()
  return friend.id.slice(0, 2).toUpperCase()
}

interface FriendMultiSelectProps {
  friends: FriendDto[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  placeholder?: string
  contentClassName?: string
  publicSelected?: boolean
  onPublicChange?: (selected: boolean) => void
}

export function FriendMultiSelect({
  friends,
  selectedIds,
  onChange,
  disabled = false,
  placeholder = "Share with friends (optional)",
  contentClassName,
  publicSelected = false,
  onPublicChange,
}: FriendMultiSelectProps) {
  const selectedFriends = useMemo(
    () => friends.filter((f) => selectedIds.includes(f.id)),
    [friends, selectedIds]
  )
  const visibleSelectedFriends = publicSelected ? [] : selectedFriends

  const label = useMemo(() => {
    if (publicSelected) return "Shared with all friends"
    const selectedCount = selectedIds.length
    if (selectedCount === 0) return placeholder
    if (selectedFriends.length === 0) {
      const noun = selectedCount === 1 ? "friend" : "friends"
      return `Shared with ${selectedCount} ${noun}`
    }
    const names = selectedFriends.slice(0, 2).map(formatFriendName)
    const extraCount = Math.max(0, selectedCount - names.length)
    const extra = extraCount > 0 ? ` +${extraCount}` : ""
    return `Shared with ${names.join(", ")}${extra}`
  }, [publicSelected, selectedFriends, selectedIds.length, placeholder])

  const scopeLabel = publicSelected
    ? "All friends"
    : selectedIds.length > 0
      ? `${selectedIds.length} selected`
      : "Private"

  const toggleFriend = useCallback((id: string) => {
    if (publicSelected) {
      onPublicChange?.(false)
      onChange([id])
      return
    }

    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((fid) => fid !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }, [publicSelected, selectedIds, onChange, onPublicChange])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className={cn(
            "group flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200/80 bg-white p-2.5 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform,opacity] duration-200",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "hover:border-gray-300 hover:bg-gray-50/70 hover:shadow-md active:scale-[0.99]"
          )}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-600 transition-colors group-hover:bg-white">
              {publicSelected ? (
                <Globe2 className="h-4 w-4" />
              ) : selectedIds.length > 0 ? (
                <Users className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-gray-900">{label}</span>
              <span className="block truncate text-[11px] font-semibold text-gray-400">{scopeLabel}</span>
            </span>
          </span>
          <span className="flex flex-shrink-0 items-center gap-1.5">
            {visibleSelectedFriends.slice(0, 3).map(friend => (
              <span
                key={friend.id}
                className="-ml-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-gray-900 text-[9px] font-black text-white shadow-sm first:ml-0"
                title={formatFriendName(friend)}
              >
                {friendInitials(friend)}
              </span>
            ))}
            {publicSelected && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[10px] font-black uppercase tracking-[0.06em] text-gray-600">
                All
              </span>
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      {!disabled && (
        <DropdownMenuContent
          align="start"
          className={cn(
            "w-[min(420px,calc(100vw-2rem))] max-h-80 overflow-y-auto rounded-2xl border-gray-200/80 bg-white p-2 shadow-2xl",
            contentClassName
          )}
        >
          <div className="px-2 pb-2 pt-1">
            <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-bold text-gray-400">
              <Users className="h-3.5 w-3.5" />
              Share scope
            </div>
          </div>
          {onPublicChange && (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  const nextPublic = !publicSelected
                  onPublicChange(nextPublic)
                  if (nextPublic) {
                    onChange([])
                  }
                }}
                className={cn(
                  "cursor-pointer gap-3 rounded-xl px-3 py-3",
                  publicSelected ? "bg-gray-950 text-white focus:bg-gray-950 focus:text-white" : "text-gray-900 focus:bg-gray-50"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border",
                    publicSelected ? "border-white bg-white text-gray-950" : "border-gray-300 bg-white text-transparent"
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-black">All friends</span>
                  <span className={cn("block text-[11px] font-semibold", publicSelected ? "text-white/60" : "text-gray-400")}>
                    All accepted friends
                  </span>
                </span>
                <Globe2 className={cn("h-4 w-4 flex-shrink-0", publicSelected ? "text-white/70" : "text-gray-400")} />
              </DropdownMenuItem>
              <div className="my-2 h-px bg-gray-100" />
            </>
          )}
          {friends.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-center text-xs font-bold text-gray-400">
              No friends yet.
            </div>
          ) : (
            <div className="space-y-1">
              {friends.map((friend) => {
                const selected = selectedIds.includes(friend.id)
                return (
                  <DropdownMenuItem
                    key={friend.id}
                    onSelect={(event) => {
                      event.preventDefault()
                      toggleFriend(friend.id)
                    }}
                    className={cn(
                      "cursor-pointer gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                      selected ? "bg-gray-100 text-gray-950 focus:bg-gray-100" : "focus:bg-gray-50"
                    )}
                  >
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gray-900 text-[10px] font-black text-white">
                      {friendInitials(friend)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-black">{formatFriendName(friend)}</span>
                      {friend.email && (
                        <span className="block truncate text-[11px] font-semibold text-gray-400">{friend.email}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                        selected ? "border-gray-950 bg-gray-950 text-white" : "border-gray-300 bg-white text-transparent"
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-400">
            <UserRound className="h-3.5 w-3.5" />
            {publicSelected
              ? "All friends"
              : selectedIds.length > 0
                ? `${selectedIds.length} direct share${selectedIds.length === 1 ? "" : "s"}`
                : "No direct shares"}
          </div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  )
}
