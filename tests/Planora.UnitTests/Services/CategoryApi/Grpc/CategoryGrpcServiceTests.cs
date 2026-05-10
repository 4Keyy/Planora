using Grpc.Core;
using Grpc.Core.Testing;
using Planora.BuildingBlocks.Domain;
using Planora.Category.Api.Grpc;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Commands.CreateCategory;
using Planora.Category.Application.Features.Categories.Commands.DeleteCategory;
using Planora.Category.Application.Features.Categories.Commands.UpdateCategory;
using Planora.Category.Application.Features.Categories.Queries.GetCategoryById;
using Planora.Category.Application.Features.Categories.Queries.GetUserCategories;
using Planora.GrpcContracts;
using MediatR;
using Microsoft.Extensions.Logging;
using Moq;
using ApplicationResult = Planora.BuildingBlocks.Application.Models.Result;
using CategoryAppResult = Planora.BuildingBlocks.Application.Models.Result<Planora.Category.Application.DTOs.CategoryDto>;
using CategoryDomainResult = Planora.BuildingBlocks.Domain.Result<Planora.Category.Application.DTOs.CategoryDto>;
using CategoryListResult = Planora.BuildingBlocks.Application.Models.Result<System.Collections.Generic.IReadOnlyList<Planora.Category.Application.DTOs.CategoryDto>>;

namespace Planora.UnitTests.Services.CategoryApi.Grpc;

public class CategoryGrpcServiceTests
{
    [Fact]
    public async Task GetUserCategories_ShouldMapCategoriesAndInternalFailure()
    {
        var mediator = new Mock<IMediator>();
        var service = CreateService(mediator);
        var userId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<GetUserCategoriesQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Success<IReadOnlyList<CategoryDto>>(new[]
            {
                CategoryDto(userId, "Work", "#111111", "briefcase")
            }));

        var response = await service.GetUserCategories(
            new GetUserCategoriesRequest { UserId = userId.ToString() },
            CreateContext());

        Assert.Equal(1, response.TotalCount);
        var category = Assert.Single(response.Categories);
        Assert.Equal("Work", category.Name);
        Assert.Equal(userId.ToString(), category.UserId);

