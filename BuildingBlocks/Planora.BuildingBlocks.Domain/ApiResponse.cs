using System.Text.Json.Serialization;

namespace Planora.BuildingBlocks.Domain;

/// <summary>
/// Unified API response envelope for all service responses.
/// Ensures consistent DX and predictable contract for consumers.
/// </summary>
/// <typeparam name="T">The type of the response data</typeparam>
public sealed record ApiResponse<T>
{
    public bool Success { get; init; }
    
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public T? Data { get; init; }
    
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public Error? Error { get; init; }
    
    public ApiResponseMetadata Meta { get; init; } = new();

    public static ApiResponse<T> Successful(T data, string correlationId) => new()
    {
        Success = true,
        Data = data,
        Meta = new ApiResponseMetadata { CorrelationId = correlationId }
    };

    public static ApiResponse<T> Failed(Error error, string correlationId) => new()
    {
        Success = false,
        Error = error,
        Meta = new ApiResponseMetadata { CorrelationId = correlationId }
    };
}

/// <summary>
/// Metadata for the API response.
/// </summary>
public sealed record ApiResponseMetadata
{
    public string CorrelationId { get; init; } = string.Empty;
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;
    public string Version { get; init; } = "v1";
}
