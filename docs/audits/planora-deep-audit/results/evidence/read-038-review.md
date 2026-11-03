# READ-038 source review

Reviewed all **25 Messaging files / 915 lines** completely at source HEAD `f12f038e7b545456f82cb6e256592a3c8544d355`. [JSON evidence](read-038-review.json) records exact ranges, working-file hashes, semantic notes and selective caller/test traces. Text matches that HEAD;15 files have working CRLF versus committed LF, which is disclosed rather than mistaken for source drift.

Status: **REVIEWED_SOURCE_ONLY**. No application tests, host startup, EF operation, broker operation or working-data access were performed by this reviewer. Root's concurrent T05 checks remain separate.

## CONT038-001 — design-time target selection (P2)

`MessagingDbContextFactory.cs:7-18` reads only `DefaultConnection` / its environment alias before a development fallback. Runtime DI requires `MessagingDatabase`, and the migration workflow supplies `ConnectionStrings__MessagingDatabase`. The named target alone is therefore ignored by the factory. Existing factory tests cover Auth/Category/Todo and omit Messaging.

The source mismatch is confirmed; no wrong-database operation was executed or claimed. T08/T13 should add synthetic no-connect target/precedence regressions and align the per-service contract. Root owns stable ID assignment and implementation handoff.

## Controls and limits

- HTTP sending overwrites sender input and uses current identity; handler checks mismatch and accepted friendship. Both Messaging gRPC methods refuse requests with `PermissionDenied`.
- The traced send tracks Message and adds its sole NotificationEvent through the canonical outbox in the same scoped context/save. No new split-commit finding is asserted.
- Huge Messaging page offsets share BE-008's unchecked Int32 arithmetic family; provider/HTTP outcome was not executed. Timestamp ties, launch aliases, Redis probe selection/disposal and custom-query soft-delete filtering remain related unverified risks.
- Shared T01 readiness and service DbContext registration were traced. Working health, schema parity, query plans, cancellation under dependency failure and concurrent state writes were not tested.
- Config/credential values and user payloads are not preserved. Test-source presence does not prove execution. Supplemental snippets do not promote other continuation batches.

## Complete ranges

| File | Range read |
| --- | --- |
| `Services/MessagingApi/Planora.Messaging.Api/Planora.Messaging.Api.csproj` | 1-41 |
| `Services/MessagingApi/Planora.Messaging.Api/Program.cs` | 1-248 |
| `Services/MessagingApi/Planora.Messaging.Api/Properties/launchSettings.json` | 1-60 |
| `Services/MessagingApi/Planora.Messaging.Api/appsettings.Docker.json` | 1-36 |
| `Services/MessagingApi/Planora.Messaging.Api/appsettings.json` | 1-52 |
| `Services/MessagingApi/Planora.Messaging.Application/Common/OutboxExtensions.cs` | 1-28 |
| `Services/MessagingApi/Planora.Messaging.Application/DTOs/MessageDto.cs` | 1-14 |
| `Services/MessagingApi/Planora.Messaging.Application/DependencyInjection.cs` | 1-33 |
| `Services/MessagingApi/Planora.Messaging.Application/Features/Messages/Commands/SendMessage/SendMessageCommand.cs` | 1-12 |
| `Services/MessagingApi/Planora.Messaging.Application/Features/Messages/Commands/SendMessage/SendMessageCommandValidator.cs` | 1-26 |
| `Services/MessagingApi/Planora.Messaging.Application/Features/Messages/Mappings/MessageMappingProfile.cs` | 1-15 |
| `Services/MessagingApi/Planora.Messaging.Application/Features/Messages/Queries/GetMessages/GetMessagesQuery.cs` | 1-11 |
| `Services/MessagingApi/Planora.Messaging.Application/Features/Messages/Queries/GetMessages/GetMessagesQueryValidator.cs` | 1-19 |
| `Services/MessagingApi/Planora.Messaging.Application/GlobalUsings.cs` | 1-16 |
| `Services/MessagingApi/Planora.Messaging.Application/Planora.Messaging.Application.csproj` | 1-24 |
| `Services/MessagingApi/Planora.Messaging.Application/Services/IFriendshipService.cs` | 1-7 |
| `Services/MessagingApi/Planora.Messaging.Domain/Entities/Message.cs` | 1-53 |
| `Services/MessagingApi/Planora.Messaging.Domain/GlobalUsings.cs` | 1-4 |
| `Services/MessagingApi/Planora.Messaging.Domain/Planora.Messaging.Domain.csproj` | 1-14 |
| `Services/MessagingApi/Planora.Messaging.Domain/Repositories.cs` | 1-13 |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/DesignTime/MessagingDbContextFactory.cs` | 1-23 |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/GlobalUsings.cs` | 1-26 |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/Configurations/OutboxMessageConfiguration.cs` | 1-65 |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/MessagingDbContext.cs` | 1-51 |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/Persistence/Repositories/BaseRepository.cs` | 1-24 |

Only this Markdown and its JSON companion were written for this review. Source, canonical index, findings register, PROGRESS, central docs, branches and remotes were not changed by this reviewer. Root owns integration and commit.

Root assigned `BE-009` in the canonical findings register; the provisional ID remains in the original source-review data for provenance.
