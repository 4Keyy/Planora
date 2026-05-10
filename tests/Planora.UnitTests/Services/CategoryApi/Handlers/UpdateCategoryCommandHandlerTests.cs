using AutoMapper;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Commands.UpdateCategory;
using Microsoft.Extensions.Logging;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.Services.CategoryApi.Handlers;

public class UpdateCategoryCommandHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldUpdateOwnedCategoryAndPersist()
    {
        var userId = Guid.NewGuid();
        var category = CategoryEntity.Create(userId, "Inbox", "old", "#111111", "inbox", 1);
        var fixture = new Fixture(userId);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(category.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(category);

        var result = await fixture.CreateHandler().Handle(
            new UpdateCategoryCommand(category.Id, "Work", "deep work", "#22AA33", "briefcase", 4),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Work", category.Name);
        Assert.Equal("deep work", category.Description);
        Assert.Equal("#22AA33", category.Color);
        Assert.Equal("briefcase", category.Icon);
        Assert.Equal(4, category.Order);
        Assert.Equal("Work", result.Value!.Name);
        fixture.Repository.Verify(x => x.Update(category), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldUpdateIconWithoutChangingColor()
    {
        var userId = Guid.NewGuid();
        var category = CategoryEntity.Create(userId, "Inbox", null, "#123456", "old", 1);
        var fixture = new Fixture(userId);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(category.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(category);

        var result = await fixture.CreateHandler().Handle(
            new UpdateCategoryCommand(category.Id, Icon: "new-icon"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("#123456", category.Color);
        Assert.Equal("new-icon", category.Icon);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldRejectMissingOrForeignCategoryBeforeMutating()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new Fixture(userId);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(categoryId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CategoryEntity?)null);

        var missing = await fixture.CreateHandler().Handle(
            new UpdateCategoryCommand(categoryId, "New name"),
            CancellationToken.None);
        Assert.Equal("CATEGORY_NOT_FOUND", missing.Error!.Code);

        var foreign = CategoryEntity.Create(Guid.NewGuid(), "Foreign", null, "#ABCDEF", null, 0);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(foreign.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreign);

        var forbidden = await fixture.CreateHandler().Handle(
            new UpdateCategoryCommand(foreign.Id, "Hacked"),
            CancellationToken.None);

        Assert.Equal("FORBIDDEN", forbidden.Error!.Code);
        Assert.Equal("Foreign", foreign.Name);
        fixture.Repository.Verify(x => x.Update(It.IsAny<CategoryEntity>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnUpdateFailedWhenDomainOrPersistenceFails()
    {
        var userId = Guid.NewGuid();
        var category = CategoryEntity.Create(userId, "Inbox", null, "#123456", null, 0);
        var fixture = new Fixture(userId);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(category.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(category);

        var invalidOrder = await fixture.CreateHandler().Handle(
            new UpdateCategoryCommand(category.Id, DisplayOrder: -1),
            CancellationToken.None);

        Assert.True(invalidOrder.IsFailure);
        Assert.Equal("UPDATE_FAILED", invalidOrder.Error!.Code);
    }

    private sealed class Fixture
    {
        public Fixture(Guid userId)
        {
            CurrentUserContext.SetupGet(x => x.UserId).Returns(userId);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
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
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        public Mock<ICurrentUserContext> CurrentUserContext { get; } = new();

        public UpdateCategoryCommandHandler CreateHandler()
        {
            return new UpdateCategoryCommandHandler(
                Repository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<UpdateCategoryCommandHandler>>(),
                CurrentUserContext.Object);
        }
    }
}
