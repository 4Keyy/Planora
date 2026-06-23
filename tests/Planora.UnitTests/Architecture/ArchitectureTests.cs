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
        ("Planora.Realtime.Domain", typeof(global::Planora.Realtime.Domain.Entities.Notification).Assembly),
        ("Planora.Collaboration.Domain", typeof(global::Planora.Collaboration.Domain.Entities.Comment).Assembly),
    };

    private static readonly (string Name, Assembly Assembly)[] ApplicationAssemblies =
    {
        ("Planora.BuildingBlocks.Application", typeof(global::Planora.BuildingBlocks.Application.Pagination.PaginationParameters).Assembly),
        ("Planora.Auth.Application", typeof(global::Planora.Auth.Application.Common.Mappings.MappingProfile).Assembly),
        ("Planora.Todo.Application", typeof(global::Planora.Todo.Application.DTOs.TodoItemDto).Assembly),
        ("Planora.Category.Application", typeof(global::Planora.Category.Application.Features.IntegrationEvents.UserDeletedEventConsumer).Assembly),
        ("Planora.Messaging.Application", typeof(global::Planora.Messaging.Application.Features.Messages.Mappings.MessageMappingProfile).Assembly),
        ("Planora.Realtime.Application", typeof(global::Planora.Realtime.Application.Handlers.NotificationEventHandler).Assembly),
        ("Planora.Collaboration.Application", typeof(global::Planora.Collaboration.Application.DTOs.CommentDto).Assembly),
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

    // Concrete outer layers an Application project must never reach into:
    // every Infrastructure project (the shared one and each service's) and
    // every Api host project. After the messaging, current-user and outbox
    // contracts were relocated to BuildingBlocks.Application, the shared
    // Infrastructure project itself is now covered by the rule too.
    private static readonly string[] OuterLayerNamespaces =
    {
        "Planora.BuildingBlocks.Infrastructure",
        "Planora.Auth.Infrastructure",
        "Planora.Todo.Infrastructure",
        "Planora.Category.Infrastructure",
        "Planora.Messaging.Infrastructure",
        "Planora.Realtime.Infrastructure",
        "Planora.Collaboration.Infrastructure",
        "Planora.Auth.Api",
        "Planora.Todo.Api",
        "Planora.Category.Api",
        "Planora.Messaging.Api",
        "Planora.Realtime.Api",
        "Planora.Collaboration.Api",
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
    public void Application_layer_must_not_depend_on_infrastructure_or_api()
    {
        var violations = new List<string>();

        foreach (var (name, assembly) in ApplicationAssemblies)
        {
            var result = Types.InAssembly(assembly)
                .Should()
                .NotHaveDependencyOnAny(OuterLayerNamespaces)
                .GetResult();

            if (!result.IsSuccessful)
            {
                violations.Add(
                    $"{name}: {string.Join(", ", result.FailingTypeNames ?? Enumerable.Empty<string>())}");
            }
        }

        Assert.True(
            violations.Count == 0,
            "Application projects must not depend on Infrastructure or Api layers. Violations:" +
            System.Environment.NewLine +
            string.Join(System.Environment.NewLine, violations));
    }

    // Every assembly belonging to one service's bounded context. Cross-service communication is only
    // allowed through the shared contracts (Planora.GrpcContracts) and the shared integration-event /
    // building-block layers (Planora.BuildingBlocks.*) — never by referencing another service directly.
    private static readonly (string Service, Assembly[] Assemblies)[] ServiceContexts =
    {
        ("Auth", new[]
        {
            typeof(global::Planora.Auth.Domain.Entities.User).Assembly,
            typeof(global::Planora.Auth.Application.Common.Mappings.MappingProfile).Assembly,
            typeof(global::Planora.Auth.Infrastructure.DependencyInjection).Assembly,
        }),
        ("Todo", new[]
        {
            typeof(global::Planora.Todo.Domain.Entities.TodoItem).Assembly,
            typeof(global::Planora.Todo.Application.DTOs.TodoItemDto).Assembly,
            typeof(global::Planora.Todo.Infrastructure.DependencyInjection).Assembly,
        }),
        ("Category", new[]
        {
            typeof(global::Planora.Category.Domain.Entities.Category).Assembly,
            typeof(global::Planora.Category.Application.Features.IntegrationEvents.UserDeletedEventConsumer).Assembly,
            typeof(global::Planora.Category.Infrastructure.DependencyInjection).Assembly,
        }),
        ("Messaging", new[]
        {
            typeof(global::Planora.Messaging.Domain.Entities.Message).Assembly,
            typeof(global::Planora.Messaging.Application.Features.Messages.Mappings.MessageMappingProfile).Assembly,
            typeof(global::Planora.Messaging.Infrastructure.DependencyInjection).Assembly,
        }),
        ("Realtime", new[]
        {
            typeof(global::Planora.Realtime.Domain.Entities.Notification).Assembly,
            typeof(global::Planora.Realtime.Application.Handlers.NotificationEventHandler).Assembly,
            typeof(global::Planora.Realtime.Infrastructure.DependencyInjection).Assembly,
        }),
        ("Collaboration", new[]
        {
            typeof(global::Planora.Collaboration.Domain.Entities.Comment).Assembly,
            typeof(global::Planora.Collaboration.Application.DTOs.CommentDto).Assembly,
            typeof(global::Planora.Collaboration.Infrastructure.DependencyInjection).Assembly,
        }),
    };

    private static readonly string[] AllServices =
        { "Auth", "Todo", "Category", "Messaging", "Realtime", "Collaboration" };

    [Fact]
    [Trait("TestType", "Architecture")]
    public void Services_must_not_depend_on_another_services_bounded_context()
    {
        var violations = new List<string>();

        foreach (var (service, assemblies) in ServiceContexts)
        {
            // Forbid references to every OTHER service's root namespace. NetArchTest matches a
            // dependency when its full name starts with the search string; the service names do not
            // prefix-collide (Auth/Todo/Category/Messaging/Realtime/Collaboration), so the bare
            // "Planora.{Service}" root is unambiguous.
            var foreignNamespaces = AllServices
                .Where(other => other != service)
                .Select(other => $"Planora.{other}")
                .ToArray();

            foreach (var assembly in assemblies)
            {
                var result = Types.InAssembly(assembly)
                    .Should()
                    .NotHaveDependencyOnAny(foreignNamespaces)
                    .GetResult();

                if (!result.IsSuccessful)
                {
                    violations.Add(
                        $"{assembly.GetName().Name}: {string.Join(", ", result.FailingTypeNames ?? Enumerable.Empty<string>())}");
                }
            }
        }

        Assert.True(
            violations.Count == 0,
            "Bounded-context isolation violated: a service references another service directly. " +
            "Cross-service communication must go through Planora.GrpcContracts (synchronous) or shared " +
            "integration events in Planora.BuildingBlocks (asynchronous). Violations:" +
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
