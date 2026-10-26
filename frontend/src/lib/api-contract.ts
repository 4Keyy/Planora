import { z } from "zod/mini"
import type { Todo } from "@/types/todo"
import type { FriendDto, PagedResult, UserDto } from "@/types/auth"
import type { Category } from "@/types/category"

/**
 * The shapes the client reads from its most-used endpoints, checked when the response arrives
 * (FE-09). TypeScript types are only assertions: a field the server renamed, dropped or changed
 * used to surface only as a broken screen. A response that does not match is reported to the
 * service logs (`reportContractMismatch`) and passed on unchanged — the check never fails a
 * request or changes what a screen receives.
 *
 * Each schema mirrors one C# DTO field for field, with its nullability;
 * `src/test/quality/api-contract.contract.test.ts` reads the DTO sources and fails when the two
 * differ, and the `satisfies` checks below fail type-checking when a schema stops matching the
 * TypeScript type the screens use. Unknown fields pass (`z.looseObject`).
 *
 * Written with `zod/mini`, whose functions are tree-shaken, and loaded by `lib/api.ts` only when
 * the first GET answer arrives: bundled with every page, the full zod 4 added about 30 KB gzip to
 * each route's first-load JS for a check no screen waits on.
 */

const guid = z.string()
const instant = z.string()
/** A .NET `TimeSpan`, serialized as `[d.]hh:mm:ss[.fffffff]`. */
const timeSpan = z.string()

export const TodoWorkerSchema = z.looseObject({
  userId: guid,
  name: z.nullable(z.string()),
  avatarUrl: z.nullable(z.string()),
})

/** `Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs` */
export const TodoSchema = z.looseObject({
  id: guid,
  userId: guid,
  createdByUserId: z.nullable(guid),
  title: z.string(),
  description: z.nullable(z.string()),
  status: z.string(),
  categoryId: z.nullable(guid),
  dueDate: z.nullable(instant),
  dueDateStart: z.nullable(instant),
  expectedDate: z.nullable(instant),
  actualDate: z.nullable(instant),
  priority: z.string(),
  isPublic: z.boolean(),
  hidden: z.boolean(),
  isCompleted: z.boolean(),
  completedAt: z.nullable(instant),
  isOnTime: z.nullable(z.boolean()),
  delay: z.nullable(timeSpan),
  tags: z.array(z.string()),
  createdAt: instant,
  updatedAt: z.nullable(instant),
  categoryName: z.nullable(z.string()),
  categoryColor: z.nullable(z.string()),
  categoryIcon: z.nullable(z.string()),
  authorCategoryName: z.nullable(z.string()),
  authorCategoryColor: z.nullable(z.string()),
  authorCategoryIcon: z.nullable(z.string()),
  sharedWithUserIds: z.array(guid),
  hasSharedAudience: z.nullable(z.boolean()),
  isVisuallyUrgent: z.nullable(z.boolean()),
  requiredWorkers: z.nullable(z.int()),
  workerCount: z.int(),
  isWorking: z.boolean(),
  workerUserIds: z.array(guid),
  workers: z.array(TodoWorkerSchema),
  isCompletedByViewer: z.nullable(z.boolean()),
  ownerCompleted: z.boolean(),
  parentTodoId: z.nullable(guid),
  openSubtaskCount: z.int(),
  authorName: z.nullable(z.string()),
  authorAvatarUrl: z.nullable(z.string()),
})

/** `BuildingBlocks/Planora.BuildingBlocks.Application/Pagination/PagedResult.cs` */
const paged = <T extends z.ZodMiniType>(item: T) => z.looseObject({
  items: z.array(item),
  pageNumber: z.int(),
  pageSize: z.int(),
  totalCount: z.int(),
  totalPages: z.int(),
  hasPreviousPage: z.boolean(),
  hasNextPage: z.boolean(),
})

/** `Services/AuthApi/Planora.Auth.Application/Common/DTOs/UserDto.cs` */
export const UserSchema = z.looseObject({
  id: guid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  profilePictureUrl: z.nullable(z.string()),
  status: z.string(),
  isEmailVerified: z.boolean(),
  emailVerifiedAt: z.nullable(instant),
  lastLoginAt: z.nullable(instant),
  twoFactorEnabled: z.boolean(),
  createdAt: instant,
})

