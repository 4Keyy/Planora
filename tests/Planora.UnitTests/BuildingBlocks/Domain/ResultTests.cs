using Planora.BuildingBlocks.Domain;

namespace Planora.UnitTests.BuildingBlocks.Domain;

public class ResultTests
{
    [Fact]
    public void GenericSuccess_ShouldMapBindAndMatchValue()
    {
        var result = Result<int>.Success(21)
            .Map(value => value * 2)
            .Bind(value => Result<string>.Success($"value:{value}"));

        Assert.True(result.IsSuccess);
        Assert.Equal("value:42", result.Value);
        Assert.Equal("value:42", result.Match(value => value, error => error.Code));
    }

    [Fact]
    public void GenericFailure_ShouldSkipMapAndBind()
    {
        var result = Result<int>.Failure("ERR", "Broken")
            .Map(value => value * 2)
            .Bind(value => Result<string>.Success($"value:{value}"));

        Assert.True(result.IsFailure);
        Assert.Equal("ERR", result.Error!.Code);
        Assert.Null(result.Value);
        Assert.Equal("Broken", result.Match(value => value, error => error.Message));
    }

    [Fact]
    public void NonGenericFailure_ShouldSkipBindAndMatchError()
    {
        var called = false;
        var directFailure = Result.Failure(Error.Failure("DIRECT", "Direct failure"));

        var result = Result.Failure("ERR", "Broken")
            .Bind(() =>
            {
                called = true;
                return Result.Success();
            });

        Assert.False(called);
        Assert.True(result.IsFailure);
        Assert.Equal("Broken", result.Match(() => "ok", error => error.Message));
        Assert.True(directFailure.IsFailure);
        Assert.Equal("DIRECT", directFailure.Error!.Code);
    }

    [Fact]
    public void NonGenericSuccess_ShouldBindAndMatchSuccess()
    {
        var called = false;

        var result = Result.Success()
            .Bind(() =>
            {
                called = true;
                return Result.Success();
            });

        Assert.True(called);
        Assert.True(result.IsSuccess);
        Assert.Equal("ok", result.Match(() => "ok", error => error.Code));
    }

    [Fact]
    public void ErrorFactories_ShouldSetExpectedErrorTypes()
    {
        Assert.Equal(ErrorType.Validation, Error.Validation("VAL", "Invalid").Type);
        Assert.Equal(ErrorType.NotFound, Error.NotFound("NF", "Missing").Type);
        Assert.Equal(ErrorType.Conflict, Error.Conflict("CONFLICT", "Conflict").Type);
        Assert.Equal(ErrorType.Unauthorized, Error.Unauthorized("AUTH", "Unauthorized").Type);
        Assert.Equal(ErrorType.Forbidden, Error.Forbidden("FORBID", "Forbidden").Type);
        Assert.Equal(ErrorType.Failure, Error.Failure("FAIL", "Failure").Type);
        Assert.True(Error.None.IsNone);
    }
}
