using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Features.Users.Handlers.GetUsers;
using Planora.Auth.Application.Features.Users.Queries.GetUsers;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Users.Handlers;

public class GetUsersQueryHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldFilterSearchDateSortAndPageUsers()
    {
        var users = new[]
        {
            CreateUser("alice@example.com", "Alice", "Zephyr", active: true),
            CreateUser("bob@example.com", "Bob", "Yellow", active: false),
            CreateUser("alex@example.com", "Alex", "Anderson", active: true)
        };
        var handler = CreateHandler(users);

        var result = await handler.Handle(
            new GetUsersQuery
            {
                Status = "Active",
                SearchTerm = "al",
                CreatedFrom = DateTime.UtcNow.AddMinutes(-10),
                CreatedTo = DateTime.UtcNow.AddMinutes(10),
                OrderBy = "email",
                Ascending = true,
                PageNumber = 2,
                PageSize = 1
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value!.TotalCount);
        Assert.Equal(2, result.Value.PageNumber);
        Assert.Equal(1, result.Value.PageSize);
        Assert.Single(result.Value.Items);
        Assert.Equal("alice@example.com", result.Value.Items.Single().Email);
    }

    [Theory]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Module")]
    [InlineData("email", true, "amy@example.com")]
    [InlineData("firstname", false, "zoe@example.com")]
    [InlineData("lastname", true, "amy@example.com")]
    [InlineData(null, false, "amy@example.com")]
    public async Task Handle_ShouldSupportAllOrderingModes(string? orderBy, bool ascending, string expectedFirstEmail)
    {
        var users = new[]
        {
            CreateUser("zoe@example.com", "Zoe", "Zimmer", active: true),
            CreateUser("amy@example.com", "Amy", "Alpha", active: true)
        };
        var handler = CreateHandler(users);

        var result = await handler.Handle(
            new GetUsersQuery
            {
                OrderBy = orderBy,
                Ascending = ascending,
                PageNumber = 1,
                PageSize = 10
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(expectedFirstEmail, result.Value!.Items.First().Email);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnFailureWhenRepositoryThrows()
    {
        var repository = new Mock<IUserRepository>();
        repository
            .Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database unavailable"));
        var handler = new GetUsersQueryHandler(
            repository.Object,
            CreateMapper(),
            Mock.Of<ILogger<GetUsersQueryHandler>>());

        var result = await handler.Handle(new GetUsersQuery(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("GET_USERS_ERROR", result.Error!.Code);
    }

    private static GetUsersQueryHandler CreateHandler(IEnumerable<User> users)
    {
        var repository = new Mock<IUserRepository>();
        repository
            .Setup(x => x.GetAllAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(users.ToList());

        return new GetUsersQueryHandler(
            repository.Object,
            CreateMapper(),
            Mock.Of<ILogger<GetUsersQueryHandler>>());
    }

    private static IMapper CreateMapper()
    {
        var mapper = new Mock<IMapper>();
        mapper
            .Setup(x => x.Map<List<UserListDto>>(It.IsAny<List<User>>()))
            .Returns((List<User> source) => source.Select(user => new UserListDto
            {
                Id = user.Id,
                Email = user.Email.Value,
                FirstName = user.FirstName,
                LastName = user.LastName,
                Status = user.Status.ToString(),
                LastLoginAt = user.LastLoginAt,
                CreatedAt = user.CreatedAt
            }).ToList());

        return mapper.Object;
    }

    private static User CreateUser(string email, string firstName, string lastName, bool active)
    {
        var user = User.Create(Email.Create(email), "hashed-password", firstName, lastName);
        user.ClearDomainEvents();

        if (active)
        {
            user.VerifyEmail();
            user.ClearDomainEvents();
        }

        return user;
    }
}
