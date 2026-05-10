"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  Fingerprint,
  History as HistoryIcon,
  IdCard,
  KeyRound,
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
  Sparkles,
  Trash2,
  User,
  UserPlus,
  Users as UsersIcon,
  UserX,
  XCircle,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { api, getApiErrorMessage, parseApiResponse } from "@/lib/api"
import { clearCsrfToken } from "@/lib/csrf"
import { useAuthStore } from "@/store/auth"
import { useToastStore } from "@/store/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type TabId = "profile" | "security" | "sessions" | "history" | "friends" | "admin"

type TabConfig = {
  id: TabId
  label: string
  description: string
  icon: LucideIcon
  adminOnly?: boolean
}

type Tone = "neutral" | "good" | "warn" | "bad" | "dark" | "blue"

const tabs: TabConfig[] = [
  { id: "profile", label: "Profile", description: "Identity", icon: User },
  { id: "security", label: "Security", description: "Password & 2FA", icon: Shield },
  { id: "sessions", label: "Sessions", description: "Signed-in devices", icon: Monitor },
  { id: "history", label: "History", description: "Login activity", icon: HistoryIcon },
  { id: "friends", label: "Friends", description: "Connections", icon: UsersIcon },
  { id: "admin", label: "Admin", description: "User operations", icon: Settings, adminOnly: true },
]

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "-"

const formatDateShort = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString() : "-"

const statusTone = (status?: string | null) => {
  const value = (status ?? "").toLowerCase()
  if (value.includes("locked")) return "bg-red-50 text-red-700 ring-red-100"
  if (value.includes("inactive")) return "bg-amber-50 text-amber-700 ring-amber-100"
  if (value.includes("active")) return "bg-emerald-50 text-emerald-700 ring-emerald-100"
  return "bg-gray-100 text-gray-600 ring-gray-200"
}

const isGuid = (value: string) =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value.trim())

const isEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

const toneClasses: Record<Tone, string> = {
  neutral: "border-gray-200 bg-white text-gray-700",
  good: "border-emerald-100 bg-emerald-50 text-emerald-700",
  warn: "border-amber-100 bg-amber-50 text-amber-700",
  bad: "border-red-100 bg-red-50 text-red-700",
  dark: "border-gray-950 bg-gray-950 text-white",
  blue: "border-blue-100 bg-blue-50 text-blue-700",
}

const tabPanelVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.22,
      ease: EASE_OUT_EXPO,
      staggerChildren: 0.035,
      delayChildren: 0.02,
    },
  },
  exit: { opacity: 0, y: -8, transition: { duration: 0.14, ease: EASE_OUT_EXPO } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT_EXPO } },
}

const personName = (person: { firstName?: string | null; lastName?: string | null; email?: string | null; id?: string }) => {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim()
  if (name) return name
  if (person.email) return person.email.split("@")[0]
  return person.id ?? "Unknown"
}

function StatusPill({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black",
      toneClasses[tone],
      className
    )}>
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
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section
      layout
      variants={itemVariants}
      className={cn(
        "overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-[0_18px_60px_-34px_rgba(15,23,42,0.28)]",
        className
      )}
    >
      <div className="flex flex-col gap-4 border-b border-gray-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-600">
              <Icon className="h-4 w-4" strokeWidth={2.4} />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-black tracking-tight text-gray-950">{title}</h2>
            {description && <p className="mt-1 text-xs font-semibold text-gray-400">{description}</p>}
          </div>
        </div>
        {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </motion.section>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: LucideIcon
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: Tone
}) {
  return (
    <div className={cn(
      "rounded-lg border p-4 transition-[background-color,border-color,transform] duration-200",
      toneClasses[tone]
    )}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-black uppercase tracking-[0.14em] opacity-70">{label}</span>
        <Icon className="h-4 w-4 opacity-70" />
      </div>
      <div className="mt-3 truncate text-2xl font-black tracking-tight">{value}</div>
      {detail && <div className="mt-1 truncate text-xs font-semibold opacity-70">{detail}</div>}
    </div>
  )
}

function InfoTile({ label, value, icon: Icon }: { label: string; value: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-4">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className="mt-2 break-words text-sm font-black text-gray-950">{value}</div>
    </div>
  )
}

