import {
  MessageCircle,
  Reply,
  ListPlus,
  CheckCheck,
  Zap,
  Check,
  ClipboardCheck,
  Users,
  Bell,
  type LucideIcon,
} from "lucide-react"

/**
 * Canonical notification type discriminators — mirror the backend's NotificationType. Sent on the
 * wire as strings, so the client maps each to an icon / tint / OS-notification policy and degrades
 * an unknown type to a generic bell.
 */
export const NOTIFICATION_TYPES = {
  CommentAdded: "comment.added",
  CommentReply: "comment.reply",
  SubtaskAdded: "subtask.added",
  SubtaskCompleted: "subtask.completed",
  TaskStarted: "task.started",
  TaskCompleted: "task.completed",
  TaskReview: "task.review",
  TaskParticipantsDone: "task.participants_done",
} as const

/** Visual + behavioral config for one notification kind. */
export interface NotificationKind {
  icon: LucideIcon
  /** Accent color (hex) — used for the glyph, ring and count bubble. */
  tint: string
  /** Short human label for the bell row. */
  label: string
  /** Whether this kind raises a native OS notification (when the tab is backgrounded). */
  isSystem: boolean
  /** The "little people + checkmark" composite glyph (participants done). */
  composite?: "people-check"
}

const DEFAULT_KIND: NotificationKind = {
  icon: Bell,
  tint: "#6366f1",
  label: "Notification",
  isSystem: false,
}

const KINDS: Record<string, NotificationKind> = {
  [NOTIFICATION_TYPES.CommentAdded]: {
    icon: MessageCircle, tint: "#6366f1", label: "New message", isSystem: false,
  },
  [NOTIFICATION_TYPES.CommentReply]: {
    icon: Reply, tint: "#8b5cf6", label: "Reply to you", isSystem: true,
  },
  [NOTIFICATION_TYPES.SubtaskAdded]: {
    icon: ListPlus, tint: "#0ea5e9", label: "New subtask", isSystem: false,
  },
  [NOTIFICATION_TYPES.SubtaskCompleted]: {
    icon: CheckCheck, tint: "#10b981", label: "Subtask completed", isSystem: false,
  },
  [NOTIFICATION_TYPES.TaskStarted]: {
    icon: Zap, tint: "#6366f1", label: "Taken into work", isSystem: false,
  },
  [NOTIFICATION_TYPES.TaskCompleted]: {
    icon: Check, tint: "#059669", label: "Task completed", isSystem: true,
  },
  [NOTIFICATION_TYPES.TaskReview]: {
    icon: ClipboardCheck, tint: "#f59e0b", label: "Ready for review", isSystem: true,
  },
  [NOTIFICATION_TYPES.TaskParticipantsDone]: {
    icon: Users, tint: "#14b8a6", label: "All collaborators done", isSystem: true, composite: "people-check",
  },
}

/** Resolve the visual/behavioral config for a notification type (generic bell for unknowns). */
export function getNotificationKind(type: string | null | undefined): NotificationKind {
  if (!type) return DEFAULT_KIND
  return KINDS[type] ?? DEFAULT_KIND
}

/** Whether a notification type should raise a native OS notification when the tab is backgrounded. */
export function isSystemNotification(type: string | null | undefined): boolean {
  return getNotificationKind(type).isSystem
}
