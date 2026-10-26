import { z } from "zod"
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
 * TypeScript type the screens use. Unknown fields pass (`passthrough`).
 */

const guid = z.string()
const instant = z.string()
/** A .NET `TimeSpan`, serialized as `[d.]hh:mm:ss[.fffffff]`. */
const timeSpan = z.string()

export const TodoWorkerSchema = z.object({
  userId: guid,
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
}).passthrough()

/** `Services/TodoApi/Planora.Todo.Application/DTOs/TodoItemDto.cs` */
export const TodoSchema = z.object({
  id: guid,
  userId: guid,
  createdByUserId: guid.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  categoryId: guid.nullable(),
  dueDate: instant.nullable(),
  dueDateStart: instant.nullable(),
  expectedDate: instant.nullable(),
  actualDate: instant.nullable(),
  priority: z.string(),
  isPublic: z.boolean(),
  hidden: z.boolean(),
  isCompleted: z.boolean(),
  completedAt: instant.nullable(),
  isOnTime: z.boolean().nullable(),
  delay: timeSpan.nullable(),
  tags: z.array(z.string()),
  createdAt: instant,
  updatedAt: instant.nullable(),
  categoryName: z.string().nullable(),
  categoryColor: z.string().nullable(),
  categoryIcon: z.string().nullable(),
  authorCategoryName: z.string().nullable(),
  authorCategoryColor: z.string().nullable(),
  authorCategoryIcon: z.string().nullable(),
  sharedWithUserIds: z.array(guid),
  hasSharedAudience: z.boolean().nullable(),
  isVisuallyUrgent: z.boolean().nullable(),
  requiredWorkers: z.number().int().nullable(),
  workerCount: z.number().int(),
  isWorking: z.boolean(),
  workerUserIds: z.array(guid),
  workers: z.array(TodoWorkerSchema),
  isCompletedByViewer: z.boolean().nullable(),
  ownerCompleted: z.boolean(),
  parentTodoId: guid.nullable(),
  openSubtaskCount: z.number().int(),
  authorName: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
}).passthrough()

/** `BuildingBlocks/Planora.BuildingBlocks.Application/Pagination/PagedResult.cs` */
const paged = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item),
  pageNumber: z.number().int(),
  pageSize: z.number().int(),
  totalCount: z.number().int(),
  totalPages: z.number().int(),
  hasPreviousPage: z.boolean(),
  hasNextPage: z.boolean(),
}).passthrough()

/** `Services/AuthApi/Planora.Auth.Application/Common/DTOs/UserDto.cs` */
export const UserSchema = z.object({
  id: guid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  profilePictureUrl: z.string().nullable(),
  status: z.string(),
  isEmailVerified: z.boolean(),
  emailVerifiedAt: instant.nullable(),
  lastLoginAt: instant.nullable(),
  twoFactorEnabled: z.boolean(),
  createdAt: instant,
}).passthrough()

/** `Services/AuthApi/Planora.Auth.Application/Features/Friendships/Queries/GetFriends/FriendDto.cs` */
export const FriendSchema = z.object({
  id: guid,
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  profilePictureUrl: z.string().nullable(),
  friendsSince: instant,
}).passthrough()

/** `Services/CategoryApi/Planora.Category.Application/DTOs/CategoryDto.cs` */
export const CategorySchema = z.object({
  id: guid,
  userId: guid,
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  icon: z.string().nullable(),
  displayOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant.nullable(),
}).passthrough()

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
export const RESPONSE_CONTRACTS: ReadonlyArray<{ name: string; path: RegExp; schema: z.ZodTypeAny }> = [
  { name: "GET /todos/api/v1/todos", path: /^\/todos\/api\/v1\/todos$/, schema: PagedTodosSchema },
  { name: "GET /todos/api/v1/todos/{id}", path: /^\/todos\/api\/v1\/todos\/[0-9a-fA-F-]{36}$/, schema: TodoSchema },
  { name: "GET /auth/api/v1/users/me", path: /^\/auth\/api\/v1\/users\/me$/, schema: UserSchema },
  { name: "GET /auth/api/v1/friendships", path: /^(?:\/auth\/api\/v1)?\/friendships$/, schema: PagedFriendsSchema },
  { name: "GET /categories/api/v1/categories", path: /^\/categories\/api\/v1\/categories$/, schema: CategoryListSchema },
]

/** At most this many differences are described per response. */
const MAX_ISSUES = 5

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
    const where = issue.path.map((part) => (typeof part === "number" ? "*" : part)).join(".") || "(body)"
    const detail = issue.code === "invalid_type" ? ` (expected ${issue.expected}, got ${issue.received})` : ""
    issues.add(`${where} ${issue.code}${detail}`)
    if (issues.size >= MAX_ISSUES) break
  }
  return { endpoint: contract.name, issues: [...issues] }
}
