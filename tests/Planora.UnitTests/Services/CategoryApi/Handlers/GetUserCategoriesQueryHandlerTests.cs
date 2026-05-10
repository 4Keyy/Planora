using System.Linq.Expressions;
using AutoMapper;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Queries.GetUserCategories;
using Microsoft.Extensions.Logging;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.Services.CategoryApi.Handlers;

public sealed class GetUserCategoriesQueryHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldUseExplicitUserFilterDeletedCategoriesSortAndMapDtos()
    {
        var requestedUserId = Guid.NewGuid();
        var currentUserId = Guid.NewGuid();
        var ownedLate = CategoryEntity.Create(requestedUserId, "Later", null, "#111111", "late", 20);
        var ownedFirst = CategoryEntity.Create(requestedUserId, "First", null, "#222222", "first", 1);
        var deleted = CategoryEntity.Create(requestedUserId, "Deleted", null, "#333333", "deleted", 0);
        deleted.MarkAsDeleted(requestedUserId);
        var foreign = CategoryEntity.Create(Guid.NewGuid(), "Foreign", null, "#444444", "foreign", 2);
        var fixture = new Fixture(currentUserId);
        fixture.Repository
            .Setup(x => x.FindAsync(
                It.IsAny<Expression<Func<CategoryEntity, bool>>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Expression<Func<CategoryEntity, bool>> predicate, CancellationToken _) =>
                new[] { ownedLate, deleted, foreign, ownedFirst }
                    .Where(predicate.Compile())
                    .ToList());

        var result = await fixture.CreateHandler().Handle(
            new GetUserCategoriesQuery(requestedUserId),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(new[] { "First", "Later" }, result.Value!.Select(category => category.Name));
        Assert.All(result.Value, category => Assert.Equal(requestedUserId, category.UserId));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldFallBackToCurrentUserAndReturnAuthRequired_WhenMissing()
    {
        var currentUserId = Guid.NewGuid();
        var category = CategoryEntity.Create(currentUserId, "Inbox", null, "#123456", "inbox", 0);
        var fixture = new Fixture(currentUserId);
        fixture.Repository
            .Setup(x => x.FindAsync(
                It.IsAny<Expression<Func<CategoryEntity, bool>>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Expression<Func<CategoryEntity, bool>> predicate, CancellationToken _) =>
                new[] { category }.Where(predicate.Compile()).ToList());

        var success = await fixture.CreateHandler().Handle(new GetUserCategoriesQuery(), CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.Equal("Inbox", Assert.Single(success.Value!).Name);

        var missingUser = new Fixture(Guid.Empty);
        var authRequired = await missingUser.CreateHandler().Handle(new GetUserCategoriesQuery(), CancellationToken.None);

        Assert.True(authRequired.IsFailure);
        Assert.Equal("AUTH_REQUIRED", authRequired.Error!.Code);
        missingUser.Repository.Verify(
            x => x.FindAsync(It.IsAny<Expression<Func<CategoryEntity, bool>>>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnQueryFailed_WhenRepositoryThrows()
    {
        var fixture = new Fixture(Guid.NewGuid());
        fixture.Repository
            .Setup(x => x.FindAsync(
                It.IsAny<Expression<Func<CategoryEntity, bool>>>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database unavailable"));

        var result = await fixture.CreateHandler().Handle(new GetUserCategoriesQuery(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("QUERY_FAILED", result.Error!.Code);
        Assert.Equal("database unavailable", result.Error.Message);
    }

    private sealed class Fixture
    {
        public Fixture(Guid currentUserId)
        {
            CurrentUserContext.SetupGet(x => x.UserId).Returns(currentUserId);
            Mapper
                .Setup(x => x.Map<CategoryDto>(It.IsAny<CategoryEntity>()))
                .Returns((CategoryEntity source) => new CategoryDto
                {
                    Id = source.Id,
                    UserId = source.UserId,
                    Name = source.Name,
                    Description = source.Description,
                    Color = source.Color,
                    Icon = source.Icon,
                    DisplayOrder = source.Order,
                    CreatedAt = source.CreatedAt,
                    UpdatedAt = source.UpdatedAt
                });
        }

        public Mock<IRepository<CategoryEntity>> Repository { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        public Mock<ICurrentUserContext> CurrentUserContext { get; } = new();

        public GetUserCategoriesQueryHandler CreateHandler()
            => new(
                Repository.Object,
                Mapper.Object,
                Mock.Of<ILogger<GetUserCategoriesQueryHandler>>(),
                CurrentUserContext.Object);
    }
}
