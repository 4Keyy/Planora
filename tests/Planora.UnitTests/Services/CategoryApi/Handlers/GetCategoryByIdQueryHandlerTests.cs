using AutoMapper;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Queries.GetCategoryById;
using Planora.Category.Domain.Repositories;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.Services.CategoryApi.Handlers;

public sealed class GetCategoryByIdQueryHandlerTests
{
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnAuthRequired_WhenUserContextMissing()
    {
        var fixture = new Fixture(Guid.Empty);

        var result = await fixture.CreateHandler().Handle(
            new GetCategoryByIdQuery(Guid.NewGuid()),
            CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_REQUIRED", result.Error!.Code);
        fixture.Repository.Verify(
            x => x.GetByIdAndUserIdAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldUseExplicitOrCurrentUserReturnMappedCategoryOrNotFound()
    {
        var currentUserId = Guid.NewGuid();
        var explicitUserId = Guid.NewGuid();
        var category = CategoryEntity.Create(explicitUserId, "Inbox", null, "#123456", "inbox", 0);
        var fixture = new Fixture(currentUserId);
        fixture.Repository
            .Setup(x => x.GetByIdAndUserIdAsync(category.Id, explicitUserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(category);
        fixture.Repository
            .Setup(x => x.GetByIdAndUserIdAsync(It.Is<Guid>(id => id != category.Id), currentUserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CategoryEntity?)null);

        var found = await fixture.CreateHandler().Handle(
            new GetCategoryByIdQuery(category.Id, explicitUserId),
            CancellationToken.None);
        var missingId = Guid.NewGuid();
        var missing = await fixture.CreateHandler().Handle(
            new GetCategoryByIdQuery(missingId),
            CancellationToken.None);

        Assert.True(found.IsSuccess);
        Assert.Equal("Inbox", found.Value!.Name);
        Assert.Equal(explicitUserId, found.Value.UserId);
        Assert.True(missing.IsFailure);
        Assert.Equal("CATEGORY_NOT_FOUND", missing.Error!.Code);
        Assert.Contains(missingId.ToString(), missing.Error.Message);
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

        public Mock<ICategoryRepository> Repository { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        public Mock<ICurrentUserContext> CurrentUserContext { get; } = new();

        public GetCategoryByIdQueryHandler CreateHandler()
            => new(Repository.Object, Mapper.Object, CurrentUserContext.Object);
    }
}
