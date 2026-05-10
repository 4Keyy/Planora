# Product Notes

For the canonical product overview, read [`overview.md`](overview.md) and [`features.md`](features.md).

## Product Position

Planora is a personal task-management app with:

- account security and session management;
- categories;
- active/completed task workflows;
- friendship-based task sharing;
- hidden shared-task privacy;
- direct messages;
- realtime notification primitives.

This is confirmed by:

- `frontend/src/app`
- `Services/AuthApi`
- `Services/TodoApi`
- `Services/CategoryApi`
- `Services/MessagingApi`
- `Services/RealtimeApi`

## User-Facing Scenarios

| Scenario | Status | Reference |
|---|---|---|
| Register/login/logout | implemented | `AuthenticationController.cs`, `frontend/src/app/auth` |
| Restore session after reload | implemented | `frontend/src/store/auth.ts`, `frontend/src/lib/auth-public.ts` |
| Create categories | implemented | `CategoriesController.cs`, `frontend/src/app/categories/page.tsx` |
| Create/update/complete todos | implemented | `TodosController.cs`, `frontend/src/app/todos/page.tsx` |
| Share todos with friends | implemented | `FriendshipsController.cs`, Todo command handlers |
| Hide shared todos per viewer | implemented | `HiddenTodoDtoFactory.cs`, `TodoViewerStateResolver.cs` |
| Send direct messages | implemented in API | `MessagesController.cs` |
| Realtime notifications | implemented as primitives | `RealtimeApi` controllers/hubs |

## Visual Design

### Animated Background

The app uses a WebGL fragment-shader background (`ColorBends`) rendered via Three.js, wrapped in a lazy-loaded layer (`ColorBendsLayer`) that is dropped once into the root layout and sits behind all content.

| Setting | Value |
|---|---|
| Colors | `["#d4d4d4", "#9e9e9e", "#616161"]` (light → mid → dark gray) |
| Rotation | `-65°` |
| Speed | `0.36` |
| Scale | `1.4` |
| Frequency | `1` |
| WarpStrength | `1` |
| MouseInfluence | `0.8` |
| Noise | `0` (disabled) |
| Parallax | `0.65` |
| Iterations | `2` |
| Intensity | `1.2` |
| BandWidth | `6` |
| Transparent | `true` |

Key implementation details:

- `frontend/src/components/backgrounds/color-bends.tsx` — WebGL component; exports `ColorBends` and `hexToVec3`.
- `frontend/src/components/backgrounds/color-bends-layer.tsx` — thin lazy+Suspense wrapper; `className="fixed inset-0 -z-10 pointer-events-none"`.
- Named Three.js imports for tree-shaking.
- Respects `prefers-reduced-motion`: renders a single static frame, no RAF loop.
- Pauses animation on `visibilitychange` (tab hidden) and resumes on tab visible.
- Pointer tracking via `window` (not container) so mouse influence works through `pointer-events-none`.
- Full cleanup on unmount: `cancelAnimationFrame`, `ResizeObserver.disconnect`, `renderer.dispose()`, `renderer.forceContextLoss()`, canvas `removeChild`.

## Not Confirmed As Product Features

| Claim | Status |
|---|---|
| Mobile apps | not found |
| Public SaaS deployment | not found |
| Third-party analytics SDK/dashboard | not found |
| Payments/subscriptions | not found |
| Offline-first sync | not found |
