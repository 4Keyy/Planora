/**
 * mock-api.mjs — deterministic API fixtures for the Planora UI audit.
 *
 * Intercepts the frontend's calls in Playwright and answers them with controlled
 * data, so the authenticated routes can be audited without the backend stack and —
 * more importantly — so the edge cases of BLOCK 12 become reproducible instead of
 * whatever happens to be in a dev database.
 *
 * The client only DECODES the access token (frontend/src/lib/jwt.ts:23 — no
 * signature verification), and identity is derived from its claims
 * (store/auth.ts:100-112), so mocking `/auth/api/v1/auth/refresh` alone is enough
 * to reach an authenticated state. No real credential is involved.
 *
 * Datasets: `rich` (varied realistic data) | `empty` (nothing anywhere) |
 *           `extreme` (long strings, huge numbers, 200 items) | `slow` | `error`
 */

const USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  email: 'audit@planora.test',
  firstName: 'Audit',
  lastName: 'Reviewer',
}

const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A structurally valid, unsigned JWT. Only ever decoded client-side. */
function mintToken(overrides = {}) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url({ alg: 'none', typ: 'JWT' })
  const payload = b64url({
    sub: USER.userId,
    email: USER.email,
    firstName: USER.firstName,
    lastName: USER.lastName,
    email_verified: 'true',
    role: 'User',
    iat: now,
    exp: now + 3600,
    ...overrides,
  })
  return `${header}.${payload}.mock-signature-not-verified-client-side`
}

const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString()

const CATEGORIES = [
  { id: 'cat-1', name: 'Household', color: '#0ea5e9', icon: 'Home', displayOrder: 1 },
  { id: 'cat-2', name: 'Travel', color: '#10b981', icon: 'Plane', displayOrder: 2 },
  { id: 'cat-3', name: 'Work', color: '#f59e0b', icon: 'Briefcase', displayOrder: 3 },
  { id: 'cat-4', name: 'Finance', color: '#ef4444', icon: 'Wallet', displayOrder: 4 },
]

const PRIORITIES = ['VeryLow', 'Low', 'Medium', 'High', 'Urgent']

const TITLES = [
  'Book the flights for the spring trip',
  'Renew the household insurance policy',
  'Split last month’s shared expenses',
  'Fix the leaking tap in the kitchen',
  'Prepare the quarterly budget review',
  'Order a replacement battery for the smoke alarm',
  'Plan the weekend menu and grocery run',
  'Collect the receipts for the tax return',
]

/** A long word with no spaces — the classic mobile-overflow trigger. */
const UNBREAKABLE = 'Unbreakablestringwithoutanyspaceswhatsoeverthatmustwrapsomehow'.repeat(3)

function makeTodo(i, dataset) {
  const extreme = dataset === 'extreme'
  const cat = CATEGORIES[i % CATEGORIES.length]
  return {
    id: `todo-${i}`,
    userId: USER.userId,
    title: extreme
      ? (i % 3 === 0
          ? 'A deliberately excessive task title that keeps going well past any reasonable length in order to prove how the card, the list row and the modal header each decide to truncate, wrap or overflow it on a narrow phone screen'
          : i % 3 === 1 ? UNBREAKABLE : TITLES[i % TITLES.length])
      : TITLES[i % TITLES.length],
    description: extreme
      ? 'A description long enough to exercise the two-line clamp and the dense-mode three-line clamp at the same time, including https://example.com/a/very/long/url/that/never/breaks/anywhere/at/all/and/keeps/going and an emoji run 🎯🧭📌🗂️🔭.'
      : i % 2 === 0 ? 'Short supporting note for this task.' : null,
    status: i % 4 === 3 ? 'Done' : i % 3 === 0 ? 'InProgress' : 'Pending',
    categoryId: cat.id,
    categoryName: extreme ? 'A category name that is sixty characters long exactly here' : cat.name,
    categoryColor: cat.color,
    categoryIcon: cat.icon,
    // The start of an interval must never fall after its end — an inverted range
    // rendered as "Sep 12 - Sep 11" and looked like a product bug when it was a
    // fixture bug. Overdue items get a past END, and the start precedes it.
    dueDate: i % 5 === 0 ? iso(-2) : iso(i % 14),
    dueDateStart: i % 7 === 0 ? (i % 5 === 0 ? iso(-4) : iso(-1)) : null,
    priority: PRIORITIES[i % PRIORITIES.length],
    isPublic: i % 3 === 0,
    isCompleted: i % 4 === 3,
    hidden: false,
    completedAt: i % 4 === 3 ? iso(-1) : null,
    isOnTime: i % 4 === 3 ? i % 8 !== 3 : null,
    tags: i % 2 === 0 ? ['shared', 'recurring'] : [],
    createdAt: iso(-30 + (i % 30)),
    updatedAt: iso(-1),
    authorName: extreme ? 'Bartholomew Featherstonehaugh-Wydell' : 'Audit Reviewer',
    sharedWithUserIds: i % 3 === 0 ? ['22222222-2222-4222-8222-222222222222'] : null,
    hasSharedAudience: i % 3 === 0,
    isVisuallyUrgent: i % 5 === 4,
    requiredWorkers: i % 6 === 0 ? 3 : null,
    workerCount: i % 6 === 0 ? 1 : 0,
    isWorking: false,
    openSubtaskCount: i % 4 === 0 ? 2 : 0,
    parentTodoId: null,
    ownerCompleted: i % 4 === 3,
    isCompletedByViewer: i % 4 === 3,
  }
}

