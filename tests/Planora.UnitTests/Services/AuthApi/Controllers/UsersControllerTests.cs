using Planora.Auth.Api.Controllers;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Features.Users.Commands.ChangeEmail;
using Planora.Auth.Application.Features.Users.Commands.ChangePassword;
using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;
using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.Auth.Application.Features.Users.Commands.Disable2FA;
using Planora.Auth.Application.Features.Users.Commands.Enable2FA;
using Planora.Auth.Application.Features.Users.Commands.ResendEmailVerification;
using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;
using Planora.Auth.Application.Features.Users.Commands.RevokeSession;
using Planora.Auth.Application.Features.Users.Commands.UpdateUser;
using Planora.Auth.Application.Features.Users.Commands.VerifyEmail;
using Planora.Auth.Application.Features.Users.Queries.GetCurrentUser;
using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
using Planora.Auth.Application.Features.Users.Queries.GetUsers;
using Planora.Auth.Application.Features.Users.Queries.GetUserSecurity;
using Planora.Auth.Application.Features.Users.Queries.GetUserSessions;
using Planora.Auth.Application.Features.Users.Queries.GetUserStatistics;
using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Pagination;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Controllers;

public class UsersControllerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task QueryEndpoints_MapMediatorResultsToHttpResponses()
    {
        var mediator = new Mock<IMediator>();
        var userId = Guid.NewGuid();
        var users = new PagedResult<UserListDto>(new[] { new UserListDto { Id = userId, Email = "user@example.com" } }, 1, 10, 1);
        var sessions = new List<SessionDto> { new() { Id = Guid.NewGuid(), DeviceName = "Chrome" } };
        var loginHistory = new PagedResult<LoginHistoryPagedDto>(new[] { new LoginHistoryPagedDto { Id = Guid.NewGuid() } }, 1, 10, 1);
        var statistics = new UserStatisticsDto { TotalUsers = 3, ActiveUsers = 2 };

        GetUserQuery? sentGetUser = null;
        mediator.Setup(x => x.Send(It.IsAny<GetCurrentUserQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(UserDto(userId)));
        mediator.Setup(x => x.Send(It.IsAny<GetUserQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result<UserDetailDto>>, CancellationToken>((query, _) => sentGetUser = (GetUserQuery)query)
            .ReturnsAsync(Result.Success(new UserDetailDto { Id = userId, Email = "detail@example.com" }));
        mediator.Setup(x => x.Send(It.IsAny<GetUsersQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(users));
        mediator.Setup(x => x.Send(It.IsAny<GetUserSecurityQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new UserSecurityDto { UserId = userId, ActiveSessionsCount = 1 }));
        mediator.Setup(x => x.Send(It.IsAny<GetUserSessionsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(sessions));
        mediator.Setup(x => x.Send(It.IsAny<GetLoginHistoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(loginHistory));
        mediator.Setup(x => x.Send(It.IsAny<GetUserStatisticsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(statistics));
        var controller = CreateController(mediator);

        Assert.IsType<OkObjectResult>(await controller.GetCurrentUser(CancellationToken.None));
        var getUser = Assert.IsType<OkObjectResult>(await controller.GetUser(userId, CancellationToken.None));
        Assert.IsType<UserDetailDto>(getUser.Value);
        Assert.Equal(userId, sentGetUser!.UserId);
        Assert.Same(users, Assert.IsType<OkObjectResult>(await controller.GetUsers(new GetUsersQuery(), CancellationToken.None)).Value);
        Assert.IsType<UserSecurityDto>(Assert.IsType<OkObjectResult>(await controller.GetSecurity(CancellationToken.None)).Value);
        Assert.Same(sessions, Assert.IsType<OkObjectResult>(await controller.GetSessions(CancellationToken.None)).Value);
        Assert.Same(loginHistory, Assert.IsType<OkObjectResult>(await controller.GetLoginHistory(new GetLoginHistoryQuery(), CancellationToken.None)).Value);
        Assert.Same(statistics, Assert.IsType<OkObjectResult>(await controller.GetStatistics(CancellationToken.None)).Value);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task QueryEndpoints_MapFailuresToNotFoundOrServerError()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetCurrentUserQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<UserDto>("CURRENT_USER_FAILED", "current user failed"));
        mediator.Setup(x => x.Send(It.IsAny<GetUserQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<UserDetailDto>("USER_NOT_FOUND", "missing"));
        mediator.Setup(x => x.Send(It.IsAny<GetUsersQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<PagedResult<UserListDto>>("USERS_FAILED", "users failed"));
        mediator.Setup(x => x.Send(It.IsAny<GetUserSecurityQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<UserSecurityDto>("SECURITY_FAILED", "security failed"));
        mediator.Setup(x => x.Send(It.IsAny<GetUserSessionsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<List<SessionDto>>("SESSIONS_FAILED", "sessions failed"));
        mediator.Setup(x => x.Send(It.IsAny<GetLoginHistoryQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<PagedResult<LoginHistoryPagedDto>>("HISTORY_FAILED", "history failed"));
        mediator.Setup(x => x.Send(It.IsAny<GetUserStatisticsQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Failure<UserStatisticsDto>("STATS_FAILED", "stats failed"));
        var controller = CreateController(mediator);

        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(await controller.GetCurrentUser(CancellationToken.None)).StatusCode);
        Assert.IsType<NotFoundObjectResult>(await controller.GetUser(Guid.NewGuid(), CancellationToken.None));
        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(await controller.GetUsers(new GetUsersQuery(), CancellationToken.None)).StatusCode);
        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(await controller.GetSecurity(CancellationToken.None)).StatusCode);
        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(await controller.GetSessions(CancellationToken.None)).StatusCode);
        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(await controller.GetLoginHistory(new GetLoginHistoryQuery(), CancellationToken.None)).StatusCode);
        Assert.Equal(StatusCodes.Status500InternalServerError, Assert.IsType<ObjectResult>(await controller.GetStatistics(CancellationToken.None)).StatusCode);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CommandEndpoints_MapSuccessToExpectedHttpResponses()
    {
        var mediator = new Mock<IMediator>();
        var tokenId = Guid.NewGuid();
        RevokeSessionCommand? sentRevokeSession = null;
        VerifyEmailCommand? tokenVerification = null;
        var resendEmailVerification = false;

        mediator.Setup(x => x.Send(It.IsAny<UpdateUserCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(UserDto(Guid.NewGuid())));
        mediator.Setup(x => x.Send(It.IsAny<DeleteUserCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<ChangePasswordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<ChangeEmailCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<VerifyEmailCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => tokenVerification ??= (VerifyEmailCommand)command)
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<ResendEmailVerificationCommand>(), It.IsAny<CancellationToken>()))
            .Callback(() => resendEmailVerification = true)
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<Enable2FACommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success(new Enable2FAResponse { Secret = "secret", QrCodeUrl = "otpauth://test" }));
        mediator.Setup(x => x.Send(It.IsAny<Confirm2FACommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<Disable2FACommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<RevokeSessionCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Result>, CancellationToken>((command, _) => sentRevokeSession = (RevokeSessionCommand)command)
            .ReturnsAsync(Result.Success());
        mediator.Setup(x => x.Send(It.IsAny<RevokeAllSessionsCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Result.Success());
        var controller = CreateController(mediator);

        Assert.IsType<OkObjectResult>(await controller.UpdateProfile(new UpdateUserCommand { FirstName = "Ada", LastName = "Lovelace" }, CancellationToken.None));
        Assert.Contains("Account deleted", Assert.IsType<OkObjectResult>(await controller.DeleteAccount(new DeleteUserCommand { Password = "pw" }, CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Contains("Password changed", Assert.IsType<OkObjectResult>(await controller.ChangePassword(new ChangePasswordCommand(), CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Contains("Email changed", Assert.IsType<OkObjectResult>(await controller.ChangeEmail(new ChangeEmailCommand(), CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Contains("Email verified", Assert.IsType<OkObjectResult>(await controller.VerifyEmailByToken("verify-token", CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Equal("verify-token", tokenVerification!.Token);
        Assert.Contains("Email verified", Assert.IsType<OkObjectResult>(await controller.VerifyEmail(new VerifyEmailCommand { Token = "body-token" }, CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Contains("verification link sent", Assert.IsType<OkObjectResult>(await controller.VerifyEmail(new VerifyEmailCommand(), CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.True(resendEmailVerification);
        Assert.IsType<Enable2FAResponse>(Assert.IsType<OkObjectResult>(await controller.Enable2FA(CancellationToken.None)).Value);
        Assert.Contains("Two-factor authentication enabled", Assert.IsType<OkObjectResult>(await controller.Confirm2FA(new Confirm2FACommand { Code = "123456" }, CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Contains("Two-factor authentication disabled", Assert.IsType<OkObjectResult>(await controller.Disable2FA(new Disable2FACommand { Password = "pw" }, CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Contains("Session revoked", Assert.IsType<OkObjectResult>(await controller.RevokeSession(tokenId, CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
        Assert.Equal(tokenId, sentRevokeSession!.TokenId);
        Assert.Contains("All sessions revoked", Assert.IsType<OkObjectResult>(await controller.RevokeAllSessions(new RevokeAllSessionsCommand { Password = "pw" }, CancellationToken.None)).Value!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CommandEndpoints_MapFailuresToBadRequest()
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<UpdateUserCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure<UserDto>("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<DeleteUserCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<ChangePasswordCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<ChangeEmailCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<VerifyEmailCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<ResendEmailVerificationCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<Enable2FACommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure<Enable2FAResponse>("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<Confirm2FACommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<Disable2FACommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<RevokeSessionCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        mediator.Setup(x => x.Send(It.IsAny<RevokeAllSessionsCommand>(), It.IsAny<CancellationToken>())).ReturnsAsync(Result.Failure("BAD", "bad"));
        var controller = CreateController(mediator);

        Assert.IsType<BadRequestObjectResult>(await controller.UpdateProfile(new UpdateUserCommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.DeleteAccount(new DeleteUserCommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.ChangePassword(new ChangePasswordCommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.ChangeEmail(new ChangeEmailCommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.VerifyEmailByToken("bad-token", CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.VerifyEmail(new VerifyEmailCommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.Enable2FA(CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.Confirm2FA(new Confirm2FACommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.Disable2FA(new Disable2FACommand(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.RevokeSession(Guid.NewGuid(), CancellationToken.None));
        Assert.IsType<BadRequestObjectResult>(await controller.RevokeAllSessions(new RevokeAllSessionsCommand(), CancellationToken.None));
    }

    private static UsersController CreateController(Mock<IMediator> mediator)
        => new(
            mediator.Object,
            Mock.Of<ILogger<UsersController>>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

    private static UserDto UserDto(Guid id) => new()
    {
        Id = id,
        Email = "user@example.com",
        FirstName = "First",
        LastName = "Last",
        Status = "Active",
        CreatedAt = DateTime.UtcNow
    };
}
