using AutoMapper;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Commands.CreateCategory;
using Planora.Category.Application.Features.Categories.Commands.DeleteCategory;
using Microsoft.Extensions.Logging;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.Services.CategoryApi.Handlers;

public sealed class CreateDeleteCategoryCommandHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateCategory_ShouldUseCurrentUserPersistAndMapDto()
    {
        var userId = Guid.NewGuid();
        var fixture = new Fixture(userId);
        CategoryEntity? created = null;
        fixture.Repository
            .Setup(x => x.AddAsync(It.IsAny<CategoryEntity>(), It.IsAny<CancellationToken>()))
            .Callback<CategoryEntity, CancellationToken>((category, _) => created = category)
            .ReturnsAsync((CategoryEntity category, CancellationToken _) => category);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        var handler = fixture.CreateCreateHandler();

        var result = await handler.Handle(
            new CreateCategoryCommand(Guid.NewGuid(), "Inbox", "default", null, "tray", 3),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(created);
        Assert.Equal(userId, created!.UserId);
        Assert.Equal("Inbox", created.Name);
        Assert.Equal("#000000", created.Color);
        Assert.Equal("Inbox", result.Value!.Name);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CreateCategory_ShouldReturnCreateFailedForDomainOrPersistenceErrors()
    {
        var fixture = new Fixture(Guid.NewGuid());

        var invalidName = await fixture.CreateCreateHandler().Handle(
            new CreateCategoryCommand(null, "", null, "#123456", null, 0),
            CancellationToken.None);

        Assert.True(invalidName.IsFailure);
        Assert.Equal("CREATE_FAILED", invalidName.Error!.Code);

        fixture.Repository
            .Setup(x => x.AddAsync(It.IsAny<CategoryEntity>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("db unavailable"));

        var persistenceFailure = await fixture.CreateCreateHandler().Handle(
            new CreateCategoryCommand(null, "Inbox", null, "#123456", null, 0),
            CancellationToken.None);

        Assert.True(persistenceFailure.IsFailure);
        Assert.Equal("CREATE_FAILED", persistenceFailure.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task DeleteCategory_ShouldRejectMissingOrForeignCategoryBeforeDeleting()
    {
        var userId = Guid.NewGuid();
        var fixture = new Fixture(userId);
        var categoryId = Guid.NewGuid();
        fixture.Repository
            .Setup(x => x.GetByIdAsync(categoryId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CategoryEntity?)null);

        var missing = await fixture.CreateDeleteHandler().Handle(new DeleteCategoryCommand(categoryId), CancellationToken.None);
        Assert.True(missing.IsFailure);
        Assert.Equal("CATEGORY_NOT_FOUND", missing.Error!.Code);

        var foreign = CategoryEntity.Create(Guid.NewGuid(), "Foreign", null, "#123456", null, 0);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(foreign.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreign);

        var forbidden = await fixture.CreateDeleteHandler().Handle(new DeleteCategoryCommand(foreign.Id), CancellationToken.None);

        Assert.True(forbidden.IsFailure);
        Assert.Equal("FORBIDDEN", forbidden.Error!.Code);
        Assert.False(foreign.IsDeleted);
        fixture.Repository.Verify(x => x.Update(It.IsAny<CategoryEntity>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task DeleteCategory_ShouldSoftDeleteOwnedCategoryAndReturnDeleteFailedOnExceptions()
    {
        var userId = Guid.NewGuid();
        var category = CategoryEntity.Create(userId, "Owned", null, "#123456", null, 0);
        var fixture = new Fixture(userId);
        fixture.Repository
            .Setup(x => x.GetByIdAsync(category.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(category);
        fixture.UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);

        var success = await fixture.CreateDeleteHandler().Handle(new DeleteCategoryCommand(category.Id), CancellationToken.None);

        Assert.True(success.IsSuccess);
        Assert.True(category.IsDeleted);
        Assert.Equal(userId, category.DeletedBy);
        fixture.Repository.Verify(x => x.Update(category), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);

        var failingFixture = new Fixture(userId);
        var failingCategory = CategoryEntity.Create(userId, "Failing", null, "#123456", null, 0);
        failingFixture.Repository
            .Setup(x => x.GetByIdAsync(failingCategory.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(failingCategory);
        failingFixture.UnitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("save failed"));

        var failed = await failingFixture.CreateDeleteHandler().Handle(
            new DeleteCategoryCommand(failingCategory.Id),
            CancellationToken.None);

        Assert.True(failed.IsFailure);
        Assert.Equal("DELETE_FAILED", failed.Error!.Code);
    }

    private sealed class Fixture
    {
        public Fixture(Guid userId)
        {
            CurrentUserContext.SetupGet(x => x.UserId).Returns(userId);
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

        public CreateCategoryCommandHandler CreateCreateHandler()
            => new(
                Repository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<CreateCategoryCommandHandler>>(),
                CurrentUserContext.Object);

        public DeleteCategoryCommandHandler CreateDeleteHandler()
            => new(
                Repository.Object,
                UnitOfWork.Object,
                Mock.Of<ILogger<DeleteCategoryCommandHandler>>(),
                CurrentUserContext.Object);
    }
}
