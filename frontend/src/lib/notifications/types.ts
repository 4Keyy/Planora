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

/**
 * The contextual "analogy" a notification carries — who/what it is really about.
 * Drives a small secondary glyph on the badge so a glance reads "this is about
 * people" / "this happened in the branch" / "someone is talking", not just a color:
 *   - "people" → a collaborator acted (started, completed, ready for review)
 *   - "branch" → the task's branch/subtasks changed (subtask added/done)
 *   - "chat"   → a message or reply in the branch thread
 */
export type NotificationMotif = "people" | "branch" | "chat"

/** Visual + behavioral config for one notification kind. */
export interface NotificationKind {
  icon: LucideIcon
  /** Accent color (hex) — used for the glyph, ring and count bubble. */
  tint: string
  /** Short human label for the bell row. */
  label: string
  /** Whether this kind raises a native OS notification (when the tab is backgrounded). */
  isSystem: boolean
  /** What the event is really about — people, the branch, or chat. Drives the motif glyph. */
  motif: NotificationMotif
  /** The "little people + checkmark" composite glyph (participants done). */
  composite?: "people-check"
}

// Semantic, glanceable color system — three families so the hue itself reads the
// category before the glyph does: blues = communication / new, greens = completion,
// ambers = needs-your-attention. Keeps the palette vivid but on-brand (Planora is a
// neutral UI with one functional accent per state), without the old indigo/violet glut.
const DEFAULT_KIND: NotificationKind = {
  icon: Bell,
  tint: "#64748b", // slate — neutral, matches the app's grayscale chrome
  label: "Notification",
  isSystem: false,
  motif: "people",
}

const KINDS: Record<string, NotificationKind> = {
  [NOTIFICATION_TYPES.CommentAdded]: {
    icon: MessageCircle, tint: "#3b82f6", label: "New message", isSystem: false, motif: "chat",
  },
  [NOTIFICATION_TYPES.CommentReply]: {
    icon: Reply, tint: "#0ea5e9", label: "Reply to you", isSystem: true, motif: "chat",
  },
  [NOTIFICATION_TYPES.SubtaskAdded]: {
    icon: ListPlus, tint: "#6366f1", label: "New subtask", isSystem: false, motif: "branch",
  },
  [NOTIFICATION_TYPES.SubtaskCompleted]: {
    icon: CheckCheck, tint: "#10b981", label: "Subtask done", isSystem: false, motif: "branch",
  },
  [NOTIFICATION_TYPES.TaskStarted]: {
    icon: Zap, tint: "#f59e0b", label: "Picked up", isSystem: false, motif: "people",
  },
  [NOTIFICATION_TYPES.TaskCompleted]: {
    icon: Check, tint: "#16a34a", label: "Task done", isSystem: true, motif: "people",
  },
  [NOTIFICATION_TYPES.TaskReview]: {
    icon: ClipboardCheck, tint: "#f97316", label: "Ready for review", isSystem: true, motif: "people",
  },
  [NOTIFICATION_TYPES.TaskParticipantsDone]: {
    icon: Users, tint: "#0d9488", label: "Everyone's done", isSystem: true, motif: "people", composite: "people-check",
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
