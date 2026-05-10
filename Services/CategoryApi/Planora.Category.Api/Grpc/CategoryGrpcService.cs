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
        var query = new GetUserCategoriesQuery(string.IsNullOrEmpty(request.UserId) ? null : Guid.Parse(request.UserId));
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
        var command = new CreateCategoryCommand(
            string.IsNullOrEmpty(request.UserId) ? null : Guid.Parse(request.UserId),
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

    public override async Task<UpdateCategoryResponse> UpdateCategory(UpdateCategoryRequest request, ServerCallContext context)
    {
        var command = new UpdateCategoryCommand(Guid.Parse(request.Id), request.Name);
        var result = await _mediator.Send(command);

        if (result.IsFailure)
        {
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Unknown Error"));
        }

        return new UpdateCategoryResponse
        {
            Success = true
        };
    }

    public override async Task<DeleteCategoryResponse> DeleteCategory(DeleteCategoryRequest request, ServerCallContext context)
    {
        var command = new DeleteCategoryCommand(Guid.Parse(request.Id));
        var result = await _mediator.Send(command);

        if (result.IsFailure)
        {
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Unknown Error"));
        }

        return new DeleteCategoryResponse
        {
            Success = true
        };
    }
}
