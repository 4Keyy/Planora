"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useReducedMotion } from "framer-motion"
import { motion } from "@/components/ui/motion"
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  Copy,
  Fingerprint,
  History as HistoryIcon,
  IdCard,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Monitor,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
  User,
  UserPlus,
  Users as UsersIcon,
  UserX,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { api, getApiErrorMessage, parseApiResponse } from "@/lib/api"
import { refreshAccessToken } from "@/lib/auth-public"
import { getApiBaseUrl } from "@/lib/config"
import { clearCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { invalidateFriends } from "@/hooks/use-friends"
import { Button } from "@/components/ui/button"
import { ChangePasswordForm } from "@/components/profile/change-password-form"
import { ChangeEmailForm } from "@/components/profile/change-email-form"
import { Input } from "@/components/ui/input"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { TWEEN_FAST } from "@/lib/animations"
import { formatDateTime as formatDate, formatDate as formatDateShort } from "@/lib/datetime"
import { StatusPanel } from "@/components/ui/status-panel"
import { Field, FIELD_LABEL_CLASS, type FieldControlProps } from "@/components/ui/field"
import { Enter, EnterEach, EnterInView, SkeletonSwap, useEnter, useEnterEach } from "@/components/animated/entrance"
import type {
  UserDto,
  UserSecurityDto,
  SessionDto,
  LoginHistoryPagedDto,
  PagedResult,
  FriendDto,
  FriendRequestDto,
  UserListDto,
  UserStatisticsDto,
  UserDetailDto,
} from "@/types/auth"

/* ------------------------------------------------------------------ *
 * Types & config
 * ------------------------------------------------------------------ */

type SectionId = "profile" | "security" | "sessions" | "history" | "friends" | "admin"

type SectionConfig = {
  id: SectionId
  index: string
  label: string
  description: string
  icon: LucideIcon
  adminOnly?: boolean
}

const sections: SectionConfig[] = [
  { id: "profile", index: "01", label: "Profile", description: "Identity & avatar", icon: User },
  { id: "security", index: "02", label: "Security", description: "Password & 2FA", icon: Shield },
  { id: "sessions", index: "03", label: "Sessions", description: "Signed-in devices", icon: Monitor },
  { id: "history", index: "04", label: "History", description: "Login activity", icon: HistoryIcon },
  { id: "friends", index: "05", label: "Friends", description: "Connections", icon: UsersIcon },
  { id: "admin", index: "06", label: "Admin", description: "User operations", icon: Settings, adminOnly: true },
]


const isGuid = (value: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value.trim())

const isEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

const personName = (person: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  id?: string
}): string => {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim()
  if (name) return name
  if (person.email) return person.email.split("@")[0]
  return person.id ?? "Unknown"
}

/* ------------------------------------------------------------------ *
 * Shared class tokens (monochrome, light + dark)
 * ------------------------------------------------------------------ */

const CARD =
  "rounded-xl border border-line bg-paper shadow-sm"

/**
 * Eyebrow label for the page's metadata rows (a `<dt>`, a section caption). It is
 * the SAME style a form field's label uses — there is one eyebrow in this product,
 * not three. It used to be bold, 0.14em-tracked `text-ink-subtle` here,
 * `font-semibold tracking-wider text-ink-muted` on the auth screens and
 * `font-bold tracking-widest text-ink-subtle` on the categories page; nobody could
 * see the difference while reading any one of those files.
 *
 * `ink-muted` (7.81:1) rather than `ink-subtle` (4.74:1): this text is 12px and
 * uppercase, the hardest combination to read, and it should sit well clear of the
 * 4.5:1 floor rather than on it.
 */
const LABEL = FIELD_LABEL_CLASS

/* ------------------------------------------------------------------ *
 * Reusable helpers (names preserved from the original file)
 * ------------------------------------------------------------------ */

function StatusPill({
  children,
  active = false,
  className,
}: {
  children: ReactNode
  active?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-caption font-bold text-ink-muted",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 flex-shrink-0 rounded-full",
          active
            ? "bg-ink"
            : "border border-line-strong"
        )}
      />
      {children}
    </span>
  )
}

/**
 * When the content inside a card arrives, after the card itself: its header has landed and
 * the eye has moved on to the body.
 */
const CARD_BODY_AT = 120

/**
 * A card of a section. It arrives when it scrolls into view, so a long page is not played
 * off-screen: in view when its section appears, at `at` on the section's timeline (after
 * the heading); further down, as the reader reaches it. `index` staggers cards revealed
 * side by side.
 */
function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  at = 150,
  index,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  at?: number
  index?: number
}) {
  return (
    <EnterInView
      as="section"
      tier="panel"
      at={at}
      index={index}
      className={cn(CARD, "flex flex-col overflow-hidden", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-line bg-paper-sunken text-ink-subtle">
              <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-body-sm font-bold tracking-tight text-ink">
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 truncate text-caption font-semibold text-ink-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className={cn("flex flex-1 flex-col p-5", bodyClassName)}>{children}</div>
    </EnterInView>
  )
}

/**
 * A single hairline data cell. Rendered inside a `<dl>` grid so a group of
 * MetricTiles forms an even spec-grid with 1px dividers and no colored fills.
 * `tone` is preserved for API compatibility but only drives the small status dot.
 *
 * Its words arrive, not the cell: the cells are white over the grid's grey hairlines, so
 * a cell fading in would flash grey. The grid lands with its card; label then value pour
 * in across it, `index` cells from the left.
 */
function MetricTile({
  label,
  value,
  detail,
  active,
  index = 0,
  at = CARD_BODY_AT,
  ready,
}: {
  icon?: LucideIcon
  label: string
  value: ReactNode
  detail?: ReactNode
  active?: boolean
  index?: number
  at?: number
  /** False while its value is still on its way; the words wait rather than arrive as "—". */
  ready?: boolean
}) {
  const labelIn = useEnter("text", { at, index, ready })
  const valueIn = useEnter("text", { at: at + 40, index, ready })
  const detailIn = useEnter("text", { at: at + 80, index, ready })
  return (
    <div className="bg-paper p-4">
      <dt className={cn(LABEL, labelIn.className)} style={labelIn.style}>{label}</dt>
      <dd className={cn("mt-2 flex items-baseline gap-2", valueIn.className)} style={valueIn.style}>
        <span className="min-w-0 truncate text-title-sm font-bold tabular-nums tracking-tight text-ink">
          {value}
        </span>
        {active !== undefined && (
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 flex-shrink-0 translate-y-[-2px] rounded-full",
              active ? "bg-ink" : "border border-line-strong"
            )}
          />
        )}
      </dd>
      {detail && (
        <p className={cn("mt-1 truncate text-caption font-semibold text-ink-muted", detailIn.className)} style={detailIn.style}>
          {detail}
        </p>
      )}
    </div>
  )
}

function InfoTile({ label, value, icon: Icon }: { label: string; value: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-lg border border-line bg-paper-sunken/80 p-4/40">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />}
        <span className={LABEL}>{label}</span>
      </div>
      <div className="mt-2 break-words text-body-sm font-bold text-ink">{value}</div>
    </div>
  )
}

/**
 * Thin alias over the shared primitive. Every one of these sits inside a section
 * that already carries its own heading, so the title renders as a `<p>` — a second
 * heading here would put a phantom level in the page outline.
 */
function EmptyState({ icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <Enter tier="row" at={CARD_BODY_AT}>
      <StatusPanel size="compact" as="p" icon={icon} title={title} description={description} />
    </Enter>
  )
}

/**
 * Adapter over the shared `Field`. The old version wrapped the control in a
 * `<label>` and offered no error slot at all, so a failed profile save could only
 * be reported through a toast that a screen-reader user might have already
 * dismissed. `Field` associates the label by id and leaves room for an error.
 */
function FieldGroup({ label, children }: { label: string; children: (props: FieldControlProps) => ReactNode }) {
  return <Field label={label}>{children}</Field>
}

function Pager({
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  label,
  order = 0,
}: {
  previousDisabled?: boolean
  nextDisabled?: boolean
  onPrevious: () => void
  onNext: () => void
  label?: string
  /** How many rows arrive above it: it comes in after the last of them. */
  order?: number
}) {
  const entrance = useEnter("row", { at: CARD_BODY_AT, index: order })
  return (
    <div
      className={cn("mt-4 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between", entrance.className)}
      style={entrance.style}
    >
      <span className="text-caption font-semibold text-ink-muted">{label ?? "Page controls"}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={previousDisabled} onClick={onPrevious}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={nextDisabled} onClick={onNext}>
          Next
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-20 animate-pulse rounded-lg border border-line bg-paper-sunken/40"
        />
      ))}
    </div>
  )
}

/**
 * A section's heading, read top to bottom as it arrives: the eyebrow, the title a beat
 * later, the sentence after it. The `id` is the one the section's `aria-labelledby` names.
 */