        mediator
            .Setup(x => x.Send(It.IsAny<GetUserCategoriesQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Failure<IReadOnlyList<CategoryDto>>("QUERY_FAILED", "db down"));

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetUserCategories(new GetUserCategoriesRequest { UserId = userId.ToString() }, CreateContext()));
        Assert.Equal(StatusCode.Internal, ex.StatusCode);
    }

    [Fact]
    public async Task GetCategoryById_ShouldValidateIdsAndMapDomainFailures()
    {
        var service = CreateService(new Mock<IMediator>());
        var invalidCategory = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetCategoryById(new GetCategoryByIdRequest { CategoryId = "bad", UserId = Guid.NewGuid().ToString() }, CreateContext()));
        Assert.Equal(StatusCode.InvalidArgument, invalidCategory.StatusCode);

        var missingUser = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetCategoryById(new GetCategoryByIdRequest { CategoryId = Guid.NewGuid().ToString(), UserId = "" }, CreateContext()));
        Assert.Equal(StatusCode.Unauthenticated, missingUser.StatusCode);

        var mediator = new Mock<IMediator>();
        service = CreateService(mediator);
        mediator
            .Setup(x => x.Send(It.IsAny<GetCategoryByIdQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CategoryDomainResult.Failure(Error.NotFound("CATEGORY_NOT_FOUND", "missing")));
        var notFound = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetCategoryById(
                new GetCategoryByIdRequest { CategoryId = Guid.NewGuid().ToString(), UserId = Guid.NewGuid().ToString() },
                CreateContext()));
        Assert.Equal(StatusCode.NotFound, notFound.StatusCode);

        mediator
            .Setup(x => x.Send(It.IsAny<GetCategoryByIdQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CategoryDomainResult.Failure(Error.Unauthorized("AUTH_REQUIRED", "auth required")));
        var unauthorized = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetCategoryById(
                new GetCategoryByIdRequest { CategoryId = Guid.NewGuid().ToString(), UserId = Guid.NewGuid().ToString() },
                CreateContext()));
        Assert.Equal(StatusCode.Unauthenticated, unauthorized.StatusCode);
    }

    [Fact]
    public async Task GetCategoryById_ShouldReturnCategoryOrEmptyResponse()
    {
        var mediator = new Mock<IMediator>();
        var service = CreateService(mediator);
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.Is<GetCategoryByIdQuery>(q => q.CategoryId == categoryId && q.UserId == userId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CategoryDomainResult.Success(CategoryDto(userId, "Inbox", "#ffffff", null, categoryId)));

        var response = await service.GetCategoryById(
            new GetCategoryByIdRequest { CategoryId = categoryId.ToString(), UserId = userId.ToString() },
            CreateContext());

        Assert.Equal(categoryId.ToString(), response.Category.Id);
        Assert.Equal("Inbox", response.Category.Name);
        Assert.Equal("", response.Category.Icon);

        mediator
            .Setup(x => x.Send(It.IsAny<GetCategoryByIdQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(CategoryDomainResult.Success(null!));
        var empty = await service.GetCategoryById(
            new GetCategoryByIdRequest { CategoryId = Guid.NewGuid().ToString(), UserId = userId.ToString() },
            CreateContext());
        Assert.Null(empty.Category);
    }

    [Fact]
    public async Task CreateUpdateDelete_ShouldMapSuccessAndInternalFailures()
    {
        var mediator = new Mock<IMediator>();
        var service = CreateService(mediator);
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<CreateCategoryCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Success(CategoryDto(userId, "Created", "#111111", "plus", categoryId)));
        mediator
            .Setup(x => x.Send(It.IsAny<UpdateCategoryCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Success(CategoryDto(userId, "Updated", "#222222", "edit", categoryId)));
        mediator
            .Setup(x => x.Send(It.IsAny<DeleteCategoryCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Success());

        var create = await service.CreateCategory(
            new CreateCategoryRequest { UserId = userId.ToString(), Name = "Created" },
            CreateContext());
        var update = await service.UpdateCategory(
            new UpdateCategoryRequest { Id = categoryId.ToString(), Name = "Updated" },
            CreateContext());
        var delete = await service.DeleteCategory(
            new DeleteCategoryRequest { Id = categoryId.ToString() },
            CreateContext());

        Assert.Equal(categoryId.ToString(), create.Id);
        Assert.True(update.Success);
        Assert.True(delete.Success);

        mediator
            .Setup(x => x.Send(It.IsAny<CreateCategoryCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Failure<CategoryDto>("CREATE_FAILED", "create failed"));
        var createFailed = await Assert.ThrowsAsync<RpcException>(() =>
            service.CreateCategory(new CreateCategoryRequest { UserId = userId.ToString(), Name = "Bad" }, CreateContext()));
        Assert.Equal(StatusCode.Internal, createFailed.StatusCode);

        mediator
            .Setup(x => x.Send(It.IsAny<UpdateCategoryCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Failure<CategoryDto>("UPDATE_FAILED", "update failed"));
        var updateFailed = await Assert.ThrowsAsync<RpcException>(() =>
            service.UpdateCategory(new UpdateCategoryRequest { Id = categoryId.ToString(), Name = "Bad" }, CreateContext()));
        Assert.Equal(StatusCode.Internal, updateFailed.StatusCode);

        mediator
            .Setup(x => x.Send(It.IsAny<DeleteCategoryCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Failure("DELETE_FAILED", "delete failed"));
        var deleteFailed = await Assert.ThrowsAsync<RpcException>(() =>
            service.DeleteCategory(new DeleteCategoryRequest { Id = categoryId.ToString() }, CreateContext()));
        Assert.Equal(StatusCode.Internal, deleteFailed.StatusCode);
    }

    private static CategoryGrpcService CreateService(Mock<IMediator> mediator)
        => new(mediator.Object, Mock.Of<ILogger<CategoryGrpcService>>());

    private static ServerCallContext CreateContext()
        => TestServerCallContext.Create(
            "Category",
            null,
            DateTime.UtcNow.AddMinutes(1),
            new Metadata(),
            CancellationToken.None,
            "127.0.0.1",
            null,
            null,
            _ => Task.CompletedTask,
            () => null,
            _ => { });

    private static CategoryDto CategoryDto(
        Guid userId,
        string name,
        string color,
        string? icon,
        Guid? id = null)
        => new()
        {
            Id = id ?? Guid.NewGuid(),
            UserId = userId,
            Name = name,
            Description = null,
            Color = color,
            Icon = icon,
            DisplayOrder = 0,
            CreatedAt = DateTime.UtcNow
        };
}
