using Planora.BuildingBlocks.Infrastructure.Configuration;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>
/// Pins the sanitisation of CLR type FullNames into OpenAPI <c>$ref</c>-valid
/// schema ids. The Spectral <c>oas3-schema</c> rule rejects <c>$ref</c> values
/// containing characters disallowed by RFC 3986 URI-reference grammar; the
/// CLR generic-type separators (<c>&lt;</c>, <c>&gt;</c>, <c>,</c>) and the
/// nested-type separator (<c>+</c>) all fall into that bucket. The sanitiser
/// must replace them deterministically and must not introduce a way for two
/// distinct CLR types to collide on the same schema id.
/// </summary>
public sealed class PlanoraSwaggerSchemaIdTests
{
    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_PreservesPlainFullName()
    {
        var id = InvokeSanitize("Planora.Auth.Application.Common.DTOs.UserDto");
        Assert.Equal("Planora.Auth.Application.Common.DTOs.UserDto", id);
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_ReplacesGenericBrackets()
    {
        var id = InvokeSanitize("Planora.Common.PagedResult<Planora.Auth.UserDto>");
        // Brackets and the chars they enclose are collapsed into a single `_`.
        Assert.Equal("Planora.Common.PagedResult_Planora.Auth.UserDto", id);
        Assert.DoesNotContain("<", id);
        Assert.DoesNotContain(">", id);
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_ReplacesNestedGenericSeparator()
    {
        var id = InvokeSanitize("System.Collections.Generic.Dictionary<System.String,System.Int32>");
        Assert.Equal("System.Collections.Generic.Dictionary_System.String_System.Int32", id);
        Assert.DoesNotContain(",", id);
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_CollapsesReflectionAssemblyQualifiedNoise()
    {
        // The reflection FullName Swashbuckle hands the delegate for a closed
        // generic looks like the following — backtick, square brackets, commas,
        // spaces, and equals all need to be collapsed to a URI-reference-safe id.
        const string input =
            "Planora.BuildingBlocks.Application.Pagination.PagedResult`1[[" +
            "Planora.Auth.Application.Features.Friendships.Queries.GetFriends.FriendDto, " +
            "Planora.Auth.Application, Version=1.0.0.0, Culture=neutral, " +
            "PublicKeyToken=null]]";

        var id = InvokeSanitize(input);

        // Every illegal char gone:
        foreach (var ch in new[] { '`', '[', ']', ',', ' ', '=' })
        {
            Assert.False(id.Contains(ch), $"id should not contain '{ch}': {id}");
        }
        // The closed-generic distinguishing tokens (Planora.Auth.UserDto, etc.) survive
        // so two distinct generics produce distinct ids.
        Assert.Contains("FriendDto", id);
        Assert.Contains("PagedResult", id);
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_NormalisesNestedTypePlusSeparator()
    {
        // CLR FullName for a nested type uses '+' between outer and nested.
        var id = InvokeSanitize("Planora.Outer+Inner");
        Assert.Equal("Planora.Outer.Inner", id);
    }

    [Fact]
    [Trait("TestType", "Contract")]
    public void SanitizeSchemaId_TolesNullAndEmpty()
    {
        Assert.Equal(string.Empty, InvokeSanitize(null));
        Assert.Equal(string.Empty, InvokeSanitize(string.Empty));
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_IsDeterministic()
    {
        const string input = "Planora.Common.PagedResult<Planora.Auth.UserDto>";
        Assert.Equal(InvokeSanitize(input), InvokeSanitize(input));
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_DistinctInputsProduceDistinctIds()
    {
        // Two CLR types that share short-name `Result` are distinguished by their
        // type arguments. The sanitiser must not collapse them.
        var a = InvokeSanitize("Planora.BuildingBlocks.Domain.Result<Planora.Auth.UserDto>");
        var b = InvokeSanitize("Planora.BuildingBlocks.Domain.Result<Planora.Todo.TodoDto>");
        Assert.NotEqual(a, b);
    }

    [Fact]
    [Trait("TestType", "Contract")]
    [Trait("TestType", "Regression")]
    public void SanitizeSchemaId_OnlyTouchesIllegalCharacters()
    {
        // Underscores, digits, parentheses (not actually present in FullName but harmless),
        // and dots remain. Only the four illegal characters '<', '>', ',', '+' are touched.
        var id = InvokeSanitize("Planora_Foo.Bar_v2.Baz3");
        Assert.Equal("Planora_Foo.Bar_v2.Baz3", id);
    }

    private static string InvokeSanitize(string? fullName)
    {
        // SanitizeSchemaId is `internal` — call through reflection so the test
        // does not require InternalsVisibleTo to be configured for the
        // BuildingBlocks.Infrastructure assembly.
        var method = typeof(PlanoraSwaggerExtensions).GetMethod(
            "SanitizeSchemaId",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)
            ?? throw new InvalidOperationException("SanitizeSchemaId not found");
        return (string)method.Invoke(null, new object?[] { fullName })!;
    }
}
