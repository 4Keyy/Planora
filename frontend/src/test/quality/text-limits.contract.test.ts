import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { COMMENT_MAX, SUBTASK_TITLE_MAX, TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from "@/lib/limits"

// The editors' limits are the server's (lib/limits.ts). This reads the FluentValidation rules
// themselves, so a limit changed on one side fails here instead of in front of a user.
const repoRoot = path.resolve(process.cwd(), "..")

function serverMaxLength(validator: string, property: string): number {
  const source = fs.readFileSync(path.join(repoRoot, validator), "utf8")
  // One rule per segment: the text from this RuleFor up to the next one.
  const rule = source
    .split("RuleFor(")
    .find((segment) => new RegExp(`^\\s*\\w+\\s*=>\\s*\\w+\\.${property}\\s*\\)`).test(segment))
  if (!rule) throw new Error(`${validator} has no rule for ${property}`)
  const match = /\.MaximumLength\((\d+)\)/.exec(rule)
  if (!match) throw new Error(`${validator}: the ${property} rule sets no MaximumLength`)
  return Number(match[1])
}

const TODO = "Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands"
const COMMENTS = "Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands"

describe("editor text limits match the server's validators", () => {
  it("task title", () => {
    expect(TASK_TITLE_MAX).toBe(serverMaxLength(`${TODO}/CreateTodo/CreateTodoCommandValidator.cs`, "Title"))
  })

  it("task description on create and update", () => {
    expect(TASK_DESCRIPTION_MAX).toBe(serverMaxLength(`${TODO}/CreateTodo/CreateTodoCommandValidator.cs`, "Description"))
    expect(TASK_DESCRIPTION_MAX).toBe(serverMaxLength(`${TODO}/UpdateTodo/UpdateTodoCommandValidator.cs`, "Description"))
  })

  it("subtask title", () => {
    expect(SUBTASK_TITLE_MAX).toBe(serverMaxLength(`${TODO}/CreateSubtask/CreateSubtaskCommandValidator.cs`, "Title"))
  })

  it("branch messages on add and edit", () => {
    expect(COMMENT_MAX).toBe(serverMaxLength(`${COMMENTS}/AddComment/AddCommentCommandValidator.cs`, "Content"))
    expect(COMMENT_MAX).toBe(serverMaxLength(`${COMMENTS}/UpdateComment/UpdateCommentCommandValidator.cs`, "Content"))
  })
})
