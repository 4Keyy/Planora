using Grpc.Core;
using Planora.Category.Application.Features.Categories.Commands.CreateCategory;
using Planora.Category.Application.Features.Categories.Commands.DeleteCategory;
using Planora.Category.Application.Features.Categories.Commands.UpdateCategory;
using Planora.Category.Application.Features.Categories.Queries.GetUserCategories;
using Planora.Category.Application.Features.Categories.Queries.GetCategoryById;
using Planora.GrpcContracts;
using MediatR;

namespace Planora.Category.Api.Grpc;

public class CategoryGrpcService : CategoryService.CategoryServiceBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<CategoryGrpcService> _logger;

    public CategoryGrpcService(IMediator mediator, ILogger<CategoryGrpcService> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    public override async Task<GetUserCategoriesResponse> GetUserCategories(GetUserCategoriesRequest request, ServerCallContext context)
    {
        // The gRPC surface carries no end-user identity, so the caller MUST scope the read to a
        // specific user; never fall back to a null/empty user that would widen the query.
        var userId = RequireUserId(request.UserId);
        var query = new GetUserCategoriesQuery(userId);
        var result = await _mediator.Send(query);

        if (result.IsFailure)
        {
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Unknown Error"));
        }

        var response = new GetUserCategoriesResponse
        {
            TotalCount = result.Value.Count
        };

        response.Categories.AddRange(result.Value.Select(c => new CategoryModel
        {
            Id = c.Id.ToString(),
            Name = c.Name,
            UserId = c.UserId.ToString(),
            Color = c.Color ?? "",
            Icon = c.Icon ?? "",
            Description = c.Description ?? ""
        }));

        return response;
    }

    public override async Task<GetCategoryByIdResponse> GetCategoryById(GetCategoryByIdRequest request, ServerCallContext context)
    {
        _logger.LogInformation(
            "gRPC GetCategoryById start - CategoryId: {CategoryId}, UserId: {UserId}",
            request.CategoryId,
            request.UserId);
        
        if (!Guid.TryParse(request.CategoryId, out var categoryId))
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.InvalidArgument, "Invalid category ID"));

        if (!Guid.TryParse(request.UserId, out var userId) || userId == Guid.Empty)
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Unauthenticated, "User ID is required"));

        var query = new GetCategoryByIdQuery(categoryId, userId);
        var result = await _mediator.Send(query);

        _logger.LogInformation("gRPC GetCategoryById result - IsFailure: {IsFailure}", result.IsFailure);

        if (result.IsFailure)
        {
            _logger.LogWarning(
                "gRPC GetCategoryById failed for CategoryId {CategoryId}, UserId {UserId}: {Error}",
                categoryId,
                userId,
                result.Error?.Message);

            var statusCode = result.Error?.Type == Planora.BuildingBlocks.Domain.ErrorType.Unauthorized
                ? global::Grpc.Core.StatusCode.Unauthenticated
                : global::Grpc.Core.StatusCode.NotFound;

            throw new RpcException(new global::Grpc.Core.Status(statusCode, result.Error?.Message ?? "Category not found"));
        }

        if (result.Value == null)
        {
            return new GetCategoryByIdResponse();
        }

        var categoryModel = new CategoryModel
        {
            Id = result.Value.Id.ToString(),
            Name = result.Value.Name ?? "",
            UserId = result.Value.UserId.ToString(),
            Color = result.Value.Color ?? "",
            Icon = result.Value.Icon ?? "",
            Description = result.Value.Description ?? ""
        };

        _logger.LogInformation("gRPC CategoryModel created - Id: {Id}, Name: {Name}, Icon: {Icon}, Color: {Color}",
            categoryModel.Id, categoryModel.Name, categoryModel.Icon, categoryModel.Color);

        var response = new GetCategoryByIdResponse
        {
            Category = categoryModel
        };

        return response;
    }

    public override async Task<CreateCategoryResponse> CreateCategory(CreateCategoryRequest request, ServerCallContext context)
    {
        // Require an explicit owner: without it the command would resolve Guid.Empty over gRPC
        // (no HttpContext.User) and create an ownerless category. The domain Category.Create now
        // also rejects an empty owner as a second line of defence.
        var userId = RequireUserId(request.UserId);
        var command = new CreateCategoryCommand(
            userId,
            request.Name,
            null, // Description
            null, // Color
            null  // Icon
        );

        var result = await _mediator.Send(command);

        if (result.IsFailure)
        {
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Unknown Error"));
        }

        return new CreateCategoryResponse
        {
            Id = result.Value.Id.ToString()
        };
    }

    // Mutations carry no owner identity over the gRPC contract (UpdateCategoryRequest /
    // DeleteCategoryRequest have no user_id) and have no internal gRPC caller — the only client,
    // TodoApi, calls GetCategoryById only. Rather than mutate from an unauthenticated Guid.Empty
    // context (which would write/delete without ownership scoping), the gRPC surface refuses
    // mutations. Category create/update/delete is performed through the authenticated HTTP API.
    public override Task<UpdateCategoryResponse> UpdateCategory(UpdateCategoryRequest request, ServerCallContext context)
        => throw new RpcException(new global::Grpc.Core.Status(
            global::Grpc.Core.StatusCode.PermissionDenied,
            "Category updates are not available over gRPC; use the authenticated HTTP API."));

    public override Task<DeleteCategoryResponse> DeleteCategory(DeleteCategoryRequest request, ServerCallContext context)
        => throw new RpcException(new global::Grpc.Core.Status(
            global::Grpc.Core.StatusCode.PermissionDenied,
            "Category deletes are not available over gRPC; use the authenticated HTTP API."));

    // A valid, non-empty user id is mandatory on the user-scoped gRPC methods.
    private static Guid RequireUserId(string rawUserId)
    {
        if (!Guid.TryParse(rawUserId, out var userId) || userId == Guid.Empty)
        {
            throw new RpcException(new global::Grpc.Core.Status(
                global::Grpc.Core.StatusCode.Unauthenticated, "A valid user id is required"));
        }
        return userId;
    }
}