function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/70 px-4 py-8 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-black text-gray-900">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-xs font-semibold text-gray-400">{description}</p>}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">{label}</span>
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
    <div className="flex flex-col gap-2 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs font-semibold text-gray-400">{label ?? "Page controls"}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={previousDisabled} onClick={onPrevious}>
          <ArrowLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={nextDisabled} onClick={onNext}>
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function LoadingRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-lg border border-gray-100 bg-gray-50" />
      ))}
    </div>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const addToast = useToastStore((s) => s.addToast)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const hasHydrated = useAuthStore(s => s.hasHydrated)
  const roles = useAuthStore(s => s.roles)
  const updateUser = useAuthStore(s => s.updateUser)

  const isAdmin = roles.includes("Admin")
  const availableTabs = useMemo(
    () => tabs.filter((t) => !t.adminOnly || isAdmin),
    [isAdmin]
  )

  const [activeTab, setActiveTab] = useState<TabId>("profile")

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

  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    profilePictureUrl: "",
  })

  const [changePasswordForm, setChangePasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  })

  const [changeEmailForm, setChangeEmailForm] = useState({
    newEmail: "",
    password: "",
  })

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
  const [showGuidFriendFallback, setShowGuidFriendFallback] = useState(false)
  const [avatarError, setAvatarError] = useState(false)

  const isEmailVerified = user?.isEmailVerified ?? !!user?.emailVerifiedAt
  const avatarUrl = profileForm.profilePictureUrl || user?.profilePictureUrl || ""
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

  const tabBadges = useMemo(() => {
    const sessionsCount =
      typeof security?.activeSessionsCount === "number"
        ? security.activeSessionsCount
        : sessions.length
          ? sessions.length
          : undefined
    return {
      profile: undefined,
      security: security?.twoFactorEnabled ? "2FA" : undefined,
      sessions: sessionsCount,
      history: history?.totalCount,
      friends: friends?.totalCount,
      admin: adminUsers?.totalCount,
    } as Partial<Record<TabId, string | number | undefined>>
  }, [security, sessions.length, history?.totalCount, friends?.totalCount, adminUsers?.totalCount])

  const activeTabConfig = availableTabs.find(tab => tab.id === activeTab) ?? availableTabs[0]

  useEffect(() => {
    if (!hasHydrated) return
    if (!isAuthenticated || !useAuthStore.getState().isTokenValid()) {
      router.replace("/auth/login")
    }
  }, [hasHydrated, isAuthenticated, router])

  useEffect(() => {
    if (activeTab === "admin" && !isAdmin) {
      setActiveTab("profile")
    }
  }, [activeTab, isAdmin])

  useEffect(() => {
    setAvatarError(false)
  }, [avatarUrl])

  const loadProfile = async () => {
    if (loadingProfile) return
    setLoadingProfile(true)
    try {
      const res = await api.get("/auth/api/v1/users/me")
      const data = parseApiResponse<UserDto>(res.data)
      setUser(data)
      setProfileForm({
        firstName: data.firstName,
        lastName: data.lastName,
        profilePictureUrl: data.profilePictureUrl ?? "",
      })
    } catch {
      addToast({ type: "error", title: "Failed to load profile" })
    } finally {
      setLoadingProfile(false)
    }
  }

  const loadSecurity = async () => {
    if (loadingSecurity) return
    setLoadingSecurity(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/security")
      const data = parseApiResponse<UserSecurityDto>(res.data)
      setSecurity(data)
    } catch {
      addToast({ type: "error", title: "Failed to load security info" })
    } finally {
      setLoadingSecurity(false)
    }
  }

  const loadSessions = async () => {
    if (loadingSessions) return
    setLoadingSessions(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/sessions")
      const data = parseApiResponse<SessionDto[]>(res.data)
      setSessions(data)
    } catch {
      addToast({ type: "error", title: "Failed to load sessions" })
    } finally {
      setLoadingSessions(false)
    }
  }

  const loadHistory = async (page = historyPage) => {
    if (loadingHistory) return
    setLoadingHistory(true)
    try {
      const res = await api.get("/auth/api/v1/users/me/login-history", {
        params: { pageNumber: page, pageSize: 10 },
      })
      const data = parseApiResponse<PagedResult<LoginHistoryPagedDto>>(res.data)
      setHistory(data)
    } catch {
      addToast({ type: "error", title: "Failed to load history" })
    } finally {
      setLoadingHistory(false)
    }
  }

  const loadFriends = async (page = friendsPage) => {
    if (loadingFriends) return
    setLoadingFriends(true)
    try {
      const res = await api.get("/friendships", {
        params: { pageNumber: page, pageSize: 10 },
      })
      const data = parseApiResponse<PagedResult<FriendDto>>(res.data)
      setFriends(data)

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

  const loadAdmin = async (page = adminPage) => {
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

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return
    loadProfile()
    loadSecurity()
    // loadProfile/loadSecurity are plain async functions intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated, isAuthenticated])

  useEffect(() => {
    if (activeTab === "sessions") loadSessions()
    if (activeTab === "history") loadHistory()
    if (activeTab === "friends") loadFriends()
    if (activeTab === "admin") loadAdmin()
    // load* functions are plain async functions guarded by loading flags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const handleProfileSave = async () => {
    try {
      const res = await api.put("/auth/api/v1/users/me", {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
        profilePictureUrl: profileForm.profilePictureUrl || null,
      })
      const data = parseApiResponse<UserDto>(res.data)
      setUser(data)
      updateUser({
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        userId: data.id,
      })
      addToast({ type: "success", title: "Profile updated" })
    } catch {
      addToast({ type: "error", title: "Failed to update profile" })
    }
  }

  const handleChangePassword = async () => {
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

  const handleChangeEmail = async () => {
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

  const handleVerifyEmail = async () => {
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

  const handleEnable2FA = async () => {
    try {
      const res = await api.post("/auth/api/v1/users/me/2fa/enable")
      const data = parseApiResponse<{ secret: string; qrCodeUrl: string }>(res.data)
      setTwoFactorSetup({ secret: data.secret, qrCodeUrl: data.qrCodeUrl })
      addToast({ type: "success", title: "2FA setup generated" })
    } catch {
      addToast({ type: "error", title: "Failed to start 2FA" })
    }
  }

  const handleConfirm2FA = async () => {
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

  const handleDisable2FA = async () => {
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

  const handleRevokeSession = async (tokenId: string) => {
    try {
      await api.delete(`/auth/api/v1/users/me/sessions/${tokenId}`)
      addToast({ type: "success", title: "Session revoked" })
      loadSessions()
      loadSecurity()
    } catch {
      addToast({ type: "error", title: "Failed to revoke session" })
    }
  }

  const handleRevokeAllSessions = async () => {
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

  const handleDeleteAccount = async () => {
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

  const handleSendFriendRequest = async () => {
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
      const message = getApiErrorMessage(error)
      addToast({ type: "error", title: message || "Failed to send invite" })
    }
  }

  const handleSendFriendRequestById = async () => {
    const normalizedId = friendIdInput.trim()
    if (!normalizedId) return
    if (!isGuid(normalizedId)) {
      addToast({ type: "error", title: "Invalid user ID", description: "Use a GUID like 00000000-0000-0000-0000-000000000000" })
      return
    }
    try {
      await api.post("/friendships/requests", { friendId: normalizedId })
      setFriendIdInput("")
      addToast({ type: "success", title: "Request sent" })
      loadFriends()
    } catch (error: unknown) {
      const message = getApiErrorMessage(error)
      addToast({ type: "error", title: message || "Failed to send request" })
    }
  }

  const handleCopyUserId = async () => {
    if (!user?.id || typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(user.id)
    addToast({ type: "success", title: "User ID copied" })
  }

  const handleAcceptFriendRequest = async (friendshipId: string) => {
    try {
      await api.post(`/friendships/requests/${friendshipId}/accept`)
      addToast({ type: "success", title: "Friend added" })
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Failed to accept request" })
    }
  }

  const handleRejectFriendRequest = async (friendshipId: string) => {
    try {
      await api.post(`/friendships/requests/${friendshipId}/reject`)
      addToast({ type: "success", title: "Request rejected" })
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Failed to reject request" })
    }
  }

  const handleRemoveFriend = async (friendId: string) => {
    try {
      await api.delete(`/friendships/${friendId}`)
      addToast({ type: "success", title: "Friend removed" })
      loadFriends()
    } catch {
      addToast({ type: "error", title: "Failed to remove friend" })
    }
  }

  const handleLoadUserDetail = async (userId: string) => {
    try {
      const res = await api.get(`/auth/api/v1/users/${userId}`)
      setSelectedUser(parseApiResponse<UserDetailDto>(res.data))
    } catch {
      addToast({ type: "error", title: "Failed to load user" })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
      className="min-w-0 overflow-x-hidden space-y-7 pb-12"
    >
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-[0_24px_80px_-45px_rgba(15,23,42,0.38)]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="p-5 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-inner">
                {avatarUrl && !avatarError ? (
                  <Image
                    src={avatarUrl}
                    alt="Profile"
                    fill
                    className="object-cover"
                    onError={() => setAvatarError(true)}
                    sizes="96px"
                    unoptimized={avatarUrl.startsWith("data:")}
                  />
                ) : (
                  <span className="text-3xl font-black text-gray-800">{initials}</span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={isEmailVerified ? "good" : "warn"}>
                    {isEmailVerified ? "Verified email" : "Email pending"}
                  </StatusPill>
                  <StatusPill tone={security?.twoFactorEnabled ? "good" : "neutral"}>
                    {security?.twoFactorEnabled ? "2FA enabled" : "2FA off"}
                  </StatusPill>
                  {isAdmin && <StatusPill tone="dark">Admin</StatusPill>}
                </div>
                <h1 className="mt-4 truncate text-3xl font-black tracking-tight text-gray-950 sm:text-4xl">
                  {displayName}
                </h1>
                <p className="mt-2 truncate text-sm font-semibold text-gray-500">{user?.email || "-"}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <MetricTile
                icon={Monitor}
                label="Sessions"
                value={security?.activeSessionsCount ?? "-"}
                detail="Active now"
                tone="blue"
              />
              <MetricTile
                icon={ShieldCheck}
                label="Status"
                value={user?.status || "Unknown"}
                detail={isEmailVerified ? "Account verified" : "Needs email"}
                tone={isEmailVerified ? "good" : "warn"}
              />
              <MetricTile
                icon={CalendarDays}
                label="Member"
                value={formatDateShort(user?.createdAt)}
                detail="Created"
              />
            </div>
          </div>

          <div className="border-t border-gray-100 bg-gray-50/70 p-5 sm:p-7 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-950 text-white">
                <Sparkles className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Profile center</p>
                <p className="mt-1 text-sm font-black text-gray-950">{activeTabConfig?.label ?? "Profile"}</p>
              </div>
            </div>
            <p className="mt-5 text-sm font-semibold leading-6 text-gray-500">
              Manage identity, security, sessions, access history, friends, and administrative tools from one calm workspace.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <InfoTile label="Last login" value={formatDate(user?.lastLoginAt)} icon={Clock3} />
              <InfoTile label="Roles" value={roles.length ? roles.join(", ") : "User"} icon={BadgeCheck} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white p-2 shadow-[0_18px_60px_-40px_rgba(15,23,42,0.35)]">
            <div className="flex max-w-full gap-2 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
              {availableTabs.map((tab) => {
                const Icon = tab.icon
                const badge = tabBadges[tab.id]
                const isActive = activeTab === tab.id

                return (
                  <motion.button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    whileTap={{ scale: 0.985 }}
                    className={cn(
                      "group relative flex min-w-[180px] max-w-[220px] flex-shrink-0 items-center justify-between gap-3 rounded-lg border p-3 text-left transition-[background-color,border-color,color] duration-200 lg:min-w-0 lg:max-w-none lg:flex-shrink",
                      isActive
                        ? "border-gray-950 bg-gray-950 text-white"
                        : "border-transparent bg-white text-gray-700 hover:border-gray-200 hover:bg-gray-50"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={cn(
                        "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md transition-colors",
                        isActive ? "bg-white/12 text-white" : "bg-gray-100 text-gray-500 group-hover:bg-white"
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black">{tab.label}</span>
                        <span className={cn(
                          "block truncate text-[11px] font-semibold",
                          isActive ? "text-white/60" : "text-gray-400"
                        )}>
                          {tab.description}
                        </span>
                      </span>
                    </span>
                    {badge !== undefined && badge !== null && (
                      <span className={cn(
                        "rounded-full px-2 py-1 text-[10px] font-black",
                        isActive ? "bg-white/15 text-white" : "bg-gray-100 text-gray-500"
                      )}>
                        {badge}
                      </span>
                    )}
                  </motion.button>
                )
              })}
            </div>
          </div>
        </aside>

        <section className="min-w-0">
          <AnimatePresence mode="wait">
            {activeTab === "profile" && (
              <motion.div
                key="profile"
                variants={tabPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-5"
              >
                <SectionCard
                  icon={IdCard}
                  title="Identity"
                  description="Keep your public account details current."
                  action={
                    <Button variant="secondary" onClick={loadProfile} disabled={loadingProfile}>
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </Button>
                  }
                >
                  {loadingProfile ? (
                    <LoadingRows count={2} />
                  ) : (
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
                      <div className="space-y-4">
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
                        <FieldGroup label="Profile picture URL">
                          <Input
                            value={profileForm.profilePictureUrl}
                            onChange={(e) => setProfileForm((s) => ({ ...s, profilePictureUrl: e.target.value }))}
                            placeholder="https://..."
                            maxLength={500}
                            showCount
                          />
                        </FieldGroup>
                        <Button onClick={handleProfileSave}>Save profile</Button>
                      </div>

                      <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4">
                        <div className="flex items-center gap-4">
                          <div className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white shadow-inner">
                            {avatarUrl && !avatarError ? (
                              <Image
                                src={avatarUrl}
                                alt="Profile"
                                fill
                                className="object-cover"
                                onError={() => setAvatarError(true)}
                                sizes="64px"
                                unoptimized={avatarUrl.startsWith("data:")}
                              />
                            ) : (
                              <span className="text-xl font-black text-gray-800">{initials}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-black text-gray-950">{displayName}</p>
                            <p className="mt-1 truncate text-xs font-semibold text-gray-500">{user?.email || "-"}</p>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          <InfoTile label="Account status" value={user?.status || "Unknown"} icon={Activity} />
                          <InfoTile label="Created" value={formatDate(user?.createdAt)} icon={CalendarDays} />
                        </div>
                      </div>
                    </div>
                  )}
                </SectionCard>

                <SectionCard icon={BadgeCheck} title="Account snapshot" description="Readable account metadata at a glance.">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <InfoTile label="Email" value={user?.email || "-"} icon={Mail} />
                    <InfoTile label="Verified" value={isEmailVerified ? "Yes" : "No"} icon={BadgeCheck} />
                    <InfoTile label="Last login" value={formatDate(user?.lastLoginAt)} icon={Clock3} />
                    <InfoTile label="Roles" value={roles.length ? roles.join(", ") : "User"} icon={Shield} />
                  </div>
                </SectionCard>
              </motion.div>
            )}

            {activeTab === "security" && (
              <motion.div
                key="security"
                variants={tabPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-5"
              >
                <SectionCard
                  icon={ShieldCheck}
                  title="Security overview"
                  description="A compact readout of current account protection."
                  action={
                    <Button variant="secondary" onClick={loadSecurity} disabled={loadingSecurity}>
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </Button>
                  }
                >
                  {loadingSecurity ? (
                    <LoadingRows count={2} />
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <MetricTile icon={Fingerprint} label="2FA" value={security?.twoFactorEnabled ? "Enabled" : "Disabled"} tone={security?.twoFactorEnabled ? "good" : "neutral"} />
                      <MetricTile icon={Monitor} label="Sessions" value={security?.activeSessionsCount ?? "-"} detail="Active tokens" tone="blue" />
                      <MetricTile icon={AlertTriangle} label="Failed attempts" value={security?.failedLoginAttempts ?? "-"} tone={security?.failedLoginAttempts ? "warn" : "good"} />
                      <MetricTile icon={Lock} label="Locked until" value={formatDate(security?.lockedUntil)} />
                      <MetricTile icon={KeyRound} label="Password changed" value={formatDateShort(security?.lastPasswordChange)} />
                      <MetricTile icon={Mail} label="Email changed" value={formatDateShort(security?.lastEmailChange)} />
                    </div>
                  )}
                </SectionCard>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
                  <div className="space-y-5">
                    <SectionCard icon={KeyRound} title="Password" description="Update credentials for this account.">
                      <div className="space-y-3">
                        <Input
                          type="password"
                          placeholder="Current password"
                          value={changePasswordForm.currentPassword}
                          onChange={(e) => setChangePasswordForm((s) => ({ ...s, currentPassword: e.target.value }))}
                        />
                        <Input
                          type="password"
                          placeholder="New password"
                          value={changePasswordForm.newPassword}
                          onChange={(e) => setChangePasswordForm((s) => ({ ...s, newPassword: e.target.value }))}
                        />
                        <Input
                          type="password"
                          placeholder="Confirm new password"
                          value={changePasswordForm.confirmNewPassword}
                          onChange={(e) => setChangePasswordForm((s) => ({ ...s, confirmNewPassword: e.target.value }))}
                        />
                        <Button onClick={handleChangePassword}>Update password</Button>
                      </div>
                    </SectionCard>

                    <SectionCard icon={Mail} title="Email" description="Change or verify the email used for account access.">
                      <div className="space-y-4">
                        {!isEmailVerified && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
                            <div className="flex items-center gap-2 text-sm font-black text-amber-800">
                              <AlertTriangle className="h-4 w-4" />
                              Email not verified
                            </div>
                            <Button className="mt-3" onClick={handleVerifyEmail} disabled={verifyingEmail}>
                              {verifyingEmail ? "Sending..." : "Send verification email"}
                            </Button>
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            type="email"
                            placeholder="New email"
                            value={changeEmailForm.newEmail}
                            onChange={(e) => setChangeEmailForm((s) => ({ ...s, newEmail: e.target.value }))}
                          />
                          <Input
                            type="password"
                            placeholder="Password"
                            value={changeEmailForm.password}
                            onChange={(e) => setChangeEmailForm((s) => ({ ...s, password: e.target.value }))}
                          />
                        </div>
                        <Button onClick={handleChangeEmail}>Change email</Button>
                      </div>
                    </SectionCard>
                  </div>

                  <div className="space-y-5">
                    <SectionCard icon={Fingerprint} title="Two-factor authentication" description="Authenticator-based login protection.">
                      <div className="space-y-4">
                        {!security?.twoFactorEnabled && !twoFactorSetup && (
                          <Button onClick={handleEnable2FA}>Enable 2FA</Button>
                        )}

                        <AnimatePresence initial={false}>
                          {twoFactorSetup && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={TWEEN_FAST}
                              className="overflow-hidden"
                            >
                              <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3">
                                <div className="flex flex-col gap-4 sm:flex-row">
                                  {/* eslint-disable-next-line @next/next/no-img-element -- QR code is a data: URI, next/image does not support data: URLs */}
                                  <img
                                    src={twoFactorSetup.qrCodeUrl.startsWith("data:")
                                      ? twoFactorSetup.qrCodeUrl
                                      : `data:image/png;base64,${twoFactorSetup.qrCodeUrl}`}
                                    alt="Two-factor authentication QR code"
                                    className="h-32 w-32 rounded-lg border border-gray-200 bg-white"
                                  />
                                  <div className="min-w-0 flex-1 space-y-2">
                                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-gray-400">Secret</div>
                                    <div className="break-all rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-700">
                                      {twoFactorSetup.secret}
                                    </div>
                                  </div>
                                </div>
                                <Input
                                  placeholder="Enter 2FA code"
                                  value={twoFactorCode}
                                  onChange={(e) => setTwoFactorCode(e.target.value)}
                                />
                                <div className="flex flex-wrap gap-2">
                                  <Button onClick={handleConfirm2FA}>Confirm 2FA</Button>
                                  <Button variant="secondary" onClick={() => setTwoFactorSetup(null)}>Cancel</Button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {security?.twoFactorEnabled && (
                          <div className="space-y-3">
                            <StatusPill tone="good">2FA is enabled</StatusPill>
                            <Input
                              type="password"
                              placeholder="Password"
                              value={disable2faPassword}
                              onChange={(e) => setDisable2faPassword(e.target.value)}
                            />
                            <Button variant="secondary" onClick={handleDisable2FA}>Disable 2FA</Button>
                          </div>
                        )}
                      </div>
                    </SectionCard>

                    <SectionCard icon={LogOut} title="Session control" description="End other signed-in sessions.">
                      <div className="space-y-3">
                        <Input
                          type="password"
                          placeholder="Password"
                          value={revokeAllPassword}
                          onChange={(e) => setRevokeAllPassword(e.target.value)}
                        />
                        <Button variant="secondary" onClick={handleRevokeAllSessions}>Revoke all sessions</Button>
                      </div>
                    </SectionCard>

                    <SectionCard icon={Trash2} title="Danger zone" description="Permanent account removal." className="border-red-100">
                      <div className="space-y-3">
                        <Input
                          type="password"
                          placeholder="Password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                        />
                        <Button variant="destructive" onClick={handleDeleteAccount}>Delete account</Button>
                      </div>
                    </SectionCard>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "sessions" && (
              <motion.div
                key="sessions"
                variants={tabPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-5"
              >
                <SectionCard
                  icon={Monitor}
                  title="Active sessions"
                  description="Review signed-in devices and revoke stale sessions."
                  action={
                    <Button variant="secondary" onClick={loadSessions} disabled={loadingSessions}>
                      <RefreshCw className="h-4 w-4" />
                      Refresh
                    </Button>
                  }
                >
                  {loadingSessions ? (
                    <LoadingRows count={3} />
                  ) : sessions.length === 0 ? (
                    <EmptyState icon={Monitor} title="No active sessions" description="New sessions will appear here after sign-in." />
                  ) : (
                    <div className="space-y-3">
                      {sessions.map((session) => (
                        <motion.div
                          layout
                          key={session.id}
                          className={cn(
                            "rounded-lg border p-4",
                            session.isCurrent ? "border-emerald-200 bg-emerald-50/50" : "border-gray-100 bg-gray-50/70"
                          )}
                        >
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={cn(
                                "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                                session.isCurrent ? "bg-emerald-100 text-emerald-700" : "bg-white text-gray-500"
                              )}>
                                <Monitor className="h-4 w-4" />
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-black text-gray-950">
                                  {session.deviceName || "Device"} · {session.browser || "Browser"}
                                </p>
                                <p className="mt-1 truncate text-xs font-semibold text-gray-500">
                                  {session.ipAddress} · {session.location || "Unknown location"}
                                </p>
                                <p className="mt-2 text-xs font-semibold text-gray-400">
                                  Created {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {session.isCurrent ? (
                                <StatusPill tone="good">Current</StatusPill>
                              ) : (
                                <Button size="sm" variant="secondary" onClick={() => handleRevokeSession(session.id)}>
                                  Revoke
                                </Button>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </motion.div>
            )}

            {activeTab === "history" && (
              <motion.div
                key="history"
                variants={tabPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-5"
              >
                <SectionCard icon={HistoryIcon} title="Login history" description="Recent authentication attempts and device context.">
                  {loadingHistory ? (
                    <LoadingRows count={4} />
                  ) : history?.items?.length ? (
                    <div className="space-y-3">
                      {history.items.map((entry) => (
                        <motion.div
                          layout
                          key={entry.id}
                          className="rounded-lg border border-gray-100 bg-gray-50/70 p-4"
                        >
                          <div className="flex items-start gap-3">
                            <span className={cn(
                              "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                              entry.isSuccessful ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                            )}>
                              {entry.isSuccessful ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="truncate text-sm font-black text-gray-950">
                                  {entry.device || "Device"} · {entry.browser || "Browser"}
                                </p>
                                <StatusPill tone={entry.isSuccessful ? "good" : "bad"}>
                                  {entry.isSuccessful ? "Success" : "Failed"}
                                </StatusPill>
                              </div>
                              <p className="mt-1 text-xs font-semibold text-gray-500">
                                {entry.ipAddress} · {entry.location || "Unknown"} · {formatDate(entry.loginAt)}
                              </p>
                              {!entry.isSuccessful && entry.failureReason && (
                                <p className="mt-2 text-xs font-semibold text-red-600">Reason: {entry.failureReason}</p>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                      <Pager
                        previousDisabled={!history?.hasPreviousPage}
                        nextDisabled={!history?.hasNextPage}
                        label={`Page ${history.pageNumber} of ${history.totalPages || 1}`}
                        onPrevious={() => {
                          const next = Math.max(1, historyPage - 1)
                          setHistoryPage(next)
                          loadHistory(next)
                        }}
                        onNext={() => {
                          const next = historyPage + 1
                          setHistoryPage(next)
                          loadHistory(next)
                        }}
                      />
                    </div>
                  ) : (
                    <EmptyState icon={HistoryIcon} title="No login history" description="Authentication events will appear here." />
                  )}
                </SectionCard>
              </motion.div>
            )}

            {activeTab === "friends" && (
              <motion.div
                key="friends"
                variants={tabPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
              >
                <div className="space-y-5">
                  <SectionCard icon={UserPlus} title="Invite friends" description="Send a request by account email.">
                    <div className="space-y-4">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          type="email"
                          placeholder="friend@example.com"
                          value={friendEmailInput}
                          onChange={(e) => setFriendEmailInput(e.target.value)}
                        />
                        <Button onClick={handleSendFriendRequest}>
                          <Send className="h-4 w-4" />
                          Send invite
                        </Button>
                      </div>

                      <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                        <button
                          type="button"
                          onClick={() => setShowGuidFriendFallback((value) => !value)}
                          className="flex w-full items-center justify-between gap-3 text-left text-xs font-black uppercase tracking-[0.12em] text-gray-500"
                        >
                          User ID fallback
                          <Eye className="h-4 w-4" />
                        </button>

                        <AnimatePresence initial={false}>
                          {showGuidFriendFallback && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={TWEEN_FAST}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 space-y-3">
                                <div className="flex gap-2">
                                  <div className="min-w-0 flex-1 break-all rounded-md border border-gray-100 bg-white px-3 py-2 font-mono text-xs text-gray-700">
                                    {user?.id || "-"}
                                  </div>
                                  <Button size="sm" variant="secondary" onClick={handleCopyUserId} disabled={!user?.id}>
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <Input
                                    placeholder="Friend user ID (GUID)"
                                    value={friendIdInput}
                                    onChange={(e) => setFriendIdInput(e.target.value)}
                                  />
                                  <Button variant="secondary" onClick={handleSendFriendRequestById}>Send</Button>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard icon={ArrowRight} title="Outgoing requests" description="Requests waiting for a response.">
                    {outgoingRequests.length === 0 ? (
                      <EmptyState icon={Send} title="No outgoing requests" />
                    ) : (
                      <div className="space-y-2">
                        {outgoingRequests.map((request) => (
                          <div key={request.friendshipId} className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-gray-950">{personName(request)}</p>
                              <p className="truncate text-xs font-semibold text-gray-500">{request.email}</p>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => handleRejectFriendRequest(request.friendshipId)}>
                              Cancel
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                </div>

                <div className="space-y-5">
                  <SectionCard icon={ArrowLeft} title="Incoming requests" description="Requests that need your decision.">
                    {incomingRequests.length === 0 ? (
                      <EmptyState icon={UserPlus} title="No incoming requests" />
                    ) : (
                      <div className="space-y-2">
                        {incomingRequests.map((request) => (
                          <div key={request.friendshipId} className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-gray-950">{personName(request)}</p>
                              <p className="truncate text-xs font-semibold text-gray-500">{request.email}</p>
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => handleAcceptFriendRequest(request.friendshipId)}>Accept</Button>
                              <Button size="sm" variant="secondary" onClick={() => handleRejectFriendRequest(request.friendshipId)}>Reject</Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard
                    icon={UsersIcon}
                    title="Friends"
                    description="Accepted connections available for sharing tasks."
                    action={
                      <Button size="sm" variant="secondary" onClick={() => loadFriends()} disabled={loadingFriends}>
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                      </Button>
                    }
                  >
                    {loadingFriends ? (
                      <LoadingRows count={3} />
                    ) : friends?.items?.length ? (
                      <div className="space-y-2">
                        {friends.items.map((friend) => (
                          <div key={friend.id} className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-black text-gray-950">{personName(friend)}</p>
                              <p className="truncate text-xs font-semibold text-gray-500">{friend.email}</p>
                              <p className="mt-1 text-[11px] font-semibold text-gray-400">Friends since {formatDateShort(friend.friendsSince)}</p>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => handleRemoveFriend(friend.id)}>
                              <UserX className="h-4 w-4" />
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Pager
                          previousDisabled={!friends?.hasPreviousPage}
                          nextDisabled={!friends?.hasNextPage}
                          label={`Page ${friends.pageNumber} of ${friends.totalPages || 1}`}
                          onPrevious={() => {
                            const next = Math.max(1, friendsPage - 1)
                            setFriendsPage(next)
                            loadFriends(next)
                          }}
                          onNext={() => {
                            const next = friendsPage + 1
                            setFriendsPage(next)
                            loadFriends(next)
                          }}
                        />
                      </div>
                    ) : (
                      <EmptyState icon={UsersIcon} title="No friends yet" description="Accepted friends will appear here." />
                    )}
                  </SectionCard>
                </div>
              </motion.div>
            )}

            {activeTab === "admin" && isAdmin && (
              <motion.div
                key="admin"
                variants={tabPanelVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className="space-y-5"
              >
                <SectionCard icon={Settings} title="Admin overview" description="High-level account population metrics.">
                  {adminStats ? (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <MetricTile icon={UsersIcon} label="Total users" value={adminStats.totalUsers} tone="blue" />
                      <MetricTile icon={CheckCircle2} label="Active users" value={adminStats.activeUsers} tone="good" />
                      <MetricTile icon={Lock} label="Locked users" value={adminStats.lockedUsers} tone={adminStats.lockedUsers ? "bad" : "neutral"} />
                      <MetricTile icon={Fingerprint} label="2FA users" value={adminStats.usersWithTwoFactor} />
                      <MetricTile icon={CalendarDays} label="New today" value={adminStats.newUsersToday} />
                      <MetricTile icon={CalendarDays} label="This week" value={adminStats.newUsersThisWeek} />
                      <MetricTile icon={CalendarDays} label="This month" value={adminStats.newUsersThisMonth} />
                      <MetricTile icon={Clock3} label="Updated" value={formatDateShort(adminStats.lastUpdated)} />
                    </div>
                  ) : (
                    <LoadingRows count={2} />
                  )}
                </SectionCard>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
                  <SectionCard icon={Search} title="User management" description="Filter, page, and inspect account records.">
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <Input placeholder="Search" value={adminSearch} onChange={(e) => setAdminSearch(e.target.value)} />
                        <Input placeholder="Status" value={adminStatus} onChange={(e) => setAdminStatus(e.target.value)} />
                        <Input type="date" value={adminCreatedFrom} onChange={(e) => setAdminCreatedFrom(e.target.value)} />
                        <Input type="date" value={adminCreatedTo} onChange={(e) => setAdminCreatedTo(e.target.value)} />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setAdminPage(1)
                          loadAdmin(1)
                        }}
                      >
                        Apply filters
                      </Button>

                      {loadingAdmin ? (
                        <LoadingRows count={3} />
                      ) : adminUsers?.items?.length ? (
                        <div className="space-y-3">
                          {adminUsers.items.map((adminUser) => (
                            <div key={adminUser.id} className="flex flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-black text-gray-950">{personName(adminUser)}</p>
                                  <span className={cn("rounded-full px-2 py-1 text-[10px] font-black ring-1", statusTone(adminUser.status))}>
                                    {adminUser.status}
                                  </span>
                                </div>
                                <p className="mt-1 truncate text-xs font-semibold text-gray-500">{adminUser.email}</p>
                                <p className="mt-1 text-[11px] font-semibold text-gray-400">Created {formatDateShort(adminUser.createdAt)}</p>
                              </div>
                              <Button size="sm" variant="secondary" onClick={() => handleLoadUserDetail(adminUser.id)}>
                                View
                              </Button>
                            </div>
                          ))}
                          <Pager
                            previousDisabled={!adminUsers.hasPreviousPage}
                            nextDisabled={!adminUsers.hasNextPage}
                            label={`Page ${adminUsers.pageNumber} of ${adminUsers.totalPages || 1}`}
                            onPrevious={() => {
                              const next = Math.max(1, adminPage - 1)
                              setAdminPage(next)
                              loadAdmin(next)
                            }}
                            onNext={() => {
                              const next = adminPage + 1
                              setAdminPage(next)
                              loadAdmin(next)
                            }}
                          />
                        </div>
                      ) : (
                        <EmptyState icon={Search} title="No users found" />
                      )}
                    </div>
                  </SectionCard>

                  <SectionCard icon={User} title="Selected user" description="Detailed account readout.">
                    {selectedUser ? (
                      <div className="space-y-3">
                        <InfoTile label="Name" value={selectedUser.fullName || personName(selectedUser)} icon={User} />
                        <InfoTile label="Email" value={selectedUser.email} icon={Mail} />
                        <InfoTile label="Status" value={selectedUser.status} icon={Activity} />
                        <InfoTile label="2FA" value={selectedUser.twoFactorEnabled ? "Enabled" : "Disabled"} icon={Fingerprint} />
                        <InfoTile label="Locked until" value={formatDate(selectedUser.lockedUntil)} icon={Lock} />
                      </div>
                    ) : (
                      <EmptyState icon={User} title="No user selected" description="Choose a user from the management list." />
                    )}
                  </SectionCard>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>
    </motion.div>
  )
}
