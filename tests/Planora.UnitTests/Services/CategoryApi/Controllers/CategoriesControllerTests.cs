using Planora.Category.Api.Controllers;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Commands.CreateCategory;
using Planora.Category.Application.Features.Categories.Commands.DeleteCategory;
using Planora.Category.Application.Features.Categories.Commands.UpdateCategory;
using Planora.Category.Application.Features.Categories.Queries.GetUserCategories;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using ApplicationResult = Planora.BuildingBlocks.Application.Models.Result;
using CategoryListResult = Planora.BuildingBlocks.Application.Models.Result<System.Collections.Generic.IReadOnlyList<Planora.Category.Application.DTOs.CategoryDto>>;
using CategoryResult = Planora.BuildingBlocks.Application.Models.Result<Planora.Category.Application.DTOs.CategoryDto>;

namespace Planora.UnitTests.Services.CategoryApi.Controllers;

public class CategoriesControllerTests
{
    [Fact]
    public async Task GetCategories_SendsCurrentUserQuery_AndReturnsResultEnvelope()
    {
        var mediator = new Mock<IMediator>();
        GetUserCategoriesQuery? sentQuery = null;
        var categories = new List<CategoryDto> { CategoryDto("Work") };
        var result = ApplicationResult.Success<IReadOnlyList<CategoryDto>>(categories);
        mediator
            .Setup(x => x.Send(It.IsAny<GetUserCategoriesQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<CategoryListResult>, CancellationToken>((query, _) => sentQuery = (GetUserCategoriesQuery)query)
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        var actionResult = await controller.GetCategories(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(actionResult.Result);
        Assert.Same(result, ok.Value);
        Assert.NotNull(sentQuery);
        Assert.Null(sentQuery.UserId);
    }

    [Fact]
    public async Task CreateCategory_StripsUserId_AndReturnsCreatedAtCategories()
    {
        var mediator = new Mock<IMediator>();
        CreateCategoryCommand? sentCommand = null;
        var result = ApplicationResult.Success(CategoryDto("Inbox"));
        mediator
            .Setup(x => x.Send(It.IsAny<CreateCategoryCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<CategoryResult>, CancellationToken>((command, _) => sentCommand = (CreateCategoryCommand)command)
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        var actionResult = await controller.CreateCategory(
            new CreateCategoryCommand(Guid.NewGuid(), "Inbox", "desc", "#111111", "Folder", 7),
            CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(actionResult.Result);
        Assert.Equal(nameof(CategoriesController.GetCategories), created.ActionName);
        Assert.Same(result, created.Value);
        Assert.NotNull(sentCommand);
        Assert.Null(sentCommand.UserId);
        Assert.Equal("Inbox", sentCommand.Name);
        Assert.Equal(7, sentCommand.DisplayOrder);
    }

    [Fact]
    public async Task UpdateCategory_UsesRouteId_AndReturnsMediatorResult()
    {
        var mediator = new Mock<IMediator>();
        UpdateCategoryCommand? sentCommand = null;
        var categoryId = Guid.NewGuid();
        var result = ApplicationResult.Success(CategoryDto("Updated"));
        mediator
            .Setup(x => x.Send(It.IsAny<UpdateCategoryCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<CategoryResult>, CancellationToken>((command, _) => sentCommand = (UpdateCategoryCommand)command)
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        var actionResult = await controller.UpdateCategory(
            categoryId,
            new UpdateCategoryCommand(Guid.NewGuid(), Name: "Updated"),
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(actionResult.Result);
        Assert.Same(result, ok.Value);
        Assert.NotNull(sentCommand);
        Assert.Equal(categoryId, sentCommand.CategoryId);
        Assert.Equal("Updated", sentCommand.Name);
    }

    [Fact]
    public async Task DeleteCategory_MapsSuccessAndFailureCodes()
    {
        var categoryId = Guid.NewGuid();

        var notFound = await DeleteWithResult(categoryId, ApplicationResult.Failure("CATEGORY_NOT_FOUND", "Missing"));
        Assert.IsType<NotFoundObjectResult>(notFound);

        var forbidden = await DeleteWithResult(categoryId, ApplicationResult.Failure("FORBIDDEN", "Denied"));
        Assert.IsType<ForbidResult>(forbidden);

        var invalid = await DeleteWithResult(categoryId, ApplicationResult.Failure("VALIDATION_ERROR", "Invalid"));
        Assert.IsType<BadRequestObjectResult>(invalid);

        var success = await DeleteWithResult(categoryId, ApplicationResult.Success());
        Assert.IsType<NoContentResult>(success);
    }

    private static async Task<IActionResult> DeleteWithResult(Guid categoryId, ApplicationResult result)
    {
        var mediator = new Mock<IMediator>();
        DeleteCategoryCommand? sentCommand = null;
        mediator
            .Setup(x => x.Send(It.IsAny<DeleteCategoryCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<ApplicationResult>, CancellationToken>((command, _) => sentCommand = (DeleteCategoryCommand)command)
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        var actionResult = await controller.DeleteCategory(categoryId, CancellationToken.None);

        Assert.NotNull(sentCommand);
        Assert.Equal(categoryId, sentCommand.CategoryId);
        return actionResult;
    }

    private static CategoriesController CreateController(Mock<IMediator> mediator)
        => new(
            mediator.Object,
            new Mock<ILogger<CategoriesController>>().Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

    private static CategoryDto CategoryDto(string name) => new()
    {
        Id = Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        Name = name,
        Color = "#111111",
        DisplayOrder = 0,
        CreatedAt = DateTime.UtcNow
    };
}
