using Planora.Auth.Domain.ValueObjects;
using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public class EmailTests
{
    [Theory]
    [InlineData("USER@Example.COM", "user@example.com")]
    [InlineData(" first.last+tag@sub.example.co ", "first.last+tag@sub.example.co")]
    public void Create_ShouldNormalizeValidEmail(string input, string expected)
    {
        var email = Email.Create(input);

        Assert.Equal(expected, email.Value);
        Assert.Equal(expected, email.ToString());
        Assert.Equal(expected, (string)email);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("missing-at.example.com")]
    [InlineData("missing-domain@")]
    [InlineData("missing-tld@example")]
    public void Create_ShouldRejectInvalidEmail(string? input)
    {
        Assert.Throws<InvalidValueObjectException>(() => Email.Create(input!));
    }

    [Fact]
    public void Create_ShouldRejectEmailsLongerThan255Characters()
    {
        var tooLong = $"{new string('a', 244)}@example.com";

        Assert.True(tooLong.Length > 255);
        Assert.Throws<InvalidValueObjectException>(() => Email.Create(tooLong));
    }

    [Fact]
    public void Equality_ShouldUseNormalizedEmailValue()
    {
        Assert.Equal(Email.Create("USER@example.com"), Email.Create("user@example.com"));
    }
}
