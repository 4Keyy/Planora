# T08 generated migration source review

**Source review complete for four service chains and five migrations.** Root tracks executable acceptance separately.

Reviewed all 14 final generated files (4439 lines) at HEAD `05dab9c6ca72f2e85cc6d3c4b49989d60ca9a58d`. The nine regenerated files were compared in full with their previously reviewed rejected sources. The five Collaboration files were read in full. [JSON evidence](t08-generated-migration-review.json) preserves both versions, full ranges, hashes, exact changed hunks and operation counts.

## Historical finding T08-GEN-001 (P1)

The first Auth baseline `20261103195755_InitialReviewedBaseline` contained random Role IDs and generation-time timestamps in Up, Designer and snapshot. It was rejected before staging or application. Initial hashes and the original finding remain in JSON `initial_review`; root retained the complete files under `.buildcheck/deep-audit-t08/rejected-scaffolds/`. See [rejected-scaffold provenance](t08-rejected-scaffold-provenance.json).

Root regenerated using explicit owned assembly/startup/deps/runtime paths passed directly to the official `ef.dll`; see [scaffolding proof](t08-owned-scaffolding.json). This reviewer did not execute those commands. All 14 final source hashes match the corresponding scaffolding outputs.

## Source correction verified

Final Auth `20261103201759_InitialReviewedBaseline` Up, Designer and snapshot each contain exactly the committed IDs: Admin `075a45ef-828e-50e7-af6a-7587be5a997b`, User `0a00159e-af48-5e76-a909-55edb8c61fc7`. Both seeds use `2026-01-01T00:00:00Z`. Descriptions, nullable audit fields and `IsDeleted=false` remain unchanged. Rejected random IDs are absent from all 3 final Auth files.

Only seed values/row order and the Designer migration ID changed in Auth. Category/Messaging Up and snapshot files are unchanged from their initial reviewed versions; only their Designer migration IDs changed. All three complete normalized Designer/snapshot model bodies remain equal. No additional generated-source defect was identified.

This corrects T08-GEN-001 at source level. Current-model comparison, fresh migration execution, guarded adoption and data preservation still require the root's executable gates. The separate schema-guard review remains pending correction/GREEN and is not resolved by this source update.

## Collaboration pre-reply baseline and additive upgrade

`20261104053345_InitialPreReplyBaseline` creates the `collaboration` schema and three tables. It adds three primary keys and six indexes. `20261104053426_AddReplyReferences` adds six columns to `collaboration.comments` and one composite index on `(TaskId, ReplyToId)`. Five new columns are nullable. `ReplyToDeleted` is non-null with default `false`. The types and length limits match `CommentConfiguration`.

The final Designer model body matches the final snapshot. Comparing both Designer bodies shows only the six properties and the reply index added. The first scaffold's snapshot was superseded by the second scaffold, and the earlier output hash remains in the scaffolding proof. `LegacyCollaborationBaselineFactory` creates the pre-reply design model with `UseNpgsql()` and a separate model customizer. Its design-time entry point supplies no connection string. The pre-reply target derives from the current model, so adoption of a historical database still depends on provider schema equivalence.

Both IDs match the startup wrapper's baseline and adoption ceiling. The upgrade Down drops the index and six columns, which destroys reply data. The baseline Down drops all three Collaboration tables. Creation and index locking still require deployment review.

## Reviewed operations

| Service | Final migration ID | Tables / PKs | FKs | Indexes (unique / filtered) | Seed operations / rows | Down drops |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | 20261103201759 | 11 / 11 | 6 | 35 (6 / 2) | 1 / 2 | 11 |
| Category | 20261103201802 | 2 / 2 | 1 | 8 (0 / 1) | 0 / 0 | 2 |
| Messaging | 20261103201805 | 3 / 3 | 0 | 8 (0 / 1) | 0 / 0 | 3 |
| Collaboration baseline | 20261104053345 | 3 / 3 | 0 | 6 (0 / 0) | 0 / 0 | 3 |
| Collaboration replies | 20261104053426 | 0 / 0 | 0 | 1 (0 / 0) | 0 / 0 | 0 |

No Up contains `migrationBuilder.Sql`, `AlterColumn`, `DropTable`, `DeleteData` or `UpdateData`. Source/index/FK/default comparison notes are preserved in JSON. No provider SQL was executed by this reviewer.