/** `Services/AuthApi/Planora.Auth.Application/Features/Friendships/Queries/GetFriends/FriendDto.cs` */
export const FriendSchema = z.looseObject({
  id: guid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  profilePictureUrl: z.nullable(z.string()),
  friendsSince: instant,
})

/** `Services/CategoryApi/Planora.Category.Application/DTOs/CategoryDto.cs` */
export const CategorySchema = z.looseObject({
  id: guid,
  userId: guid,
  name: z.string(),
  description: z.nullable(z.string()),
  color: z.string(),
  icon: z.nullable(z.string()),
  displayOrder: z.int(),
  createdAt: instant,
  updatedAt: z.nullable(instant),
})

export const PagedTodosSchema = paged(TodoSchema)
export const PagedFriendsSchema = paged(FriendSchema)
export const CategoryListSchema = z.array(CategorySchema)

// What the schemas accept is what the screens read: these fail type-checking when they drift apart.
type Accepts<T> = (value: T) => void
const accepts = <T>(): Accepts<T> => () => undefined
void (accepts<Todo>() satisfies Accepts<z.infer<typeof TodoSchema>>)
void (accepts<UserDto>() satisfies Accepts<z.infer<typeof UserSchema>>)
void (accepts<FriendDto>() satisfies Accepts<z.infer<typeof FriendSchema>>)
void (accepts<PagedResult<FriendDto>>() satisfies Accepts<z.infer<typeof PagedFriendsSchema>>)
void (accepts<Category>() satisfies Accepts<z.infer<typeof CategorySchema>>)

/** The endpoints whose answers are checked: a GET's path (no query) and the shape of its body. */
export const RESPONSE_CONTRACTS: ReadonlyArray<{ name: string; path: RegExp; schema: z.ZodMiniType }> = [
  { name: "GET /todos/api/v1/todos", path: /^\/todos\/api\/v1\/todos$/, schema: PagedTodosSchema },
  { name: "GET /todos/api/v1/todos/{id}", path: /^\/todos\/api\/v1\/todos\/[0-9a-fA-F-]{36}$/, schema: TodoSchema },
  { name: "GET /auth/api/v1/users/me", path: /^\/auth\/api\/v1\/users\/me$/, schema: UserSchema },
  { name: "GET /auth/api/v1/friendships", path: /^(?:\/auth\/api\/v1)?\/friendships$/, schema: PagedFriendsSchema },
  { name: "GET /categories/api/v1/categories", path: /^\/categories\/api\/v1\/categories$/, schema: CategoryListSchema },
]

/** At most this many differences are described per response. */
const MAX_ISSUES = 5

/** The value an issue points at: zod 4 reports the expected type, not the one it found. */
function valueAt(body: unknown, path: ReadonlyArray<PropertyKey>): unknown {
  let current = body
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined
    current = (current as Record<PropertyKey, unknown>)[key]
  }
  return current
}

/** A JSON value's type name: `null`, `array`, or what `typeof` says. */
function kindOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

/**
 * The differences between a response body (already unwrapped from its envelope) and the contract
 * for `method path`, or `null` when no contract applies or the body matches. Item indices are
 * folded (`items.*.priority`) so one drifted field reads as one difference however many rows
 * carry it. Only field paths and type names are described, never values.
 */
export function describeContractMismatch(method: string | undefined, url: string | undefined, body: unknown): { endpoint: string; issues: string[] } | null {
  if ((method ?? "get").toLowerCase() !== "get" || !url) return null
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split(/[?#]/)[0]
  const contract = RESPONSE_CONTRACTS.find((candidate) => candidate.path.test(path))
  if (!contract) return null

  const result = contract.schema.safeParse(body)
  if (result.success) return null

  const issues = new Set<string>()
  for (const issue of result.error.issues) {
    const where = issue.path.map((part) => (typeof part === "number" ? "*" : String(part))).join(".") || "(body)"
    const detail = issue.code === "invalid_type" ? ` (expected ${issue.expected}, got ${kindOf(valueAt(body, issue.path))})` : ""
    issues.add(`${where} ${issue.code}${detail}`)
    if (issues.size >= MAX_ISSUES) break
  }
  return { endpoint: contract.name, issues: [...issues] }
}
