using Planora.BuildingBlocks.Infrastructure;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using Moq;
using AuthUnitOfWork = Planora.Auth.Infrastructure.Persistence.AuthUnitOfWork;
using CategoryUnitOfWork = Planora.Category.Infrastructure.Persistence.CategoryUnitOfWork;
using CategoryGenericUnitOfWork = Planora.Category.Infrastructure.Persistence.UnitOfWork;
using TodoUnitOfWork = Planora.Todo.Infrastructure.Persistence.Repositories.TodoUnitOfWork;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class UnitOfWorkTransactionTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task TodoUnitOfWork_ShouldCommitRollbackAndDisposeTransactions()
    {
        await using var context = CreateTodoContext();
        await using var unitOfWork = new TodoUnitOfWork(context);

        Assert.False(unitOfWork.HasActiveTransaction);
        Assert.Equal(0, await unitOfWork.SaveChangesAsync());

        await unitOfWork.BeginTransactionAsync();
        Assert.True(unitOfWork.HasActiveTransaction);
        await unitOfWork.CommitTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
        Assert.True(unitOfWork.HasActiveTransaction);
        await unitOfWork.RollbackTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CategoryUnitOfWork_ShouldCommitRollbackAndDisposeTransactions()
    {
        await using var context = CreateCategoryContext();
        await using var unitOfWork = new CategoryUnitOfWork(context);

        Assert.False(unitOfWork.HasActiveTransaction);
        Assert.Equal(0, await unitOfWork.SaveChangesAsync());

        await unitOfWork.BeginTransactionAsync();
        Assert.True(unitOfWork.HasActiveTransaction);
        await unitOfWork.CommitTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
        Assert.True(unitOfWork.HasActiveTransaction);
        await unitOfWork.RollbackTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CategoryGenericUnitOfWork_ShouldIgnoreDuplicateBeginAndNoopMissingTransactionOperations()
    {
        using var context = CreateCategoryContext();
        using var unitOfWork = new CategoryGenericUnitOfWork(context);

        Assert.False(unitOfWork.HasActiveTransaction);
        await unitOfWork.CommitTransactionAsync();
        await unitOfWork.RollbackTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
        await unitOfWork.BeginTransactionAsync();
        Assert.True(unitOfWork.HasActiveTransaction);

        await unitOfWork.CommitTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        await unitOfWork.BeginTransactionAsync();
        await unitOfWork.RollbackTransactionAsync();
        Assert.False(unitOfWork.HasActiveTransaction);

        Assert.Equal(0, await unitOfWork.SaveChangesAsync());
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task UnitOfWorks_ShouldDisposeActiveTransactionsSynchronously()
    {
        using (var todo = CreateTodoContext())
        {
            var unitOfWork = new TodoUnitOfWork(todo);
            await unitOfWork.BeginTransactionAsync();
            Assert.True(unitOfWork.HasActiveTransaction);
            unitOfWork.Dispose();
        }

        using (var category = CreateCategoryContext())
        {
            var unitOfWork = new CategoryUnitOfWork(category);
            await unitOfWork.BeginTransactionAsync();
            Assert.True(unitOfWork.HasActiveTransaction);
            unitOfWork.Dispose();
        }
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuthUnitOfWork_ShouldRollbackAndClearTransaction_WhenCommitSaveFails()
    {
        using var context = CreateAuthContext();
        var unitOfWork = new AuthUnitOfWork(context);
        var transaction = new Mock<IDbContextTransaction>();
        transaction
            .Setup(x => x.RollbackAsync(It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        typeof(AuthUnitOfWork)
            .GetField("_currentTransaction", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .SetValue(unitOfWork, transaction.Object);
        Assert.NotNull(context.Roles);
        Assert.NotNull(context.UserRoles);

        context.Dispose();

        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            unitOfWork.CommitTransactionAsync(CancellationToken.None));

        Assert.False(unitOfWork.HasActiveTransaction);
        transaction.Verify(x => x.RollbackAsync(It.IsAny<CancellationToken>()), Times.Once);
        unitOfWork.Dispose();
    }

    private static TodoDbContext CreateTodoContext()
    {
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseInMemoryDatabase($"todo-uow-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new TodoDbContext(options);
    }

    private static CategoryDbContext CreateCategoryContext()
    {
        var options = new DbContextOptionsBuilder<CategoryDbContext>()
            .UseInMemoryDatabase($"category-uow-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new CategoryDbContext(options, Mock.Of<IDomainEventDispatcher>());
    }

    private static AuthDbContext CreateAuthContext()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"auth-uow-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        return new AuthDbContext(
            options,
            Mock.Of<Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher>());
    }
}
