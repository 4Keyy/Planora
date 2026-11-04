# READ-033 Auth persistence source review

Reviewed all **25 files and 1510 lines**. The batch file hashes remained stable during review and their text matches checkout HEAD `05dab9c6ca72f2e85cc6d3c4b49989d60ca9a58d` after line-ending normalization. The JSON records each exact range, raw SHA256, semantic review and supporting traces. [Review evidence](read-033-review.json)

`RoleConfiguration` reflects deterministic T08 seed metadata from `05dab9c`. The current `AuthDbContext` warning change was inspected as a supporting trace outside this batch. Its working hash and recorded HEAD relation are in JSON.

## Provisional findings

| ID | Priority | Source finding and required verification |
| --- | --- | --- |
| CONT033-001 | P1 | Recovery code lookup and use-marker save lack a conditional consumption step. Two independent contexts can read the same unused code before either save. Run a provider barrier regression with the intended single winner. |
| CONT033-002 | P1 | Reset token validation and clearing occur on a loaded User without a durable one-time guard. The existing sequential mock test cannot exercise two simultaneous reads. Reproduce with two contexts and distinct new passwords. |
| CONT033-003 | P2 | Versioned PBKDF2 verification derives a key with the stored decoded length. With a malformed empty key, the BCL produces an empty result and equality returns true. This requires malformed stored data. Add a rejection control that preserves reviewed historical hash formats. |
| CONT033-004 | P2 | Both friendship send flows check then insert with nonunique pair indexes. The unordered lookup can also choose a terminal row ahead of active state. Test simultaneous directions and retained terminal history. |

The empty-key conclusion follows the pinned .NET implementation. The char-span overload allows zero output length, the core returns early for an empty destination and fixed-time equality succeeds for two empty spans. The source trace establishes the stored-data precondition. [PBKDF2 implementation](https://raw.githubusercontent.com/dotnet/runtime/v10.0.8/src/libraries/System.Security.Cryptography/src/System/Security/Cryptography/Rfc2898DeriveBytes.OneShot.cs), [Fixed-time equality implementation](https://raw.githubusercontent.com/dotnet/runtime/v10.0.8/src/libraries/System.Security.Cryptography/src/System/Security/Cryptography/CryptographicOperations.cs)

## Preserved controls and review limits

- Auth DI binds the canonical scoped outbox, and the compatibility adapter forwards the additive T01 staging operation. Model indexes provide lookup support. Runtime exclusivity remains the separate DIST-009 gate.
- Friendship xmin guards an existing row transition. Recovery-code and User races require separate durable state checks. The login-history offset remains registered as BE-008.
- Retention policies use explicit predicates, advisory locking, dry run, tripwire and bounded batch size. Account purge orders dependents after avatar cleanup. Several separate delete commands allow partial progress on failure. Cross-service erasure requires its own delivery and domain evidence.
- This review covers source and test source. Root owns provider, runtime and deployment gates. Supplemental traces do not advance any other continuation batch. Credential values and user data are excluded from the evidence.

## Complete source ranges

| File | Range read |
| --- | --- |
| `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs` | 1-260 |
| `Services/AuthApi/Planora.Auth.Infrastructure/DesignTime/AuthDbContextFactory.cs` | 1-49 |
| `Services/AuthApi/Planora.Auth.Infrastructure/GlobalUsings.cs` | 1-44 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/FriendshipConfiguration.cs` | 1-53 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/InboxMessageConfiguration.cs` | 1-42 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/LoginHistoryConfiguration.cs` | 1-30 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/OutboxMessageConfiguration.cs` | 1-46 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/PasswordHistoryConfiguration.cs` | 1-33 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/RoleConfiguration.cs` | 1-51 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/UserRecoveryCodeConfiguration.cs` | 1-32 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Configurations/UserRoleConfiguration.cs` | 1-33 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/FriendshipRepository.cs` | 1-65 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/InboxRepository.cs` | 1-47 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/LoginHistoryRepository.cs` | 1-71 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/OutboxRepository.cs` | 1-50 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/PasswordHistoryRepository.cs` | 1-42 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/UserRecoveryCodeRepository.cs` | 1-37 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Planora.Auth.Infrastructure.csproj` | 1-37 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Retention/AuthCleanupPolicies.cs` | 1-85 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Retention/ExpiredRefreshTokenPurgePolicy.cs` | 1-46 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Retention/SecurityAuditRetentionPolicies.cs` | 1-77 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Retention/UserSoftDeletePurgePolicy.cs` | 1-114 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Security/JwtSettings.cs` | 1-15 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordHasher.cs` | 1-102 |
| `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordResetTokenService.cs` | 1-49 |
