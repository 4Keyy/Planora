"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { motion, useReducedMotion } from "framer-motion"
import {
  Activity,
  AlertTriangle,
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
import { Input } from "@/components/ui/input"
import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import { EASE_OUT_EXPO, TWEEN_FAST } from "@/lib/animations"
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

const formatDate = (value?: string | null): string =>
  value ? new Date(value).toLocaleString() : "—"

const formatDateShort = (value?: string | null): string =>
  value ? new Date(value).toLocaleDateString() : "—"

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
  "rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_14px_38px_-26px_rgba(15,23,42,0.20)] dark:border-gray-800 dark:bg-gray-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_14px_38px_-26px_rgba(0,0,0,0.7)]"

const LABEL =
  "block text-[10px] font-black uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500"

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
        "inline-flex items-center gap-2 text-xs font-bold text-gray-700 dark:text-gray-300",
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-[7px] w-[7px] flex-shrink-0 rounded-full",
          active
            ? "bg-gray-950 dark:bg-gray-100"
            : "border-[1.5px] border-gray-300 dark:border-gray-600"
        )}
      />
      {children}
    </span>
  )
}

function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn(CARD, "flex h-full flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-400">
              <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black tracking-tight text-gray-950 dark:text-gray-50">
              {title}
            </h3>
            {description && (
              <p className="mt-0.5 truncate text-xs font-semibold text-gray-400 dark:text-gray-500">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className={cn("flex flex-1 flex-col p-5", bodyClassName)}>{children}</div>
    </section>
  )
}

/**
 * A single hairline data cell. Rendered inside a `<dl>` grid so a group of
 * MetricTiles forms an even spec-grid with 1px dividers and no colored fills.
 * `tone` is preserved for API compatibility but only drives the small status dot.
 */
function MetricTile({
  label,
  value,
  detail,
  active,
}: {
  icon?: LucideIcon
  label: string
  value: ReactNode
  detail?: ReactNode
  active?: boolean
}) {
  return (
    <div className="bg-white p-4 dark:bg-gray-900">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-2 flex items-baseline gap-2">
        <span className="truncate text-xl font-black tracking-tight text-gray-950 dark:text-gray-50">
          {value}
        </span>
        {active !== undefined && (
          <span
            aria-hidden
            className={cn(
              "h-[7px] w-[7px] flex-shrink-0 translate-y-[-2px] rounded-full",
              active ? "bg-gray-950 dark:bg-gray-100" : "border-[1.5px] border-gray-300 dark:border-gray-600"
            )}
          />
        )}
      </dd>
      {detail && (
        <p className="mt-1 truncate text-xs font-semibold text-gray-400 dark:text-gray-500">{detail}</p>
      )}
    </div>
  )
}

function InfoTile({ label, value, icon: Icon }: { label: string; value: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 dark:border-gray-800 dark:bg-gray-800/40">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" aria-hidden />}
        <span className={LABEL}>{label}</span>
      </div>
      <div className="mt-2 break-words text-sm font-black text-gray-950 dark:text-gray-50">{value}</div>
    </div>
  )
}

function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center dark:border-gray-700 dark:bg-gray-800/30">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-black text-gray-900 dark:text-gray-100">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-xs font-semibold text-gray-400 dark:text-gray-500">
          {description}
        </p>
      )}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className={LABEL}>{label}</span>
      {children}
    </label>
  )
}

function Pager({
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
  label,
}: {
  previousDisabled?: boolean
  nextDisabled?: boolean
  onPrevious: () => void
  onNext: () => void
  label?: string
}) {
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">{label ?? "Page controls"}</span>
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
          className="h-20 animate-pulse rounded-xl border border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-800/40"
        />
      ))}
    </div>
  )
}

