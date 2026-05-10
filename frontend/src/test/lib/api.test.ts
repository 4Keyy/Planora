import axios from "axios"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  api,
  fetchTaskById,
  getApiErrorMessage,
  parseApiResponse,
  setTaskHidden,
  setViewerPreference,
} from "@/lib/api"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

describe("api response helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("unwraps responses that use the backend value envelope", () => {
    expect(parseApiResponse({ value: { ok: true }, status: 200 })).toEqual({ ok: true })
  })

  it("unwraps responses that use the shared success/data envelope", () => {
    expect(parseApiResponse({ success: true, data: { ok: true }, meta: { correlationId: "trace" } })).toEqual({ ok: true })
  })

  it("returns unwrapped responses unchanged", () => {
    expect(parseApiResponse({ ok: true })).toEqual({ ok: true })
  })

  it("extracts nested API error messages from shared error envelopes", () => {
    const error = new axios.AxiosError("Request failed")
    error.response = {
      data: {
        success: false,
        error: { code: "VALIDATION", message: "Title is required" },
      },
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: { headers: new axios.AxiosHeaders() },
    }

    expect(getApiErrorMessage(error)).toBe("Title is required")
  })

  it("falls back through all supported API error message shapes", () => {
    const stringError = new axios.AxiosError("Request failed")
    stringError.response = {
      data: { error: "Forbidden" },
      status: 403,
      statusText: "Forbidden",
      headers: {},
      config: { headers: new axios.AxiosHeaders() },
    }
    const detailError = new axios.AxiosError("Request failed")
    detailError.response = {
      data: { detail: "Detailed failure", title: "Fallback title" },
      status: 500,
      statusText: "Server Error",
      headers: {},
      config: { headers: new axios.AxiosHeaders() },
    }

    expect(getApiErrorMessage(stringError)).toBe("Forbidden")
    expect(getApiErrorMessage(detailError)).toBe("Detailed failure")
    expect(getApiErrorMessage(new Error("Plain failure"))).toBe("Plain failure")
    expect(getApiErrorMessage("unknown", "Fallback")).toBe("Fallback")
  })

  it("normalizes hidden toggle responses", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({
      data: { value: { hidden: true, categoryName: undefined, categoryId: "cat-1" } },
    })

    await expect(setTaskHidden("todo-1", true)).resolves.toEqual({
      hidden: true,
      categoryName: null,
      categoryId: "cat-1",
    })
    expect(patch).toHaveBeenCalledWith("/todos/api/v1/todos/todo-1/hidden", { hidden: true })
  })

  it("normalizes shared viewer preference responses and defaults todoId", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({
      data: { hiddenByViewer: false, viewerCategoryId: undefined },
    })

    await expect(setViewerPreference("todo-9", { hiddenByViewer: false })).resolves.toEqual({
      todoId: "todo-9",
      hiddenByViewer: false,
      viewerCategoryId: null,
    })
    expect(patch).toHaveBeenCalledWith("/todos/api/v1/todos/todo-9/viewer-preferences", {
      hiddenByViewer: false,
    })
  })

  it("fetches one todo through the expected gateway route", async () => {
    const todo: Todo = {
      id: "todo-1",
      userId: "user-1",
      title: "Plan",
      status: TodoStatus.Pending,
      priority: TodoPriority.Medium,
      isPublic: false,
      isCompleted: false,
      tags: [],
      createdAt: "2026-05-01T00:00:00.000Z",
    }
    const get = vi.spyOn(api, "get").mockResolvedValue({ data: { value: todo } })

    await expect(fetchTaskById("todo-1")).resolves.toBe(todo)
    expect(get).toHaveBeenCalledWith("/todos/api/v1/todos/todo-1")
  })
})
