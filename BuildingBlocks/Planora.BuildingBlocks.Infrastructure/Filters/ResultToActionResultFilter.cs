using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Planora.BuildingBlocks.Infrastructure.Filters;

/// <summary>
/// Automatic Result<T> to ActionResult converter filter.
/// Eliminates manual IsFailure checks in controllers.
/// </summary>
public sealed class ResultToActionResultFilter : IActionFilter
{
    public void OnActionExecuting(ActionExecutingContext context)
    {
        // No pre-execution logic needed
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
        if (context.Result is ObjectResult objectResult && objectResult.Value != null)
        {
            var resultType = objectResult.Value.GetType();

            // Check if it's Result<T>
            if (resultType.IsGenericType && resultType.GetGenericTypeDefinition() == typeof(Result<>))
            {
                var isFailureProperty = resultType.GetProperty("IsFailure");
                var valueProperty = resultType.GetProperty("Value");
                var errorProperty = resultType.GetProperty("Error");

                if (isFailureProperty != null && valueProperty != null && errorProperty != null)
                {
                    var isFailure = (bool)isFailureProperty.GetValue(objectResult.Value)!;
                    var correlationId = context.HttpContext.TraceIdentifier;

                    if (isFailure)
                    {
                        var error = (Error)errorProperty.GetValue(objectResult.Value)!;
                        context.Result = ConvertErrorToActionResult(error, context);
                    }
                    else
                    {
                        // Success - extract Value and wrap in ApiResponse
                        var value = valueProperty.GetValue(objectResult.Value);
                        var response = ApiResponse<object>.Successful(value!, correlationId);
                        context.Result = new OkObjectResult(response);
                    }
                }
            }
            // Check if it's non-generic Result
            else if (resultType == typeof(Result))
            {
                var isFailureProperty = resultType.GetProperty("IsFailure");
                var errorProperty = resultType.GetProperty("Error");

                if (isFailureProperty != null && errorProperty != null)
                {
                    var isFailure = (bool)isFailureProperty.GetValue(objectResult.Value)!;
                    var correlationId = context.HttpContext.TraceIdentifier;

                    if (isFailure)
                    {
                        var error = (Error)errorProperty.GetValue(objectResult.Value)!;
                        context.Result = ConvertErrorToActionResult(error, context);
                    }
                    else
                    {
                        // Success without value - return wrapped success
                        var response = ApiResponse<object>.Successful(new { Message = "Operation completed successfully" }, correlationId);
                        context.Result = new OkObjectResult(response);
                    }
                }
            }
        }
    }

    private static IActionResult ConvertErrorToActionResult(Error error, ActionExecutedContext context)
    {
        var correlationId = context.HttpContext.TraceIdentifier;
        var statusCode = DetermineStatusCode(error);
        
        var response = ApiResponse<object>.Failed(error, correlationId);

        return new ObjectResult(response)
        {
            StatusCode = statusCode
        };
    }

    private static int DetermineStatusCode(Error error)
    {
        // Map error codes to HTTP status codes
        if (error.Code.StartsWith("VALIDATION", StringComparison.OrdinalIgnoreCase))
            return 400;

        if (error.Code.StartsWith("AUTH", StringComparison.OrdinalIgnoreCase) ||
            error.Code.Contains("UNAUTHORIZED", StringComparison.OrdinalIgnoreCase))
            return 401;

        if (error.Code.StartsWith("AUTHORIZATION", StringComparison.OrdinalIgnoreCase) ||
            error.Code.Contains("FORBIDDEN", StringComparison.OrdinalIgnoreCase))
            return 403;

        if (error.Code.Contains("NOT_FOUND", StringComparison.OrdinalIgnoreCase) ||
            error.Code.Contains("NOTFOUND", StringComparison.OrdinalIgnoreCase))
            return 404;

        if (error.Code.StartsWith("CONCURRENCY", StringComparison.OrdinalIgnoreCase) ||
            error.Code.StartsWith("BUSINESS", StringComparison.OrdinalIgnoreCase))
            return 409;

        if (error.Code.StartsWith("INFRASTRUCTURE", StringComparison.OrdinalIgnoreCase))
            return 503;

        return 500; // Default for unexpected errors
    }
}