function todosFor(dataset) {
  if (dataset === 'empty') return []
  const n = dataset === 'extreme' ? 200 : 14
  return Array.from({ length: n }, (_, i) => makeTodo(i, dataset))
}

function categoriesFor(dataset) {
  if (dataset === 'empty') return []
  if (dataset === 'extreme') {
    return CATEGORIES.map((c, i) => ({
      ...c,
      name: i === 0 ? 'A category name that is sixty characters long exactly here' : c.name,
    }))
  }
  return CATEGORIES
}

/**
 * Installs the interception on a Playwright BrowserContext.
 * @param {import('playwright').BrowserContext} context
 * @param {{dataset?: string, latencyMs?: number, failWith?: number}} opts
 */
export async function installMockApi(context, opts = {}) {
  const dataset = opts.dataset ?? 'rich'
  const latency = opts.latencyMs ?? 0
  const failWith = opts.failWith ?? null
  /**
   * Signed-OUT mocking. The client only DECODES the access token, so mocking
   * /auth/refresh with a minted one is enough to reach an authenticated state — which
   * is exactly what makes the public set unmeasurable: /auth/login then redirects to
   * /dashboard and the recorded cells describe the dashboard, not the login page.
   *
   * With `anon`, /auth/refresh answers 204 No Content, which is what the real server
   * sends when there is no refresh cookie (docs/features.md, Edge Cases). The silent
   * restore fails the way it does for a first-time visitor, the public routes render
   * signed out, and the run still needs no backend.
   */
  const anon = opts.anon ?? false

  // The CSRF token is read from a readable cookie (lib/csrf.ts:35-42); seeding it
  // means the client never needs the token endpoint.
  await context.addCookies([
    { name: 'XSRF-TOKEN', value: 'mock-csrf-token', domain: '127.0.0.1', path: '/' },
  ])

  const todos = todosFor(dataset)
  const categories = categoriesFor(dataset)

  const json = (route, body, status = 200) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(body),
    })

  // `/friendships` is proxied by next.config rewrites WITHOUT the /api/v1 prefix,
  // so it needs its own matcher — see the same-origin rewrite list.
  await context.route('**/friendships**', async (route) => {
    if (latency) await new Promise((r) => setTimeout(r, latency))
    if (failWith) return json(route, { error: { code: 'MOCK_FAILURE' } }, failWith)
    return json(route, dataset === 'empty' ? [] : [
      { id: 'f1', userId: '22222222-2222-4222-8222-222222222222', friendId: '22222222-2222-4222-8222-222222222222', email: 'friend@planora.test', firstName: 'Sam', lastName: 'Rivera', status: 'Accepted', profilePictureUrl: null },
      { id: 'f2', userId: '33333333-3333-4333-8333-333333333333', friendId: '33333333-3333-4333-8333-333333333333', email: 'jo@planora.test', firstName: 'Jo', lastName: 'Kim', status: 'Accepted', profilePictureUrl: null },
    ])
  })

  await context.route('**/*/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    const method = route.request().method()

    if (latency) await new Promise((r) => setTimeout(r, latency))
    if (failWith) return json(route, { error: { code: 'MOCK_FAILURE', message: 'Injected failure' } }, failWith)

    // ── auth ──
    if (p.endsWith('/auth/csrf-token')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'XSRF-TOKEN=mock-csrf-token; Path=/' },
        body: JSON.stringify({ token: 'mock-csrf-token' }),
      })
    }
    if (anon && p.endsWith('/auth/refresh')) {
      return route.fulfill({ status: 204, body: '' })
    }
    if (p.endsWith('/auth/refresh') || p.endsWith('/auth/login')) {
      return json(route, {
        accessToken: mintToken(),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        userId: USER.userId, email: USER.email, firstName: USER.firstName, lastName: USER.lastName,
      })
    }
    if (p.endsWith('/auth/validate-token')) return json(route, { isValid: true, valid: true })
    if (p.endsWith('/auth/logout')) return json(route, { success: true })

    // ── user ──
    if (p.endsWith('/users/me')) {
      return json(route, { ...USER, profilePictureUrl: null, createdAt: iso(-400), emailVerified: true })
    }
    if (p.endsWith('/users/statistics')) {
      const done = todos.filter((t) => t.isCompleted).length
      return json(route, {
        totalTasks: todos.length, completedTasks: done,
        completionRate: todos.length ? Math.round((done / todos.length) * 100) : 0,
        onTimeRate: 82, currentStreak: 4, longestStreak: 11,
        weeklyCompleted: [2, 4, 1, 5, 3, 0, 2],
      })
    }
    if (p.includes('/users/me/sessions')) {
      return json(route, dataset === 'empty' ? [] : [
        { id: 's1', device: 'Chrome on Windows', ipAddress: '10.0.0.2', lastActiveAt: iso(0), isCurrent: true, createdAt: iso(-3) },
        { id: 's2', device: 'Safari on iPhone', ipAddress: '10.0.0.7', lastActiveAt: iso(-2), isCurrent: false, createdAt: iso(-20) },
      ])
    }
    if (p.includes('/users/me/login-history')) {
      return json(route, dataset === 'empty' ? [] : [
        { id: 'h1', occurredAt: iso(0), ipAddress: '10.0.0.2', succeeded: true, device: 'Chrome on Windows' },
        { id: 'h2', occurredAt: iso(-4), ipAddress: '10.0.0.9', succeeded: false, device: 'Unknown' },
      ])
    }
    if (p.includes('/users/me/security')) {
      return json(route, { twoFactorEnabled: false, emailVerified: true, lastPasswordChangeAt: iso(-90) })
    }
    if (p.includes('/friendships')) {
      return json(route, dataset === 'empty' ? [] : [
        { id: 'f1', userId: '22222222-2222-4222-8222-222222222222', email: 'friend@planora.test', firstName: 'Sam', lastName: 'Rivera', status: 'Accepted', profilePictureUrl: null },
      ])
    }
    if (p.endsWith('/users')) return json(route, { items: [], totalCount: 0 })

    // ── notifications ──
    // SummaryDto (store/notifications.ts:47) wants totalUnread + perTask[]. The old
    // { unreadCount, total } left totalUnread undefined, so the bell read 0 and no
    // per-task badge ever lit — the exact surface this mock exists to exercise.
    if (p.includes('/notifications/summary')) {
      if (dataset === 'empty') return json(route, { totalUnread: 0, perTask: [] })
      return json(route, {
        totalUnread: 3,
        perTask: [
          { taskId: 'todo-0', count: 2, latestType: 'CommentAdded', groups: [{ type: 'CommentAdded', count: 2, latestOccurredOnUtc: iso(0) }] },
          { taskId: 'todo-1', count: 1, latestType: 'TaskShared', groups: [{ type: 'TaskShared', count: 1, latestOccurredOnUtc: iso(0) }] },
        ],
      })
    }
    // A BARE ARRAY of NotificationPayload: loadList (store/notifications.ts:136) does
    // `(res.data ?? []).map(normalize)`, so an object threw and the catch left the bell
    // empty. normalize() reads userId / taskId / actorId / message / occurredOnUtc —
    // none of which the old { title, body } shape carried.
    if (p.includes('/notifications/read')) return json(route, { success: true })
    if (p.includes('/notifications')) {
      if (dataset === 'empty') return json(route, [])
      return json(route, [
        { id: 'n1', userId: USER.userId, taskId: 'todo-0', actorId: '22222222-2222-4222-8222-222222222222', type: 'TaskShared', title: 'Sam shared a task with you', message: 'Book the flights for the spring trip', isRead: false, occurredOnUtc: iso(0) },
        { id: 'n2', userId: USER.userId, taskId: 'todo-0', actorId: '22222222-2222-4222-8222-222222222222', type: 'CommentAdded', title: 'New comment', message: 'I can take the second half.', isRead: false, occurredOnUtc: iso(-1) },
        { id: 'n3', userId: USER.userId, taskId: 'todo-1', actorId: '33333333-3333-4333-8333-333333333333', type: 'TaskShared', title: 'Jo shared a task with you', message: 'Renew the household insurance policy', isRead: false, occurredOnUtc: iso(-1) },
      ])
    }

    // ── categories ──
    if (p.includes('/categories')) {
      if (method !== 'GET') return json(route, categories[0])
      return json(route, categories)
    }

    // ── comments ──
    // PAGED, not a bare array: fetchComments (lib/api.ts:462) types the response as
    // PagedCommentsResponse and reads `.items`. Returning the array made `res.items`
    // undefined, so `(res.items ?? [])` collapsed to [] and the branch feed rendered
    // EMPTY under --mock for as long as this file has existed. Subtasks below are the
    // opposite case and are deliberately bare; the two are not symmetric.
    if (p.includes('/comments')) {
      const comments = dataset === 'empty' ? [] : [
        { id: 'c1', todoItemId: 'todo-0', authorId: USER.userId, authorName: 'Audit Reviewer', content: 'Starting on this today.', createdAt: iso(-1), isOwn: true, isEdited: false, isGenesisComment: true },
        { id: 'c2', todoItemId: 'todo-0', authorId: '22222222-2222-4222-8222-222222222222', authorName: 'Sam Rivera', content: dataset === 'extreme' ? UNBREAKABLE : 'I can take the second half.', createdAt: iso(0), isOwn: false, isEdited: false },
        { id: 'c3', todoItemId: 'todo-0', authorId: USER.userId, authorName: 'Audit Reviewer', content: 'Good — I will book the outbound.', createdAt: iso(0), isOwn: true, isEdited: false, replyToType: 'comment', replyToId: 'c2', replyToAuthorId: '22222222-2222-4222-8222-222222222222', replyToAuthorName: 'Sam Rivera', replyToPreview: 'I can take the second half.' },
      ]
      if (method !== 'GET') return json(route, comments[1] ?? comments[0] ?? {})
      return json(route, { items: comments, totalCount: comments.length })
    }

    // ── todos ──
    // Subtasks come back as a BARE ARRAY: branch-feed.tsx:284 spreads it directly
    // (`[...subtasks]`), so an object here throws "t is not iterable".
    if (p.includes('/subtasks')) {
      if (method !== 'GET') return json(route, makeTodo(900, dataset))
      if (dataset === 'empty') return json(route, [])
      return json(route, [0, 1, 2].map((i) => ({
        ...makeTodo(900 + i, dataset),
        parentTodoId: 'todo-0',
        title: ['Compare three airlines', 'Check passport expiry dates', 'Reserve the airport transfer'][i],
        isCompleted: i === 0,
        status: i === 0 ? 'Done' : 'Pending',
        workers: i === 1 ? [{ userId: '22222222-2222-4222-8222-222222222222', name: 'Sam Rivera', avatarUrl: null }] : [],
        workerCount: i === 1 ? 1 : 0,
        requiredWorkers: i === 1 ? 2 : null,
      })))
    }
    // setViewerPreference (lib/api.ts:368) reads todoId / hiddenByViewer /
    // viewerCategoryId / completedByViewer / ownerCompleted. The old shape
    // ({ hiddenFields, redactedFieldNames }) matched nothing the client asks for, so
    // every hide/complete round-trip came back undefined and the optimistic state stood.
    if (p.includes('/viewer-preferences')) {
      const vpId = p.split('/todos/')[1]?.split('/')[0] ?? 'todo-0'
      let body = {}
      try { body = JSON.parse(route.request().postData() ?? '{}') } catch { body = {} }
      return json(route, {
        todoId: vpId,
        hiddenByViewer: body.hiddenByViewer ?? false,
        viewerCategoryId: body.viewerCategoryId ?? null,
        completedByViewer: body.completedByViewer ?? null,
        ownerCompleted: false,
      })
    }
    if (p.includes('/todos')) {
      const idMatch = p.match(/\/todos\/([^/]+)$/)
      if (idMatch && method === 'GET' && idMatch[1] !== 'todos') {
        const found = todos.find((t) => t.id === idMatch[1]) ?? todos[0]
        if (!found) return json(route, { error: { code: 'NOT_FOUND' } }, 404)
        return json(route, found)
      }
      if (method !== 'GET') return json(route, todos[0] ?? {})
      const completedParam = url.searchParams.get('isCompleted') ?? url.searchParams.get('completed')
      let items = todos
      if (completedParam === 'true') items = todos.filter((t) => t.isCompleted)
      else if (completedParam === 'false') items = todos.filter((t) => !t.isCompleted)
      return json(route, { items, totalCount: items.length })
    }

    // Anything unmatched: an empty, well-shaped answer rather than a hang.
    return json(route, { items: [], totalCount: 0 })
  })
}

export const MOCK_USER = USER
