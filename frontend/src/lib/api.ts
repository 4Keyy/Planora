import axios, { AxiosInstance, AxiosError } from "axios"
import { useAuthStore } from "@/store/auth"
import { getCsrfToken, shouldIncludeCsrfToken, clearCsrfToken, CSRF_HEADER_NAME } from "@/lib/csrf"
import { refreshAccessToken } from "@/lib/auth-public"
import { PRODUCT_EVENTS, trackProductEvent } from "@/lib/analytics"
import { getApiBaseUrl } from "@/lib/config"
import type { Todo, TodoComment } from "@/types/todo"
import type { AuthTokenDto } from "@/types/auth"

const BASE_URL = getApiBaseUrl()
let refreshPromise: Promise<AuthTokenDto> | null = null
type RetriableRequestConfig = NonNullable<AxiosError["config"]> & { _retry?: boolean }
type HiddenStateResponse = {
  hidden: boolean
  categoryName?: string | null
  categoryId?: string | null
}
type ViewerPreferenceResponse = {
  todoId?: string
  hiddenByViewer: boolean
  viewerCategoryId?: string | null
}

/**
 * Generic API Response wrapper handling
 */
type WrappedApiResponse<T> = {
  value?: T
  status?: number
  message?: string
}

type DataApiResponse<T> = {
  success?: boolean
  data?: T
  error?: unknown
  meta?: unknown
}

export type ApiResponse<T> = WrappedApiResponse<T> | DataApiResponse<T> | T

const hasWrappedValue = <T>(response: ApiResponse<T>): response is WrappedApiResponse<T> =>
  response !== null && typeof response === "object" && "value" in response

const hasWrappedData = <T>(response: ApiResponse<T>): response is DataApiResponse<T> =>
  response !== null &&
  typeof response === "object" &&
  "data" in response &&
  ("success" in response || "meta" in response || "error" in response)

/**
 * Extract data from API response (handles both wrapped and unwrapped responses)
 */
export const parseApiResponse = <T>(response: ApiResponse<T>): T => {
  if (hasWrappedValue(response)) {
    return response.value as T
  }
  if (hasWrappedData(response)) {
    return response.data as T
  }
  return response as T
}

export const getApiErrorMessage = (error: unknown, fallback = "Something went wrong"): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; error?: string | { message?: string }; title?: string; detail?: string }
      | undefined
    return data?.message ??
      (typeof data?.error === "string" ? data.error : data?.error?.message) ??
      data?.detail ??
      data?.title ??
      error.message ??
      fallback
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallback
}

const logApiHttpError = (error: AxiosError): void => {
  const status = error.response?.status
  if (!status) return

  const details = {
    status,
    method: error.config?.method,
    url: error.config?.url,
  }

  if (status >= 500) {
    console.error("[API Error]", details)
    return
  }

  // 401/403 are expected control-flow cases handled below. In Next dev, console.error
  // raises an overlay even when the request is caught and handled by UI state.
  if (status !== 401 && status !== 403 && process.env.NODE_ENV !== "production") {
    console.warn("[API Response]", details)
  }
}

/**
 * Initialize Axios instance
 * SECURITY: withCredentials: true causes the browser to include the httpOnly
 * refresh-token cookie on every request to the API origin. This is required for
 * the silent token refresh flow and for logout to clear the server-side cookie.
 */
export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000,
  withCredentials: true,
})

/**
 * Request interceptor - Add authorization token and CSRF token
 * 
 * SECURITY: 
 * - Authorization header contains JWT token for authentication
 * - CSRF token header prevents cross-site request forgery for state-modifying requests
 */
api.interceptors.request.use(async (config) => {
  const token = useAuthStore.getState().accessToken
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }

  // Add CSRF token to state-modifying requests
  if (shouldIncludeCsrfToken(config.method || 'GET')) {
    try {
      const csrfToken = await getCsrfToken()
      config.headers = config.headers ?? {}
      config.headers[CSRF_HEADER_NAME] = csrfToken
    } catch (error) {
      console.error('[API] Failed to add CSRF token:', error)
      // Continue anyway - server will reject if CSRF is required
    }
  }

  return config
}, (error) => {
  return Promise.reject(error)
})

