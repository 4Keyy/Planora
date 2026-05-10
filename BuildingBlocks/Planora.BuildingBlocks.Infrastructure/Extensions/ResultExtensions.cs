using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Microsoft.AspNetCore.Mvc;

namespace Planora.BuildingBlocks.Infrastructure.Extensions;

/// <summary>
/// Extension methods for converting Result<T> to ASP.NET Core IActionResult.
/// Automatically maps errors to appropriate DomainExceptions that are caught by middleware.
/// </summary>
public static class ResultExtensions
{
    /// <summary>
    /// Converts Result<T> to IActionResult.
    /// On success: returns 200 OK with value.
    /// On failure: throws appropriate DomainException (caught by EnhancedGlobalExceptionMiddleware).
    /// </summary>
    public static IActionResult ToActionResult<T>(this Result<T> result)
    {
        if (result.IsSuccess)
            return new OkObjectResult(result.Value);

        // Throw appropriate exception - middleware will handle it
        throw MapErrorToException(result.Error!);
    }

    /// <summary>
    /// Converts Result to IActionResult (no value).
    /// On success: returns 200 OK.
    /// On failure: throws appropriate DomainException.
    /// </summary>
    public static IActionResult ToActionResult(this Result result)
    {
        if (result.IsSuccess)
            return new OkResult();

        throw MapErrorToException(result.Error!);
    }

    /// <summary>
    /// Converts Result<T> to IActionResult with custom success status code.
    /// </summary>
    public static IActionResult ToActionResult<T>(this Result<T> result, int successStatusCode)
    {
        if (result.IsSuccess)
            return new ObjectResult(result.Value) { StatusCode = successStatusCode };

        throw MapErrorToException(result.Error!);
    }

    /// <summary>
    /// Converts Result<T> to CreatedAtAction response.
    /// </summary>
    public static IActionResult ToCreatedAtActionResult<T>(
        this Result<T> result,
        string actionName,
        object? routeValues = null)
    {
        if (result.IsSuccess)
            return new CreatedAtActionResult(actionName, null, routeValues, result.Value);

        throw MapErrorToException(result.Error!);
    }

    /// <summary>
    /// Converts Result to NoContent (204) response on success.
    /// </summary>
    public static IActionResult ToNoContentResult(this Result result)
    {
        if (result.IsSuccess)
            return new NoContentResult();

        throw MapErrorToException(result.Error!);
    }

    /// <summary>
    /// Maps Error to appropriate DomainException.
    /// </summary>
    private static Exception MapErrorToException(Error error)
    {
        return error.Type switch
        {
            ErrorType.Validation => new InvalidValueObjectException(
                "ValueObject",
                error.Message,
                error.Code ?? ErrorCode.Validation.InvalidInput),
            
            ErrorType.NotFound => new EntityNotFoundException(
                "Resource",
                "Unknown"),
            
            ErrorType.Conflict => new DuplicateEntityException(
                "Resource",
                "field",
                "value"),
            
            ErrorType.Unauthorized => new UnauthorizedAccessException(error.Message),
            
            ErrorType.Forbidden => new ForbiddenException(error.Message),
            
            _ => new BusinessRuleViolationException(error.Message)
        };
    }

    /// <summary>
    /// Executes an action if result is successful, otherwise throws exception.
    /// </summary>
    public static Result<TOut> OnSuccess<TIn, TOut>(
        this Result<TIn> result,
        Func<TIn, TOut> onSuccess)
    {
        if (result.IsFailure)
            return Result<TOut>.Failure(result.Error!);

        return Result<TOut>.Success(onSuccess(result.Value!));
    }

    /// <summary>
    /// Executes an async action if result is successful.
    /// </summary>
    public static async Task<Result<TOut>> OnSuccessAsync<TIn, TOut>(
        this Result<TIn> result,
        Func<TIn, Task<TOut>> onSuccess)
    {
        if (result.IsFailure)
            return Result<TOut>.Failure(result.Error!);

        var value = await onSuccess(result.Value!);
        return Result<TOut>.Success(value);
    }

    /// <summary>
    /// Returns a default value if result is a failure.
    /// </summary>
    public static T GetValueOrDefault<T>(this Result<T> result, T defaultValue)
    {
        return result.IsSuccess ? result.Value! : defaultValue;
    }

    /// <summary>
    /// Returns a default value from factory if result is a failure.
    /// </summary>
    public static T GetValueOrDefault<T>(this Result<T> result, Func<T> defaultValueFactory)
    {
        return result.IsSuccess ? result.Value! : defaultValueFactory();
    }

    /// <summary>
    /// Throws exception if result is a failure, otherwise returns value.
    /// </summary>
    public static T GetValueOrThrow<T>(this Result<T> result)
    {
        if (result.IsFailure)
            throw MapErrorToException(result.Error!);

        return result.Value!;
    }
}
