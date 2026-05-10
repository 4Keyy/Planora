import { create } from "zustand"

/**
 * Toast notification type variants
 */
export type ToastType = "success" | "error" | "warning" | "info"

/**
 * Toast notification item structure
 */
export type ToastItem = {
  id: string
  title: string
  description?: string
  type: ToastType
}

/**
 * Toast store state and actions
 */
type ToastState = {
  toasts: ToastItem[]
  addToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => void
  removeToast: (id: string) => void
  clear: () => void
}

const TOAST_AUTO_DURATION = 5000

/**
 * Generate unique ID for toast
 */
const generateId = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

/**
 * Zustand toast store for notifications
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  /**
   * Add new toast notification
   */
  addToast: (toast) => {
    const id = toast.id ?? generateId()
    set((state) => ({ 
      toasts: [...state.toasts, { ...toast, id }] 
    }))

    // Auto-remove toast after duration
    setTimeout(() => {
      set((state) => ({ 
        toasts: state.toasts.filter((t) => t.id !== id) 
      }))
    }, TOAST_AUTO_DURATION)
  },

  /**
   * Remove specific toast by ID
   */
  removeToast: (id) => 
    set((state) => ({ 
      toasts: state.toasts.filter((t) => t.id !== id) 
    })),

  /**
   * Clear all toasts
   */
  clear: () => set({ toasts: [] }),
}))
