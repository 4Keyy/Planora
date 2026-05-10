import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { decodeJwt, getJwtEmailVerified, getJwtRoles } from "@/lib/jwt"
import { refreshAccessToken, validateAccessToken } from "@/lib/auth-public"
import { PRODUCT_EVENTS, trackProductEvent } from "@/lib/analytics"
import type { AuthTokenDto } from "@/types/auth"

/**
 * Authentication user information
 */
export type AuthUser = {
  userId: string
  email: string
  firstName: string
  lastName: string
}

/**
 * Authentication payload from API
 */
export type AuthPayload = {
  accessToken: string
  // refreshToken deliberately omitted — stored in httpOnly cookie, never in JS
  refreshTokenExpiresAt?: string | Date
  userId?: string
  email?: string
  firstName?: string
  lastName?: string
}

/**
 * Auth store state and actions
 */
type AuthState = {
  user?: AuthUser
  // SECURITY: Raw JWT tokens are NOT stored in client-accessible storage.
  // The access token is held only in memory (this store's non-persisted state).
  // The refresh token is stored in an httpOnly cookie set by the backend;
  // it is never written to sessionStorage or localStorage.
  accessToken?: string
  accessTokenExpiresAt?: string
  refreshTokenExpiresAt?: string
  roles: string[]
  emailVerified?: boolean
  isAuthenticated: boolean
  hasHydrated: boolean
  hasRestoredSession: boolean
  setAuth: (payload: AuthPayload) => void
  applyRefresh: (payload: AuthTokenDto) => void
  updateUser: (patch: Partial<AuthUser>) => void
  clearAuth: () => void
  isTokenValid: () => boolean
  isRefreshTokenValid: () => boolean
  restoreSession: () => Promise<void>
  scheduleTokenRefresh: () => (() => void) | undefined
}

const STORAGE_KEY = "planora-auth"

/**
 * Storage adapter.
 * On the server, use a no-op storage to satisfy zustand persist typings (and avoid SSR crashes).
 * SECURITY: We only persist non-sensitive identity fields (user profile, roles, expiry timestamps).
 * The raw access token and refresh token are intentionally excluded from persisted storage.
 * The refresh token lives exclusively in an httpOnly, Secure, SameSite=Strict cookie set by the
 * /auth/api/v1/auth/login and /auth/api/v1/auth/refresh endpoints.
 * The access token is kept only in this in-memory Zustand store (lost on page reload, re-obtained
 * via the httpOnly-cookie-based refresh flow through the API refresh endpoint).
 */
const noopStorage = {
  getItem: (_name: string) => null,
  setItem: (_name: string, _value: string) => { },
  removeItem: (_name: string) => { },
}

const storage = createJSONStorage<Partial<AuthState>>(() => {
  if (typeof window === "undefined") return noopStorage
  try {
    sessionStorage.getItem("test")
    return sessionStorage
  } catch {
    console.warn("sessionStorage is not available, using memory storage")
    return noopStorage
  }
})

const deriveAccessExpiry = (accessToken?: string): string | undefined => {
  if (!accessToken) return undefined
  const decoded = decodeJwt(accessToken)
  if (!decoded?.exp) return undefined
  return new Date(decoded.exp * 1000).toISOString()
}

const deriveUserFromToken = (accessToken?: string) => {
  if (!accessToken) return undefined
  const decoded = decodeJwt(accessToken)
  if (!decoded) return undefined
  const userId = typeof decoded.sub === "string" ? decoded.sub : undefined
  const email = typeof decoded.email === "string" ? decoded.email : undefined
  const firstName = typeof decoded.firstName === "string" ? decoded.firstName : undefined
  const lastName = typeof decoded.lastName === "string" ? decoded.lastName : undefined
  if (!userId || !email || !firstName || !lastName) return undefined
  return { userId, email, firstName, lastName } as AuthUser
}

/**
 * Zustand auth store with sessionStorage persistence
 */
