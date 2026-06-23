using Planora.BuildingBlocks.Domain;
using Microsoft.AspNetCore.Http;
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
                        // Success - extract Value and wrap in ApiResponse, preserving the controller's
                        // original success status code and Location (e.g. 201 CreatedAtAction).
                        var value = valueProperty.GetValue(objectResult.Value);
                        var response = ApiResponse<object>.Successful(value!, correlationId);
                        context.Result = BuildSuccessResult(objectResult, response);
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
                        // Success without value - return wrapped success, preserving the original status.
                        var response = ApiResponse<object>.Successful(new { Message = "Operation completed successfully" }, correlationId);
                        context.Result = BuildSuccessResult(objectResult, response);
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

    /// <summary>
    /// Rebuilds a success result that preserves the controller's intended status code and Location
    /// header (so a <c>CreatedAtAction</c> stays a 201 with a Location) while swapping the raw
    /// <c>Result&lt;T&gt;</c> payload for the wrapped <see cref="ApiResponse{T}"/>.
    /// </summary>
    private static IActionResult BuildSuccessResult(ObjectResult original, object response) => original switch
    {
        CreatedAtActionResult c => new CreatedAtActionResult(c.ActionName, c.ControllerName, c.RouteValues, response),
        CreatedAtRouteResult c => new CreatedAtRouteResult(c.RouteName, c.RouteValues, response),
        CreatedResult c => new CreatedResult(c.Location ?? string.Empty, response),
        AcceptedAtActionResult a => new AcceptedAtActionResult(a.ActionName, a.ControllerName, a.RouteValues, response),
        AcceptedResult a => new AcceptedResult(a.Location, response),
        _ => new ObjectResult(response) { StatusCode = original.StatusCode ?? StatusCodes.Status200OK }
    };

    /// <summary>
    /// Maps a domain <see cref="Error"/> to an HTTP status code by its semantic <see cref="ErrorType"/>
    /// — never by parsing the machine-readable <see cref="Error.Code"/>, which is only an identifier in
    /// the response body. Untyped errors (<see cref="ErrorType.Failure"/>/<see cref="ErrorType.None"/>)
    /// fall back to the legacy code-prefix heuristic for backwards compatibility until every producer
    /// uses the typed <c>Error.Validation/NotFound/Conflict/Unauthorized/Forbidden</c> factories.
    /// </summary>
    private static int DetermineStatusCode(Error error) => error.Type switch
    {
        ErrorType.Validation => StatusCodes.Status400BadRequest,
        ErrorType.Unauthorized => StatusCodes.Status401Unauthorized,
        ErrorType.Forbidden => StatusCodes.Status403Forbidden,
        ErrorType.NotFound => StatusCodes.Status404NotFound,
        ErrorType.Conflict => StatusCodes.Status409Conflict,
        _ => DetermineStatusCodeFromCode(error.Code)
    };

    private static int DetermineStatusCodeFromCode(string code)
    {
        if (code.StartsWith("VALIDATION", StringComparison.OrdinalIgnoreCase))
            return StatusCodes.Status400BadRequest;

        if (code.StartsWith("AUTH", StringComparison.OrdinalIgnoreCase) ||
            code.Contains("UNAUTHORIZED", StringComparison.OrdinalIgnoreCase))
            return StatusCodes.Status401Unauthorized;

        if (code.StartsWith("AUTHORIZATION", StringComparison.OrdinalIgnoreCase) ||
            code.Contains("FORBIDDEN", StringComparison.OrdinalIgnoreCase))
            return StatusCodes.Status403Forbidden;

        if (code.Contains("NOT_FOUND", StringComparison.OrdinalIgnoreCase) ||
            code.Contains("NOTFOUND", StringComparison.OrdinalIgnoreCase))
            return StatusCodes.Status404NotFound;

        if (code.StartsWith("CONCURRENCY", StringComparison.OrdinalIgnoreCase) ||
            code.StartsWith("BUSINESS", StringComparison.OrdinalIgnoreCase))
            return StatusCodes.Status409Conflict;

        if (code.StartsWith("INFRASTRUCTURE", StringComparison.OrdinalIgnoreCase))
            return StatusCodes.Status503ServiceUnavailable;

        return StatusCodes.Status500InternalServerError;
    }
}
