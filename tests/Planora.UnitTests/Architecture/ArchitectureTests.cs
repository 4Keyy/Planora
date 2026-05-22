using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NetArchTest.Rules;

namespace Planora.UnitTests.Architecture;

/// <summary>
/// Enforces the Clean Architecture / DDD dependency rule automatically: a
/// layering violation (for example a Domain project taking a dependency on
/// Infrastructure) fails the build instead of slipping through review.
/// </summary>
public sealed class ArchitectureTests
{
    private static readonly (string Name, Assembly Assembly)[] DomainAssemblies =
    {
        ("Planora.BuildingBlocks.Domain", typeof(global::Planora.BuildingBlocks.Domain.Error).Assembly),
        ("Planora.Auth.Domain", typeof(global::Planora.Auth.Domain.Entities.User).Assembly),
        ("Planora.Todo.Domain", typeof(global::Planora.Todo.Domain.Entities.TodoItem).Assembly),
        ("Planora.Category.Domain", typeof(global::Planora.Category.Domain.Entities.Category).Assembly),
        ("Planora.Messaging.Domain", typeof(global::Planora.Messaging.Domain.Entities.Message).Assembly),
    };

    // Namespaces that belong to the infrastructure layer or to infrastructure
    // frameworks. No Domain type may reference anything under these.
    private static readonly string[] InfrastructureNamespaces =
    {
        "Planora.BuildingBlocks.Infrastructure",
        "Microsoft.EntityFrameworkCore",
        "Microsoft.AspNetCore",
        "Npgsql",
        "StackExchange.Redis",
        "RabbitMQ",
        "Grpc",
    };

    [Fact]
    [Trait("TestType", "Architecture")]
    public void Domain_layer_must_not_depend_on_infrastructure()
    {
        var violations = new List<string>();

        foreach (var (name, assembly) in DomainAssemblies)
        {
            var result = Types.InAssembly(assembly)
                .Should()
                .NotHaveDependencyOnAny(InfrastructureNamespaces)
                .GetResult();

            if (!result.IsSuccessful)
            {
                violations.Add(
                    $"{name}: {string.Join(", ", result.FailingTypeNames ?? Enumerable.Empty<string>())}");
            }
        }

        Assert.True(
            violations.Count == 0,
            "Domain projects must not depend on infrastructure concerns. Violations:" +
            System.Environment.NewLine +
            string.Join(System.Environment.NewLine, violations));
    }

    [Fact]
    [Trait("TestType", "Architecture")]
    public void BuildingBlocks_Domain_must_not_depend_on_outer_layers()
    {
        var result = Types.InAssembly(typeof(global::Planora.BuildingBlocks.Domain.Error).Assembly)
            .Should()
            .NotHaveDependencyOnAny(
                "Planora.BuildingBlocks.Application",
                "Planora.BuildingBlocks.Infrastructure")
            .GetResult();

        Assert.True(
            result.IsSuccessful,
            "Planora.BuildingBlocks.Domain must not depend on the Application or Infrastructure layers. Offending types: " +
            string.Join(", ", result.FailingTypeNames ?? Enumerable.Empty<string>()));
    }
}