function SectionHeading({ index, title, description }: { index: string; title: string; description: string }) {
  return (
    <div className="mb-4">
      <span className={LABEL}>{title} · {index}</span>
      <h2 className="mt-1.5 text-[clamp(20px,2.4vw,26px)] font-black tracking-tight text-gray-950 dark:text-gray-50">
        {title}
      </h2>
      <p className="mt-1 text-[13px] font-semibold text-gray-500 dark:text-gray-400">{description}</p>
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

  const [profileForm, setProfileForm] = useState({ firstName: "", lastName: "" })
  const [changePasswordForm, setChangePasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  })
  const [changeEmailForm, setChangeEmailForm] = useState({ newEmail: "", password: "" })

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
      addToast({ type: "error", title: "Failed to load profile" })
    } finally {
      setLoadingProfile(false)
    }
  }

  const loadSecurity = async (): Promise<void> => {
    if (loadingSecurity) return
    setLoadingSecurity(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/security")
      setSecurity(parseApiResponse<UserSecurityDto>(res.data))
    } catch {
      addToast({ type: "error", title: "Failed to load security info" })
    } finally {
      setLoadingSecurity(false)
    }
  }

  const loadSessions = async (): Promise<void> => {
    if (loadingSessions) return
    setLoadingSessions(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/sessions")
      setSessions(parseApiResponse<SessionDto[]>(res.data))
    } catch {
      addToast({ type: "error", title: "Failed to load sessions" })
    } finally {
      setLoadingSessions(false)
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
      addToast({ type: "error", title: "Failed to load history" })
    } finally {
      setLoadingHistory(false)
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
      addToast({ type: "error", title: "Failed to load friends" })
    } finally {
      setLoadingFriends(false)
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
      addToast({ type: "error", title: "Failed to load admin data" })
    } finally {
      setLoadingAdmin(false)
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

  // Lazy per-section loading preserved: each section fetches once, the first time
  // it scrolls into view (was: on tab switch). Manual "Refresh" buttons re-fetch.
  const loadedSections = useRef<Set<SectionId>>(new Set())
  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    if (loadedSections.current.has(activeSection)) return
    loadedSections.current.add(activeSection)
    if (activeSection === "sessions") loadSessions()
    else if (activeSection === "history") loadHistory()
    else if (activeSection === "friends") loadFriends()
    else if (activeSection === "admin") loadAdmin()
    // load* are plain async functions guarded by their loading flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, hasHydrated, isAuthenticated])

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
      addToast({ type: "error", title: "Failed to upload avatar" })
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
      addToast({ type: "error", title: "Failed to remove avatar" })
    }
  }

  const handleProfileSave = async (): Promise<void> => {
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
      addToast({ type: "error", title: "Failed to update profile" })
    }
  }

  const handleChangePassword = async (): Promise<void> => {
    if (changePasswordForm.newPassword !== changePasswordForm.confirmNewPassword) {
      addToast({ type: "error", title: "Passwords do not match" })
      return
    }
    try {
      await api.post("/auth/api/v1/users/me/change-password", changePasswordForm)
      setChangePasswordForm({ currentPassword: "", newPassword: "", confirmNewPassword: "" })
      addToast({ type: "success", title: "Password updated" })
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Failed to change password" })
    }
  }

  const handleChangeEmail = async (): Promise<void> => {
    try {
      await api.post("/auth/api/v1/users/me/change-email", changeEmailForm)
      updateUser({ email: changeEmailForm.newEmail })
      setChangeEmailForm({ newEmail: "", password: "" })
      addToast({ type: "success", title: "Email updated", description: "Verify your new email." })
      loadProfile()
    } catch {
      addToast({ type: "error", title: "Failed to change email" })
    }
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
      addToast({ type: "error", title: "Failed to send verification email" })
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
      addToast({ type: "error", title: "Failed to start 2FA" })
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
      addToast({ type: "error", title: "Failed to disable 2FA" })
    }
  }

  const handleRevokeSession = async (tokenId: string): Promise<void> => {
    try {
      await api.delete(`/auth/api/v1/users/me/sessions/${tokenId}`)
      addToast({ type: "success", title: "Session revoked" })
      loadSessions()
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Failed to revoke session" })
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
      addToast({ type: "error", title: "Failed to revoke sessions" })
    }
  }

  const handleDeleteAccount = async (): Promise<void> => {
    if (!deletePassword.trim()) return
    try {
      await api.delete("/auth/api/v1/users/me", { data: { password: deletePassword } })
      useAuthStore.getState().clearAuth()
      clearCsrfToken()
      addToast({ type: "success", title: "Account deleted" })
      router.push("/auth/login")
    } catch {
      addToast({ type: "error", title: "Failed to delete account" })
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
      addToast({ type: "error", title: getApiErrorMessage(error) || "Failed to send invite" })
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
      addToast({ type: "error", title: getApiErrorMessage(error) || "Failed to send request" })
    }
  }

  const handleCopyUserId = async (): Promise<void> => {
    if (!user?.id || typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(user.id)
    addToast({ type: "success", title: "User ID copied" })
  }

  const handleAcceptFriendRequest = async (friendshipId: string): Promise<void> => {
    try {
      await api.post(`/friendships/requests/${friendshipId}/accept`)
      addToast({ type: "success", title: "Friend added" })
      invalidateFriends()
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Failed to accept request" })
    }
  }

  const handleRejectFriendRequest = async (friendshipId: string): Promise<void> => {
    try {
      await api.post(`/friendships/requests/${friendshipId}/reject`)
      addToast({ type: "success", title: "Request rejected" })
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Failed to reject request" })
    }
  }

  const handleRemoveFriend = async (friendId: string): Promise<void> => {
    try {
      await api.delete(`/friendships/${friendId}`)
      addToast({ type: "success", title: "Friend removed" })
      invalidateFriends()
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Failed to remove friend" })
    }
  }

  const handleLoadUserDetail = async (userId: string): Promise<void> => {
    try {
      const res = await api.get(`/auth/api/v1/users/${userId}`)
      setSelectedUser(parseApiResponse<UserDetailDto>(res.data))
    } catch {
      addToast({ type: "error", title: "Failed to load user" })
    }
  }

  const twoFactorQrSrc = twoFactorSetup
    ? twoFactorSetup.qrCodeUrl.startsWith("data:")
      ? twoFactorSetup.qrCodeUrl
      : `data:image/png;base64,${twoFactorSetup.qrCodeUrl}`
    : ""

  /* ---------------- Render ---------------- */

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
      className="min-w-0 overflow-x-hidden pb-24"
    >
      {/* ============ IDENTITY HEADER ============ */}
      <section
        ref={setSectionRef("profile")}
        id="profile-header"
        className={cn(CARD, "overflow-hidden")}
      >
        <div className="p-6 sm:p-7">
          <div className="flex flex-wrap items-center gap-5 sm:gap-6">
            <div
              className="relative flex-shrink-0"
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
                  "group relative block h-[88px] w-[88px] cursor-pointer overflow-hidden rounded-[18px] border border-gray-200 dark:border-gray-800",
                  avatarDragOver && "ring-2 ring-gray-950 ring-offset-2 dark:ring-gray-100 dark:ring-offset-gray-900"
                )}
              >
                <Avatar
                  src={user?.profilePictureUrl}
                  firstName={user?.firstName}
                  lastName={user?.lastName}
                  email={user?.email}
                  size={88}
                  className="h-full w-full rounded-[18px]"
                />
                <span
                  className={cn(
                    "absolute inset-0 flex items-center justify-center transition-opacity duration-200",
                    avatarUploading
                      ? "bg-white/75 opacity-100 dark:bg-gray-900/75"
                      : "bg-black/40 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  )}
                >
                  {avatarUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-gray-700 dark:text-gray-200" aria-hidden />
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
              <h1 className="truncate text-[clamp(25px,3.4vw,32px)] font-black leading-tight tracking-tight text-gray-950 dark:text-gray-50">
                {displayName}
              </h1>
              <p className="mt-1.5 truncate text-sm font-semibold text-gray-500 dark:text-gray-400">
                {user?.email || "—"}
              </p>
              <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
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

          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 sm:grid-cols-4">
            <MetricTile label="Active sessions" value={security?.activeSessionsCount ?? sessions.length ?? "—"} />
            <MetricTile label="Member since" value={formatDateShort(user?.createdAt)} />
            <MetricTile label="Last login" value={formatDate(user?.lastLoginAt)} />
            <MetricTile label="Role" value={roles.length ? roles.join(", ") : "User"} />
          </dl>
        </div>
      </section>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[268px_minmax(0,1fr)] lg:gap-8">
        {/* ============ RAIL ============ */}
        <div className="lg:sticky lg:top-5 lg:self-start">
          <nav
            aria-label="Profile sections"
            className={cn(CARD, "p-1.5")}
          >
            <ul className="flex gap-1 overflow-x-auto p-0.5 lg:flex-col lg:overflow-visible">
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
                        "flex w-full items-center gap-3 rounded-xl border border-transparent p-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-1 dark:focus-visible:ring-gray-100",
                        isActive
                          ? "bg-gray-100 dark:bg-gray-800"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                          isActive
                            ? "border-gray-200 bg-white text-gray-950 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-50"
                            : "border-transparent text-gray-400 dark:text-gray-500"
                        )}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2.4} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate text-sm font-black tracking-tight",
                            isActive ? "text-gray-950 dark:text-gray-50" : "text-gray-600 dark:text-gray-300"
                          )}
                        >
                          {section.label}
                        </span>
                        <span className="block truncate text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                          {section.description}
                        </span>
                      </span>
                      {badge !== undefined && badge !== null && (
                        <span
                          className={cn(
                            "flex-shrink-0 rounded-full px-2 py-1 text-[10px] font-black",
                            isActive
                              ? "border border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          )}
                        >
                          {badge}
                        </span>
                      )}
                    </motion.button>
                  </li>
                )
              })}
            </ul>
          </nav>

          <div className={cn(CARD, "mt-3.5 hidden p-5 lg:block")}>
            <p className={LABEL}>Account health</p>
            <div className="mt-3 flex items-baseline gap-1.5">
              <span className="text-4xl font-black leading-none tracking-tight text-gray-950 dark:text-gray-50">
                {30 + (security?.twoFactorEnabled ? 34 : 0) + (security?.failedLoginAttempts ? 0 : 20) + 16}
              </span>
              <span className="text-sm font-black text-gray-400 dark:text-gray-500">/ 100</span>
            </div>
            <ul className="mt-4 space-y-2.5">
              <li className="flex items-center gap-2.5 text-xs font-bold text-gray-700 dark:text-gray-300">
                <Check className="h-4 w-4 text-gray-950 dark:text-gray-100" aria-hidden />
                Email {isEmailVerified ? "verified" : "pending"}
              </li>
              <li className="flex items-center gap-2.5 text-xs font-bold text-gray-700 dark:text-gray-300">
                <Fingerprint
                  className={cn(
                    "h-4 w-4",
                    security?.twoFactorEnabled ? "text-gray-950 dark:text-gray-100" : "text-gray-400 dark:text-gray-500"
                  )}
                  aria-hidden
                />
                Two-factor · {security?.twoFactorEnabled ? "on" : "off"}
              </li>
              <li className="flex items-center gap-2.5 text-xs font-bold text-gray-700 dark:text-gray-300">
                <Monitor className="h-4 w-4 text-gray-500 dark:text-gray-400" aria-hidden />
                {security?.activeSessionsCount ?? sessions.length ?? 0} active sessions
              </li>
            </ul>
          </div>
        </div>

        {/* ============ CONTENT ============ */}
        <div className="flex min-w-0 flex-col gap-11">
          {/* ---------- PROFILE ---------- */}
          <section aria-labelledby="section-profile" className="scroll-mt-24">
            <SectionHeading index="01" title="Profile" description="Your name, avatar and account details." />
            <div className="flex flex-col gap-[18px]">
              <SectionCard
                icon={IdCard}
                title="Profile details"
                description="Keep your public account name current."
                action={
                  <Button variant="secondary" size="sm" onClick={loadProfile} disabled={loadingProfile}>
                    <RefreshCw className={cn("h-4 w-4", loadingProfile && "animate-spin")} aria-hidden />
                    Refresh
                  </Button>
                }
              >
                {loadingProfile ? (
                  <LoadingRows count={2} />
                ) : (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FieldGroup label="First name">
                        <Input
                          value={profileForm.firstName}
                          onChange={(e) => setProfileForm((s) => ({ ...s, firstName: e.target.value }))}
                          maxLength={100}
                          showCount
                        />
                      </FieldGroup>
                      <FieldGroup label="Last name">
                        <Input
                          value={profileForm.lastName}
                          onChange={(e) => setProfileForm((s) => ({ ...s, lastName: e.target.value }))}
                          maxLength={100}
                          showCount
                        />
                      </FieldGroup>
                    </div>

                    <div className="my-5 h-px bg-gray-100 dark:bg-gray-800" />

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
                      <div className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
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
                          <span className="text-lg font-black text-gray-800 dark:text-gray-200">{initials}</span>
                        )}
                        {avatarUploading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/80 dark:bg-gray-900/80">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-600 dark:text-gray-300" aria-hidden />
                          </div>
                        )}
                      </div>

                      <label
                        className={cn(
                          "group flex min-w-0 flex-1 basis-56 cursor-pointer select-none items-center gap-3 rounded-xl border-[1.5px] border-dashed px-4 py-3.5 transition-colors duration-200",
                          avatarDragOver
                            ? "border-gray-950 bg-gray-950/[0.04] dark:border-gray-100 dark:bg-gray-100/[0.06]"
                            : "border-gray-200 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-gray-500 dark:hover:bg-gray-800/40",
                          avatarUploading && "pointer-events-none opacity-60"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                            avatarDragOver
                              ? "border-gray-950 bg-gray-950 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                              : "border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500"
                          )}
                        >
                          {avatarDragOver ? <Upload className="h-4 w-4" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-black text-gray-800 dark:text-gray-200">
                            {avatarDragOver ? "Drop to upload" : "Click or drag a photo to upload"}
                          </span>
                          <span className="mt-0.5 block text-[10px] font-semibold text-gray-400 dark:text-gray-500">
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
                      <Button onClick={handleProfileSave} className="flex-shrink-0">
                        Save changes
                      </Button>
                    </div>
                  </>
                )}
              </SectionCard>

              <SectionCard icon={BadgeCheck} title="Account" description="Read-only account metadata.">
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 xl:grid-cols-4">
                  <MetricTile label="Email" value={user?.email || "—"} />
                  <MetricTile label="Verified" value={isEmailVerified ? "Yes" : "No"} />
                  <MetricTile label="Last login" value={formatDate(user?.lastLoginAt)} />
                  <MetricTile label="Roles" value={roles.length ? roles.join(", ") : "User"} />
                </dl>
                <div className="mt-3.5 flex items-center justify-between gap-4 rounded-xl border border-gray-100 bg-gray-50/80 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/40">
                  <div className="min-w-0">
                    <span className={LABEL}>User ID</span>
                    <span className="mt-1.5 block truncate font-mono text-xs font-bold text-gray-700 dark:text-gray-300">
                      {user?.id || "—"}
                    </span>
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleCopyUserId} className="flex-shrink-0">
                    <Copy className="h-4 w-4" aria-hidden />
                    Copy
                  </Button>
                </div>
              </SectionCard>
            </div>
          </section>

          {/* ---------- SECURITY ---------- */}
          <section ref={setSectionRef("security")} aria-labelledby="section-security" className="scroll-mt-24">
            <SectionHeading index="02" title="Security" description="Password, two-factor, sessions and account removal." />
            <div className="flex flex-col gap-[18px]">
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
                {loadingSecurity ? (
                  <LoadingRows count={2} />
                ) : (
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 xl:grid-cols-3">
                    <MetricTile
                      label="Two-factor"
                      value={security?.twoFactorEnabled ? "Enabled" : "Disabled"}
                      active={!!security?.twoFactorEnabled}
                    />
                    <MetricTile label="Active sessions" value={security?.activeSessionsCount ?? "—"} />
                    <MetricTile
                      label="Failed attempts"
                      value={security?.failedLoginAttempts ?? "—"}
                      active={!security?.failedLoginAttempts}
                    />
                    <MetricTile label="Locked until" value={formatDate(security?.lockedUntil)} />
                    <MetricTile label="Password changed" value={formatDateShort(security?.lastPasswordChange)} />
                    <MetricTile label="Email changed" value={formatDateShort(security?.lastEmailChange)} />
                  </dl>
                )}
              </SectionCard>

              <div className="grid gap-[18px] md:grid-cols-2">
                <SectionCard icon={KeyRound} title="Password" description="Update your credentials.">
                  <div className="flex flex-1 flex-col">
                    <div className="space-y-3">
                      <Input
                        type="password"
                        placeholder="Current password"
                        autoComplete="current-password"
                        value={changePasswordForm.currentPassword}
                        onChange={(e) => setChangePasswordForm((s) => ({ ...s, currentPassword: e.target.value }))}
                      />
                      <Input
                        type="password"
                        placeholder="New password"
                        autoComplete="new-password"
                        value={changePasswordForm.newPassword}
                        onChange={(e) => setChangePasswordForm((s) => ({ ...s, newPassword: e.target.value }))}
                      />
                      <Input
                        type="password"
                        placeholder="Confirm new password"
                        autoComplete="new-password"
                        value={changePasswordForm.confirmNewPassword}
                        onChange={(e) => setChangePasswordForm((s) => ({ ...s, confirmNewPassword: e.target.value }))}
                      />
                    </div>
                    <div className="mt-auto pt-4">
                      <Button onClick={handleChangePassword} className="w-full">
                        Update password
                      </Button>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard icon={Mail} title="Email" description="Change or re-verify your email.">
                  <div className="flex flex-1 flex-col">
                    <div className="space-y-3">
                      <div
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl border px-3.5 py-3",
                          isEmailVerified
                            ? "border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/40"
                            : "border-gray-300 bg-white dark:border-gray-700 dark:bg-gray-900"
                        )}
                      >
                        {isEmailVerified ? (
                          <Check className="h-4 w-4 flex-shrink-0 text-gray-950 dark:text-gray-100" aria-hidden />
                        ) : (
                          <AlertTriangle className="h-4 w-4 flex-shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-black text-gray-950 dark:text-gray-50">
                            {user?.email || "—"}
                          </span>
                          <span className="block text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                            {isEmailVerified ? "Verified" : "Not verified"}
                          </span>
                        </span>
                      </div>
                      <Input
                        type="email"
                        placeholder="New email address"
                        value={changeEmailForm.newEmail}
                        onChange={(e) => setChangeEmailForm((s) => ({ ...s, newEmail: e.target.value }))}
                      />
                      <Input
                        type="password"
                        placeholder="Confirm with password"
                        autoComplete="current-password"
                        value={changeEmailForm.password}
                        onChange={(e) => setChangeEmailForm((s) => ({ ...s, password: e.target.value }))}
                      />
                    </div>
                    <div className="mt-auto flex gap-2 pt-4">
                      <Button onClick={handleChangeEmail} className="flex-1">
                        Change email
                      </Button>
                      <Button variant="secondary" onClick={handleVerifyEmail} disabled={verifyingEmail}>
                        {verifyingEmail ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                        Re-send
                      </Button>
                    </div>
                  </div>
                </SectionCard>
              </div>

              <SectionCard icon={Fingerprint} title="Two-factor authentication" description="Authenticator-based login protection.">
                {security?.twoFactorEnabled ? (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-gray-200 bg-gray-50 text-gray-950 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-100">
                        <Check className="h-4 w-4" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-black text-gray-950 dark:text-gray-50">Two-factor is enabled</p>
                        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500">
                          A code is required at every new sign-in.
                        </p>
                      </div>
                    </div>
                    <div className="flex min-w-[220px] flex-1 gap-2 sm:max-w-md">
                      <Input
                        type="password"
                        placeholder="Password to disable"
                        autoComplete="current-password"
                        value={disable2faPassword}
                        onChange={(e) => setDisable2faPassword(e.target.value)}
                      />
                      <Button variant="secondary" onClick={handleDisable2FA}>
                        Disable
                      </Button>
                    </div>
                  </div>
                ) : twoFactorSetup ? (
                  <div className="mx-auto grid max-w-3xl items-center gap-6 sm:grid-cols-[auto_minmax(220px,1fr)]">
                    <div className="flex items-center gap-4">
                      <div className="h-[132px] w-[132px] flex-shrink-0 overflow-hidden rounded-[13px] border border-gray-200 bg-white p-2 dark:border-gray-800">
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
                        <code className="mt-2 block break-all rounded-lg border border-gray-200 bg-gray-100 px-2.5 py-2 font-mono text-xs font-bold text-gray-950 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                          {twoFactorSetup.secret}
                        </code>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <p className="text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                        Scan the code with an authenticator app, then enter the 6-digit code it shows.
                      </p>
                      <Input
                        inputMode="numeric"
                        placeholder="000000"
                        aria-label="Six-digit verification code"
                        value={twoFactorCode}
                        onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="text-center font-black tracking-[0.32em]"
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
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <p className="min-w-0 flex-1 basis-64 text-sm font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                      Add a second step at sign-in with any authenticator app for stronger protection.
                    </p>
                    <Button onClick={handleEnable2FA}>
                      <ShieldCheck className="h-4 w-4" aria-hidden />
                      Enable two-factor
                    </Button>
                  </div>
                )}
              </SectionCard>

              <div className="grid gap-[18px] md:grid-cols-2">
                <SectionCard icon={LogOut} title="Session control" description="End all other signed-in sessions.">
                  <div className="flex flex-1 flex-col">
                    <p className="text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                      Keeps this device signed in and revokes every other active session.
                    </p>
                    <div className="mt-auto flex gap-2 pt-4">
                      <Input
                        type="password"
                        placeholder="Your password"
                        autoComplete="current-password"
                        value={revokeAllPassword}
                        onChange={(e) => setRevokeAllPassword(e.target.value)}
                      />
                      <Button variant="secondary" onClick={handleRevokeAllSessions}>
                        Revoke all
                      </Button>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard icon={Trash2} title="Delete account" description="Permanent and irreversible.">
                  <div className="flex flex-1 flex-col">
                    <p className="text-xs font-semibold leading-relaxed text-gray-500 dark:text-gray-400">
                      Erases your profile, tasks and shares. This cannot be undone.
                    </p>
                    <div className="mt-auto flex gap-2 pt-4">
                      <Input
                        type="password"
                        placeholder="Confirm with password"
                        autoComplete="current-password"
                        value={deletePassword}
                        onChange={(e) => setDeletePassword(e.target.value)}
                      />
                      <Button variant="destructive" onClick={handleDeleteAccount}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </SectionCard>
              </div>
            </div>
          </section>

          {/* ---------- SESSIONS ---------- */}
          <section ref={setSectionRef("sessions")} aria-labelledby="section-sessions" className="scroll-mt-24">
            <SectionHeading index="03" title="Sessions" description="Devices currently signed in to your account." />
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
              {loadingSessions ? (
                <LoadingRows count={3} />
              ) : sessions.length ? (
                <ul className="space-y-2.5">
                  {sessions.map((session) => {
                    const mobile = /iphone|android|mobile|ios/i.test(`${session.deviceName} ${session.browser}`)
                    const DeviceIcon = mobile ? Smartphone : Monitor
                    return (
                      <li
                        key={session.id}
                        className={cn(
                          "flex items-center gap-4 rounded-xl border p-4",
                          session.isCurrent
                            ? "border-gray-200 border-l-[3px] border-l-gray-950 bg-gray-50 dark:border-gray-700 dark:border-l-gray-100 dark:bg-gray-800/50"
                            : "border-gray-100 dark:border-gray-800"
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[11px]",
                            session.isCurrent
                              ? "bg-gray-950 text-white dark:bg-gray-100 dark:text-gray-900"
                              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                          )}
                        >
                          <DeviceIcon className="h-4 w-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-gray-950 dark:text-gray-50">
                              {session.deviceName || "Device"} · {session.browser || "Browser"}
                            </span>
                            {session.isCurrent && (
                              <span className="text-[10px] font-black uppercase tracking-[0.1em] text-gray-400 dark:text-gray-500">
                                This device
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate font-mono text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                            {session.ipAddress || "—"} · {session.location || "Unknown"} · {formatDate(session.lastActivityAt || session.createdAt)}
                          </p>
                        </div>
                        {session.isCurrent ? (
                          <span className="flex-shrink-0 text-[11px] font-black text-gray-400 dark:text-gray-500">Active</span>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => handleRevokeSession(session.id)}>
                            Revoke
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <EmptyState icon={Monitor} title="No active sessions" description="New sessions will appear here after sign-in." />
              )}
            </SectionCard>
          </section>

          {/* ---------- HISTORY ---------- */}
          <section ref={setSectionRef("history")} aria-labelledby="section-history" className="scroll-mt-24">
            <SectionHeading index="04" title="History" description="Recent authentication activity." />
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
              {loadingHistory ? (
                <LoadingRows count={4} />
              ) : history?.items.length ? (
                <>
                  <ul className="space-y-2">
                    {history.items.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center gap-4 rounded-xl border border-gray-100 p-3.5 dark:border-gray-800"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-black text-gray-950 dark:text-gray-50">
                            {formatDate(entry.loginAt)}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                            {[entry.browser, entry.device].filter(Boolean).join(" · ") || entry.userAgent} · {entry.location || "Unknown"} · {entry.ipAddress}
                          </p>
                          {!entry.isSuccessful && entry.failureReason && (
                            <p className="mt-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                              Reason: {entry.failureReason}
                            </p>
                          )}
                        </div>
                        <span
                          aria-hidden
                          className={cn(
                            "h-[7px] w-[7px] flex-shrink-0 rounded-full",
                            entry.isSuccessful ? "bg-gray-300 dark:bg-gray-600" : "bg-gray-950 dark:bg-gray-100"
                          )}
                        />
                        <span
                          className={cn(
                            "w-14 flex-shrink-0 text-right text-[11px] font-black",
                            entry.isSuccessful ? "text-gray-400 dark:text-gray-500" : "text-gray-950 dark:text-gray-100"
                          )}
                        >
                          {entry.isSuccessful ? "Success" : "Failed"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Pager
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
            </SectionCard>
          </section>

          {/* ---------- FRIENDS ---------- */}
          <section ref={setSectionRef("friends")} aria-labelledby="section-friends" className="scroll-mt-24">
            <SectionHeading index="05" title="Friends" description="People you can share tasks with." />
            <div className="flex flex-col gap-[18px]">
              <SectionCard icon={UserPlus} title="Add a friend" description="By account email, or by their User ID.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldGroup label="By email">
                    <div className="flex gap-2">
                      <Input
                        type="email"
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
                  </FieldGroup>
                  <FieldGroup label="By user ID">
                    <div className="flex gap-2">
                      <Input
                        placeholder="00000000-0000-0000-0000-000000000000"
                        value={friendIdInput}
                        onChange={(e) => setFriendIdInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendFriendRequestById()
                        }}
                        className="font-mono text-xs"
                      />
                      <Button variant="secondary" onClick={handleSendFriendRequestById}>
                        Add
                      </Button>
                    </div>
                  </FieldGroup>
                </div>
              </SectionCard>

              <div className="grid gap-[18px] md:grid-cols-2">
                <SectionCard
                  icon={ArrowLeft}
                  title="Incoming"
                  description="Awaiting your decision."
                  action={
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {incomingRequests.length}
                    </span>
                  }
                >
                  {incomingRequests.length ? (
                    <ul className="space-y-2.5">
                      {incomingRequests.map((request) => (
                        <li
                          key={request.friendshipId}
                          className="flex items-center gap-3 rounded-xl border border-gray-100 p-2.5 dark:border-gray-800"
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
                            <p className="truncate text-[13px] font-black text-gray-950 dark:text-gray-50">
                              {personName(request)}
                            </p>
                            <p className="truncate text-[11px] font-semibold text-gray-400 dark:text-gray-500">{request.email}</p>
                          </div>
                          <Button size="sm" onClick={() => handleAcceptFriendRequest(request.friendshipId)}>
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
                    </ul>
                  ) : (
                    <EmptyState icon={UserPlus} title="No incoming requests" />
                  )}
                </SectionCard>

                <SectionCard
                  icon={ArrowRight}
                  title="Outgoing"
                  description="Waiting for a response."
                  action={
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {outgoingRequests.length}
                    </span>
                  }
                >
                  {outgoingRequests.length ? (
                    <ul className="space-y-2.5">
                      {outgoingRequests.map((request) => (
                        <li
                          key={request.friendshipId}
                          className="flex items-center gap-3 rounded-xl border border-gray-100 p-2.5 dark:border-gray-800"
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
                            <p className="truncate text-[13px] font-black text-gray-950 dark:text-gray-50">
                              {personName(request)}
                            </p>
                            <p className="truncate text-[11px] font-semibold text-gray-400 dark:text-gray-500">{request.email}</p>
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-[0.1em] text-gray-400 dark:text-gray-500">
                            Pending
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <EmptyState icon={Send} title="No outgoing requests" />
                  )}
                </SectionCard>
              </div>

              <SectionCard
                icon={UsersIcon}
                title="Friends"
                description="Accepted connections."
                action={
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {friends?.totalCount ?? 0}
                  </span>
                }
              >
                {loadingFriends ? (
                  <LoadingRows count={3} />
                ) : friends?.items.length ? (
                  <>
                    <ul className="grid gap-2.5 sm:grid-cols-2">
                      {friends.items.map((friend) => (
                        <li
                          key={friend.id}
                          className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 transition-colors hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-600"
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
                            <p className="truncate text-[13px] font-black text-gray-950 dark:text-gray-50">
                              {personName(friend)}
                            </p>
                            <p className="truncate text-[11px] font-semibold text-gray-400 dark:text-gray-500">
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
                    </ul>
                    <Pager
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
              </SectionCard>
            </div>
          </section>

          {/* ---------- ADMIN (role-gated) ---------- */}
          {isAdmin && (
            <section ref={setSectionRef("admin")} aria-labelledby="section-admin" className="scroll-mt-24">
              <SectionHeading index="06" title="Admin" description="Platform statistics and user operations." />
              <div className="flex flex-col gap-[18px]">
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
                  {adminStats ? (
                    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 dark:border-gray-800 dark:bg-gray-800 sm:grid-cols-4">
                      <MetricTile label="Total users" value={adminStats.totalUsers} />
                      <MetricTile label="Active users" value={adminStats.activeUsers} />
                      <MetricTile label="Locked users" value={adminStats.lockedUsers} active={!adminStats.lockedUsers} />
                      <MetricTile label="2FA users" value={adminStats.usersWithTwoFactor} />
                      <MetricTile label="New today" value={adminStats.newUsersToday} />
                      <MetricTile label="This week" value={adminStats.newUsersThisWeek} />
                      <MetricTile label="This month" value={adminStats.newUsersThisMonth} />
                      <MetricTile label="Updated" value={formatDateShort(adminStats.lastUpdated)} />
                    </dl>
                  ) : (
                    <LoadingRows count={2} />
                  )}
                </SectionCard>

                <div className="grid gap-[18px] xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,1fr)]">
                  <SectionCard icon={Search} title="User management" description="Search and filter accounts.">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <Input
                        placeholder="Search name or email"
                        value={adminSearch}
                        onChange={(e) => setAdminSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            setAdminPage(1)
                            loadAdmin(1)
                          }
                        }}
                      />
                      <Input placeholder="Status" value={adminStatus} onChange={(e) => setAdminStatus(e.target.value)} />
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
                    </div>
                    <div className="mt-3">
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
                    </div>

                    <div className="mt-4">
                      {loadingAdmin ? (
                        <LoadingRows count={4} />
                      ) : adminUsers?.items?.length ? (
                        <>
                          <ul className="space-y-2">
                            {adminUsers.items.map((adminUser) => (
                              <li
                                key={adminUser.id}
                                className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 dark:border-gray-800"
                              >
                                <Avatar
                                  firstName={adminUser.firstName}
                                  lastName={adminUser.lastName}
                                  email={adminUser.email}
                                  size={38}
                                  className="flex-shrink-0 rounded-full"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-[13px] font-black text-gray-950 dark:text-gray-50">
                                    {personName(adminUser)}
                                  </p>
                                  <p className="truncate text-[11px] font-semibold text-gray-400 dark:text-gray-500">
                                    {adminUser.email} · {adminUser.status}
                                  </p>
                                </div>
                                <Button size="sm" variant="secondary" onClick={() => handleLoadUserDetail(adminUser.id)}>
                                  View
                                </Button>
                              </li>
                            ))}
                          </ul>
                          <Pager
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
                    </div>
                  </SectionCard>

                  <SectionCard icon={User} title="User detail" description="Selected account.">
                    {selectedUser ? (
                      <div className="space-y-4">
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
                            <p className="truncate text-base font-black text-gray-950 dark:text-gray-50">
                              {selectedUser.fullName || personName(selectedUser)}
                            </p>
                            <p className="truncate text-sm font-semibold text-gray-500 dark:text-gray-400">
                              {selectedUser.email}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-2.5">
                          <InfoTile label="Status" value={selectedUser.status} icon={Activity} />
                          <InfoTile
                            label="2FA"
                            value={selectedUser.twoFactorEnabled ? "Enabled" : "Disabled"}
                            icon={Fingerprint}
                          />
                          <InfoTile label="Locked until" value={formatDate(selectedUser.lockedUntil)} icon={Lock} />
                          <InfoTile label="Member since" value={formatDateShort(selectedUser.createdAt)} icon={CalendarDays} />
                        </div>
                      </div>
                    ) : (
                      <EmptyState icon={User} title="No user selected" description="Choose a user from the management list." />
                    )}
                  </SectionCard>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </motion.div>
  )
}
