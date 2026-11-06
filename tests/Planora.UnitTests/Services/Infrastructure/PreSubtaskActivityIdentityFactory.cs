using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Infrastructure.Persistence;

namespace Planora.UnitTests.Services.Infrastructure;

internal static class PreSubtaskActivityIdentityFactory
{
    internal static CollaborationDbContext Create(DbContextOptions<CollaborationDbContext> options) =>
        new(new DbContextOptionsBuilder<CollaborationDbContext>(options)
            .ReplaceService<IModelCustomizer, PreSubtaskActivityIdentityModelCustomizer>()
            .Options);
}

public sealed class PreSubtaskActivityIdentityModelCustomizer(ModelCustomizerDependencies dependencies)
    : ModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);
        RemoveSourceIdentity(modelBuilder);
    }

    internal static void RemoveSourceIdentity(ModelBuilder modelBuilder)
    {
        var comment = modelBuilder.Entity<Comment>();
        var sourceIndex = comment.Metadata.GetIndexes().SingleOrDefault(index =>
            index.Properties.Select(property => property.Name)
                .SequenceEqual(new[] { nameof(Comment.TaskId), nameof(Comment.SourceSubtaskId) }));
        if (sourceIndex is not null)
            comment.Metadata.RemoveIndex(sourceIndex);
        comment.Ignore(value => value.SourceSubtaskId);
    }
}

public sealed class PreSubtaskActivityIdentityFactoryTests
{
    [Fact]
    public void Model_RemovesOnlySourceIdentityAndIndex_AndDoesNotContaminateCurrentModel()
    {
        var options = new DbContextOptionsBuilder<CollaborationDbContext>().UseNpgsql().Options;
        using var current = new CollaborationDbContext(options);
        using var legacy = PreSubtaskActivityIdentityFactory.Create(options);
        var currentModel = current.GetService<IDesignTimeModel>().Model;
        var legacyModel = legacy.GetService<IDesignTimeModel>().Model;
        var currentComment = currentModel.FindEntityType(typeof(Comment))!;
        var legacyComment = legacyModel.FindEntityType(typeof(Comment))!;
        Assert.Null(legacy.Database.GetConnectionString());
        Assert.NotNull(currentComment.FindProperty(nameof(Comment.SourceSubtaskId)));
        Assert.Null(legacyComment.FindProperty(nameof(Comment.SourceSubtaskId)));
        Assert.NotSame(current.GetService<IModelSource>(), legacy.GetService<IModelSource>());

        var currentTables = currentModel.GetRelationalModel().Tables.ToDictionary(table => (table.Schema, table.Name));
        var legacyTables = legacyModel.GetRelationalModel().Tables.ToDictionary(table => (table.Schema, table.Name));
        Assert.Equal(currentTables.Count, legacyTables.Count);
        foreach (var (key, table) in currentTables)
        {
            Assert.True(legacyTables.TryGetValue(key, out var legacyTable));
            var comments = key == ("collaboration", "comments");
            Assert.Equal(table.Columns.Where(column => !comments || column.Name != nameof(Comment.SourceSubtaskId))
                    .Select(column => column.Name).OrderBy(name => name),
                legacyTable!.Columns.Select(column => column.Name).OrderBy(name => name));
            Assert.Equal(table.Indexes.Where(index => !comments ||
                        !index.Columns.Select(column => column.Name).SequenceEqual(new[] { "TaskId", "SourceSubtaskId" }))
                    .Select(IndexDefinition).OrderBy(value => value),
                legacyTable.Indexes.Select(IndexDefinition).OrderBy(value => value));
        }

        using var currentAfterLegacy = new CollaborationDbContext(options);
        Assert.NotNull(currentAfterLegacy.GetService<IDesignTimeModel>().Model.FindEntityType(typeof(Comment))!
            .FindProperty(nameof(Comment.SourceSubtaskId)));
    }

    private static string IndexDefinition(ITableIndex index) =>
        $"{index.Name}:{string.Join(',', index.Columns.Select(column => column.Name))}:{index.IsUnique}:{index.Filter}";
}
