using System.Reflection;
using Planora.BuildingBlocks.Infrastructure.Resilience;

namespace Planora.UnitTests.BuildingBlocks;

public sealed class DependencyWaiterTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void QuoteIdentifier_ShouldEscapeEmbeddedQuotes()
    {
        var method = typeof(DependencyWaiter).GetMethod(
            "QuoteIdentifier",
            BindingFlags.NonPublic | BindingFlags.Static);

        Assert.NotNull(method);
        var quoted = method!.Invoke(null, ["tenant\"db"]);

        Assert.Equal("\"tenant\"\"db\"", quoted);
    }
}
