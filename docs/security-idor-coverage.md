# Authorization And IDOR Coverage Map

Source audit: **2026-10-06**, baseline `8b072a9f3da0e57e1aecfce0e814d780506b3078`.
This maps implemented authorization and actual test evidence, including identifiers
in paths, queries and bodies. It does not certify that every cross-user scenario has a
regression test. See [API.md](API.md) for contracts and [auth-security.md](auth-security.md)
for authentication, CSRF, revocation and service trust.

## Evidence Conventions

- **Explicit regression** means the named test asserts the relevant denial/actor rule.
- **Implementation / suite** means source carries the rule and the linked suite
  exercises related behavior; this does not imply a missing cross-user test exists.
- **Finding** means the inspected path differs from the intended access invariant.
- Direct controller tests do not exercise ASP.NET role/authentication attributes,
  CSRF, gateway routing or real database filters; those require integration evidence.
- A gRPC service key proves a trusted service caller, not the end-user identity in
  its payload. Shared service trust is not an ownership check.

## Auth API

Sources: [UsersController](../Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs),
[FriendshipsController](../Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs),
[AuthenticationController](../Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs).
Users collection has a service `GET /api/v1/Users` route; the gateway has a users
catch-all but no explicit collection-root mapping. See the API route caveat.

| Gateway method/path | Implemented scope | Evidence |
|---|---|---|
| `GET/PUT/DELETE /auth/api/v1/users/me` | caller's account; delete also requires password | [UserCommandHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/UserCommandHandlerTests.cs), [UserQueryHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/UserQueryHandlerTests.cs); implementation/suite |
| `POST /auth/api/v1/users/me/avatar` | target derived from caller | [UploadAvatarCommandHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/UploadAvatarCommandHandlerTests.cs); implementation/suite |
| `POST /auth/api/v1/users/me/change-password`, `/change-email` | caller plus current password | [UserSecurityHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/UserSecurityHandlerTests.cs), `ChangePassword_ShouldReturnSecurityFailuresBeforeMutatingUser`, `ChangeEmail_ShouldValidateAuthenticationPasswordEmailAndUniqueness`; explicit credential regressions |
| `POST /auth/api/v1/users/me/verify-email` | caller for resend; legacy body token identifies the one-time target | [VerifyEmailCommandHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/VerifyEmailCommandHandlerTests.cs); token capability |
| `GET /auth/api/v1/users/verify-email?token=...` | public one-time hashed verification token | same suite; intentionally no bearer gate |
| `POST /auth/api/v1/users/me/2fa/enable`, `/confirm`, `/disable` | caller; pending setup/TOTP for confirm, password for disable | [Enable2FACommandHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/Enable2FACommandHandlerTests.cs), [Confirm2FACommandHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/Confirm2FACommandHandlerTests.cs), UserSecurityHandlerTests |
| `GET /auth/api/v1/users/me/security`, `/sessions`, `/login-history` | caller-scoped queries | UserSecurityHandlerTests and UserQueryHandlerTests; implementation/suite |
| `DELETE /auth/api/v1/users/me/sessions/{tokenId}` | token owner must equal caller before update/save | UserSecurityHandlerTests, `RevokeSession_WhenTokenBelongsToAnotherUser_ReturnsForbidden`; explicit regression. Controller maps returned failure to `400`, despite the semantic forbidden error. |
| `POST /auth/api/v1/users/me/sessions/revoke-all` | caller plus password; no supplied target | UserSecurityHandlerTests, `RevokeAllSessions_ShouldRequirePasswordAndRevokeActiveRefreshTokens`; explicit credential regression |
| `GET /auth/api/v1/users/{userId}`, `/statistics`, service collection | `[Authorize(Roles = "Admin")]`; other-user administration is intentional | [UsersControllerTests](../tests/Planora.UnitTests/Services/AuthApi/Controllers/UsersControllerTests.cs), [GetUsersQueryHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/GetUsersQueryHandlerTests.cs); role attribute/source plus direct tests |
| `POST /auth/api/v1/auth/logout` | handler will not revoke a token belonging to another non-empty caller | [AuthSessionHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Authentication/Handlers/AuthSessionHandlerTests.cs); implementation/suite |
| `POST /auth/api/v1/friendships/requests`, `/requests/by-email` | requester from caller; friend id/email is destination | [FriendshipHandlerTests](../tests/Planora.UnitTests/Services/AuthApi/Friendships/FriendshipHandlerTests.cs), `SendFriendRequest_ShouldRejectSelfMissingFriendAndExistingRelationship`; explicit regression |
| `POST /auth/api/v1/friendships/requests/{friendshipId}/accept`, `/reject` | only request addressee | FriendshipHandlerTests, `AcceptRejectAndRemove_ShouldEnforceActorAndPersistStateTransitions`; explicit actor regression |
| `DELETE /auth/api/v1/friendships/{friendId}` | caller participates in relationship | same actor regression |
| `GET /auth/api/v1/friendships`, `/requests` | caller's relationships/request direction | FriendshipHandlerTests and [FriendshipsControllerTests](../tests/Planora.UnitTests/Services/AuthApi/Controllers/FriendshipsControllerTests.cs); implementation/suite |
| `GET /auth/api/v1/friendships/friend-ids?userId=...`, `/are-friends?userId1=...&userId2=...` | `userId`/`userId1` must equal caller, resolving `sub` or mapped `NameIdentifier`; lookup exceptions deny access | FriendshipsControllerTests, `InternalFriendshipEndpoints_AcceptSubjectRemappedToNameIdentifier`, `InternalFriendshipEndpoints_FailClosedOnFailureOrExceptions` |
| `POST /auth/api/v1/analytics/events` | caller-associated event; no supplied user target | [AnalyticsControllerTests](../tests/Planora.UnitTests/Services/AuthApi/Controllers/AnalyticsControllerTests.cs); implementation/suite |

