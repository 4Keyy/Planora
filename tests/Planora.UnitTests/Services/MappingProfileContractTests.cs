using AutoMapper;
using Planora.Category.Application.DTOs;
using Planora.Category.Application.Features.Categories.Mappings;
using Planora.Messaging.Application.DTOs;
using Planora.Messaging.Application.Features.Messages.Mappings;
using Planora.Messaging.Domain.Entities;
using Microsoft.Extensions.Logging.Abstractions;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.Services;

public sealed class MappingProfileContractTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void CategoryMappingProfile_ShouldMapDomainEntityToDto()
    {
        var mapper = CreateMapper(new CategoryMappingProfile());
        var ownerId = Guid.NewGuid();
        var category = CategoryEntity.Create(ownerId, "Work", "Projects", "#007BFF", "briefcase", 7);

        var dto = mapper.Map<CategoryDto>(category);

        Assert.Equal(category.Id, dto.Id);
        Assert.Equal(ownerId, dto.UserId);
        Assert.Equal("Work", dto.Name);
        Assert.Equal("Projects", dto.Description);
        Assert.Equal("#007BFF", dto.Color);
        Assert.Equal("briefcase", dto.Icon);
        Assert.Equal(7, dto.DisplayOrder);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void MessageMappingProfile_ShouldMapDomainEntityToDto()
    {
        var mapper = CreateMapper(new MessageMappingProfile());
        var senderId = Guid.NewGuid();
        var recipientId = Guid.NewGuid();
        var message = new Message("Subject", "Body", senderId, recipientId);
        message.MarkAsRead();
        message.Archive();

        var dto = mapper.Map<MessageDto>(message);

        Assert.Equal(message.Id, dto.Id);
        Assert.Equal("Subject", dto.Subject);
        Assert.Equal("Body", dto.Body);
        Assert.Equal(senderId, dto.SenderId);
        Assert.Equal(recipientId, dto.RecipientId);
        Assert.NotNull(dto.ReadAt);
        Assert.True(dto.IsArchived);
    }

    private static IMapper CreateMapper(Profile profile)
    {
        var configuration = new MapperConfiguration(cfg => cfg.AddProfile(profile), NullLoggerFactory.Instance);
        configuration.AssertConfigurationIsValid();
        return configuration.CreateMapper();
    }
}
