using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;
using Role = Planora.Auth.Domain.Entities.Role;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class AuthRoleModelDeterminismTests
{
    private static readonly RoleSeed[] ExpectedRoles =
    [
        new(new Guid("075a45ef-828e-50e7-af6a-7587be5a997b"), "Admin", "System administrator with full access",
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), false, null, null, null, null, null),
        new(new Guid("0a00159e-af48-5e76-a909-55edb8c61fc7"), "User", "Regular user with standard access",
            new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), false, null, null, null, null, null)
    ];

    [Fact]
    public void IndependentNpgsqlDesignTimeModels_HaveIdenticalRoleSeedData()
    {
        using var firstServices = CreateModelServices();
        using var secondServices = CreateModelServices();
        using var first = CreateModelContext(firstServices);
        using var second = CreateModelContext(secondServices);
        var firstModel = first.GetService<IDesignTimeModel>().Model;
        var secondModel = second.GetService<IDesignTimeModel>().Model;

        Assert.NotSame(firstModel, secondModel);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", first.Database.ProviderName);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", second.Database.ProviderName);
        Assert.Equal(ReadSeeds(firstModel), ReadSeeds(secondModel));
    }

    [Fact]
    public void IndependentNpgsqlDesignTimeModels_DoNotGenerateMigrationOperations()
    {
        using var firstServices = CreateModelServices();
        using var secondServices = CreateModelServices();
        using var first = CreateModelContext(firstServices);
        using var second = CreateModelContext(secondServices);
        var firstModel = first.GetService<IDesignTimeModel>().Model;
        var secondModel = second.GetService<IDesignTimeModel>().Model;
        Assert.NotSame(firstModel, secondModel);

        var changes = second.GetService<IMigrationsModelDiffer>().GetDifferences(
            firstModel.GetRelationalModel(), secondModel.GetRelationalModel());

        Assert.Empty(changes);
    }

    [Fact]
    public void RoleSeeds_PreserveRoleNamesDescriptionsAndInactiveAuditFields()
    {
        using var services = CreateModelServices();
        using var context = CreateModelContext(services);
        var model = context.GetService<IDesignTimeModel>().Model;

        Assert.Equal(ExpectedRoles, ReadSeeds(model));
        Assert.NotNull(model.FindEntityType(typeof(Role))!.GetQueryFilter());
    }

    [PostgresFact]
    public async Task FreshPostgresDatabase_CreatesExactlyTheStableRoleRows_AndRerunPreservesThem()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var context = new AuthDbContext(database.Options<AuthDbContext>(), Mock.Of<IDomainEventDispatcher>());

        Assert.True(await context.Database.EnsureCreatedAsync());
        var first = await context.Roles.AsNoTracking().OrderBy(role => role.Name).ToArrayAsync();

        Assert.Equal(ExpectedRoles, first.Select(ReadEntity).ToArray());
        Assert.False(await context.Database.EnsureCreatedAsync());
        var second = await context.Roles.AsNoTracking().OrderBy(role => role.Name).ToArrayAsync();
        Assert.Equal(first.Select(ReadEntity), second.Select(ReadEntity));
    }

    // Separate internal providers prevent EF's model cache from turning independent builds into one shared model.
    private static ServiceProvider CreateModelServices() => new ServiceCollection()
        .AddEntityFrameworkNpgsql()
        .BuildServiceProvider();

    private static AuthDbContext CreateModelContext(IServiceProvider services) => new(
        new DbContextOptionsBuilder<AuthDbContext>()
            .UseNpgsql()
            .UseInternalServiceProvider(services)
            .Options,
        Mock.Of<IDomainEventDispatcher>());

    private static RoleSeed[] ReadSeeds(IModel model) => model.FindEntityType(typeof(Role))!
        .GetSeedData()
        .OrderBy(seed => (string)seed[nameof(Role.Name)]!)
        .Select(seed => new RoleSeed(
            (Guid)seed[nameof(Role.Id)]!,
            (string)seed[nameof(Role.Name)]!,
            (string?)seed[nameof(Role.Description)],
            (DateTime)seed[nameof(Role.CreatedAt)]!,
            (bool)seed[nameof(Role.IsDeleted)]!,
            (Guid?)Optional(seed, nameof(Role.CreatedBy)),
            (DateTime?)Optional(seed, nameof(Role.UpdatedAt)),
            (Guid?)Optional(seed, nameof(Role.UpdatedBy)),
            (DateTime?)Optional(seed, nameof(Role.DeletedAt)),
            (Guid?)Optional(seed, nameof(Role.DeletedBy))))
        .ToArray();

    private static object? Optional(IDictionary<string, object?> seed, string property) =>
        seed.TryGetValue(property, out var value) ? value : null;

    private static RoleSeed ReadEntity(Role role) => new(role.Id, role.Name, role.Description, role.CreatedAt, role.IsDeleted,
        role.CreatedBy, role.UpdatedAt, role.UpdatedBy, role.DeletedAt, role.DeletedBy);

    private sealed record RoleSeed(Guid Id, string Name, string? Description, DateTime CreatedAt, bool IsDeleted,
        Guid? CreatedBy, DateTime? UpdatedAt, Guid? UpdatedBy, DateTime? DeletedAt, Guid? DeletedBy);
}