## Todo API

The normal non-owner view rule requires current friendship with the owner **and**
a public task or direct share. A public task is not normally readable by any
authenticated stranger. Main-list reads use a 30-second cached friend-id set; detail
and command paths can use a live check. The exceptions below are material.

Sources: [TodosController](../Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs),
[Todo handlers](../Services/TodoApi/Planora.Todo.Application/Features/Todos/).
Evidence: [TodoOwnershipHandlerTests](../tests/Planora.UnitTests/Services/TodoApi/Handlers/TodoOwnershipHandlerTests.cs)
and [TodoCommandHandlerExpandedTests](../tests/Planora.UnitTests/Services/TodoApi/Handlers/TodoCommandHandlerExpandedTests.cs).

| Gateway method/path | Implemented rule | Evidence / limit |
|---|---|---|
| `GET /todos/api/v1/todos`, `/public`, `/category/{categoryId}` | own rows or eligible audience; viewer projection depends on query | ownership/query suites; main-list cached friendship creates a short revocation window |
| `GET /todos/api/v1/todos/{id}` | owner or current friend with public/share access; hidden DTO redaction | `GetTodoById_ShouldRejectSharedTodo_WhenFriendshipNoLongerExists`; explicit regression |
| `POST /todos/api/v1/todos` | owner from caller; supplied owner is discarded | command suite; category/share checks are separate |
| `PUT /todos/api/v1/todos/{id}` (top level) | owner edits content; eligible non-owner changes their own completion | ownership/expanded suites; viewer can reopen own completion unless author globally completed task |
| `DELETE /todos/api/v1/todos/{id}` (top level) | owner-only | expanded suite; implementation/suite |
| `PATCH /todos/api/v1/todos/{id}/hidden` | **owner-only**; shared owner uses own preference, private owner uses entity flag | expanded suite; not an arbitrary viewer mutation |
| `PATCH /todos/api/v1/todos/{id}/viewer-preferences` | visible non-owner's own state; owner rejected; foreign viewer category rejected | expanded suite; no body-supplied viewer id; author-global Done blocks reopening |
| `POST /todos/api/v1/todos/{id}/join` | owner shortcut; public non-owner bypasses friendship guard; full DTO returned | **AZ-01**: normal visibility and hidden redaction are not applied |
| `POST /todos/api/v1/todos/{id}/leave` | removes caller's worker row | worker/command suites; no supplied worker target |
| `GET /todos/api/v1/todos/{id}/subtasks` | current parent access | `GetSubtasks_RejectsViewerWithoutAccessToPrivateParent`; explicit regression |
| `POST /todos/api/v1/todos/{id}/subtasks` | owner or eligible friend; child owned by parent owner, creator recorded; no nesting | `CreateSubtask_RejectsForeignParent`, `CreateSubtask_ByNonFriendOnSharedParent_ThrowsForbidden`, `CreateSubtask_BySharedFriend_Succeeds`, `CreateSubtask_RejectsNestingUnderSubtask` |
| `PUT /todos/api/v1/todos/{id}` (subtask) | parent owner/creator edit; visible participants globally complete/reopen | `UpdateSubtask_TitleByCreator_Succeeds`, `UpdateTodo_NonOwnerCompletesSubtask_GloballyNotPerViewer`; **AZ-02**, creator shortcut precedes current access |
| `DELETE /todos/api/v1/todos/{id}` (subtask) | parent owner/creator delete; stranger denied | `DeleteSubtask_ByCreator_Succeeds`, `DeleteSubtask_ByNonCreatorNonOwner_ThrowsForbidden`; **AZ-02**, revoked creator still accepted |
| `POST /todos/api/v1/todos/{id}/duplicate` | owner/eligible current friend, new copy owned by caller; no subtask duplication | `DuplicateTodo_ByParticipant_OnPublicFriendTask_CopiesUnderDuplicator`, `DuplicateTodo_ByNonFriendOnPublicTask_ThrowsForbidden` |