## Data and rollback boundaries

- Initial migrations create schema. Existing unmanaged databases require proven equivalence and a history stamp that skips initial DDL and InsertData.
- Adoption must preserve arbitrary existing Auth Role IDs and UserRoles references. Future role data changes require explicit name-aware handling; source seed correction does not authorize replacing existing IDs.
- The initial Down methods drop their service table sets. The reply upgrade Down drops its columns and index. These operations require an explicitly approved data-preserving recovery plan for working data.
- Npgsql xmin handling, physical defaults/indexes/FKs, SQL/lock behavior, current-model equivalence and malformed-schema rejection require disposable provider gates.
- The shared startup and adoption helpers have a separate review. This reviewer inspected source and hashes. Root owns the executable checks.

## Exact final source coverage

| File | Full range | SHA256 |
| --- | --- | --- |
| `Services/AuthApi/Planora.Auth.Infrastructure/Migrations/20261103201759_InitialReviewedBaseline.cs` | 1-560 | `e35576864181ae6fd364a4aae518ffaa25a652188a4bca54846b66dbf5fd6ef2` |
| `Services/AuthApi/Planora.Auth.Infrastructure/Migrations/20261103201759_InitialReviewedBaseline.Designer.cs` | 1-883 | `e4bbfa9f2fc2828ed0778691239e8af7b558f85bc8c6f7735e3a3e50a2a412e5` |
| `Services/AuthApi/Planora.Auth.Infrastructure/Migrations/AuthDbContextModelSnapshot.cs` | 1-880 | `c1c98ae848e04e8755397c3666a03439a86f6df39f7ed3de73c23555e6a3d82d` |
| `Services/CategoryApi/Planora.Category.Infrastructure/Migrations/20261103201802_InitialReviewedBaseline.cs` | 1-124 | `c2172cde5496ee5c7055e860190b638ef5d139b603b4a103939f0213600315b1` |
| `Services/CategoryApi/Planora.Category.Infrastructure/Migrations/20261103201802_InitialReviewedBaseline.Designer.cs` | 1-200 | `8ce4ffb90bfeb269aff0fe9a76ffc81c1e0a0becaf30d8039a9583fb073c27d8` |
| `Services/CategoryApi/Planora.Category.Infrastructure/Migrations/CategoryDbContextModelSnapshot.cs` | 1-197 | `a8fab491d5096f94885ea03bdc1dd18f1e9a276cc0624ff3ba4f98ec33488401` |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/Migrations/20261103201805_InitialReviewedBaseline.cs` | 1-145 | `66f4f6b850d29b2495bb557252963767b5bb429965383c955a3e6f5349bd6e32` |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/Migrations/20261103201805_InitialReviewedBaseline.Designer.cs` | 1-226 | `bcaabb112cc06cc76b99aa00eae73e2d9bc0476e1270d031a1067678e1b02ef5` |
| `Services/MessagingApi/Planora.Messaging.Infrastructure/Migrations/MessagingDbContextModelSnapshot.cs` | 1-223 | `a6404353856ca11d42d190e1a6fc83829d3d01400a7c7f47f204701ccff141a7` |
| `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Migrations/20261104053345_InitialPreReplyBaseline.cs` | 1-149 | `5ba920f323501c5a9d0b537eda3cbf7da81efdf6051a8cc43a049f2b7db4327c` |
| `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Migrations/20261104053345_InitialPreReplyBaseline.Designer.cs` | 1-233 | `07698aaf6857a3c1a740a25f9a28289a4cdf4c183693d2c8808489b3426ab42c` |
| `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Migrations/20261104053426_AddReplyReferences.cs` | 1-106 | `eb2a28493ab4c17bcb18232611085d1057c5fea6dc02c070c5f3cdd923763d95` |
| `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Migrations/20261104053426_AddReplyReferences.Designer.cs` | 1-258 | `e1efb7eb839f381717256f044e9003fb8983aab668973b4896826ad5aa0e3e51` |
| `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Migrations/CollaborationDbContextModelSnapshot.cs` | 1-255 | `7978e3f0edb2350f71723418dbe750238722eb0482bf364bebaf34602294e138` |

Initial source hashes and rejected backup paths remain in the JSON evidence; regenerated files do not erase the failed attempt.
