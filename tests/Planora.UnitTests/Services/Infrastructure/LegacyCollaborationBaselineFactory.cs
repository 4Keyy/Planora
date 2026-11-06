using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Infrastructure.Persistence;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>Test-startup factory for scaffolding the reviewed schema before reply references were added.</summary>
public sealed class LegacyCollaborationBaselineFactory : IDesignTimeDbContextFactory<CollaborationDbContext>
{
    public CollaborationDbContext CreateDbContext(string[] args) =>
        Create(new DbContextOptionsBuilder<CollaborationDbContext>().UseNpgsql().Options);

    internal static CollaborationDbContext Create(DbContextOptions<CollaborationDbContext> options) =>
        new(new DbContextOptionsBuilder<CollaborationDbContext>(options)
            .ReplaceService<IModelCustomizer, LegacyCollaborationModelCustomizer>()
            .Options);
}

public sealed class LegacyCollaborationModelCustomizer(ModelCustomizerDependencies dependencies)
    : ModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);
        PreSubtaskActivityIdentityModelCustomizer.RemoveSourceIdentity(modelBuilder);

        var comment = modelBuilder.Entity<Comment>();
        var replyIndex = comment.Metadata.GetIndexes().SingleOrDefault(index =>
            index.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(Comment.TaskId), nameof(Comment.ReplyToId) }));
        if (replyIndex is not null)
            comment.Metadata.RemoveIndex(replyIndex);

        comment.Ignore(value => value.ReplyToType);
        comment.Ignore(value => value.ReplyToId);
        comment.Ignore(value => value.ReplyToAuthorId);
        comment.Ignore(value => value.ReplyToAuthorName);
        comment.Ignore(value => value.ReplyToPreview);
        comment.Ignore(value => value.ReplyToDeleted);
    }
}

public sealed class LegacyCollaborationBaselineFactoryTests
{
    [Fact]
    public void LegacyModel_RemovesReplyAndActivityIdentity_WithoutContaminatingTheCurrentModel()
    {
        using var current = new CollaborationDbContext(
            new DbContextOptionsBuilder<CollaborationDbContext>().UseNpgsql().Options);
        using var legacy = new LegacyCollaborationBaselineFactory().CreateDbContext(Array.Empty<string>());
        var currentModel = current.GetService<IDesignTimeModel>().Model;
        var legacyModel = legacy.GetService<IDesignTimeModel>().Model;
        var currentComment = currentModel.FindEntityType(typeof(Comment))!;
        var legacyComment = legacyModel.FindEntityType(typeof(Comment))!;
        string[] replyProperties =
        [
            nameof(Comment.ReplyToType), nameof(Comment.ReplyToId), nameof(Comment.ReplyToAuthorId),
            nameof(Comment.ReplyToAuthorName), nameof(Comment.ReplyToPreview), nameof(Comment.ReplyToDeleted),
            nameof(Comment.SourceSubtaskId)
        ];

        Assert.Null(legacy.Database.GetConnectionString());
        Assert.IsType<LegacyCollaborationModelCustomizer>(legacy.GetService<IModelCustomizer>());
        Assert.IsNotType<LegacyCollaborationModelCustomizer>(current.GetService<IModelCustomizer>());
        Assert.NotSame(current.GetService<IModelSource>(), legacy.GetService<IModelSource>());
        foreach (var name in replyProperties)
        {
            Assert.NotNull(currentComment.FindProperty(name));
            Assert.Null(legacyComment.FindProperty(name));
        }
        Assert.Null(currentComment.FindProperty(nameof(Comment.IsReply)));
        Assert.Null(legacyComment.FindProperty(nameof(Comment.IsReply)));
        Assert.Single(currentComment.GetIndexes(), IsReplyIndex);
        Assert.DoesNotContain(legacyComment.GetIndexes(), IsReplyIndex);

        var currentTables = currentModel.GetRelationalModel().Tables.ToDictionary(table => (table.Schema, table.Name));
        var legacyTables = legacyModel.GetRelationalModel().Tables.ToDictionary(table => (table.Schema, table.Name));
        Assert.NotEmpty(currentTables);
        Assert.Equal(currentTables.Count, legacyTables.Count);
        var commentTable = StoreObjectIdentifier.Table(currentComment.GetTableName()!, currentComment.GetSchema());
        var replyColumns = replyProperties.Select(name => currentComment.FindProperty(name)!.GetColumnName(commentTable))
            .ToHashSet(StringComparer.Ordinal);
        foreach (var (key, currentTable) in currentTables)
        {
            Assert.True(legacyTables.TryGetValue(key, out var legacyTable));
            var isCommentTable = key == (commentTable.Schema, commentTable.Name);
            Assert.Equal(
                currentTable.Columns.Where(column => !isCommentTable || !replyColumns.Contains(column.Name))
                    .Select(column => column.Name).OrderBy(name => name, StringComparer.Ordinal),
                legacyTable!.Columns.Select(column => column.Name).OrderBy(name => name, StringComparer.Ordinal));
            Assert.Equal(
                currentTable.Indexes.Where(index => !isCommentTable ||
                        (!index.Columns.Select(column => column.Name).SequenceEqual(new[] { "TaskId", "ReplyToId" }) &&
                         !index.Columns.Select(column => column.Name).SequenceEqual(new[] { "TaskId", "SourceSubtaskId" })))
                    .Select(IndexDefinition).OrderBy(value => value, StringComparer.Ordinal),
                legacyTable.Indexes.Select(IndexDefinition).OrderBy(value => value, StringComparer.Ordinal));
        }

        using var currentAfterLegacy = new CollaborationDbContext(
            new DbContextOptionsBuilder<CollaborationDbContext>().UseNpgsql().Options);
        var freshCurrentComment = currentAfterLegacy.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Comment))!;
        Assert.All(replyProperties, name => Assert.NotNull(freshCurrentComment.FindProperty(name)));
        Assert.Single(freshCurrentComment.GetIndexes(), IsReplyIndex);
    }

    private static bool IsReplyIndex(IReadOnlyIndex index) =>
        index.Properties.Select(property => property.Name)
            .SequenceEqual(new[] { nameof(Comment.TaskId), nameof(Comment.ReplyToId) });

    private static string IndexDefinition(ITableIndex index) =>
        $"{index.Name}:{string.Join(',', index.Columns.Select(column => column.Name))}:{index.IsUnique}:{index.Filter}";
}
