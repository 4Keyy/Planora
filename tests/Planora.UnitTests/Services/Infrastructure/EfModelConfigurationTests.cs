using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
using CategoryEventDispatcher = Planora.BuildingBlocks.Infrastructure.IDomainEventDispatcher;
using AuthEventDispatcher = Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.UnitTests.Services.Infrastructure;

public class EfModelConfigurationTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public void AuthDbContextModel_ShouldApplyUserAndTokenPersistenceContracts()
    {
        using var context = CreateAuthContext();
        var model = context.Model;

        var user = RequireEntity<User>(model);
        Assert.Equal("Users", user.GetTableName());
        Assert.NotNull(user.FindPrimaryKey());
        Assert.Equal(100, user.FindProperty(nameof(User.FirstName))?.GetMaxLength());
        Assert.Equal(100, user.FindProperty(nameof(User.LastName))?.GetMaxLength());
        Assert.Equal(500, user.FindProperty(nameof(User.PasswordHash))?.GetMaxLength());
        Assert.Equal(500, user.FindProperty(nameof(User.EmailVerificationToken))?.GetMaxLength());
        Assert.Equal(500, user.FindProperty(nameof(User.PasswordResetToken))?.GetMaxLength());
        Assert.False((bool)user.FindProperty(nameof(User.IsEmailVerified))!.GetDefaultValue()!);
        Assert.False((bool)user.FindProperty(nameof(User.IsTwoFactorEnabled))!.GetDefaultValue()!);
        Assert.Equal(0, user.FindProperty(nameof(User.FailedLoginAttempts))!.GetDefaultValue());
        Assert.False((bool)user.FindProperty(nameof(User.IsDeleted))!.GetDefaultValue()!);
        Assert.Null(user.FindProperty(nameof(User.IsActive)));
        Assert.Null(user.FindProperty(nameof(User.Roles)));
        Assert.NotNull(user.GetQueryFilter());
        Assert.Contains(user.GetIndexes(), index => index.Properties.Any(property => property.Name == nameof(User.CreatedAt)));
        Assert.Contains(user.GetIndexes(), index => index.Properties.Any(property => property.Name == nameof(User.IsDeleted)));

        var email = model.GetEntityTypes().Single(entityType => entityType.ClrType == typeof(Email));
        Assert.Equal("Email", email.FindProperty(nameof(Email.Value))?.GetColumnName());
        Assert.Equal(255, email.FindProperty(nameof(Email.Value))?.GetMaxLength());
        Assert.Contains(email.GetIndexes(), index => index.IsUnique);

        var refreshToken = RequireEntity<RefreshTokenEntity>(model);
        Assert.Equal("RefreshTokens", refreshToken.GetTableName());
        Assert.Equal(500, refreshToken.FindProperty(nameof(RefreshTokenEntity.Token))?.GetMaxLength());
        Assert.Equal(50, refreshToken.FindProperty(nameof(RefreshTokenEntity.CreatedByIp))?.GetMaxLength());
        Assert.Equal(50, refreshToken.FindProperty(nameof(RefreshTokenEntity.RevokedByIp))?.GetMaxLength());
        Assert.Equal(500, refreshToken.FindProperty(nameof(RefreshTokenEntity.RevokedReason))?.GetMaxLength());
        Assert.Equal(500, refreshToken.FindProperty(nameof(RefreshTokenEntity.ReplacedByToken))?.GetMaxLength());
        Assert.Equal(64, refreshToken.FindProperty(nameof(RefreshTokenEntity.DeviceFingerprint))?.GetMaxLength());
        Assert.Equal(255, refreshToken.FindProperty(nameof(RefreshTokenEntity.DeviceName))?.GetMaxLength());
        Assert.False((bool)refreshToken.FindProperty(nameof(RefreshTokenEntity.RememberMe))!.GetDefaultValue()!);
        Assert.Equal(1, refreshToken.FindProperty(nameof(RefreshTokenEntity.LoginCount))!.GetDefaultValue());
        Assert.Null(refreshToken.FindProperty(nameof(RefreshTokenEntity.IsExpired)));
        Assert.Null(refreshToken.FindProperty(nameof(RefreshTokenEntity.IsRevoked)));
        Assert.Null(refreshToken.FindProperty(nameof(RefreshTokenEntity.IsActive)));
        Assert.Contains(refreshToken.GetIndexes(), index => index.GetDatabaseName() == "IX_RefreshTokens_Token" && index.IsUnique);
        Assert.Contains(refreshToken.GetIndexes(), index => index.GetDatabaseName() == "ix_refresh_tokens_user_device_active" && index.IsUnique);
        var activeDeviceIndex = refreshToken.GetIndexes().Single(index => index.GetDatabaseName() == "ix_refresh_tokens_user_device_active");
        Assert.Equal("\"RevokedAt\" IS NULL", activeDeviceIndex.GetFilter());
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public void TodoDbContextModel_ShouldApplyTodoPersistenceContracts()
    {
        using var context = CreateTodoContext();
        var model = context.Model;

        var todo = RequireEntity<TodoItem>(model);
        Assert.Equal("todo", todo.GetSchema());
        Assert.NotNull(todo.FindPrimaryKey());
        Assert.Equal(200, todo.FindProperty(nameof(TodoItem.Title))?.GetMaxLength());
        Assert.Equal(2000, todo.FindProperty(nameof(TodoItem.Description))?.GetMaxLength());
        Assert.Equal(TodoStatus.Todo, todo.FindProperty(nameof(TodoItem.Status))!.GetDefaultValue());
        Assert.Equal(TodoPriority.Medium, todo.FindProperty(nameof(TodoItem.Priority))!.GetDefaultValue());
        Assert.False((bool)todo.FindProperty(nameof(TodoItem.IsPublic))!.GetDefaultValue()!);
        Assert.False((bool)todo.FindProperty(nameof(TodoItem.Hidden))!.GetDefaultValue()!);
        Assert.False((bool)todo.FindProperty(nameof(TodoItem.IsDeleted))!.GetDefaultValue()!);
        Assert.True(todo.FindProperty(nameof(TodoItem.UpdatedAt))!.IsNullable);
        Assert.True(todo.FindProperty(nameof(TodoItem.DeletedAt))!.IsNullable);
        Assert.Contains(todo.GetIndexes(), index => index.Properties.Select(property => property.Name)
            .SequenceEqual(new[] { nameof(TodoItem.UserId), nameof(TodoItem.Status), nameof(TodoItem.IsDeleted), nameof(TodoItem.CreatedAt) })
            && index.GetDatabaseName() == "ix_todo_items_user_status_deleted_created");
        Assert.Contains(todo.GetIndexes(), index => index.Properties.Any(property => property.Name == nameof(TodoItem.CategoryId)));

        var tag = model.GetEntityTypes().Single(entityType => entityType.ClrType == typeof(TodoItemTag));
        Assert.Equal("todo_tags", tag.GetTableName());
        Assert.Equal(50, tag.FindProperty(nameof(TodoItemTag.Name))?.GetMaxLength());

        var share = RequireEntity<TodoItemShare>(model);
        Assert.Contains(share.GetForeignKeys(), foreignKey => foreignKey.PrincipalEntityType.ClrType == typeof(TodoItem)
            && foreignKey.DeleteBehavior == DeleteBehavior.Cascade);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public void CategoryDbContextModel_ShouldApplyCategoryPersistenceContracts()
    {
        using var context = CreateCategoryContext();
        var model = context.Model;

        var category = RequireEntity<CategoryEntity>(model);
        Assert.NotNull(category.FindPrimaryKey());
        Assert.Equal(50, category.FindProperty(nameof(CategoryEntity.Name))?.GetMaxLength());
        Assert.Equal(500, category.FindProperty(nameof(CategoryEntity.Description))?.GetMaxLength());
        Assert.Equal(7, category.FindProperty(nameof(CategoryEntity.Color))?.GetMaxLength());
        Assert.Equal("#007BFF", category.FindProperty(nameof(CategoryEntity.Color))!.GetDefaultValue());
        Assert.True(category.FindProperty(nameof(CategoryEntity.Icon))!.IsNullable);
        Assert.Equal(0, category.FindProperty(nameof(CategoryEntity.Order))!.GetDefaultValue());
        Assert.False((bool)category.FindProperty(nameof(CategoryEntity.IsDeleted))!.GetDefaultValue()!);
        Assert.Contains(category.GetIndexes(), index => index.Properties.Any(property => property.Name == nameof(CategoryEntity.UserId)));
        Assert.Contains(category.GetIndexes(), index => index.Properties.Select(property => property.Name)
            .SequenceEqual(new[] { nameof(CategoryEntity.UserId), nameof(CategoryEntity.IsDeleted) }));
        Assert.Contains(category.GetIndexes(), index => index.Properties.Any(property => property.Name == nameof(CategoryEntity.CreatedAt)));
    }

    private static AuthDbContext CreateAuthContext()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"auth-model-{Guid.NewGuid():N}")
            .Options;

        return new AuthDbContext(options, Mock.Of<AuthEventDispatcher>());
    }

    private static TodoDbContext CreateTodoContext()
    {
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseInMemoryDatabase($"todo-model-{Guid.NewGuid():N}")
            .Options;

        return new TodoDbContext(options);
    }

    private static CategoryDbContext CreateCategoryContext()
    {
        var options = new DbContextOptionsBuilder<CategoryDbContext>()
            .UseInMemoryDatabase($"category-model-{Guid.NewGuid():N}")
            .Options;

        return new CategoryDbContext(options, Mock.Of<CategoryEventDispatcher>());
    }

    private static IEntityType RequireEntity<TEntity>(IModel model)
    {
        return model.FindEntityType(typeof(TEntity))
            ?? throw new InvalidOperationException($"EF entity type {typeof(TEntity).Name} was not configured.");
    }
}