## Collaboration API

Sources: [CommentsController](../Services/CollaborationApi/Planora.Collaboration.Api/Controllers/CommentsController.cs),
[comment commands/queries](../Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/).
Evidence: [CommentCommandHandlerTests](../tests/Planora.UnitTests/Services/CollaborationApi/Handlers/CommentCommandHandlerTests.cs).
There is **no HTTP genesis-create endpoint**. The first-page author's note is
synthesized from Todo's live description.

| Gateway method/path | Implemented scope | Evidence |
|---|---|---|
| `GET /collaboration/api/v1/comments/{taskId}` | Todo `CheckTaskCommentAccess`: missing 404, no current access 403 | query source; command suite does not certify GET pagination |
| `POST /collaboration/api/v1/comments/{taskId}` | current branch access; reply targets must be eligible and inside branch | `AddComment_WithoutAccess_ThrowsForbidden`, `AddComment_ReplyToCommentFromAnotherTask_ThrowsNotFound`, `AddComment_ReplyToSystemComment_IsRejected`, `AddComment_ReplyToSubtask_ValidatesViaTodoAndSnapshotsTitle` |
| `PUT /collaboration/api/v1/comments/{taskId}/{commentId}` | branch match and current access; regular author edits own content | `UpdateComment_AuthorWithoutTaskAccess_ThrowsForbidden`, `UpdateComment_WrongTask_ThrowsNotFound`; explicit regressions |
| `DELETE /collaboration/api/v1/comments/{taskId}/{commentId}` | matching branch, task exists, author/task-owner identity; system/genesis denied; **no `HasAccess` check** | `DeleteComment_ByStranger_ThrowsForbidden`, `DeleteComment_SystemComment_ThrowsForbidden`, `DeleteComment_ByAuthor_SoftDeletes`; **AZ-03**, revoked-author denial missing |

## Category API

Source: [CategoriesController](../Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs).
Handlers explicitly compare ownership after fetching by id; EF soft-delete filters
are not a global current-user isolation guarantee.

| Gateway method/path | Implemented scope | Evidence |
|---|---|---|
| `GET /categories/api/v1/categories` | caller-filtered query | [GetUserCategoriesQueryHandlerTests](../tests/Planora.UnitTests/Services/CategoryApi/Handlers/GetUserCategoriesQueryHandlerTests.cs); implementation/suite |
| `POST /categories/api/v1/categories` | controller discards supplied `userId`; handler takes caller | [CreateDeleteCategoryCommandHandlerTests](../tests/Planora.UnitTests/Services/CategoryApi/Handlers/CreateDeleteCategoryCommandHandlerTests.cs) |
| `PUT /categories/api/v1/categories/{id}` | fetched owner must equal caller before mutation | [UpdateCategoryCommandHandlerTests](../tests/Planora.UnitTests/Services/CategoryApi/Handlers/UpdateCategoryCommandHandlerTests.cs), `Handle_ShouldRejectMissingOrForeignCategoryBeforeMutating`; explicit regression |
| `DELETE /categories/api/v1/categories/{id}` | fetched owner equality before delete | CreateDeleteCategoryCommandHandlerTests, `DeleteCategory_ShouldRejectMissingOrForeignCategoryBeforeDeleting`; explicit regression |

