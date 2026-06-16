import { describe, expect, it } from "vitest"
import {
  NOTIFICATION_TYPES,
  getNotificationKind,
  isSystemNotification,
} from "@/lib/notifications/types"

describe("notification types", () => {
  it("maps every known type to a configured kind", () => {
    for (const type of Object.values(NOTIFICATION_TYPES)) {
      const kind = getNotificationKind(type)
      expect(kind.icon).toBeTruthy()
      expect(kind.tint).toMatch(/^#/)
      expect(kind.label.length).toBeGreaterThan(0)
    }
  })

  it("flags the people+check composite for participants-done", () => {
    expect(getNotificationKind(NOTIFICATION_TYPES.TaskParticipantsDone).composite).toBe("people-check")
    expect(getNotificationKind(NOTIFICATION_TYPES.CommentAdded).composite).toBeUndefined()
  })

  it("falls back to a generic kind for unknown / null / undefined", () => {
    expect(getNotificationKind("totally.unknown").label).toBe("Notification")
    expect(getNotificationKind(null).label).toBe("Notification")
    expect(getNotificationKind(undefined).label).toBe("Notification")
  })

  it("marks only the high-signal kinds as OS-eligible", () => {
    expect(isSystemNotification(NOTIFICATION_TYPES.CommentReply)).toBe(true)
    expect(isSystemNotification(NOTIFICATION_TYPES.TaskCompleted)).toBe(true)
    expect(isSystemNotification(NOTIFICATION_TYPES.TaskReview)).toBe(true)
    expect(isSystemNotification(NOTIFICATION_TYPES.TaskParticipantsDone)).toBe(true)

    expect(isSystemNotification(NOTIFICATION_TYPES.CommentAdded)).toBe(false)
    expect(isSystemNotification(NOTIFICATION_TYPES.SubtaskAdded)).toBe(false)
    expect(isSystemNotification(NOTIFICATION_TYPES.SubtaskCompleted)).toBe(false)
    expect(isSystemNotification(NOTIFICATION_TYPES.TaskStarted)).toBe(false)
    expect(isSystemNotification("unknown")).toBe(false)
    expect(isSystemNotification(null)).toBe(false)
  })
})
