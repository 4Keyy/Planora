using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Filters;
using FluentAssertions;
using Xunit;

namespace Planora.ErrorHandlingTests.Infrastructure.Filters;

public class ResultToActionResultFilterTests
{
    private static ActionExecutedContext RunFilter(IActionResult controllerResult)
    {
        var httpContext = new DefaultHttpContext();
        var actionContext = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        var context = new ActionExecutedContext(actionContext, new List<IFilterMetadata>(), controller: new object())
        {
            Result = controllerResult
        };

        new ResultToActionResultFilter().OnActionExecuted(context);
        return context;
    }

    // PLN-18: status comes from ErrorType, not from parsing the machine code.
    [Theory]
    [InlineData(ErrorType.Validation, "ANYTHING", StatusCodes.Status400BadRequest)]
    [InlineData(ErrorType.Unauthorized, "INVALID_CREDENTIALS", StatusCodes.Status401Unauthorized)]
    [InlineData(ErrorType.Forbidden, "TODO_PRIVATE", StatusCodes.Status403Forbidden)]
    [InlineData(ErrorType.NotFound, "X", StatusCodes.Status404NotFound)]
    [InlineData(ErrorType.Conflict, "X", StatusCodes.Status409Conflict)]
    public void Failure_ShouldMapStatusFromErrorType_NotCode(ErrorType type, string code, int expected)
    {
        var result = Result<string>.Failure(new Error(code, "boom", type));

        var context = RunFilter(new ObjectResult(result));

        context.Result.Should().BeOfType<ObjectResult>()
            .Which.StatusCode.Should().Be(expected);
    }

    // PLN-18: untyped (Failure) errors fall back to the legacy code-prefix heuristic — no regression.
    [Theory]
    [InlineData("AUTH_REQUIRED", StatusCodes.Status401Unauthorized)]
    [InlineData("VALIDATION_BAD_INPUT", StatusCodes.Status400BadRequest)]
    [InlineData("QUERY_FAILED", StatusCodes.Status500InternalServerError)]
    public void Failure_Untyped_ShouldFallBackToCodePrefix(string code, int expected)
    {
        var result = Result<string>.Failure(new Error(code, "boom", ErrorType.Failure));

        var context = RunFilter(new ObjectResult(result));

        context.Result.Should().BeOfType<ObjectResult>()
            .Which.StatusCode.Should().Be(expected);
    }

    // PLN-21: a CreatedAtAction success keeps its 201 + Location, not downgraded to 200.
    [Fact]
    public void Success_CreatedAtAction_ShouldPreserve201AndLocationMetadata()
    {
        var created = new CreatedAtActionResult("GetThing", "Things",
            new { id = 7 }, Result<string>.Success("thing"));

        var context = RunFilter(created);

        var preserved = context.Result.Should().BeOfType<CreatedAtActionResult>().Subject;
        preserved.StatusCode.Should().Be(StatusCodes.Status201Created);
        preserved.ActionName.Should().Be("GetThing");
        preserved.RouteValues!["id"].Should().Be(7);
    }

    [Fact]
    public void Success_PlainObjectResult_ShouldStay200()
    {
        var context = RunFilter(new ObjectResult(Result<string>.Success("ok")));

        context.Result.Should().BeOfType<ObjectResult>()
            .Which.StatusCode.Should().Be(StatusCodes.Status200OK);
    }
}
