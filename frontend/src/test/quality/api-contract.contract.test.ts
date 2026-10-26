import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  CategorySchema,
  FriendSchema,
  PagedTodosSchema,
  TodoSchema,
  TodoWorkerSchema,
  UserSchema,
} from "@/lib/api-contract"

// The runtime schemas (lib/api-contract.ts) must say what the server's DTOs say: every field,
// its JSON kind and whether it may be null. A field added, renamed, dropped or retyped on either
// side fails here, before it can reach a screen as undefined.

const repoRoot = path.resolve(process.cwd(), "..")
const source = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8")

type Field = { kind: "string" | "number" | "boolean" | "array" | "object" | "any"; nullable: boolean }

/** The JSON a System.Text.Json property of this C# type is written as. */
function csharpField(type: string): Field {
  const trimmed = type.replace(/\s+/g, "")
  const nullable = trimmed.endsWith("?")
  const base = nullable ? trimmed.slice(0, -1) : trimmed
  if (/^(Guid|string|DateTime|DateTimeOffset|TimeSpan)$/.test(base)) return { kind: "string", nullable }
  if (/^(int|long|short|double|float|decimal)$/.test(base)) return { kind: "number", nullable }
  if (base === "bool") return { kind: "boolean", nullable }
  if (/^(IReadOnlyList|IReadOnlyCollection|IEnumerable|List|ICollection)<.+>$/.test(base) || base.endsWith("[]")) return { kind: "array", nullable }
  if (/^[A-Z]$/.test(base)) return { kind: "any", nullable }
  return { kind: "object", nullable }
}

/** The public properties of `typeName` in a C# file, camel-cased as the API writes them. */
function csharpProperties(file: string, typeName: string): Record<string, Field> {
  const text = source(file)
  const start = text.search(new RegExp(`(record|class)\\s+${typeName}\\b`))
  expect(start, `${typeName} in ${file}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  let opened = false
  let end = start
  for (let i = text.indexOf("{", start); i < text.length; i++) {
    if (text[i] === "{") { depth++; opened = true }
    else if (text[i] === "}") depth--
    if (opened && depth === 0) { end = i; break }
  }
  const body = text.slice(start, end)
  const fields: Record<string, Field> = {}
  const property = /^\s*public\s+(?:required\s+)?(?!static\b|sealed\b|class\b|record\b)([\w<>?,.\[\]\s]+?)\s+(\w+)\s*(?:\{\s*get|=>)/gm
  for (const match of body.matchAll(property)) {
    const name = match[2][0].toLowerCase() + match[2].slice(1)
    fields[name] = csharpField(match[1])
  }
  return fields
}

/** The same description, read from a zod schema. */
function zodFields(schema: z.ZodTypeAny): Record<string, Field> {
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape
  return Object.fromEntries(Object.entries(shape).map(([name, field]) => {
    let current = field as z.ZodTypeAny
    let nullable = false
    while (current instanceof z.ZodNullable || current instanceof z.ZodOptional) {
      nullable = true
      current = current.unwrap()
    }
    const kind: Field["kind"] =
      current instanceof z.ZodString ? "string"
      : current instanceof z.ZodNumber ? "number"
      : current instanceof z.ZodBoolean ? "boolean"
      : current instanceof z.ZodArray ? "array"
      : current instanceof z.ZodObject ? "object"
      : "any"
    return [name, { kind, nullable }]
  }))
}

const contracts = [
  { file: "Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs", type: "TodoItemDto", schema: TodoSchema },
  { file: "Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs", type: "TodoWorkerDto", schema: TodoWorkerSchema },
  { file: "Services/AuthApi/Planora.Auth.Application/Common/DTOs/UserDto.cs", type: "UserDto", schema: UserSchema },
  { file: "Services/AuthApi/Planora.Auth.Application/Features/Friendships/Queries/GetFriends/FriendDto.cs", type: "FriendDto", schema: FriendSchema },
  { file: "Services/CategoryApi/Planora.Category.Application/DTOs/CategoryDto.cs", type: "CategoryDto", schema: CategorySchema },
]

describe("response contracts match the server's DTOs", () => {
  it.each(contracts)("$type: same fields, kinds and nullability", ({ file, type, schema }) => {
    expect(zodFields(schema)).toEqual(csharpProperties(file, type))
  })

  it("PagedResult: the list envelope", () => {
    const server = csharpProperties("BuildingBlocks/Planora.BuildingBlocks.Application/Pagination/PagedResult.cs", "PagedResult")
    const client = zodFields(PagedTodosSchema)
    // `Items` is `IReadOnlyList<T>`: an array whatever T is.
    expect(client).toEqual(server)
  })

  it("the endpoints still return these DTOs", () => {
    const todos = source("Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs")
    expect(todos).toMatch(/\[HttpGet\]\s*(?:\[[^\]]+\]\s*)*public async Task<ActionResult<PagedResult<TodoItemDto>>> GetTodos\(/)
    expect(todos).toMatch(/\[HttpGet\("\{id\}"\)\]\s*(?:\[[^\]]+\]\s*)*public async Task<ActionResult<TodoItemDto>> GetTodoById\(/)

    const users = source("Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs")
    expect(users).toMatch(/\[HttpGet\("me"\)\]\s*\[ProducesResponseType\(typeof\(UserDto\), StatusCodes\.Status200OK\)\]/)

    const friends = source("Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs")
    expect(friends).toMatch(/\[HttpGet\]\s*(?:\[[^\]]+\]\s*)*public async Task<ActionResult<PagedResult<FriendDto>>> GetFriends\(/)

    const categories = source("Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs")
    expect(categories).toMatch(/\[HttpGet\]\s*(?:\[[^\]]+\]\s*)*public async Task<ActionResult<IReadOnlyList<CategoryDto>>> GetCategories\(/)
  })
})
