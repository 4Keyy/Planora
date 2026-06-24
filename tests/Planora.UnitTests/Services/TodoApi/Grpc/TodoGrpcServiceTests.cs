using Grpc.Core;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.UnitTests.Shared;
using Planora.GrpcContracts;
using Planora.Todo.Api.Grpc;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using MediatR;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Grpc;

public class TodoGrpcServiceTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task GetUserTodos_MapsQueryAndTodoModels()
    {
        var mediator = new Mock<IMediator>();
        GetUserTodosQuery? sentQuery = null;
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var sharedUserId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<GetUserTodosQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedResult<TodoItemDto>>, CancellationToken>((query, _) => sentQuery = (GetUserTodosQuery)query)
            .ReturnsAsync(new PagedResult<TodoItemDto>(
                new[] { TodoDto(userId, categoryId, sharedUserId) },
                pageNumber: 2,
                pageSize: 25,
                totalCount: 1));
        var service = CreateService(mediator);

        var response = await service.GetUserTodos(
            new GetUserTodosRequest { UserId = userId.ToString(), Page = 2, PageSize = 25 },
            CreateContext());

        Assert.Equal(1, response.TotalCount);
        Assert.Equal(userId, sentQuery!.UserId);
        Assert.Equal(2, sentQuery.PageNumber);
        Assert.Equal(25, sentQuery.PageSize);
        var todo = Assert.Single(response.Todos);
        Assert.Equal("Write gRPC tests", todo.Title);
        Assert.Equal(userId.ToString(), todo.UserId);
        Assert.Equal(categoryId.ToString(), todo.CategoryId);
        Assert.False(todo.IsCompleted);
        Assert.Equal(sharedUserId.ToString(), Assert.Single(todo.SharedWithUserIds));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetUserTodos_AllowsMissingUserAndCategoryIds()
    {
        var mediator = new Mock<IMediator>();
        GetUserTodosQuery? sentQuery = null;
        mediator
            .Setup(x => x.Send(It.IsAny<GetUserTodosQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedResult<TodoItemDto>>, CancellationToken>((query, _) => sentQuery = (GetUserTodosQuery)query)
            .ReturnsAsync(new PagedResult<TodoItemDto>(
                new[] { TodoDto(Guid.NewGuid(), categoryId: null, sharedUserId: null) },
                pageNumber: 1,
                pageSize: 10,
                totalCount: 1));
        var service = CreateService(mediator);

        var response = await service.GetUserTodos(
            new GetUserTodosRequest { UserId = "", Page = 1, PageSize = 10 },
            CreateContext());

        Assert.Null(sentQuery!.UserId);
        Assert.Equal("", Assert.Single(response.Todos).CategoryId);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetTodosByCategory_MapsSuccessAndFailure()
    {
        var mediator = new Mock<IMediator>();
        GetTodosByCategoryQuery? sentQuery = null;
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<GetTodosByCategoryQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<global::Planora.BuildingBlocks.Domain.Result<PagedResult<TodoItemDto>>>, CancellationToken>((query, _) => sentQuery = (GetTodosByCategoryQuery)query)
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result<PagedResult<TodoItemDto>>.Success(new PagedResult<TodoItemDto>(
                new[] { TodoDto(userId, categoryId, sharedUserId: null, isCompleted: true) },
                pageNumber: 3,
                pageSize: 5,
                totalCount: 1)));
        var service = CreateService(mediator);

        var response = await service.GetTodosByCategory(
            new GetTodosByCategoryRequest
            {
                CategoryId = categoryId.ToString(),
                UserId = userId.ToString(),
                Page = 3,
                PageSize = 5
            },
            CreateContext());

        Assert.Equal(categoryId, sentQuery!.CategoryId);
        Assert.Equal(userId, sentQuery.UserId);
        Assert.Equal(3, sentQuery.PageNumber);
        Assert.True(Assert.Single(response.Todos).IsCompleted);

        mediator
            .Setup(x => x.Send(It.IsAny<GetTodosByCategoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result<PagedResult<TodoItemDto>>.Failure("CATEGORY_QUERY_FAILED", "category query failed"));

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetTodosByCategory(new GetTodosByCategoryRequest { CategoryId = categoryId.ToString() }, CreateContext()));
        Assert.Equal(StatusCode.Internal, ex.StatusCode);
        Assert.Equal("category query failed", ex.Status.Detail);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_FiltersSharedIdsAndMapsDomainFailures()
    {
        var mediator = new Mock<IMediator>();
        CreateTodoCommand? sentCommand = null;
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var sharedUserId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<CreateTodoCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<global::Planora.BuildingBlocks.Domain.Result<TodoItemDto>>, CancellationToken>((command, _) => sentCommand = (CreateTodoCommand)command)
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result<TodoItemDto>.Success(TodoDto(userId, categoryId, sharedUserId, id: todoId)));
        var service = CreateService(mediator);
        var request = new CreateTodoRequest
        {
            UserId = userId.ToString(),
            CategoryId = categoryId.ToString(),
            Title = "Created over gRPC"
        };
        request.SharedWithUserIds.Add(sharedUserId.ToString());
        request.SharedWithUserIds.Add("not-a-guid");

        var response = await service.CreateTodo(request, CreateContext());

        Assert.Equal(todoId.ToString(), response.Id);
        Assert.Equal(userId, sentCommand!.UserId);
        Assert.Equal(categoryId, sentCommand.CategoryId);
        Assert.Equal("Created over gRPC", sentCommand.Title);
        Assert.Equal(sharedUserId, Assert.Single(sentCommand.SharedWithUserIds!));

        mediator
            .Setup(x => x.Send(It.IsAny<CreateTodoCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result<TodoItemDto>.Failure("CREATE_FAILED", "create failed"));

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            service.CreateTodo(new CreateTodoRequest { Title = "Bad" }, CreateContext()));
        Assert.Equal(StatusCode.Internal, ex.StatusCode);
        Assert.Equal("create failed", ex.Status.Detail);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateAndDelete_SendCommandsAndReturnSuccess()
    {
        var mediator = new Mock<IMediator>();
        UpdateTodoCommand? sentUpdate = null;
        DeleteTodoCommand? sentDelete = null;
        var todoId = Guid.NewGuid();
        var sharedUserId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<UpdateTodoCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<global::Planora.BuildingBlocks.Domain.Result<TodoItemDto>>, CancellationToken>((command, _) => sentUpdate = (UpdateTodoCommand)command)
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result<TodoItemDto>.Success(TodoDto(Guid.NewGuid(), categoryId: null, sharedUserId)));
        mediator
            .Setup(x => x.Send(It.IsAny<DeleteTodoCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<global::Planora.BuildingBlocks.Domain.Result>, CancellationToken>((command, _) => sentDelete = (DeleteTodoCommand)command)
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result.Success());
        var service = CreateService(mediator);
        var updateRequest = new UpdateTodoRequest
        {
            Id = todoId.ToString(),
            Title = "Updated",
            IsCompleted = true
        };
        updateRequest.SharedWithUserIds.Add(sharedUserId.ToString());

        var update = await service.UpdateTodo(updateRequest, CreateContext());
        var delete = await service.DeleteTodo(new DeleteTodoRequest { Id = todoId.ToString() }, CreateContext());

        Assert.True(update.Success);
        Assert.Equal(todoId, sentUpdate!.TodoId);
        Assert.Equal("Updated", sentUpdate.Title);
        Assert.Equal("Done", sentUpdate.Status);
        Assert.Equal(sharedUserId, Assert.Single(sentUpdate.SharedWithUserIds!));
        Assert.True(delete.Success);
        Assert.Equal(todoId, sentDelete!.TodoId);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task UpdateAndDelete_SurfaceDomainFailuresAsRpcErrors()
    {
        // The bug: these used to ignore the Result and always return Success=true, swallowing
        // not-found / forbidden / validation failures.
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(x => x.Send(It.IsAny<UpdateTodoCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result<TodoItemDto>.Failure("UPDATE_FAILED", "update rejected"));
        mediator
            .Setup(x => x.Send(It.IsAny<DeleteTodoCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(global::Planora.BuildingBlocks.Domain.Result.Failure("DELETE_FAILED", "delete rejected"));
        var service = CreateService(mediator);

        var updateEx = await Assert.ThrowsAsync<RpcException>(() =>
            service.UpdateTodo(new UpdateTodoRequest { Id = Guid.NewGuid().ToString() }, CreateContext()));
        Assert.Equal(StatusCode.Internal, updateEx.StatusCode);
        Assert.Equal("update rejected", updateEx.Status.Detail);

        var deleteEx = await Assert.ThrowsAsync<RpcException>(() =>
            service.DeleteTodo(new DeleteTodoRequest { Id = Guid.NewGuid().ToString() }, CreateContext()));
        Assert.Equal(StatusCode.Internal, deleteEx.StatusCode);
        Assert.Equal("delete rejected", deleteEx.Status.Detail);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task MalformedGuidArguments_ThrowInvalidArgument()
    {
        var service = CreateService(new Mock<IMediator>());

        var update = await Assert.ThrowsAsync<RpcException>(() =>
            service.UpdateTodo(new UpdateTodoRequest { Id = "not-a-guid" }, CreateContext()));
        Assert.Equal(StatusCode.InvalidArgument, update.StatusCode);

        var delete = await Assert.ThrowsAsync<RpcException>(() =>
            service.DeleteTodo(new DeleteTodoRequest { Id = "not-a-guid" }, CreateContext()));
        Assert.Equal(StatusCode.InvalidArgument, delete.StatusCode);

        var category = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetTodosByCategory(new GetTodosByCategoryRequest { CategoryId = "not-a-guid" }, CreateContext()));
        Assert.Equal(StatusCode.InvalidArgument, category.StatusCode);
    }

    private static TodoGrpcService CreateService(Mock<IMediator> mediator)
        => new(
            mediator.Object,
            Mock.Of<Planora.Todo.Domain.Repositories.ITodoRepository>(),
            Mock.Of<Planora.Todo.Application.Services.IFriendshipService>(),
            Mock.Of<ILogger<TodoGrpcService>>());

    private static ServerCallContext CreateContext() => new FakeServerCallContext();

    private static TodoItemDto TodoDto(
        Guid userId,
        Guid? categoryId,
        Guid? sharedUserId,
        bool isCompleted = false,
        Guid? id = null)
        => new()
        {
            Id = id ?? Guid.NewGuid(),
            UserId = userId,
            Title = "Write gRPC tests",
            Description = null,
            Status = isCompleted ? "Done" : "Todo",
            CategoryId = categoryId,
            DueDate = null,
            ExpectedDate = null,
            ActualDate = null,
            Priority = "Medium",
            IsPublic = false,
            Hidden = false,
            IsCompleted = isCompleted,
            CompletedAt = isCompleted ? DateTime.UtcNow : null,
            Tags = Array.Empty<string>(),
            CreatedAt = DateTime.UtcNow,
            SharedWithUserIds = sharedUserId is null ? Array.Empty<Guid>() : new[] { sharedUserId.Value }
        };
}