/**
 * Response interceptor - Handle errors consistently
 * 
 * SECURITY:
 * - 401: Token expired or invalid - clear auth and redirect to login
 * - 403: Forbidden - CSRF token failed or insufficient permissions
 */
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response) {
      logApiHttpError(error)
      
      // Handle 401 Unauthorized
      if (error.response.status === 401) {
        const originalRequest = error.config as RetriableRequestConfig | undefined
        const url = originalRequest?.url as string | undefined

        // SECURITY: Do NOT clear auth or redirect when the 401 comes from the
        // login or refresh endpoint itself. A 401 from /auth/login just means
        // wrong credentials — the form should handle it, not the interceptor.
        const requestUrl = url ?? ""
        const isAuthEndpoint =
          requestUrl.includes("/auth/login") ||
          requestUrl.includes("/auth/register") ||
          requestUrl.includes("/auth/logout") ||
          requestUrl.includes("/auth/refresh")
        if (isAuthEndpoint) {
          return Promise.reject(error)
        }

        if (!originalRequest) {
          return Promise.reject(error)
        }

        if (!originalRequest._retry) {
          originalRequest._retry = true
          try {
            // No token arg - httpOnly cookie is sent automatically via withCredentials.
            // Do not gate on persisted expiry; the cookie is not readable from JS.
            refreshPromise = refreshPromise ?? refreshAccessToken().finally(() => {
              refreshPromise = null
            })
            const refreshed = await refreshPromise
            useAuthStore.getState().applyRefresh(refreshed)
            originalRequest.headers = originalRequest.headers ?? {}
            originalRequest.headers.Authorization = `Bearer ${refreshed.accessToken}`
            return api(originalRequest)
          } catch {
            console.warn("[API] Token refresh failed, clearing auth")
            trackProductEvent(
              PRODUCT_EVENTS.tokenRefreshFailed,
              { surface: "api_interceptor", url: requestUrl },
              useAuthStore.getState().accessToken,
            )
            useAuthStore.getState().clearAuth()
            clearCsrfToken()
            if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
              window.location.href = '/auth/login'
            }
          }
        } else {
          console.warn('[API] Unauthorized - clearing auth')
          useAuthStore.getState().clearAuth()
          clearCsrfToken()
          if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
            window.location.href = '/auth/login'
          }
        }
      }

      // Handle 403 Forbidden (CSRF token failure or permission denied)
      if (error.response.status === 403) {
        console.warn('[API] Forbidden - possible CSRF token failure')
        // Clear CSRF token to force refresh on next request
        clearCsrfToken()
      }
    } else if (error.request) {
      console.error("[Network Error]", error.message)
    } else {
      console.error("[Request Error]", error.message)
    }
    
    return Promise.reject(error)
  }
)

/**
 * Toggle the hidden state of a todo item.
 * Calls PATCH /todos/api/v1/todos/{id}/hidden with { hidden: bool }.
 */
export const setTaskHidden = async (id: string, hidden: boolean): Promise<{ hidden: boolean; categoryName: string | null; categoryId: string | null }> => {
  const { data } = await api.patch<ApiResponse<HiddenStateResponse>>(`/todos/api/v1/todos/${id}/hidden`, { hidden })
  const parsed = parseApiResponse(data)
  return {
    hidden: parsed.hidden,
    categoryName: parsed.categoryName ?? null,
    categoryId: parsed.categoryId ?? null,
  }
}

/**
 * Set the viewer-specific hidden preference for a shared task.
 * Calls PATCH /todos/api/v1/todos/{id}/viewer-preferences.
 * Only valid for non-owner viewers of a shared task.
 */
export const setViewerPreference = async (
  id: string,
  payload: {
    hiddenByViewer?: boolean
    viewerCategoryId?: string | null
    updateViewerCategory?: boolean
  }
): Promise<{ todoId: string; hiddenByViewer: boolean; viewerCategoryId: string | null }> => {
  const { data } = await api.patch<ApiResponse<ViewerPreferenceResponse>>(`/todos/api/v1/todos/${id}/viewer-preferences`, payload)
  const parsed = parseApiResponse(data)
  return {
    todoId: parsed.todoId ?? id,
    hiddenByViewer: parsed.hiddenByViewer,
    viewerCategoryId: parsed.viewerCategoryId ?? null,
  }
}

/**
 * Fetch a single todo item by ID.
 * Used after revealing a hidden task to hydrate the full DTO (description, dates, etc.).
 */
export const fetchTaskById = async (id: string): Promise<Todo> => {
  const { data } = await api.get<ApiResponse<Todo>>(`/todos/api/v1/todos/${id}`)
  return parseApiResponse(data)
}

export const joinTodo = async (id: string): Promise<Todo> => {
  const { data } = await api.post<ApiResponse<Todo>>(`/todos/api/v1/todos/${id}/join`)
  return parseApiResponse(data)
}

export const leaveTodo = async (id: string): Promise<void> => {
  await api.post(`/todos/api/v1/todos/${id}/leave`)
}

type PagedCommentsResponse = { items: TodoComment[]; totalCount: number }

export const fetchComments = async (
  todoId: string,
  pageNumber = 1,
  pageSize = 50,
): Promise<PagedCommentsResponse> => {
  const { data } = await api.get<ApiResponse<PagedCommentsResponse>>(
    `/todos/api/v1/todos/${todoId}/comments`,
    { params: { pageNumber, pageSize } },
  )
  return parseApiResponse(data)
}

export const addComment = async (todoId: string, content: string): Promise<TodoComment> => {
  const { data } = await api.post<ApiResponse<TodoComment>>(
    `/todos/api/v1/todos/${todoId}/comments`,
    { content },
  )
  return parseApiResponse(data)
}

export const updateComment = async (
  todoId: string,
  commentId: string,
  content: string,
): Promise<TodoComment> => {
  const { data } = await api.put<ApiResponse<TodoComment>>(
    `/todos/api/v1/todos/${todoId}/comments/${commentId}`,
    { content },
  )
  return parseApiResponse(data)
}

export const deleteComment = async (todoId: string, commentId: string): Promise<void> => {
  await api.delete(`/todos/api/v1/todos/${todoId}/comments/${commentId}`)
}
