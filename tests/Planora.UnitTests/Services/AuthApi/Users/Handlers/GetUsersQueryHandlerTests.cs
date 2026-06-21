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
    public async Task Handle_ShouldTranslateQueryIntoFilterAndPageResult()
    {
        UserListFilter? captured = null;
        var users = new[]
        {
            CreateUser("alice@example.com", "Alice", "Zephyr"),
            CreateUser("alex@example.com", "Alex", "Anderson")
        };
        var repository = new Mock<IUserRepository>();
        repository
            .Setup(x => x.GetPagedAsync(It.IsAny<UserListFilter>(), It.IsAny<CancellationToken>()))
            .Callback<UserListFilter, CancellationToken>((f, _) => captured = f)
            .ReturnsAsync(((IReadOnlyList<User>)users.ToList(), 5));

        var handler = new GetUsersQueryHandler(repository.Object, CreateMapper(), Mock.Of<ILogger<GetUsersQueryHandler>>());

        var result = await handler.Handle(
            new GetUsersQuery
            {
                Status = "Active",
                SearchTerm = "al",
                OrderBy = "email",
                Ascending = true,
                PageNumber = 2,
                PageSize = 2
            },
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // The filter handed to the repository mirrors the query (DB does the work now).
        Assert.NotNull(captured);
        Assert.Equal(UserStatus.Active, captured!.Status);
        Assert.Equal("al", captured.SearchTerm);
        Assert.Equal("email", captured.OrderBy);
        Assert.True(captured.Ascending);
        Assert.Equal(2, captured.PageNumber);
        Assert.Equal(2, captured.PageSize);
        // The repository's TotalCount is surfaced, and items are mapped to DTOs.
        Assert.Equal(5, result.Value!.TotalCount);
        Assert.Equal(2, result.Value.Items.Count);
        Assert.Equal("alice@example.com", result.Value.Items.First().Email);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Module")]
    public async Task Handle_ShouldLeaveStatusNullWhenUnparseable()
    {
        UserListFilter? captured = null;
        var repository = new Mock<IUserRepository>();
        repository
            .Setup(x => x.GetPagedAsync(It.IsAny<UserListFilter>(), It.IsAny<CancellationToken>()))
            .Callback<UserListFilter, CancellationToken>((f, _) => captured = f)
            .ReturnsAsync(((IReadOnlyList<User>)new List<User>(), 0));
        var handler = new GetUsersQueryHandler(repository.Object, CreateMapper(), Mock.Of<ILogger<GetUsersQueryHandler>>());

        var result = await handler.Handle(new GetUsersQuery { Status = "not-a-status" }, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(captured);
        Assert.Null(captured!.Status);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task Handle_ShouldReturnFailureWhenRepositoryThrows()
    {
        var repository = new Mock<IUserRepository>();
        repository
            .Setup(x => x.GetPagedAsync(It.IsAny<UserListFilter>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database unavailable"));
        var handler = new GetUsersQueryHandler(
            repository.Object,
            CreateMapper(),
            Mock.Of<ILogger<GetUsersQueryHandler>>());

        var result = await handler.Handle(new GetUsersQuery(), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("GET_USERS_ERROR", result.Error!.Code);
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

    private static User CreateUser(string email, string firstName, string lastName)
    {
        var user = User.Create(Email.Create(email), "hashed-password", firstName, lastName);
        user.ClearDomainEvents();
        return user;
    }
}
