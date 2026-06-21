using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using AppError = Planora.BuildingBlocks.Application.Models.Error;

namespace Planora.UnitTests.BuildingBlocks;

public class ResultGuardTests
{
    [Fact]
    public void ApplicationResult_ImplicitNull_IsFailureNotSuccess()
    {
        // A null value implicitly converted to a Result must be a failure, not Success(null).
        string? value = null;
        Planora.BuildingBlocks.Application.Models.Result<string> result = value!;

        Assert.True(result.IsFailure);
        Assert.Equal(AppError.NullValue.Code, result.Error!.Code);
    }

    [Fact]
    public void ApplicationResult_ImplicitNonNull_IsSuccess()
    {
        Planora.BuildingBlocks.Application.Models.Result<string> result = "ok";

        Assert.True(result.IsSuccess);
        Assert.Equal("ok", result.Value);
    }

    [Fact]
    public void MapError_NotFound_PreservesCodeAndMessage()
    {
        var result = Result<string>.Failure(Error.NotFound("CATEGORY_NOT_FOUND", "Category 42 not found"));

        var ex = Assert.Throws<MappedDomainException>(() => result.ToActionResult());

        Assert.Equal("CATEGORY_NOT_FOUND", ex.ErrorCode);
        Assert.Equal("Category 42 not found", ex.Message);
    }

    [Fact]
    public void MapError_Conflict_PreservesCodeAndMessage()
    {
        var result = Result<string>.Failure(Error.Conflict("DUP_EMAIL", "Email already registered"));

        var ex = Assert.Throws<MappedDomainException>(() => result.ToActionResult());

        Assert.Equal("DUP_EMAIL", ex.ErrorCode);
        Assert.Equal("Email already registered", ex.Message);
    }
}
