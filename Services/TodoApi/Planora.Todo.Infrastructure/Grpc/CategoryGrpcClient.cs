using Planora.GrpcContracts;
using Grpc.Core;
using Planora.Todo.Application.Exceptions;
using Planora.Todo.Application.Interfaces;
using Microsoft.Extensions.Logging;

namespace Planora.Todo.Infrastructure.Grpc;

/// <summary>
/// gRPC client wrapper for calling Category API to fetch category information.
/// </summary>
public sealed class CategoryGrpcClient : ICategoryGrpcClient
{
    private readonly CategoryService.CategoryServiceClient _client;
    private readonly ILogger<CategoryGrpcClient> _logger;

    public CategoryGrpcClient(
        CategoryService.CategoryServiceClient client,
        ILogger<CategoryGrpcClient> logger)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>
    /// Fetches category name, color, and icon for a given category ID.
    /// </summary>
    /// <param name="categoryId">The category ID to fetch information for.</param>
    /// <param name="userId">The user ID the category must belong to.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Category information, or null if not found for that user.</returns>
    public async Task<CategoryInfo?> GetCategoryInfoAsync(
        Guid categoryId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        try
        {
            _logger.LogInformation(
                "Requesting category info for CategoryId {CategoryId} scoped to user {UserId}",
                categoryId,
                userId);
            
            var request = new GetCategoryByIdRequest
            {
                CategoryId = categoryId.ToString(),
                UserId = userId.ToString()
            };

            _logger.LogDebug("Sending request to CategoryService.GetCategoryById");
            var response = await _client.GetCategoryByIdAsync(request, cancellationToken: cancellationToken);

            if (response?.Category == null || string.IsNullOrWhiteSpace(response.Category.Id))
            {
                _logger.LogWarning(
                    "Category {CategoryId} returned an empty response for user {UserId}",
                    categoryId,
                    userId);
                return null;
            }

            if (!Guid.TryParse(response.Category.Id, out var responseCategoryId) ||
                !Guid.TryParse(response.Category.UserId, out var responseUserId))
            {
                _logger.LogWarning(
                    "Category {CategoryId} returned invalid identifiers: CategoryId={ResponseCategoryId}, UserId={ResponseUserId}",
                    categoryId,
                    response.Category.Id,
                    response.Category.UserId);
                return null;
            }

            if (responseUserId != userId)
            {
                _logger.LogWarning(
                    "Category {CategoryId} returned for unexpected user {ResponseUserId}; expected {UserId}",
                    categoryId,
                    responseUserId,
                    userId);
                return null;
            }

            _logger.LogInformation(
                "Successfully retrieved category {CategoryId} for user {UserId}: Name={Name}, Color={Color}, Icon={Icon}",
                responseCategoryId,
                responseUserId,
                response.Category.Name,
                response.Category.Color,
                response.Category.Icon);
            
            return new CategoryInfo(
                responseCategoryId,
                responseUserId,
                response.Category.Name,
                string.IsNullOrEmpty(response.Category.Color) ? null : response.Category.Color,
                string.IsNullOrEmpty(response.Category.Icon) ? null : response.Category.Icon);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.NotFound)
        {
            _logger.LogWarning(
                "Category {CategoryId} not found for user {UserId}",
                categoryId,
                userId);
            return null;
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.PermissionDenied || ex.StatusCode == StatusCode.Unauthenticated)
        {
            _logger.LogWarning(
                ex,
                "Category {CategoryId} is not accessible to user {UserId}: Status={Status}",
                categoryId,
                userId,
                ex.StatusCode);
            return null;
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.Unavailable || ex.StatusCode == StatusCode.DeadlineExceeded)
        {
            _logger.LogWarning(
                ex,
                "Category API unavailable while fetching category {CategoryId} for user {UserId}: Status={Status}",
                categoryId,
                userId,
                ex.StatusCode);
            throw new ExternalServiceUnavailableException("CategoryApi", "GetCategoryById", ex);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(
                ex,
                "Unexpected error fetching category {CategoryId} for user {UserId}: {ExceptionType}",
                categoryId,
                userId,
                ex.GetType().Name);
            throw;
        }
    }
}
