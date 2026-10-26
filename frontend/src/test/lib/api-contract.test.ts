import { describe, expect, it } from "vitest"
import { describeContractMismatch } from "@/lib/api-contract"

const ID = "11111111-1111-1111-1111-111111111111"

/** A `TodoItemDto` as the API writes it: every property present, nulls included. */
const todo = (overrides: Record<string, unknown> = {}) => ({
  id: ID, userId: ID, createdByUserId: null, title: "File the report", description: null, status: "Todo",
  categoryId: null, dueDate: "2026-10-21T00:00:00Z", dueDateStart: null, expectedDate: null, actualDate: null,
  priority: "Medium", isPublic: false, hidden: false, isCompleted: false, completedAt: null, isOnTime: null,
  delay: null, tags: [], createdAt: "2026-10-20T09:00:00Z", updatedAt: null, categoryName: null,
  categoryColor: null, categoryIcon: null, authorCategoryName: null, authorCategoryColor: null,
  authorCategoryIcon: null, sharedWithUserIds: [], hasSharedAudience: false, isVisuallyUrgent: false,
  requiredWorkers: null, workerCount: 0, isWorking: false, workerUserIds: [], workers: [],
  isCompletedByViewer: null, ownerCompleted: false, parentTodoId: null, openSubtaskCount: 0,
  authorName: null, authorAvatarUrl: null,
  ...overrides,
})

const page = (items: unknown[]) => ({
  items, pageNumber: 1, pageSize: 100, totalCount: items.length, totalPages: 1, hasPreviousPage: false, hasNextPage: false,
})

describe("response contracts", () => {
  it("accepts the shapes the API writes", () => {
    expect(describeContractMismatch("get", "/todos/api/v1/todos?pageSize=100", page([todo(), todo({ hidden: true, status: "" })]))).toBeNull()
    expect(describeContractMismatch("get", `/todos/api/v1/todos/${ID}`, todo({ delay: "1.02:00:00", workers: [{ userId: ID, name: null, avatarUrl: null }] }))).toBeNull()
    expect(describeContractMismatch("get", "/auth/api/v1/users/me", {
      id: ID, email: "a@b.c", firstName: "A", lastName: "B", profilePictureUrl: null, status: "Active",
      isEmailVerified: true, emailVerifiedAt: null, lastLoginAt: null, twoFactorEnabled: false, createdAt: "2026-01-01T00:00:00Z",
    })).toBeNull()
    expect(describeContractMismatch("get", "/friendships", page([
      { id: ID, email: "a@b.c", firstName: "A", lastName: "B", profilePictureUrl: null, friendsSince: "2026-01-01T00:00:00Z" },
    ]))).toBeNull()
    expect(describeContractMismatch("get", "/categories/api/v1/categories", [
      { id: ID, userId: ID, name: "Work", description: null, color: "#3b82f6", icon: null, displayOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: null },
    ])).toBeNull()
  })

  it("names each drifted field once, however many rows carry it", () => {
    const drifted = page([todo({ priority: 3 }), todo({ priority: 4, tags: null }), todo({ isPublic: undefined })])

    expect(describeContractMismatch("GET", "http://localhost:5132/todos/api/v1/todos?pageNumber=2", drifted)).toEqual({
      endpoint: "GET /todos/api/v1/todos",
      issues: [
        "items.*.priority invalid_type (expected string, got number)",
        "items.*.tags invalid_type (expected array, got null)",
        "items.*.isPublic invalid_type (expected boolean, got undefined)",
      ],
    })
  })

  it("describes paths and types, never values", () => {
    const mismatch = describeContractMismatch("get", "/auth/api/v1/users/me", { email: "private@example.com", firstName: 42 })

    expect(JSON.stringify(mismatch)).not.toContain("private@example.com")
    expect(JSON.stringify(mismatch)).not.toContain("42")
    expect(mismatch?.issues.length).toBeLessThanOrEqual(5)
  })

  it("lets extra fields through: the server may add before the client reads", () => {
    expect(describeContractMismatch("get", `/todos/api/v1/todos/${ID}`, todo({ somethingNew: 1 }))).toBeNull()
  })

  it("checks only the GETs it knows", () => {
    expect(describeContractMismatch("post", "/todos/api/v1/todos", {})).toBeNull()
    expect(describeContractMismatch("get", "/todos/api/v1/todos/category-counts", [])).toBeNull()
    expect(describeContractMismatch("get", `/todos/api/v1/todos/${ID}/subtasks`, [])).toBeNull()
    expect(describeContractMismatch("get", undefined, {})).toBeNull()
  })
})