function SectionHeading({ id, index, title, description }: { id: string; index: string; title: string; description: string }) {
  const eyebrowIn = useEnter("text", { at: 0 })
  const titleIn = useEnter("text", { at: 60 })
  const descriptionIn = useEnter("text", { at: 120 })
  return (
    <div className="mb-4">
      <span className={cn(LABEL, eyebrowIn.className)} style={eyebrowIn.style}>
        {title} · {index}
      </span>
      <h2
        id={id}
        className={cn("mt-1.5 text-title-sm font-bold tracking-tight text-ink md:text-title", titleIn.className)}
        style={titleIn.style}
      >
        {title}
      </h2>
      <p className={cn("mt-1 text-caption font-semibold text-ink-muted", descriptionIn.className)} style={descriptionIn.style}>
        {description}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export default function ProfilePage() {
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()
  const addToast = useToastStore((s) => s.addToast)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const roles = useAuthStore((s) => s.roles)
  const updateUser = useAuthStore((s) => s.updateUser)

  const isAdmin = roles.includes("Admin")
  const availableSections = useMemo(
    () => sections.filter((s) => !s.adminOnly || isAdmin),
    [isAdmin]
  )

  // `activeSection` is now driven by scroll position (scroll-spy) instead of tabs.
  const [activeSection, setActiveSection] = useState<SectionId>("profile")

  const [user, setUser] = useState<UserDto | null>(null)
  const [security, setSecurity] = useState<UserSecurityDto | null>(null)
  const [sessions, setSessions] = useState<SessionDto[]>([])
  const [history, setHistory] = useState<PagedResult<LoginHistoryPagedDto> | null>(null)
  const [friends, setFriends] = useState<PagedResult<FriendDto> | null>(null)
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestDto[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestDto[]>([])
  const [adminUsers, setAdminUsers] = useState<PagedResult<UserListDto> | null>(null)
  const [adminStats, setAdminStats] = useState<UserStatisticsDto | null>(null)
  const [selectedUser, setSelectedUser] = useState<UserDetailDto | null>(null)

  const [loadingProfile, setLoadingProfile] = useState(false)
  const [loadingSecurity, setLoadingSecurity] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [loadingFriends, setLoadingFriends] = useState(false)
  const [loadingAdmin, setLoadingAdmin] = useState(false)
  /**
   * The sections whose first load has finished, well or badly. Until then a section shows
   * its placeholder, not its empty state: "No active sessions" for the moment before the
   * sessions arrive was a claim, and the swap to the real list a jump.
   */
  const [loaded, setLoaded] = useState<ReadonlySet<SectionId>>(() => new Set())
  const markLoaded = (id: SectionId): void =>
    setLoaded((current) => (current.has(id) ? current : new Set(current).add(id)))
  const profileReady = loaded.has("profile")
  const securityReady = loaded.has("security")
  const friendsReady = loaded.has("friends")

  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "" })

  const [verifyingEmail, setVerifyingEmail] = useState(false)
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; qrCodeUrl: string } | null>(null)
  const [twoFactorCode, setTwoFactorCode] = useState("")
  const [disable2faPassword, setDisable2faPassword] = useState("")
  const [revokeAllPassword, setRevokeAllPassword] = useState("")
  const [deletePassword, setDeletePassword] = useState("")

  const [historyPage, setHistoryPage] = useState(1)
  const [friendsPage, setFriendsPage] = useState(1)
  const [adminPage, setAdminPage] = useState(1)
  const [adminSearch, setAdminSearch] = useState("")
  const [adminStatus, setAdminStatus] = useState("")
  const [adminCreatedFrom, setAdminCreatedFrom] = useState("")
  const [adminCreatedTo, setAdminCreatedTo] = useState("")

  const [friendEmailInput, setFriendEmailInput] = useState("")
  const [friendIdInput, setFriendIdInput] = useState("")
  const [avatarError, setAvatarError] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  /**
   * In-flight guards. Without them a second click fired a second request — and
   * one of these actions deletes the account.
   */
  const [savingProfile, setSavingProfile] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null)
  const [respondingRequestId, setRespondingRequestId] = useState<string | null>(null)
  const [avatarDragOver, setAvatarDragOver] = useState(false)

  const isEmailVerified = user?.isEmailVerified ?? !!user?.emailVerifiedAt
  const avatarUrl = user?.profilePictureUrl || ""

  // Resolve after mount so window.location is available (avoids SSR/client mismatch).
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState("")
  useEffect(() => {
    if (!avatarUrl) {
      setResolvedAvatarUrl("")
      return
    }
    if (avatarUrl.startsWith("http")) {
      setResolvedAvatarUrl(avatarUrl)
      return
    }
    setResolvedAvatarUrl(`${getApiBaseUrl()}${avatarUrl.startsWith("/") ? avatarUrl : `/${avatarUrl}`}`)
  }, [avatarUrl])

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email?.split("@")[0] ||
    "Your profile"

  const initials = useMemo(() => {
    const first = profileForm.firstName || user?.firstName || ""
    const last = profileForm.lastName || user?.lastName || ""
    const emailInitial = user?.email?.[0] || "U"
    const value = `${first.charAt(0)}${last.charAt(0)}`.trim()
    return (value || emailInitial).toUpperCase()
  }, [profileForm.firstName, profileForm.lastName, user?.firstName, user?.lastName, user?.email])

  const sectionBadges = useMemo(() => {
    const sessionsCount =
      typeof security?.activeSessionsCount === "number"
        ? security.activeSessionsCount
        : sessions.length || undefined
    return {
      profile: undefined,
      security: security?.twoFactorEnabled ? "2FA" : undefined,
      sessions: sessionsCount,
      history: history?.totalCount,
      friends: friends?.totalCount,
      admin: adminUsers?.totalCount,
    } as Partial<Record<SectionId, string | number | undefined>>
  }, [security, sessions.length, history?.totalCount, friends?.totalCount, adminUsers?.totalCount])

  /* ---------------- Scroll-spy + smooth navigation ---------------- */

  const sectionRefs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({})
  const setSectionRef = (id: SectionId) => (el: HTMLElement | null): void => {
    sectionRefs.current[id] = el
  }

  useEffect(() => {
    let frame = 0
    const onScroll = (): void => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        let current: SectionId = availableSections[0]?.id ?? "profile"
        for (const section of availableSections) {
          const el = sectionRefs.current[section.id]
          if (el && el.getBoundingClientRect().top <= 150) current = section.id
        }
        setActiveSection((prev) => (prev === current ? prev : current))
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [availableSections])

  const goToSection = (id: SectionId): void => {
    const el = sectionRefs.current[id]
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 96
    window.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" })
  }

  /* ---------------- Auth guards ---------------- */

  useEffect(() => {
    if (!hasHydrated) return
    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      router.replace("/auth/login")
    }
  }, [hasHydrated, isAuthenticated, router])

  useEffect(() => {
    setAvatarError(false)
  }, [avatarUrl])

  /* ---------------- Data loaders (contracts unchanged) ---------------- */

  const loadProfile = async (): Promise<void> => {
    if (loadingProfile) return
    setLoadingProfile(true)
    try {
      const res = await api.get("/auth/api/v1/users/me")
      const data = parseApiResponse<UserDto>(res.data)
      setUser(data)
      updateUser({
        userId: data.id,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        profilePictureUrl: data.profilePictureUrl,
      })
      setProfileForm({ firstName: data.firstName, lastName: data.lastName })
    } catch {
      addToast({ type: "error", title: "Couldn't load profile" })
    } finally {
      setLoadingProfile(false)
      markLoaded("profile")
    }
  }

  const loadSecurity = async (): Promise<void> => {
    if (loadingSecurity) return
    setLoadingSecurity(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/security")
      setSecurity(parseApiResponse<UserSecurityDto>(res.data))
    } catch {
      addToast({ type: "error", title: "Couldn't load security info" })
    } finally {
      setLoadingSecurity(false)
      markLoaded("security")
    }
  }

  const loadSessions = async (): Promise<void> => {
    if (loadingSessions) return
    setLoadingSessions(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/sessions")
      setSessions(parseApiResponse<SessionDto[]>(res.data))
    } catch {
      addToast({ type: "error", title: "Couldn't load sessions" })
    } finally {
      setLoadingSessions(false)
      markLoaded("sessions")
    }
  }

  const loadHistory = async (page = historyPage): Promise<void> => {
    if (loadingHistory) return
    setLoadingHistory(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/login-history", {
        params: { pageNumber: page, pageSize: 10 },
      })
      setHistory(parseApiResponse<PagedResult<LoginHistoryPagedDto>>(res.data))
    } catch {
      addToast({ type: "error", title: "Couldn't load history" })
    } finally {
      setLoadingHistory(false)
      markLoaded("history")
    }
  }

  const loadFriends = async (page = friendsPage): Promise<void> => {
    if (loadingFriends) return
    setLoadingFriends(true)
    try {
      const res = await api.get("/friendships", {
        params: { pageNumber: page, pageSize: 10 },
      })
      setFriends(parseApiResponse<PagedResult<FriendDto>>(res.data))

      const incoming = await api.get("/friendships/requests", { params: { incoming: true } })
      const outgoing = await api.get("/friendships/requests", { params: { incoming: false } })
      setIncomingRequests(parseApiResponse<FriendRequestDto[]>(incoming.data))
      setOutgoingRequests(parseApiResponse<FriendRequestDto[]>(outgoing.data))
    } catch {
      addToast({ type: "error", title: "Couldn't load friends" })
    } finally {
      setLoadingFriends(false)
      markLoaded("friends")
    }
  }

  const loadAdmin = async (page = adminPage): Promise<void> => {
    if (!isAdmin || loadingAdmin) return
    setLoadingAdmin(true)
    try {
      const statsRes = await api.get("/auth/api/v1/users/statistics")
      setAdminStats(parseApiResponse<UserStatisticsDto>(statsRes.data))

      const res = await api.get("/auth/api/v1/users", {
        params: {
          pageNumber: page,
          pageSize: 10,
          searchTerm: adminSearch || undefined,
          status: adminStatus || undefined,
          createdFrom: adminCreatedFrom || undefined,
          createdTo: adminCreatedTo || undefined,
        },
      })
      setAdminUsers(parseApiResponse<PagedResult<UserListDto>>(res.data))
    } catch {
      addToast({ type: "error", title: "Couldn't load admin data" })
    } finally {
      setLoadingAdmin(false)
      markLoaded("admin")
    }
  }

  // Profile + security load on mount (unchanged).
  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    loadProfile()
    loadSecurity()
    // loadProfile/loadSecurity are plain async functions intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, isAuthenticated])

  // Lazy per-section loading: each section fetches once, the first time it comes within a
  // screen of the viewport — far enough ahead that it has usually arrived by the time the
  // reader scrolls to it, so the section appears with its content rather than with a
  // placeholder that is then replaced. It used to wait until the section was the active
  // one, its top 150px from the top of the window: by then it had already scrolled into
  // view showing its empty state, and a last section too short to reach that line never
  // loaded at all. Becoming active still loads it. Manual "Refresh" buttons re-fetch.
  const [nearSections, setNearSections] = useState<ReadonlySet<SectionId>>(() => new Set())
  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    const lazy: SectionId[] = ["sessions", "history", "friends", "admin"]
    const reach = (id: SectionId): void =>
      setNearSections((current) => (current.has(id) ? current : new Set(current).add(id)))
    if (typeof IntersectionObserver === "undefined") {
      lazy.forEach(reach)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.unobserve(entry.target)
          const id = lazy.find((candidate) => sectionRefs.current[candidate] === entry.target)
          if (id) reach(id)
        }
      },
      { rootMargin: "0px 0px 100% 0px" },
    )
    for (const id of lazy) {
      const el = sectionRefs.current[id]
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [hasHydrated, isAuthenticated, isAdmin])

  const loadedSections = useRef<Set<SectionId>>(new Set())
  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    for (const id of [activeSection, ...nearSections]) {
      if (loadedSections.current.has(id)) continue
      loadedSections.current.add(id)
      if (id === "sessions") loadSessions()
      else if (id === "history") loadHistory()
      else if (id === "friends") loadFriends()
      else if (id === "admin") loadAdmin()
    }
    // load* are plain async functions guarded by their loading flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, nearSections, hasHydrated, isAuthenticated])

  /* ---------------- Handlers (contracts unchanged) ---------------- */

  const handleAvatarUpload = async (file: File): Promise<void> => {
    if (avatarUploading) return
    setAvatarUploading(true)
    setAvatarError(false)
    const formData = new FormData()
    formData.append("file", file)
    try {
      const res = await api.post("/auth/api/v1/users/me/avatar", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      const data = parseApiResponse<UserDto>(res.data)
      updateUser({ profilePictureUrl: data.profilePictureUrl })
      // Refresh the access token so the JWT profilePictureUrl claim updates
      // immediately — new comments then carry the correct avatar URL.
      try {
        const refreshed = await refreshAccessToken()
        useAuthStore.getState().applyRefresh(refreshed)
      } catch {
        /* non-fatal — JWT self-updates on next scheduled refresh */
      }
      addToast({ type: "success", title: "Avatar updated" })
      loadProfile()
    } catch {
      addToast({ type: "error", title: "Couldn't upload avatar" })
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleRemoveAvatar = async (): Promise<void> => {
    try {
      const res = await api.put("/auth/api/v1/users/me", {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
        profilePictureUrl: null,
      })
      const data = parseApiResponse<UserDto>(res.data)
      setUser(data)
      updateUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        userId: data.id,
        profilePictureUrl: undefined,
      })
      setAvatarError(false)
      addToast({ type: "success", title: "Avatar removed" })
    } catch {
      addToast({ type: "error", title: "Couldn't remove avatar" })
    }
  }

  const handleProfileSave = async (): Promise<void> => {
    if (savingProfile) return
    setSavingProfile(true)
    try {
      const res = await api.put("/auth/api/v1/users/me", {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
        profilePictureUrl: user?.profilePictureUrl ?? null,
      })
      const data = parseApiResponse<UserDto>(res.data)
      setUser(data)
      updateUser({ firstName: data.firstName, lastName: data.lastName, email: data.email, userId: data.id })
      addToast({ type: "success", title: "Profile updated" })
    } catch {
      addToast({ type: "error", title: "Couldn't update profile" })
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordChanged = (): void => {
    addToast({ type: "success", title: "Password changed" })
    loadSecurity()
  }

  const handleEmailChanged = (email: string): void => {
    updateUser({ email })
    addToast({ type: "success", title: "Email changed", description: "Open the link we sent to the new address to verify it." })
    loadProfile()
  }

  const handleVerifyEmail = async (): Promise<void> => {
    setVerifyingEmail(true)
    try {
      await api.post("/auth/api/v1/users/me/verify-email", {})
      addToast({
        type: "success",
        title: "Verification email sent",
        description: "Open the verification link from your email to finish.",
      })
      loadProfile()
    } catch {
      addToast({ type: "error", title: "Couldn't send verification email" })
    } finally {
      setVerifyingEmail(false)
    }
  }

  const handleEnable2FA = async (): Promise<void> => {
    try {
      const res = await api.post("/auth/api/v1/users/me/2fa/enable")
      const data = parseApiResponse<{ secret: string; qrCodeUrl: string }>(res.data)
      setTwoFactorSetup({ secret: data.secret, qrCodeUrl: data.qrCodeUrl })
      addToast({ type: "success", title: "2FA setup generated" })
    } catch {
      addToast({ type: "error", title: "Couldn't start 2FA" })
    }
  }

  const handleConfirm2FA = async (): Promise<void> => {
    if (!twoFactorCode.trim()) return
    try {
      await api.post("/auth/api/v1/users/me/2fa/confirm", { code: twoFactorCode })
      setTwoFactorCode("")
      setTwoFactorSetup(null)
      addToast({ type: "success", title: "2FA enabled" })
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Invalid 2FA code" })
    }
  }

  const handleDisable2FA = async (): Promise<void> => {
    if (!disable2faPassword.trim()) return
    try {
      await api.post("/auth/api/v1/users/me/2fa/disable", { password: disable2faPassword })
      setDisable2faPassword("")
      addToast({ type: "success", title: "2FA disabled" })
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Couldn't disable 2FA" })
    }
  }

  const handleRevokeSession = async (tokenId: string): Promise<void> => {
    if (revokingSessionId) return
    setRevokingSessionId(tokenId)
    try {
      await api.delete(`/auth/api/v1/users/me/sessions/${tokenId}`)
      addToast({ type: "success", title: "Session revoked" })
      loadSessions()
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Couldn't revoke session" })
    } finally {
      setRevokingSessionId(null)
    }
  }

  const handleRevokeAllSessions = async (): Promise<void> => {
    if (!revokeAllPassword.trim()) return
    try {
      await api.post("/auth/api/v1/users/me/sessions/revoke-all", { password: revokeAllPassword })
      setRevokeAllPassword("")
      addToast({ type: "success", title: "All sessions revoked" })
      loadSessions()
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Couldn't revoke sessions" })
    }
  }

  const handleDeleteAccount = async (): Promise<void> => {
    if (!deletePassword.trim() || deletingAccount) return
    setDeletingAccount(true)
    try {
      await api.delete("/auth/api/v1/users/me", { data: { password: deletePassword } })
      useAuthStore.getState().clearAuth()
      clearCsrfToken()
      addToast({ type: "success", title: "Account deleted" })
      router.push("/auth/login")
    } catch {
      addToast({ type: "error", title: "Couldn't delete account" })
    } finally {
      setDeletingAccount(false)
    }
  }

  const handleSendFriendRequest = async (): Promise<void> => {
    const normalizedEmail = friendEmailInput.trim().toLowerCase()
    if (!normalizedEmail) return
    if (!isEmail(normalizedEmail)) {
      addToast({ type: "error", title: "Invalid email", description: "Enter your friend's account email." })
      return
    }
    try {
      await api.post("/auth/api/v1/friendships/requests/by-email", { email: normalizedEmail })
      setFriendEmailInput("")
      addToast({
        type: "success",
        title: "Invite sent",
        description: "If that email can receive friend requests, the request is on its way.",
      })
      loadFriends()
    } catch (error: unknown) {
      addToast({ type: "error", title: "Couldn't send invite", description: getApiErrorMessage(error) || "Couldn't send invite" })
    }
  }

  const handleSendFriendRequestById = async (): Promise<void> => {
    const normalizedId = friendIdInput.trim()
    if (!normalizedId) return
    if (!isGuid(normalizedId)) {
      addToast({
        type: "error",
        title: "Invalid user ID",
        description: "Use a GUID like 00000000-0000-0000-0000-000000000000",
      })
      return
    }
    try {
      await api.post("/friendships/requests", { friendId: normalizedId })
      setFriendIdInput("")
      addToast({ type: "success", title: "Request sent" })
      loadFriends()
    } catch (error: unknown) {
      addToast({ type: "error", title: "Couldn't send request", description: getApiErrorMessage(error) || "Couldn't send request" })
    }
  }

  const handleCopyUserId = async (): Promise<void> => {
    if (!user?.id || typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(user.id)
    addToast({ type: "success", title: "User ID copied" })
  }

  const handleAcceptFriendRequest = async (friendshipId: string): Promise<void> => {
    if (respondingRequestId) return
    setRespondingRequestId(friendshipId)
    try {
      await api.post(`/friendships/requests/${friendshipId}/accept`)
      addToast({ type: "success", title: "Friend added" })
      invalidateFriends()
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Couldn't accept request" })
    } finally {
      setRespondingRequestId(null)
    }
  }

  const handleRejectFriendRequest = async (friendshipId: string): Promise<void> => {
    try {
      await api.post(`/friendships/requests/${friendshipId}/reject`)
      addToast({ type: "success", title: "Request rejected" })
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Couldn't reject request" })
    }
  }

  const handleRemoveFriend = async (friendId: string): Promise<void> => {
    try {
      await api.delete(`/friendships/${friendId}`)
      addToast({ type: "success", title: "Friend removed" })
      invalidateFriends()
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Couldn't remove friend" })
    }
  }

  const handleLoadUserDetail = async (userId: string): Promise<void> => {
    try {
      const res = await api.get(`/auth/api/v1/users/${userId}`)
      setSelectedUser(parseApiResponse<UserDetailDto>(res.data))
    } catch {
      addToast({ type: "error", title: "Couldn't load user" })
    }
  }

  const twoFactorQrSrc = twoFactorSetup
    ? twoFactorSetup.qrCodeUrl.startsWith("data:")
      ? twoFactorSetup.qrCodeUrl
      : `data:image/png;base64,${twoFactorSetup.qrCodeUrl}`
    : ""

  /* ---------------- Arrival ---------------- */

  // The identity card lands first and its contents follow it in reading order — the
  // photo, the name, the address, the pills, then the figures. Each part that shows the
  // account waits for it: arriving as "Your profile", "U" and "2FA off" and then changing
  // would be a second, unasked-for entrance. The rail comes in beside the card, and the
  // sections below arrive as they scroll into view.
  const heroReady = profileReady && securityReady
  const avatarIn = useEnter("chip", { at: 90, ready: profileReady })
  const nameIn = useEnter("text", { at: 140, ready: profileReady })
  const emailIn = useEnter("text", { at: 190, ready: profileReady })
  const pillsIn = useEnterEach("chip", { at: 240, ready: heroReady })
  const railItemsIn = useEnterEach("row", { at: 200 })

  /* ---------------- Render ---------------- */

  return (
    <div className="min-w-0 overflow-x-clip pb-24">
      {/* ============ IDENTITY HEADER ============ */}
      <Enter
        as="section"
        tier="hero"
        ref={setSectionRef("profile")}
        id="profile-header"
        className={cn(CARD, "overflow-hidden")}
      >
        <div className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-5 sm:gap-6">
            <div
              className={cn("relative flex-shrink-0", avatarIn.className)}
              style={avatarIn.style}
              onDragOver={(e) => {
                e.preventDefault()
                setAvatarDragOver(true)
              }}
              onDragLeave={() => setAvatarDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setAvatarDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file) handleAvatarUpload(file)
              }}
            >
              <label
                className={cn(
                  "group relative block h-24 w-24 cursor-pointer overflow-hidden rounded-xl border border-line",
                  avatarDragOver && "ring-2 ring-ink ring-offset-2"
                )}
              >
                <Avatar
                  src={user?.profilePictureUrl}
                  firstName={user?.firstName}
                  lastName={user?.lastName}
                  email={user?.email}
                  size={96}
                  className="h-full w-full rounded-xl"
                />
                <span
                  className={cn(
                    "absolute inset-0 flex items-center justify-center transition-opacity duration-base",
                    avatarUploading
                      ? "bg-paper/75 opacity-100/75"
                      : "bg-ink/40 text-paper opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  )}
                >
                  {avatarUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-ink-muted" aria-hidden />
                  ) : (
                    <Camera className="h-6 w-6" aria-hidden />
                  )}
                </span>
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*"
                  aria-label="Upload profile photo"
                  disabled={avatarUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleAvatarUpload(file)
                    e.currentTarget.value = ""
                  }}
                />
              </label>
            </div>

            <div className="min-w-0 flex-1 basis-64">
              <h1
                className={cn("truncate text-title font-bold leading-tight tracking-tight text-ink md:text-display-sm", nameIn.className)}
                style={nameIn.style}
              >
                {displayName}
              </h1>
              <p className={cn("mt-1.5 truncate text-body-sm font-semibold text-ink-subtle", emailIn.className)} style={emailIn.style}>
                {user?.email || "—"}
              </p>
              <div className={cn("mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2", pillsIn.className)} style={pillsIn.style}>
                <StatusPill active={isEmailVerified}>
                  {isEmailVerified ? "Verified email" : "Email pending"}
                </StatusPill>
                <StatusPill active={!!security?.twoFactorEnabled}>
                  {security?.twoFactorEnabled ? "2FA enabled" : "2FA off"}
                </StatusPill>
                {isAdmin && <StatusPill active>Admin</StatusPill>}
              </div>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-gray-200 sm:grid-cols-4">
            <MetricTile at={300} index={0} ready={heroReady} label="Active sessions" value={security?.activeSessionsCount ?? sessions.length ?? "—"} />
            <MetricTile at={300} index={1} ready={heroReady} label="Member since" value={formatDateShort(user?.createdAt)} />
            <MetricTile at={300} index={2} ready={heroReady} label="Last login" value={formatDateShort(user?.lastLoginAt)} />
            <MetricTile at={300} index={3} ready={heroReady} label="Role" value={roles.length ? roles.join(", ") : "User"} />
          </dl>
        </div>
      </Enter>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[268px_minmax(0,1fr)] lg:gap-8">
        {/* ============ RAIL ============ */}
        <div className="lg:sticky lg:top-[var(--bar-clearance)] lg:self-start">
          <Enter
            as="nav"
            tier="panel"
            at={150}
            aria-label="Profile sections"
            className={cn(CARD, "p-1.5")}
          >
            {/* `overflow-y-hidden`: on phones this row scrolls sideways, and an item rising
                into place would otherwise make it scroll downwards for a moment too. */}
            <ul
              className={cn("flex gap-1 overflow-x-auto overflow-y-hidden p-0.5 lg:flex-col lg:overflow-visible", railItemsIn.className)}
              style={railItemsIn.style}
            >
              {availableSections.map((section) => {
                const Icon = section.icon
                const badge = sectionBadges[section.id]
                const isActive = activeSection === section.id
                return (
                  <li key={section.id} className="min-w-[196px] flex-shrink-0 lg:min-w-0 lg:flex-shrink">
                    <motion.button
                      type="button"
                      onClick={() => goToSection(section.id)}
                      whileTap={prefersReducedMotion ? undefined : { scale: 0.985 }}
                      transition={TWEEN_FAST}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "relative flex w-full items-center gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors duration-fast",
                        !isActive && "hover:bg-paper-sunken"
                      )}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="rail-active-pill"
                          className="absolute inset-0 rounded-lg bg-gray-100"
                          transition={
                            prefersReducedMotion
                              ? { duration: 0 }
                              : { type: "spring", stiffness: 420, damping: 34 }
                          }
                          aria-hidden
                        />
                      )}
                      <span
                        className={cn(
                          "relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                          isActive
                            ? "border-line bg-paper text-ink"
                            : "border-transparent text-ink-subtle"
                        )}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                      </span>
                      <span className="relative z-10 min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-body-sm font-bold tracking-tight",
                            isActive ? "text-ink" : "text-ink-muted"
                          )}
                        >
                          {section.label}
                        </span>
                        <span className="block truncate text-caption font-semibold text-ink-muted">
                          {section.description}
                        </span>
                      </span>
                      {badge !== undefined && badge !== null && (
                        // A count arrives when its section's data does, usually after
                        // the rail: it pops in as a chip, never just appears.
                        <Enter
                          as="span"
                          tier="chip"
                          at={420}
                          className={cn(
                            "relative z-10 flex-shrink-0 rounded-full px-2 py-1 text-caption font-bold tabular-nums",
                            isActive
                              ? "border border-line bg-paper text-ink-subtle"
                              : "bg-gray-100 text-ink-subtle"
                          )}
                        >
                          {badge}
                        </Enter>
                      )}
                    </motion.button>
                  </li>
                )
              })}
            </ul>
          </Enter>

          <Enter tier="panel" at={290} ready={heroReady} className={cn(CARD, "mt-3.5 hidden p-5 lg:block")}>
            <p className={LABEL}>Account health</p>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-display-sm font-bold leading-none tracking-tight text-ink">
                {30 + (security?.twoFactorEnabled ? 34 : 0) + (security?.failedLoginAttempts ? 0 : 20) + 16}
              </span>
              <span className="text-body-sm font-bold text-ink-subtle">/ 100</span>
            </div>
            <EnterEach as="ul" tier="text" at={400} ready={heroReady} className="mt-4 space-y-2.5">
              <li className="flex items-center gap-2.5 text-caption font-bold text-ink-muted">
                <Check className="h-4 w-4 text-ink" aria-hidden />
                Email {isEmailVerified ? "verified" : "pending"}
              </li>
              <li className="flex items-center gap-2.5 text-caption font-bold text-ink-muted">
                <Fingerprint
                  className={cn(
                    "h-4 w-4",
                    security?.twoFactorEnabled ? "text-ink" : "text-ink-subtle"
                  )}
                  aria-hidden
                />
                Two-factor · {security?.twoFactorEnabled ? "on" : "off"}
              </li>
              <li className="flex items-center gap-2.5 text-caption font-bold text-ink-muted">
                <Monitor className="h-4 w-4 text-ink-subtle" aria-hidden />
                {security?.activeSessionsCount ?? sessions.length ?? 0} active sessions
              </li>
            </EnterEach>
          </Enter>
        </div>

        {/* ============ CONTENT ============ */}
        {/* Each section arrives as it scrolls into view: its heading line by line, then
            each card as the reader reaches it (`SectionCard`). The ones on the first
            screen arrive on the page's timeline, after the identity card. */}
        <div className="flex min-w-0 flex-col gap-11">
          {/* ---------- PROFILE ---------- */}
          <EnterInView as="section" at={260} id="profile" aria-labelledby="section-profile" className="scroll-mt-[var(--bar-clearance)]">
            <SectionHeading id="section-profile" index="01" title="Profile" description="Your name, avatar and account details." />
            <div className="flex flex-col gap-4">
              <SectionCard
                icon={IdCard}
                title="Profile details"
                description="Keep the name your friends see current."
                action={
                  <Button variant="secondary" size="sm" onClick={loadProfile} disabled={loadingProfile}>
                    <RefreshCw className={cn("h-4 w-4", loadingProfile && "animate-spin")} aria-hidden />
                    Refresh
                  </Button>
                }
              >
                <SkeletonSwap loading={loadingProfile || !profileReady} skeleton={<LoadingRows count={2} />}>
                  <Enter tier="row" at={CARD_BODY_AT}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldGroup label="First name">
                        {(field) => (
                        <Input
                          {...field}
                          value={profileForm.firstName}
                          onChange={(e) => setProfileForm((s) => ({ ...s, firstName: e.target.value }))}
                          maxLength={100}
                          showCount
                        />
                        )}
                      </FieldGroup>
                      <FieldGroup label="Last name">
                        {(field) => (
                        <Input
                          {...field}
                          value={profileForm.lastName}
                          onChange={(e) => setProfileForm((s) => ({ ...s, lastName: e.target.value }))}
                          maxLength={100}
                          showCount
                        />
                        )}
                      </FieldGroup>
                    </div>

                    <div className="my-5 h-px bg-gray-100" />

                    <div
                      className="flex flex-wrap items-center gap-4"
                      onDragOver={(e) => {
                        e.preventDefault()
                        setAvatarDragOver(true)
                      }}
                      onDragLeave={() => setAvatarDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setAvatarDragOver(false)
                        const file = e.dataTransfer.files[0]
                        if (file) handleAvatarUpload(file)
                      }}
                    >
                      <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-paper">
                        {resolvedAvatarUrl && !avatarError ? (
                          <Image
                            src={resolvedAvatarUrl}
                            alt="Profile"
                            fill
                            className="object-cover"
                            onError={() => setAvatarError(true)}
                            sizes="56px"
                            unoptimized
                          />
                        ) : (
                          <span className="text-title-sm font-bold text-ink">{initials}</span>
                        )}
                        {avatarUploading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-paper/80/80">
                            <Loader2 className="h-5 w-5 animate-spin text-ink-muted" aria-hidden />
                          </div>
                        )}
                      </div>

                      <label
                        className={cn(
                          "group flex min-w-0 flex-1 basis-56 cursor-pointer select-none items-center gap-3 rounded-lg border border-dashed px-4 py-3.5 transition-colors duration-base",
                          avatarDragOver
                            ? "border-ink bg-ink/[0.04]"
                            : "border-line hover:border-gray-400 hover:bg-paper-sunken",
                          avatarUploading && "pointer-events-none opacity-60"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                            avatarDragOver
                              ? "border-ink bg-ink text-paper"
                              : "border-line bg-paper text-ink-subtle"
                          )}
                        >
                          {avatarDragOver ? <Upload className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-caption font-bold text-ink">
                            {avatarDragOver ? "Drop to upload" : "Click or drag a photo to upload"}
                          </span>
                          <span className="mt-0.5 block text-caption font-semibold text-ink-muted">
                            JPG, PNG, WEBP · max 5 MB
                          </span>
                        </span>
                        <input
                          type="file"
                          className="sr-only"
                          accept="image/*"
                          aria-label="Upload profile photo"
                          disabled={avatarUploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleAvatarUpload(file)
                            e.currentTarget.value = ""
                          }}
                        />
                      </label>

                      {user?.profilePictureUrl && (
                        <Button variant="secondary" size="sm" onClick={handleRemoveAvatar}>
                          Remove
                        </Button>
                      )}
                      <Button onClick={handleProfileSave} loading={savingProfile} className="flex-shrink-0">
                        Save changes
                      </Button>
                    </div>
                  </Enter>
                </SkeletonSwap>
              </SectionCard>

              <SectionCard icon={BadgeCheck} title="Account" description="Read-only account metadata." at={220}>
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-gray-200 xl:grid-cols-4">
                  <MetricTile index={0} ready={profileReady} label="Email" value={user?.email || "—"} />
                  <MetricTile index={1} ready={profileReady} label="Verified" value={isEmailVerified ? "Yes" : "No"} />
                  <MetricTile index={2} ready={profileReady} label="Last login" value={formatDate(user?.lastLoginAt)} />
                  <MetricTile index={3} ready={profileReady} label="Roles" value={roles.length ? roles.join(", ") : "User"} />
                </dl>
                <Enter
                  tier="row"
                  at={CARD_BODY_AT + 160}
                  ready={profileReady}
                  className="mt-3.5 flex items-center justify-between gap-4 rounded-lg border border-line bg-paper-sunken/80 px-4 py-3/40"
                >
                  <div className="min-w-0">
                    <span className={LABEL}>User ID</span>
                    <span className="mt-1.5 block truncate font-mono text-caption font-bold text-ink-muted">
                      {user?.id || "—"}
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleCopyUserId} className="flex-shrink-0">
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy
                  </Button>
                </Enter>
              </SectionCard>
            </div>
          </EnterInView>

          {/* ---------- SECURITY ---------- */}
          <EnterInView as="section" at={400} id="security" ref={setSectionRef("security")} aria-labelledby="section-security" className="scroll-mt-[var(--bar-clearance)]">
            <SectionHeading id="section-security" index="02" title="Security" description="Password, two-factor, sessions and account removal." />
            <div className="flex flex-col gap-4">
              <SectionCard
                icon={ShieldCheck}
                title="Overview"
                description="Current account protection at a glance."
                action={
                  <Button variant="secondary" size="sm" onClick={loadSecurity} disabled={loadingSecurity}>
                    <RefreshCw className={cn("h-4 w-4", loadingSecurity && "animate-spin")} aria-hidden />
                    Refresh
                  </Button>
                }
              >
                <SkeletonSwap loading={loadingSecurity || !securityReady} skeleton={<LoadingRows count={2} />}>
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-gray-200 xl:grid-cols-3">
                    <MetricTile
                      index={0}
                      label="Two-factor"
                      value={security?.twoFactorEnabled ? "Enabled" : "Disabled"}
                      active={!!security?.twoFactorEnabled}
                    />
                    <MetricTile index={1} label="Active sessions" value={security?.activeSessionsCount ?? "—"} />
                    <MetricTile
                      index={2}
                      label="Failed attempts"
                      value={security?.failedLoginAttempts ?? "—"}
                      active={!security?.failedLoginAttempts}
                    />
                    <MetricTile index={3} label="Locked until" value={formatDate(security?.lockedUntil)} />
                    <MetricTile index={4} label="Password changed" value={formatDateShort(security?.lastPasswordChange)} />
                    <MetricTile index={5} label="Email changed" value={formatDateShort(security?.lastEmailChange)} />
                  </dl>
                </SkeletonSwap>
              </SectionCard>

              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard icon={KeyRound} title="Password" description="Change the password you sign in with." at={220} index={0}>
                  <Enter tier="row" at={CARD_BODY_AT} className="flex flex-1 flex-col">
                    <ChangePasswordForm onChanged={handlePasswordChanged} />
                  </Enter>
                </SectionCard>

                <SectionCard icon={Mail} title="Email" description="Change the address, or verify the one you have." at={220} index={1}>
                  <Enter tier="row" at={CARD_BODY_AT} className="flex flex-1 flex-col">
                    <ChangeEmailForm
                      currentEmail={user?.email}
                      verified={isEmailVerified}
                      onChanged={handleEmailChanged}
                      onResend={handleVerifyEmail}
                      resending={verifyingEmail}
                    />
                  </Enter>
                </SectionCard>
              </div>

              <SectionCard icon={Fingerprint} title="Two-factor authentication" description="Authenticator-based login protection." at={290}>
                {/* Keyed by state: turning two-factor on or off brings the new controls
                    in, instead of swapping them under the reader in one frame. */}
                {security?.twoFactorEnabled ? (
                  <Enter key="on" tier="row" at={CARD_BODY_AT} className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-line bg-paper-sunken text-ink-muted">
                        <Check className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <p className="text-body-sm font-bold text-ink">Two-factor is enabled</p>
                        <p className="text-caption font-semibold text-ink-muted">
                          A code is required at every new sign-in.
                        </p>
                      </div>
                    </div>
                    <div className="flex min-w-[220px] flex-1 gap-2 sm:max-w-md">
                      <Input
                        type="password"
                        placeholder="Password to disable"
                        aria-label="Your password, to turn off two-factor"
                        autoComplete="current-password"
                        value={disable2faPassword}
                        onChange={(e) => setDisable2faPassword(e.target.value)}
                      />
                      <Button variant="secondary" onClick={handleDisable2FA}>
                        Disable
                      </Button>
                    </div>
                  </Enter>
                ) : twoFactorSetup ? (
                  <Enter
                    key="setup"
                    tier="row"
                    at={CARD_BODY_AT}
                    className="mx-auto grid max-w-3xl items-center gap-6 sm:grid-cols-[auto_minmax(220px,1fr)]"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-32 w-32 flex-shrink-0 overflow-hidden rounded-md border border-line bg-paper p-2">
                        {twoFactorQrSrc && (
                          <Image
                            src={twoFactorQrSrc}
                            alt="Two-factor QR code"
                            width={116}
                            height={116}
                            className="h-full w-full"
                            unoptimized
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className={LABEL}>Manual key</span>
                        <code className="mt-2 block break-all rounded-md border border-line bg-gray-100 px-2.5 py-2 font-mono text-caption font-bold text-ink">
                          {twoFactorSetup.secret}
                        </code>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <p className="text-caption font-semibold leading-relaxed text-ink-muted">
                        Scan the code with an authenticator app, then enter the 6-digit code it shows.
                      </p>
                      <Input
                        inputMode="numeric"
                        placeholder="000000"
                        aria-label="Six-digit verification code"
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="text-center font-bold tracking-widest"
                      />
                      <div className="flex gap-2">
                        <Button onClick={handleConfirm2FA} className="flex-1">
                          Enable two-factor
                        </Button>
                        <Button variant="secondary" onClick={() => setTwoFactorSetup(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </Enter>
                ) : (
                  <Enter key="off" tier="row" at={CARD_BODY_AT} className="flex flex-wrap items-center justify-between gap-4">
                    <p className="min-w-0 flex-1 basis-64 text-body-sm font-semibold leading-relaxed text-ink-subtle">
                      Add a second step at sign-in with any authenticator app for stronger protection.
                    </p>
                    <Button onClick={handleEnable2FA}>
                      <ShieldCheck className="h-4 w-4" aria-hidden />
                      Enable two-factor
                    </Button>
                  </Enter>
                )}
              </SectionCard>

              <div className="grid gap-4 md:grid-cols-2">
                <SectionCard icon={LogOut} title="Session control" description="End all other signed-in sessions." at={360} index={0}>
                  <Enter tier="row" at={CARD_BODY_AT} className="flex flex-1 flex-col">
                    <p className="text-caption font-semibold leading-relaxed text-ink-muted">
                      Keeps this device signed in and revokes every other active session.
                    </p>
                    <div className="mt-auto flex gap-2 pt-4">
                      <Input
                        type="password"
                        placeholder="Your password"
                        aria-label="Your password, to sign out other sessions"
                        autoComplete="current-password"
                        value={revokeAllPassword}
                        onChange={(e) => setRevokeAllPassword(e.target.value)}
                      />
                      <Button variant="secondary" onClick={handleRevokeAllSessions}>
                        Revoke all
                      </Button>
                    </div>
                  </Enter>
                </SectionCard>

                <SectionCard icon={Trash2} title="Delete account" description="Permanent and irreversible." at={360} index={1}>
                  <Enter tier="row" at={CARD_BODY_AT} className="flex flex-1 flex-col">
                    <p className="text-caption font-semibold leading-relaxed text-ink-muted">
                      Erases your profile, tasks and shares. This cannot be undone.
                    </p>
                    <div className="mt-auto flex gap-2 pt-4">
                      <Input
                        type="password"
                        placeholder="Confirm with password"
                        aria-label="Your password, to delete your account"
                        autoComplete="current-password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                      />
                      <Button variant="destructive" onClick={handleDeleteAccount} loading={deletingAccount}>
                        Delete
                      </Button>
                    </div>
                  </Enter>
                </SectionCard>
              </div>
            </div>
          </EnterInView>

          {/* ---------- SESSIONS ---------- */}
          <EnterInView as="section" at={540} id="sessions" ref={setSectionRef("sessions")} aria-labelledby="section-sessions" className="scroll-mt-[var(--bar-clearance)]">
            <SectionHeading id="section-sessions" index="03" title="Sessions" description="Devices currently signed in to your account." />
            <SectionCard
              icon={Monitor}
              title="Active sessions"
              description="Revoke any device you don't recognise."
              action={
                <Button variant="secondary" size="sm" onClick={loadSessions} disabled={loadingSessions}>
                  <RefreshCw className={cn("h-4 w-4", loadingSessions && "animate-spin")} aria-hidden />
                  Refresh
                </Button>
              }
            >
              <SkeletonSwap loading={loadingSessions || !loaded.has("sessions")} skeleton={<LoadingRows count={3} />}>
                {sessions.length ? (
                  <EnterEach as="ul" tier="row" at={CARD_BODY_AT} className="space-y-2.5">
                    {sessions.map((session) => {
                      const mobile = /iphone|android|mobile|ios/i.test(`${session.deviceName} ${session.browser}`)
                      const DeviceIcon = mobile ? Smartphone : Monitor
                      return (
                        <li
                          key={session.id}
                          className={cn(
                            "flex items-center gap-4 rounded-lg border p-4",
                            session.isCurrent
                              ? "border-line border-l-[3px] border-l-ink bg-paper-sunken"
                              : "border-line"
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md",
                              session.isCurrent
                                ? "bg-ink text-paper"
                                : "bg-gray-100 text-ink-subtle"
                            )}
                          >
                            <DeviceIcon className="h-4 w-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-body-sm font-bold text-ink">
                                {session.deviceName || "Device"} · {session.browser || "Browser"}
                              </span>
                              {session.isCurrent && (
                                <span className="text-caption font-bold uppercase tracking-wider text-ink-muted">
                                  This device
                                </span>
                              )}
                            </div>
                            <p className="mt-1 truncate font-mono text-caption font-semibold text-ink-muted">
                              {session.ipAddress || "—"} · {session.location || "Unknown"} · {formatDate(session.lastActivityAt || session.createdAt)}
                            </p>
                          </div>
                          {session.isCurrent ? (
                            <span className="flex-shrink-0 text-caption font-bold text-ink-muted">Active</span>
                          ) : (
                            <Button size="sm" variant="secondary" loading={revokingSessionId === session.id} onClick={() => handleRevokeSession(session.id)}>
                              Revoke
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </EnterEach>
                ) : (
                  <EmptyState icon={Monitor} title="No active sessions" description="New sessions will appear here after sign-in." />
                )}
              </SkeletonSwap>
            </SectionCard>
          </EnterInView>

          {/* ---------- HISTORY ---------- */}
          <EnterInView as="section" at={680} id="history" ref={setSectionRef("history")} aria-labelledby="section-history" className="scroll-mt-[var(--bar-clearance)]">
            <SectionHeading id="section-history" index="04" title="History" description="Recent authentication activity." />
            <SectionCard
              icon={HistoryIcon}
              title="Sign-in events"
              description="Newest first."
              action={
                <Button variant="secondary" size="sm" onClick={() => loadHistory(historyPage)} disabled={loadingHistory}>
                  <RefreshCw className={cn("h-4 w-4", loadingHistory && "animate-spin")} aria-hidden />
                  Refresh
                </Button>
              }
            >
              <SkeletonSwap loading={loadingHistory || !loaded.has("history")} skeleton={<LoadingRows count={4} />}>
                {history?.items.length ? (
                  <>
                    <EnterEach as="ul" tier="row" at={CARD_BODY_AT} className="space-y-2">
                      {history.items.map((entry) => (
                        <li
                          key={entry.id}
                          className="flex items-center gap-4 rounded-lg border border-line p-3.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-caption font-bold text-ink">
                              {formatDate(entry.loginAt)}
                            </div>
                            <p className="mt-0.5 truncate text-caption font-semibold text-ink-muted">
                              {[entry.browser, entry.device].filter(Boolean).join(" · ") || entry.userAgent} · {entry.location || "Unknown"} · {entry.ipAddress}
                            </p>
                            {!entry.isSuccessful && entry.failureReason && (
                              <p className="mt-1 text-caption font-bold text-ink-muted">
                                Reason: {entry.failureReason}
                              </p>
                            )}
                          </div>
                          <span
                            aria-hidden
                            className={cn(
                              "h-2 w-2 flex-shrink-0 rounded-full",
                              entry.isSuccessful ? "bg-gray-300" : "bg-ink"
                            )}
                          />
                          <span
                            className={cn(
                              "w-14 flex-shrink-0 text-right text-caption font-bold",
                              entry.isSuccessful ? "text-ink-subtle" : "text-ink"
                            )}
                          >
                            {entry.isSuccessful ? "Success" : "Failed"}
                          </span>
                        </li>
                      ))}
                    </EnterEach>
                    <Pager
                      order={history.items.length}
                      previousDisabled={!history?.hasPreviousPage}
                      nextDisabled={!history?.hasNextPage}
                      onPrevious={() => {
                        if (!history?.hasPreviousPage) return
                        const p = historyPage - 1
                        setHistoryPage(p)
                        loadHistory(p)
                      }}
                      onNext={() => {
                        if (!history?.hasNextPage) return
                        const p = historyPage + 1
                        setHistoryPage(p)
                        loadHistory(p)
                      }}
                      label={`Page ${history.pageNumber} of ${history.totalPages || 1} · ${history.totalCount} events`}
                    />
                  </>
                ) : (
                  <EmptyState icon={HistoryIcon} title="No login history" description="Authentication events will appear here." />
                )}
              </SkeletonSwap>
            </SectionCard>
          </EnterInView>

          {/* ---------- FRIENDS ---------- */}
          <EnterInView as="section" at={820} id="friends" ref={setSectionRef("friends")} aria-labelledby="section-friends" className="scroll-mt-[var(--bar-clearance)]">
            <SectionHeading id="section-friends" index="05" title="Friends" description="People you can share tasks with." />
            <div className="flex flex-col gap-4">
              <SectionCard icon={UserPlus} title="Add a friend" description="By account email, or by their User ID.">
                <Enter tier="row" at={CARD_BODY_AT} className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="By email">
                    {(field) => (
                    <div className="flex gap-2">
                      <Input
                        {...field}
                        type="email"
                        autoComplete="off"
                        placeholder="friend@planora.app"
                        value={friendEmailInput}
                        onChange={(e) => setFriendEmailInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendFriendRequest()
                        }}
                      />
                      <Button onClick={handleSendFriendRequest}>
                        <Send className="h-4 w-4" aria-hidden />
                        Send
                      </Button>
                    </div>
                    )}
                  </FieldGroup>
                  <FieldGroup label="By user ID">
                    {(field) => (
                    <div className="flex gap-2">
                      <Input
                        {...field}
                        autoComplete="off"
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={friendIdInput}
                        onChange={(e) => setFriendIdInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendFriendRequestById()
                        }}
                        className="font-mono text-caption"
                      />
                      <Button variant="secondary" onClick={handleSendFriendRequestById}>
                        Add
                      </Button>
                    </div>
                    )}
                  </FieldGroup>
                </Enter>
              </SectionCard>

              <div className="grid items-start gap-4 md:grid-cols-2">
                <SectionCard
                  icon={ArrowLeft}
                  title="Incoming"
                  description="Awaiting your decision."
                  at={220}
                  index={0}
                  action={
                    <Enter
                      as="span"
                      tier="chip"
                      at={CARD_BODY_AT}
                      ready={friendsReady}
                      className="rounded-full bg-gray-100 px-2.5 py-1 text-caption font-bold text-ink-muted"
                    >
                      {incomingRequests.length}
                    </Enter>
                  }
                >
                  <SkeletonSwap loading={!friendsReady} skeleton={<LoadingRows count={1} />}>
                    {incomingRequests.length ? (
                      <EnterEach as="ul" tier="row" at={CARD_BODY_AT} className="space-y-2.5">
                        {incomingRequests.map((request) => (
                          <li
                            key={request.friendshipId}
                            className="flex items-center gap-3 rounded-lg border border-line p-2.5"
                          >
                            <Avatar
                              src={request.profilePictureUrl}
                              firstName={request.firstName}
                              lastName={request.lastName}
                              email={request.email}
                              size={38}
                              className="flex-shrink-0 rounded-full"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-caption font-bold text-ink">
                                {personName(request)}
                              </p>
                              <p className="truncate text-caption font-semibold text-ink-muted">{request.email}</p>
                            </div>
                            <Button size="sm" loading={respondingRequestId === request.friendshipId} onClick={() => handleAcceptFriendRequest(request.friendshipId)}>
                              <Check className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Reject request from ${personName(request)}`}
                              onClick={() => handleRejectFriendRequest(request.friendshipId)}
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </Button>
                          </li>
                        ))}
                      </EnterEach>
                    ) : (
                      <EmptyState icon={UserPlus} title="No incoming requests" />
                    )}
                  </SkeletonSwap>
                </SectionCard>

                <SectionCard
                  icon={ArrowRight}
                  title="Outgoing"
                  description="Waiting for a response."
                  at={220}
                  index={1}
                  action={
                    <Enter
                      as="span"
                      tier="chip"
                      at={CARD_BODY_AT}
                      ready={friendsReady}
                      className="rounded-full bg-gray-100 px-2.5 py-1 text-caption font-bold text-ink-muted"
                    >
                      {outgoingRequests.length}
                    </Enter>
                  }
                >
                  <SkeletonSwap loading={!friendsReady} skeleton={<LoadingRows count={1} />}>
                    {outgoingRequests.length ? (
                      <EnterEach as="ul" tier="row" at={CARD_BODY_AT} className="space-y-2.5">
                        {outgoingRequests.map((request) => (
                          <li
                            key={request.friendshipId}
                            className="flex items-center gap-3 rounded-lg border border-line p-2.5"
                          >
                            <Avatar
                              src={request.profilePictureUrl}
                              firstName={request.firstName}
                              lastName={request.lastName}
                              email={request.email}
                              size={38}
                              className="flex-shrink-0 rounded-full opacity-70"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-caption font-bold text-ink">
                                {personName(request)}
                              </p>
                              <p className="truncate text-caption font-semibold text-ink-muted">{request.email}</p>
                            </div>
                            <span className="text-caption font-bold uppercase tracking-wider text-ink-muted">
                              Pending
                            </span>
                          </li>
                        ))}
                      </EnterEach>
                    ) : (
                      <EmptyState icon={Send} title="No outgoing requests" />
                    )}
                  </SkeletonSwap>
                </SectionCard>
              </div>

              <SectionCard
                icon={UsersIcon}
                title="Friends"
                description="Accepted connections."
                at={290}
                action={
                  <Enter
                    as="span"
                    tier="chip"
                    at={CARD_BODY_AT}
                    ready={friendsReady}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-caption font-bold text-ink-muted"
                  >
                    {friends?.totalCount ?? 0}
                  </Enter>
                }
              >
                <SkeletonSwap loading={loadingFriends || !friendsReady} skeleton={<LoadingRows count={3} />}>
                  {friends?.items.length ? (
                    <>
                      <EnterEach as="ul" tier="row" at={CARD_BODY_AT} className="grid gap-2.5 sm:grid-cols-2">
                        {friends.items.map((friend) => (
                          <li
                            key={friend.id}
                            className="flex items-center gap-3 rounded-lg border border-line p-3 transition-[transform,border-color,box-shadow] duration-base hover:-translate-y-0.5 hover:border-line-strong hover:shadow-sm"
                          >
                            <Avatar
                              src={friend.profilePictureUrl}
                              firstName={friend.firstName}
                              lastName={friend.lastName}
                              email={friend.email}
                              size={40}
                              className="flex-shrink-0 rounded-full"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-caption font-bold text-ink">
                                {personName(friend)}
                              </p>
                              <p className="truncate text-caption font-semibold text-ink-muted">
                                Friends since {formatDateShort(friend.friendsSince)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Remove ${personName(friend)}`}
                              onClick={() => handleRemoveFriend(friend.id)}
                            >
                              <UserX className="h-4 w-4" aria-hidden />
                            </Button>
                          </li>
                        ))}
                      </EnterEach>
                      <Pager
                        order={friends.items.length}
                        previousDisabled={!friends?.hasPreviousPage}
                        nextDisabled={!friends?.hasNextPage}
                        onPrevious={() => {
                          if (!friends?.hasPreviousPage) return
                          const p = friendsPage - 1
                          setFriendsPage(p)
                          loadFriends(p)
                        }}
                        onNext={() => {
                          if (!friends?.hasNextPage) return
                          const p = friendsPage + 1
                          setFriendsPage(p)
                          loadFriends(p)
                        }}
                        label={`Page ${friends.pageNumber} of ${friends.totalPages || 1} · ${friends.totalCount} friends`}
                      />
                    </>
                  ) : (
                    <EmptyState icon={UsersIcon} title="No friends yet" description="Accepted friends will appear here." />
                  )}
                </SkeletonSwap>
              </SectionCard>
            </div>
          </EnterInView>

          {/* ---------- ADMIN (role-gated) ---------- */}
          {isAdmin && (
            <EnterInView as="section" at={960} id="admin" ref={setSectionRef("admin")} aria-labelledby="section-admin" className="scroll-mt-[var(--bar-clearance)]">
              <SectionHeading id="section-admin" index="06" title="Admin" description="Platform statistics and user operations." />
              <div className="flex flex-col gap-4">
                <SectionCard
                  icon={Activity}
                  title="Statistics"
                  description="Live account totals."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => loadAdmin(adminPage)} disabled={loadingAdmin}>
                      <RefreshCw className={cn("h-4 w-4", loadingAdmin && "animate-spin")} aria-hidden />
                      Refresh
                    </Button>
                  }
                >
                  <SkeletonSwap loading={!adminStats} skeleton={<LoadingRows count={2} />}>
                    {adminStats ? (
                      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-gray-200 sm:grid-cols-4">
                        <MetricTile index={0} label="Total users" value={adminStats.totalUsers} />
                        <MetricTile index={1} label="Active users" value={adminStats.activeUsers} />
                        <MetricTile index={2} label="Locked users" value={adminStats.lockedUsers} active={!adminStats.lockedUsers} />
                        <MetricTile index={3} label="2FA users" value={adminStats.usersWithTwoFactor} />
                        <MetricTile index={4} label="New today" value={adminStats.newUsersToday} />
                        <MetricTile index={5} label="This week" value={adminStats.newUsersThisWeek} />
                        <MetricTile index={6} label="This month" value={adminStats.newUsersThisMonth} />
                        <MetricTile index={7} label="Updated" value={formatDateShort(adminStats.lastUpdated)} />
                      </dl>
                    ) : null}
                  </SkeletonSwap>
                </SectionCard>

                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
                  <SectionCard icon={Search} title="User management" description="Search and filter accounts." at={220} index={0}>
                    <Enter tier="row" at={CARD_BODY_AT} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Input
                        placeholder="Search name or email"
                        aria-label="Search users by name or email"
                        value={adminSearch}
                        onChange={(e) => setAdminSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setAdminPage(1)
                            loadAdmin(1)
                          }
                        }}
                      />
                      <Input placeholder="Status" aria-label="Filter by status" value={adminStatus} onChange={(e) => setAdminStatus(e.target.value)} />
                      <Input
                        type="date"
                        aria-label="Created from"
                        value={adminCreatedFrom}
                        onChange={(e) => setAdminCreatedFrom(e.target.value)}
                      />
                      <Input
                        type="date"
                        aria-label="Created to"
                        value={adminCreatedTo}
                        onChange={(e) => setAdminCreatedTo(e.target.value)}
                      />
                    </Enter>
                    <Enter tier="row" at={CARD_BODY_AT + 60} className="mt-3">
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAdminPage(1)
                          loadAdmin(1)
                        }}
                      >
                        <Search className="h-4 w-4" aria-hidden />
                        Apply filters
                      </Button>
                    </Enter>

                    <SkeletonSwap className="mt-4" loading={loadingAdmin || !loaded.has("admin")} skeleton={<LoadingRows count={4} />}>
                      {adminUsers?.items?.length ? (
                        <>
                          <EnterEach as="ul" tier="row" at={CARD_BODY_AT + 120} className="space-y-2">
                            {adminUsers.items.map((adminUser) => (
                              <li
                                key={adminUser.id}
                                className="flex items-center gap-3 rounded-lg border border-line p-3"
                              >
                                <Avatar
                                  firstName={adminUser.firstName}
                                  lastName={adminUser.lastName}
                                  email={adminUser.email}
                                  size={38}
                                  className="flex-shrink-0 rounded-full"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-caption font-bold text-ink">
                                    {personName(adminUser)}
                                  </p>
                                  <p className="truncate text-caption font-semibold text-ink-muted">
                                    {adminUser.email} · {adminUser.status}
                                  </p>
                                </div>
                                <Button size="sm" variant="secondary" onClick={() => handleLoadUserDetail(adminUser.id)}>
                                  View
                                </Button>
                              </li>
                            ))}
                          </EnterEach>
                          <Pager
                            order={adminUsers.items.length}
                            previousDisabled={!adminUsers.hasPreviousPage}
                            nextDisabled={!adminUsers.hasNextPage}
                            onPrevious={() => {
                              if (!adminUsers.hasPreviousPage) return
                              const p = adminPage - 1
                              setAdminPage(p)
                              loadAdmin(p)
                            }}
                            onNext={() => {
                              if (!adminUsers.hasNextPage) return
                              const p = adminPage + 1
                              setAdminPage(p)
                              loadAdmin(p)
                            }}
                            label={`Page ${adminUsers.pageNumber} of ${adminUsers.totalPages || 1}`}
                          />
                        </>
                      ) : (
                        <EmptyState icon={Search} title="No users found" />
                      )}
                    </SkeletonSwap>
                  </SectionCard>

                  <SectionCard icon={User} title="User detail" description="Selected account." at={220} index={1}>
                    {/* Keyed by the account: choosing another one brings its details in. */}
                    {selectedUser ? (
                      <Enter key={selectedUser.id} tier="row" at={CARD_BODY_AT} className="space-y-4">
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={selectedUser.profilePictureUrl}
                            firstName={selectedUser.firstName}
                            lastName={selectedUser.lastName}
                            email={selectedUser.email}
                            size={48}
                            className="flex-shrink-0 rounded-full"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-body font-bold text-ink">
                              {selectedUser.fullName || personName(selectedUser)}
                            </p>
                            <p className="truncate text-body-sm font-semibold text-ink-subtle">
                              {selectedUser.email}
                            </p>
                          </div>
                        </div>
                        <EnterEach tier="row" at={CARD_BODY_AT + 60} className="grid gap-2.5">
                          <InfoTile label="Status" value={selectedUser.status} icon={Activity} />
                          <InfoTile
                            label="2FA"
                            value={selectedUser.twoFactorEnabled ? "Enabled" : "Disabled"}
                            icon={Fingerprint}
                          />
                          <InfoTile label="Locked until" value={formatDate(selectedUser.lockedUntil)} icon={Lock} />
                          <InfoTile label="Member since" value={formatDateShort(selectedUser.createdAt)} icon={CalendarDays} />
                        </EnterEach>
                      </Enter>
                    ) : (
                      <EmptyState icon={User} title="No user selected" description="Choose a user from the management list." />
                    )}
                  </SectionCard>
                </div>
              </div>
            </EnterInView>
          )}
        </div>
      </div>
    </div>
  )
}
