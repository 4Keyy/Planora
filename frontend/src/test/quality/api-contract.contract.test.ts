import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { z } from "zod"
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

const KINDS: readonly Field["kind"][] = ["string", "number", "boolean", "array", "object"]

/** The same description, read from a zod schema's definition (the same in `zod` and `zod/mini`). */
function zodFields(schema: z.core.$ZodType): Record<string, Field> {
  const { shape } = schema._zod.def as z.core.$ZodObjectDef
  return Object.fromEntries(Object.entries(shape).map(([name, field]) => {
    let def = field._zod.def
    let nullable = false
    while (def.type === "nullable" || def.type === "optional") {
      nullable = true
      def = (def as z.core.$ZodNullableDef | z.core.$ZodOptionalDef).innerType._zod.def
    }
    return [name, { kind: KINDS.find((kind) => kind === def.type) ?? "any", nullable }]
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

  // FE-11 (API-10): every ReceiveNotification push is built by NotificationService.Wire, and it
  // must carry what the client's NotificationPayload reads.
  it("ReceiveNotification: the pushed fields are the client's NotificationPayload", () => {
    const service = source("Services/RealtimeApi/Planora.Realtime.Infrastructure/Services/NotificationService.cs")
    const wire = service.slice(service.indexOf("private static object Wire("))
    const pushed = [...wire.slice(0, wire.indexOf("};")).matchAll(/^\s*(\w+) = payload\.\w+,?$/gm)].map((m) => m[1])
    expect(service.match(/SendAsync\("ReceiveNotification", Wire\(/g)).toHaveLength(4)

    const client = source("frontend/src/lib/realtime/client.ts")
    const block = client.slice(client.indexOf("export interface NotificationPayload {"))
    const fields = [...block.slice(0, block.indexOf("}")).matchAll(/^\s*(\w+)(\?)?:/gm)]
    // `occurredOn` is the alias an older realtime service sent; the client still reads it, nothing sends it.
    const read = fields.filter(([, name]) => name !== "occurredOn").map(([, name]) => name)

    expect(pushed.sort()).toEqual(read.sort())
  })

  // FE-11 (API-11): a field the client writes that the command does not have is dropped by model
  // binding without a word — the create payload carried `tags`, which nothing ever stored.
  it.each([
    { type: "CreateTodoPayload", command: "Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/CreateTodo/CreateTodoCommand.cs" },
    { type: "UpdateTodoPayload", command: "Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/UpdateTodo/UpdateTodoCommand.cs" },
  ])("$type writes only fields the command binds", ({ type, command }) => {
    const types = source("frontend/src/types/todo.ts")
    const block = types.slice(types.indexOf(`export type ${type} = {`))
    const written = [...block.slice(0, block.indexOf("\n}")).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1])

    const record = source(command)
    const parameters = [...record.slice(record.indexOf("record "), record.indexOf(") : ICommand")).matchAll(/^\s*[\w<>?,\s]+?\s(\w+)(?:\s*=[^,\n]*)?,?\s*$/gm)]
      .map((m) => m[1][0].toLowerCase() + m[1].slice(1))

    expect(written.length).toBeGreaterThan(5)
    expect(written.filter((field) => !parameters.includes(field))).toEqual([])
  })

  // The full zod added about 30 KB gzip to the first-load JS of every page that imported it.
  // `zod/mini` keeps the forms to a few KB, and `lib/api.ts` loads these schemas only when the
  // first GET answer arrives.
  it("the app uses zod/mini and loads the response contracts lazily", () => {
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === "test" ? [] : files(full)
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
    })
    const fullZod = files(path.join(repoRoot, "frontend", "src"))
      .filter((file) => /from\s+["']zod(?:\/v4(?:\/classic)?)?["']/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(repoRoot, file))
    expect(fullZod).toEqual([])

    const api = source("frontend/src/lib/api.ts")
    expect(api).toContain('import type * as ApiContract from "@/lib/api-contract"')
    expect(api).toContain('import("@/lib/api-contract")')
    expect(api).not.toMatch(/^import \{[^}]*\} from "@\/lib\/api-contract"/m)
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
