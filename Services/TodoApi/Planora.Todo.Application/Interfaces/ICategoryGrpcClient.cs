namespace Planora.Todo.Application.Interfaces;

public sealed record CategoryInfo(Guid Id, Guid UserId, string Name, string? Color, string? Icon);

/// <summary>
/// Interface for gRPC client that fetches category information from Category API.
/// </summary>
public interface ICategoryGrpcClient
{
    /// <summary>
    /// Fetches category name, color, and icon for a given category ID.
    /// </summary>
    /// <param name="categoryId">The category ID to fetch information for.</param>
    /// <param name="userId">The user ID the category must belong to.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Category information, or null when the category is not found for that user.</returns>
    Task<CategoryInfo?> GetCategoryInfoAsync(Guid categoryId, Guid userId, CancellationToken cancellationToken);
}