Update string-code failures can become `400` through the shared result filter;
delete explicitly maps `FORBIDDEN` to bearer `Forbid()`/403. Do not infer status
solely from a semantic error label.

## Messaging API

Source: [MessagesController](../Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs).

| Gateway method/path | Implemented scope | Evidence |
|---|---|---|
| `GET /messaging/api/v1/messages?otherUserId=...` | conversation must involve caller and other id in either direction; current friendship not required for history | [GetMessagesQueryHandlerTests](../tests/Planora.UnitTests/Services/MessagingApi/Messages/GetMessagesQueryHandlerTests.cs); implementation/suite |
| `POST /messaging/api/v1/messages` | controller removes supplied sender; handler derives caller, rejects internal mismatch and requires friendship | [SendMessageHandlerTests](../tests/Planora.UnitTests/Services/MessagingApi/Handlers/SendMessageHandlerTests.cs), `Handle_ShouldRejectSenderMismatch_BeforeFriendshipCheck`, `Handle_ShouldRejectAndNotSave_WhenUsersAreNotFriends`; explicit regressions |

## Realtime API And Hub

Sources: [NotificationsController](../Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs),
[ConnectionsController](../Services/RealtimeApi/Planora.Realtime.Api/Controllers/ConnectionsController.cs),
[NotificationHub](../Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs).

| Gateway method/path or hub call | Implemented scope | Evidence / limit |
|---|---|---|
| `GET /realtime/api/v1/notifications/summary`, collection root | caller from `sub`/`NameIdentifier`; user-filtered store | [NotificationsControllerTests](../tests/Planora.UnitTests/Services/RealtimeApi/Controllers/NotificationsControllerTests.cs), `GetSummary_AcceptsSubjectRemappedToNameIdentifier`; [NotificationReadStoreTests](../tests/Planora.UnitTests/Services/RealtimeApi/Infrastructure/NotificationReadStoreTests.cs) |
| `POST /realtime/api/v1/notifications/read` | caller-scoped even with supplied notification/task ids | same suites; all/task/ids selector priority |
| `POST /realtime/api/v1/notifications/send` | **Admin-only**, target caller, type whitelist | NotificationsControllerTests, `SendNotification_RejectsSecuritySpoofTypes`; role attribute needs HTTP evidence beyond direct calls |
| `POST /realtime/api/v1/notifications/broadcast` | Admin-only, all users; no identical type whitelist | same suite; attribute/source |
| `GET /realtime/api/v1/connections/active` | caller's local connections | [ConnectionsControllerTests](../tests/Planora.UnitTests/Services/RealtimeApi/Controllers/ConnectionsControllerTests.cs); inventory is process-local |
| `GET /realtime/api/v1/connections/stats` | Admin-only aggregate | same suite; attribute/source |
| `Subscribe`/`Unsubscribe` | static `system`, `announcements`, `todos`; no client-controlled `user:{otherUser}` group | hub source; no dedicated hub test file found |
| `JoinTask` | current Todo branch access; RPC failure denies join | [TaskBranchAuthorizerTests](../tests/Planora.UnitTests/Services/RealtimeApi/Grpc/TaskBranchAuthorizerTests.cs), `NoAccessOrMissingTask_ReturnsFalse`, `TodoGrpcFailure_FailsClosed_ReturnsFalseWithoutThrowing`; authorizer regressions, not full hub tests |
| `StartTyping`/`StopTyping` | must already have joined room locally | source; no current-access recheck |
| `LeaveTask` | removes caller; sends stopped-typing to any valid task id without prior membership check | source; **AZ-06**, signal injection does not grant content reads |

Existing rooms are not evicted on friendship/sharing removal. Existing WebSockets
are not disconnected on JWT expiry or later security-stamp rotation by the inspected
code. Authorization at connect/join time does not prove continuous current access.

## Shared Administration

