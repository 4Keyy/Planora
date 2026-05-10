using System.Linq.Expressions;
using AutoMapper;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory;
using Planora.Todo.Domain.Entities;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class GetTodosByCategoryQueryHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRequireUserContextWhenQueryUserIdIsMissing()
    {
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(x => x.UserId).Returns(Guid.Empty);
        var handler = new GetTodosByCategoryQueryHandler(
            Mock.Of<IRepository<TodoItem>>(),
            Mock.Of<IMapper>(),
            Mock.Of<ILogger<GetTodosByCategoryQueryHandler>>(),
            currentUser.Object);

        var result = await handler.Handle(
            new GetTodosByCategoryQuery(Guid.NewGuid(), UserId: null),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_REQUIRED", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldPageOwnedCategoryTodosAndMapDtos()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var matching = TodoItem.Create(userId, "Matching", categoryId: categoryId);
        var otherCategory = TodoItem.Create(userId, "Other category", categoryId: Guid.NewGuid());
        var deleted = TodoItem.Create(userId, "Deleted", categoryId: categoryId);
        deleted.MarkAsDeleted(userId);
        Expression<Func<TodoItem, bool>>? capturedPredicate = null;
        Expression<Func<TodoItem, object>>? capturedOrder = null;
        var repository = new Mock<IRepository<TodoItem>>();
        repository
            .Setup(x => x.GetPagedAsync(
                2,
                5,
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                It.IsAny<Expression<Func<TodoItem, object>>>(),
                false,
                It.IsAny<CancellationToken>()))
            .Callback<int, int, Expression<Func<TodoItem, bool>>?, Expression<Func<TodoItem, object>>?, bool, CancellationToken>(
                (_, _, predicate, orderBy, _, _) =>
                {
                    capturedPredicate = predicate;
                    capturedOrder = orderBy;
                })
            .ReturnsAsync((new[] { matching }, 1));
        var mapper = new Mock<IMapper>();
        var dto = CreateDto(matching);
        mapper.Setup(x => x.Map<TodoItemDto>(matching)).Returns(dto);
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(x => x.UserId).Returns(Guid.NewGuid());
        var handler = new GetTodosByCategoryQueryHandler(
            repository.Object,
            mapper.Object,
            Mock.Of<ILogger<GetTodosByCategoryQueryHandler>>(),
            currentUser.Object);

        var result = await handler.Handle(
            new GetTodosByCategoryQuery(categoryId, userId, PageNumber: 2, PageSize: 5),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value!.PageNumber);
        Assert.Equal(5, result.Value.PageSize);
        Assert.Equal(1, result.Value.TotalCount);
        Assert.Same(dto, Assert.Single(result.Value.Items));
        Assert.NotNull(capturedPredicate);
        var predicate = capturedPredicate!.Compile();
        Assert.True(predicate(matching));
        Assert.False(predicate(otherCategory));
        Assert.False(predicate(deleted));
        Assert.NotNull(capturedOrder);
        Assert.Equal(matching.CreatedAt, capturedOrder!.Compile()(matching));
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnQueryFailedWhenRepositoryThrows()
    {
        var userId = Guid.NewGuid();
        var repository = new Mock<IRepository<TodoItem>>();
        repository
            .Setup(x => x.GetPagedAsync(
                It.IsAny<int>(),
                It.IsAny<int>(),
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                It.IsAny<Expression<Func<TodoItem, object>>>(),
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("todo lookup failed"));
        var handler = new GetTodosByCategoryQueryHandler(
            repository.Object,
            Mock.Of<IMapper>(),
            Mock.Of<ILogger<GetTodosByCategoryQueryHandler>>(),
            Mock.Of<ICurrentUserContext>());

        var result = await handler.Handle(
            new GetTodosByCategoryQuery(Guid.NewGuid(), userId),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("QUERY_FAILED", result.Error!.Code);
    }

    private static TodoItemDto CreateDto(TodoItem todo)
        => new()
        {
            Id = todo.Id,
            UserId = todo.UserId,
            Title = todo.Title,
            Status = todo.Status.ToString(),
            Priority = todo.Priority.ToString(),
            IsPublic = todo.IsPublic,
            Hidden = todo.Hidden,
            IsCompleted = todo.IsCompleted,
            Tags = Array.Empty<string>(),
            CreatedAt = todo.CreatedAt
        };
}
