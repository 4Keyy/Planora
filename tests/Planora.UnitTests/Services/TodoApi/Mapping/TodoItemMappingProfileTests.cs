using AutoMapper;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Microsoft.Extensions.Logging.Abstractions;

namespace Planora.UnitTests.Services.TodoApi.Mapping;

public sealed class TodoItemMappingProfileTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void TodoItemMappingProfile_ShouldMapDomainStateTagsTimingAndShares()
    {
        var configuration = new MapperConfiguration(
            cfg => cfg.AddProfile<TodoItemMappingProfile>(),
            NullLoggerFactory.Instance);
        var mapper = configuration.CreateMapper();
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var sharedUserIds = new[] { Guid.NewGuid(), Guid.NewGuid(), userId, Guid.Empty, Guid.NewGuid() };
        var expectedDate = DateTime.UtcNow.AddDays(-1);
        var actualDate = DateTime.UtcNow;
        var todo = TodoItem.Create(
            userId,
            "  Mapping target  ",
            "  Description  ",
            categoryId,
            expectedDate: expectedDate,
            priority: TodoPriority.VeryLow,
            isPublic: true,
            sharedWithUserIds: sharedUserIds);
        todo.AddTag("work", userId);
        todo.AddTag("urgent", userId);
        todo.SetHidden(true, userId);
        todo.UpdateActualDate(actualDate, userId);

        var dto = mapper.Map<TodoItemDto>(todo);

        Assert.Equal(todo.Id, dto.Id);
        Assert.Equal(userId, dto.UserId);
        Assert.Equal("Mapping target", dto.Title);
        Assert.Equal("Description", dto.Description);
        Assert.Equal("Done", dto.Status);
        Assert.Equal(categoryId, dto.CategoryId);
        Assert.Equal(TodoPriority.VeryLow.ToString(), dto.Priority);
        Assert.True(dto.IsPublic);
        Assert.True(dto.Hidden);
        Assert.True(dto.IsCompleted);
        Assert.False(dto.IsOnTime);
        Assert.True(dto.Delay > TimeSpan.Zero);
        Assert.Equal(new[] { "work", "urgent" }, dto.Tags);
        Assert.Equal(sharedUserIds.Where(id => id != userId && id != Guid.Empty).Distinct(), dto.SharedWithUserIds);
    }
}
