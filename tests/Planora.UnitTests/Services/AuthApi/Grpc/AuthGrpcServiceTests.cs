using Grpc.Core;
using Planora.Auth.Api.Grpc;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
using Planora.Auth.Application.Features.Friendships.Queries.AreFriends;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
using Planora.BuildingBlocks.Application.Models;
using Planora.GrpcContracts;
using MediatR;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Planora.UnitTests.Services.AuthApi.Grpc;

public class AuthGrpcServiceTests
{
    private readonly Mock<IMediator> _mediatorMock;
    private readonly Mock<ILogger<AuthGrpcService>> _loggerMock;
    private readonly AuthGrpcService _service;

    public AuthGrpcServiceTests()
    {
        _mediatorMock = new Mock<IMediator>();
        _loggerMock = new Mock<ILogger<AuthGrpcService>>();
        _service = new AuthGrpcService(_mediatorMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task ValidateToken_ShouldReturnValidResponse_WhenTokenIsValid()
    {
        // Arrange
        var token = "valid-token";
        var request = new ValidateTokenRequest { Token = token };
        var context = new Mock<ServerCallContext>();

        var userId = Guid.NewGuid();
        var email = "test@example.com";
        var roles = new List<string> { "User", "Admin" };

        var expectedResult = new TokenValidationDto
        {
            IsValid = true,
            UserId = userId,
            Email = email,
            Roles = roles
        };

        _mediatorMock.Setup(m => m.Send(It.Is<ValidateTokenQuery>(q => q.Token == token), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(expectedResult));

        // Act
        var response = await _service.ValidateToken(request, context.Object);

        // Assert
        Assert.True(response.IsValid);
        Assert.Equal(userId.ToString(), response.UserId);
        Assert.Equal(email, response.Email);
        Assert.Equal(roles, response.Roles);
    }

    [Fact]
    public async Task ValidateToken_ShouldReturnInvalidResponse_WhenTokenIsInvalid()
    {
        // Arrange
        var token = "invalid-token";
        var request = new ValidateTokenRequest { Token = token };
        var context = new Mock<ServerCallContext>();

        _mediatorMock.Setup(m => m.Send(It.Is<ValidateTokenQuery>(q => q.Token == token), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<TokenValidationDto>(Error.Unauthorized("Token.Invalid", "Invalid token")));

        // Act
        var response = await _service.ValidateToken(request, context.Object);

        // Assert
        Assert.False(response.IsValid);
        Assert.Equal("Invalid token", response.ErrorMessage);
        Assert.Empty(response.UserId);
        Assert.Empty(response.Email);
    }

    [Fact]
    public async Task ValidateToken_ShouldReturnInvalidResponse_WhenHandlerReturnsInvalidDto()
    {
        // Arrange
        var token = "expired-token";
        var request = new ValidateTokenRequest { Token = token };
        var context = new Mock<ServerCallContext>();

        _mediatorMock.Setup(m => m.Send(It.Is<ValidateTokenQuery>(q => q.Token == token), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new TokenValidationDto
            {
                IsValid = false,
                Message = "Token is invalid or expired"
            }));

        // Act
        var response = await _service.ValidateToken(request, context.Object);

        // Assert
        Assert.False(response.IsValid);
        Assert.Equal("Token is invalid or expired", response.ErrorMessage);
        Assert.Empty(response.UserId);
        Assert.Empty(response.Email);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task GetUserInfo_ShouldMapUserDetailsOrThrowNotFound()
    {
        var userId = Guid.NewGuid();
        _mediatorMock
            .Setup(m => m.Send(It.Is<GetUserQuery>(q => q.UserId == userId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new UserDetailDto
            {
                Id = userId,
                Email = "user@example.com",
                FirstName = "Ada",
                LastName = "Lovelace"
            }));

        var response = await _service.GetUserInfo(
            new GetUserInfoRequest { UserId = userId.ToString() },
            Mock.Of<ServerCallContext>());

        Assert.Equal(userId.ToString(), response.UserId);
        Assert.Equal("user@example.com", response.Email);
        Assert.Equal("Ada", response.FirstName);
        Assert.Equal("Lovelace", response.LastName);
        Assert.True(response.IsActive);

        var missingId = Guid.NewGuid();
        _mediatorMock
            .Setup(m => m.Send(It.Is<GetUserQuery>(q => q.UserId == missingId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<UserDetailDto>(Error.NotFound("USER_NOT_FOUND", "missing")));

        var ex = await Assert.ThrowsAsync<RpcException>(() => _service.GetUserInfo(
            new GetUserInfoRequest { UserId = missingId.ToString() },
            Mock.Of<ServerCallContext>()));
        Assert.Equal(StatusCode.NotFound, ex.StatusCode);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task RevokeToken_ShouldMapLogoutResult()
    {
        _mediatorMock
            .SetupSequence(m => m.Send(It.IsAny<LogoutCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success())
            .ReturnsAsync(Result.Failure(Error.Unauthorized("LOGOUT_FAILED", "logout failed")));

        var success = await _service.RevokeToken(
            new RevokeTokenRequest { Token = "refresh-token" },
            Mock.Of<ServerCallContext>());
        var failure = await _service.RevokeToken(
            new RevokeTokenRequest { Token = "refresh-token" },
            Mock.Of<ServerCallContext>());

        Assert.True(success.Success);
        Assert.Equal("Token revoked", success.Message);
        Assert.False(failure.Success);
        Assert.Equal("logout failed", failure.Message);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task GetFriendIds_ShouldMapIdsOrThrowInternal()
    {
        var userId = Guid.NewGuid();
        var friendIds = new List<Guid> { Guid.NewGuid(), Guid.NewGuid() };
        _mediatorMock
            .Setup(m => m.Send(It.Is<GetFriendIdsQuery>(q => q.UserId == userId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(friendIds));

        var response = await _service.GetFriendIds(
            new GetFriendIdsRequest { UserId = userId.ToString() },
            Mock.Of<ServerCallContext>());

        Assert.Equal(friendIds.Select(id => id.ToString()), response.FriendIds);

        var failedUserId = Guid.NewGuid();
        _mediatorMock
            .Setup(m => m.Send(It.Is<GetFriendIdsQuery>(q => q.UserId == failedUserId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<List<Guid>>(Error.InternalServer("FRIENDS_FAILED", "friends failed")));

        var ex = await Assert.ThrowsAsync<RpcException>(() => _service.GetFriendIds(
            new GetFriendIdsRequest { UserId = failedUserId.ToString() },
            Mock.Of<ServerCallContext>()));
        Assert.Equal(StatusCode.Internal, ex.StatusCode);
        Assert.Equal("friends failed", ex.Status.Detail);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AreFriends_ShouldMapResultOrThrowInternal()
    {
        var userId1 = Guid.NewGuid();
        var userId2 = Guid.NewGuid();
        _mediatorMock
            .Setup(m => m.Send(It.Is<AreFriendsQuery>(q => q.UserId1 == userId1 && q.UserId2 == userId2), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(true));

        var response = await _service.AreFriends(
            new AreFriendsRequest { UserId1 = userId1.ToString(), UserId2 = userId2.ToString() },
            Mock.Of<ServerCallContext>());

        Assert.True(response.AreFriends);

        var failedUserId = Guid.NewGuid();
        _mediatorMock
            .Setup(m => m.Send(It.Is<AreFriendsQuery>(q => q.UserId1 == failedUserId), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<bool>(Error.InternalServer("CHECK_FAILED", "check failed")));

        var ex = await Assert.ThrowsAsync<RpcException>(() => _service.AreFriends(
            new AreFriendsRequest { UserId1 = failedUserId.ToString(), UserId2 = userId2.ToString() },
            Mock.Of<ServerCallContext>()));
        Assert.Equal(StatusCode.Internal, ex.StatusCode);
        Assert.Equal("check failed", ex.Status.Detail);
    }
}
