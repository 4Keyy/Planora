# READ-010 — application behavior and event contracts

Reviewed 25 files at `da6256d` on 2026-11-20. The index records the complete
reviewed ranges. Twenty-four source hashes match the baseline. The remaining
file, `TaskActivityIntegrationEvent.cs`, includes the nullable subtask ID
introduced by `dd06caa9`. Its reviewed SHA-256 is
`734f08282f268e3bacff86d0cdbe969eca447273b1aa8c2da9d4c9389bfe5884`.

| Scope | Review |
| --- | --- |
| MediatR behaviors | Confirmed registration of logging and validation in five domain services, validation failure before the handler, and the error behavior's propagation of the original exception. The validators share one context across asynchronous calls. A search found no current `RootContextData` writers, so there is no confirmed concurrency failure from that use. |
| CQRS, current user and shared imports | The command/query interfaces constrain the MediatR request and response types. Current-user identity is populated by the host adapter, and the interfaces and global imports add no separate authorization path. |
| Account, user, category and friendship events | Examined data fields, constructor defaults and the boundaries between transport metadata, account information and entity cleanup IDs. These payload definitions do not establish publisher atomicity or broker ordering. |
| Notification and realtime events | Notifications remain user-scoped with a string discriminator. Realtime events carry IDs and action, with the full content loaded through authorized routes. The XML description of join-time-only branch audience is stale after the Realtime authorization work in [T06](../T06.md). |
| Task and subtask events | Collaboration matches subtask cleanup by parent and source subtask IDs. The `SubtaskDeletedIntegrationEvent` title-based XML summary is stale. The `TaskCreatedIntegrationEvent` summary still mentions a stored genesis comment, while Collaboration now synthesizes the author's note on read. Event schemas were left intact for this review. |
| Domain event dispatch | The interface forwards single and enumerated events with cancellation support. Delivery and commit ordering depend on the calling implementation. |

**BE-038, P2, confirmed in source.** `LoggingBehavior` gates its normal
request and response payload logging on `Debug`. Its catch block serializes
a request into an `Error` record regardless of that setting. The redaction
list covers known credential fields but does not remove ordinary task,
comment or message text. The issue is independent of HTTP query redaction and
the response-stream fix. Existing handler-error tests check exception and
log level, with no assertion that the payload is absent from Error logs.
Production log contents were outside this review.

## BE-038 follow-up

The strengthened handler-error test failed on a synthetic task title in an
Error record. The fix removes the serialized request from this record. The
same exception and correlation ID remain available, and the Debug event
still carries the redacted request. All 41 targeted application and logging
cases passed after the BE-038 and BE-039 changes. See the
[verification commands](read-015-review.md#verification).