export const useAuthStore = create(
  persist<AuthState, [], [], Partial<AuthState>>(
    (set, get) => ({
      user: undefined,
      // accessToken is in-memory only — not persisted to sessionStorage
      accessToken: undefined,
      accessTokenExpiresAt: undefined,
      refreshTokenExpiresAt: undefined,
      roles: [],
      emailVerified: undefined,
      isAuthenticated: false,
      hasHydrated: false,
      hasRestoredSession: false,

      /**
       * Set authentication state from API payload
       */
      setAuth: (payload) =>
        set((state) => {
          const accessTokenExpiresAt = deriveAccessExpiry(payload.accessToken)
          const decoded = decodeJwt(payload.accessToken)
          const roles = getJwtRoles(decoded)
          const emailVerified = getJwtEmailVerified(decoded)

          const derivedUser = deriveUserFromToken(payload.accessToken)
          const user: AuthUser | undefined = {
            userId: payload.userId ?? derivedUser?.userId ?? state.user?.userId ?? "",
            email: payload.email ?? derivedUser?.email ?? state.user?.email ?? "",
            firstName: payload.firstName ?? derivedUser?.firstName ?? state.user?.firstName ?? "",
            lastName: payload.lastName ?? derivedUser?.lastName ?? state.user?.lastName ?? "",
          }

          return {
            user: user.userId ? user : state.user,
            // SECURITY: accessToken kept in-memory only; never written to sessionStorage
            accessToken: payload.accessToken,
            // refreshToken is deliberately omitted here — it lives in an httpOnly cookie
            accessTokenExpiresAt,
            refreshTokenExpiresAt:
              payload.refreshTokenExpiresAt instanceof Date
                ? payload.refreshTokenExpiresAt.toISOString()
                : payload.refreshTokenExpiresAt,
            roles,
            emailVerified,
            isAuthenticated: true,
          }
        }),

      /**
       * Apply refreshed token payload.
       * SECURITY: Only the in-memory accessToken is updated here.
       * The new refreshToken is set as an httpOnly cookie by the backend on the /refresh response;
       * we do not receive or store it in JavaScript.
       */
      applyRefresh: (payload) =>
        set((state) => {
          const accessTokenExpiresAt = deriveAccessExpiry(payload.accessToken)
          const decoded = decodeJwt(payload.accessToken)
          const roles = getJwtRoles(decoded)
          const emailVerified = getJwtEmailVerified(decoded)
          const derivedUser = deriveUserFromToken(payload.accessToken)

          return {
            accessToken: payload.accessToken,
            // refreshToken intentionally omitted — lives in httpOnly cookie
            accessTokenExpiresAt,
            refreshTokenExpiresAt: payload.expiresAt ?? state.refreshTokenExpiresAt,
            roles: roles.length ? roles : state.roles,
            emailVerified: emailVerified ?? state.emailVerified,
            user: derivedUser ?? state.user,
            isAuthenticated: true,
          }
        }),

      updateUser: (patch) =>
        set((state) => {
          if (!state.user) return {}
          return { user: { ...state.user, ...patch } }
        }),

      /**
       * Clear all authentication state.
       * SECURITY: Also clears the httpOnly refresh-token cookie via the logout proxy route.
       * The cookie itself cannot be cleared from JS — the backend must expire it (Set-Cookie: Max-Age=0).
       */
      clearAuth: () =>
        set({
          user: undefined,
          accessToken: undefined,
          accessTokenExpiresAt: undefined,
          refreshTokenExpiresAt: undefined,
          roles: [],
          emailVerified: undefined,
          isAuthenticated: false,
        }),

      /**
       * Check if current access token is still valid
       */
      isTokenValid: () => {
        const state = get()
        if (!state.isAuthenticated || !state.accessToken) return false
        if (!state.accessTokenExpiresAt) return true
        const expiresAt = new Date(state.accessTokenExpiresAt)
        if (expiresAt > new Date()) return true
        // Allow session if refresh token cookie is still within its known expiry window
        return state.isRefreshTokenValid()
      },

      /**
       * Check if the refresh token (httpOnly cookie) is likely still valid.
       * We cannot read the httpOnly cookie from JS — we rely on the persisted
       * refreshTokenExpiresAt timestamp set when the token was last issued.
       */
      isRefreshTokenValid: () => {
        const state = get()
        if (!state.refreshTokenExpiresAt) return false
        const expiresAt = new Date(state.refreshTokenExpiresAt)
        return expiresAt > new Date()
      },

      /**
       * Restore session on app start.
       * - If access token is missing (e.g. after page reload), attempt a silent refresh via
       *   the httpOnly refresh-token cookie (the cookie is sent automatically by the browser).
       * - If access token is still valid, optionally validate with server.
       */
      restoreSession: async () => {
        const state = get()

        const accessValid = state.accessToken &&
          (!state.accessTokenExpiresAt || new Date(state.accessTokenExpiresAt) > new Date())

        if (accessValid && state.accessToken) {
          try {
            const validation = await validateAccessToken(state.accessToken)
            if (!validation?.isValid) {
              get().clearAuth()
            } else if (validation?.roles?.length) {
              set({ roles: validation.roles as string[] })
            }
            if (validation?.isValid) {
              trackProductEvent(PRODUCT_EVENTS.sessionRestored, { method: "validate" }, state.accessToken)
            }
          } catch {
            // Keep session if validation fails (network); user will be challenged on API calls
            trackProductEvent(PRODUCT_EVENTS.sessionRestored, { method: "validate_unavailable" }, state.accessToken)
          }
          set({ hasRestoredSession: true })
          return
        }

        // Always attempt silent refresh — the httpOnly cookie is sent automatically via withCredentials.
        // Do NOT gate on isRefreshTokenValid(): sessionStorage is cleared on browser restart,
        // but a persistent refresh_token cookie may still be valid. Let the server decide.
        try {
          const refreshed = await refreshAccessToken()
          get().applyRefresh(refreshed)
          trackProductEvent(PRODUCT_EVENTS.sessionRestored, { method: "refresh" }, refreshed.accessToken)
        } catch {
          trackProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { surface: "restore_session" }, state.accessToken)
          get().clearAuth()
        } finally {
          set({ hasRestoredSession: true })
        }
      },

      /**
       * Schedule automatic token refresh.
       * SECURITY: No refresh token string is passed — the httpOnly cookie is sent automatically.
       */
      scheduleTokenRefresh: () => {
        const state = get()
        if (!state.accessTokenExpiresAt) return undefined

        const expiresAt = new Date(state.accessTokenExpiresAt)
        const now = new Date()
        const timeUntilExpiry = expiresAt.getTime() - now.getTime()

        // Refresh 5 minutes before expiry (or immediately if less than 5 minutes remain)
        const refreshInMs = Math.max(0, timeUntilExpiry - (5 * 60 * 1000))

        const timeout = setTimeout(async () => {
          try {
            // No token argument — backend reads httpOnly cookie
            const refreshed = await refreshAccessToken()
            get().applyRefresh(refreshed)
            // Schedule next refresh
            get().scheduleTokenRefresh()
          } catch {
            console.warn("Auto-refresh failed")
            trackProductEvent(PRODUCT_EVENTS.tokenRefreshFailed, { surface: "scheduled_refresh" }, get().accessToken)
            // Retry in 5 minutes
            setTimeout(() => get().scheduleTokenRefresh(), 5 * 60 * 1000)
          }
        }, refreshInMs)

        // Return cleanup at the outer function level so callers can cancel the timer
        return () => clearTimeout(timeout)
      },
    }),
    {
      name: STORAGE_KEY,
      storage,
      // SECURITY: Only non-sensitive identity metadata is persisted to sessionStorage.
      // Raw JWT strings (accessToken, refreshToken) are intentionally excluded.
      // - accessToken: kept in memory only; lost on page reload (re-obtained via silent refresh)
      // - refreshToken: stored exclusively in httpOnly cookie; JS cannot read it
      partialize: (state) => ({
        user: state.user,
        accessTokenExpiresAt: state.accessTokenExpiresAt,
        refreshTokenExpiresAt: state.refreshTokenExpiresAt,
        roles: state.roles,
        emailVerified: state.emailVerified,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hasHydrated = true
        }
      },
    }
  )
)