`GET /system/info`, where the shared
[SystemInfoController](../BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Services/SystemInfoController.cs)
is exposed, requires Admin. No gateway route is committed. Controller existence
alone does not prove its assembly is registered by a particular API.

## Cross-Service gRPC Trust

Actual contracts: [auth.proto](../GrpcContracts/Protos/auth.proto),
[todo.proto](../GrpcContracts/Protos/todo.proto), [category.proto](../GrpcContracts/Protos/category.proto),
[messaging.proto](../GrpcContracts/Protos/messaging.proto), [realtime.proto](../GrpcContracts/Protos/realtime.proto).

| Contract | Implemented trust | Evidence |
|---|---|---|
| `auth.AuthService/AreFriends`, `/GetFriendIds`, `/GetUserAvatarsBatch`, `/GetUserProfilesBatch`, `/GetUserInfo` | shared service key; payload user ids are trusted internal inputs | [AuthGrpcServiceTests](../tests/Planora.UnitTests/Services/AuthApi/Grpc/AuthGrpcServiceTests.cs), [ServiceKeyInterceptorTests](../tests/Planora.UnitTests/BuildingBlocks/Grpc/ServiceKeyInterceptorTests.cs) |
| `todo.TodoService/CheckTaskCommentAccess` | key plus owner/friend and public/share rule for supplied requester | Todo gRPC source; caller must supply its authenticated requester |
| `todo.TodoService/GetSubtaskBrief` | key plus parent/child scope; no independent bearer identity | source; Collaboration checks branch access first |
| `category.CategoryService/GetCategoryById` | key; response owner checked by client where needed | [CategoryGrpcServiceTests](../tests/Planora.UnitTests/Services/CategoryApi/Grpc/CategoryGrpcServiceTests.cs) |
| Messaging / Realtime RPCs | key; trusted internal recipient/sender payloads | [MessagingGrpcServiceTests](../tests/Planora.UnitTests/Services/MessagingApi/Grpc/MessagingGrpcServiceTests.cs), [RealtimeGrpcServiceTests](../tests/Planora.UnitTests/Services/RealtimeApi/Grpc/RealtimeGrpcServiceTests.cs) |

Interceptor tests establish key enforcement, not each RPC's end-user ownership
correctness or deployed transport encryption.

## Known Findings And Missing Regressions

Findings are based on inspected code paths; application fixes/tests are outside this
documentation change. Severity reflects the demonstrated source-level impact.

| Finding | Trigger and impact | Missing regression / remediation direction |
|---|---|---|
| **AZ-01 (high)** | non-friend authenticated user joins a public task: friendship skipped, full DTO returned even when normal view should deny/redact | deny non-friend under normal visibility; test hidden join response; reuse safe access/projection |
| **AZ-02 (medium)** | former collaborator edits/deletes own-created subtask after parent access removed: creator shortcut precedes current access | revoked-creator rename/delete regression; clarify intended retained authority or enforce current branch access |
| **AZ-03 (medium)** | former comment author deletes known regular comment after branch access removed: author/owner checked, `HasAccess` ignored | deletion denial matching existing `UpdateComment_AuthorWithoutTaskAccess_ThrowsForbidden` |
| **AZ-04 (medium)** | main Todo list retains removed friendship in cached ids for up to 30 seconds | invalidation/current-access regression; define revocation latency |
| **AZ-05 (medium)** | task room stays subscribed after access removal; JWT revocation/expiry does not end existing socket | room eviction/continuous authorization/expiry integration tests |
| **AZ-06 (low)** | `LeaveTask` emits `UserStoppedTyping` to a room caller never joined | assert no unrelated-room event; require membership before signaling |

Stamp fail-open/TTL behavior, public token-validation discrepancies, IP quotas and
dependency advisories are described in [the security reference](auth-security.md#known-security-gaps--clarifications).
Passing a broader suite does not remove these source findings.

## Maintenance Contract

For a new authorized endpoint/procedure, document actor, resource and current-access
checks and add a meaningful cross-user/revoked-access regression where ids select
another resource. Keep routes, statuses and test names grounded in source. Reconcile
[INVARIANTS.md](INVARIANTS.md) when the stated invariant differs from code instead
of treating implicit suite coverage as proof.
