using System.Text.Json;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Api.Controllers;
using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using Planora.Auth.Application.Features.Authentication.Commands.Register;
using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
using Planora.Auth.Application.Features.Authentication.Response.Login;
using Planora.Auth.Application.Features.Authentication.Response.Register;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using ApplicationResult = Planora.BuildingBlocks.Application.Models.Result;
using LoginResult = Planora.BuildingBlocks.Domain.Result<Planora.Auth.Application.Features.Authentication.Response.Login.LoginResponse>;
using RegisterResult = Planora.BuildingBlocks.Domain.Result<Planora.Auth.Application.Features.Authentication.Response.Register.RegisterResponse>;

namespace Planora.UnitTests.Services.AuthApi.Controllers;

public class AuthenticationControllerTests
{
    [Fact]
    public async Task Register_SetsRefreshTokenCookie_AndOmitsRefreshTokenFromBody()
    {
        var mediatorMock = new Mock<IMediator>();
        var registerResponse = new RegisterResponse
        {
            UserId = Guid.NewGuid(),
            Email = "user@example.com",
            FirstName = "Test",
            LastName = "User",
            AccessToken = "access-token",
            RefreshToken = "register-refresh-token-1234567890",
            ExpiresAt = DateTime.UtcNow.AddDays(7)
        };

        mediatorMock
            .Setup(x => x.Send(It.IsAny<RegisterCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(RegisterResult.Success(registerResponse));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "https";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.Register(
            new RegisterCommand
            {
                Email = "user@example.com",
                Password = "Password123!",
                ConfirmPassword = "Password123!",
                FirstName = "Test",
                LastName = "User"
            },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var bodyJson = JsonSerializer.Serialize(ok.Value);
        Assert.DoesNotContain("RefreshToken", bodyJson);
        Assert.DoesNotContain(registerResponse.RefreshToken, bodyJson);

        var setCookie = httpContext.Response.Headers.SetCookie.ToString();
        Assert.Contains($"refresh_token={registerResponse.RefreshToken}", setCookie);
        Assert.Contains("httponly", setCookie.ToLowerInvariant());
        Assert.Contains("secure", setCookie.ToLowerInvariant());
        Assert.Contains("samesite=strict", setCookie.ToLowerInvariant());
        Assert.Contains("path=/auth/api/v1/auth", setCookie.ToLowerInvariant());
    }

    [Fact]
    public void RegisterResponse_DoesNotSerializeRefreshToken()
    {
        var response = new RegisterResponse
        {
            AccessToken = "access-token",
            RefreshToken = "hidden-refresh-token-1234567890"
        };

        var json = JsonSerializer.Serialize(response);

        Assert.DoesNotContain("RefreshToken", json);
        Assert.DoesNotContain(response.RefreshToken, json);
    }

    [Fact]
    public async Task Login_SetsSessionRefreshTokenCookie_WhenRememberMeIsFalse_AndOmitsRefreshTokenFromBody()
    {
        var mediatorMock = new Mock<IMediator>();
        var loginResponse = new LoginResponse
        {
            UserId = Guid.NewGuid(),
            Email = "user@example.com",
            FirstName = "Test",
            LastName = "User",
            AccessToken = "access-token",
            RefreshToken = "login-refresh-token-1234567890",
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            TwoFactorEnabled = false
        };

        mediatorMock
            .Setup(x => x.Send(It.IsAny<LoginCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(LoginResult.Success(loginResponse));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "https";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.Login(
            new LoginCommand
            {
                Email = "user@example.com",
                Password = "Password123!",
                RememberMe = false
            },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var bodyJson = JsonSerializer.Serialize(ok.Value);
        Assert.DoesNotContain("RefreshToken", bodyJson);
        Assert.DoesNotContain(loginResponse.RefreshToken, bodyJson);

        var setCookie = httpContext.Response.Headers.SetCookie.ToString();
        Assert.Contains($"refresh_token={loginResponse.RefreshToken}", setCookie);
        Assert.Contains("httponly", setCookie.ToLowerInvariant());
        Assert.Contains("secure", setCookie.ToLowerInvariant());
        Assert.Contains("samesite=strict", setCookie.ToLowerInvariant());
        Assert.Contains("path=/auth/api/v1/auth", setCookie.ToLowerInvariant());
        Assert.DoesNotContain("expires=", setCookie.ToLowerInvariant());
    }

    [Fact]
    public async Task Login_SetsPersistentRefreshTokenCookie_WhenRememberMeIsTrue()
    {
        var mediatorMock = new Mock<IMediator>();
        var loginResponse = new LoginResponse
        {
            UserId = Guid.NewGuid(),
            Email = "user@example.com",
            FirstName = "Test",
            LastName = "User",
            AccessToken = "access-token",
            RefreshToken = "persistent-refresh-token-1234567890",
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            TwoFactorEnabled = false
        };

        mediatorMock
            .Setup(x => x.Send(It.IsAny<LoginCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(LoginResult.Success(loginResponse));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "https";
        var controller = CreateController(mediatorMock, httpContext);

        await controller.Login(
            new LoginCommand
            {
                Email = "user@example.com",
                Password = "Password123!",
                RememberMe = true
            },
            CancellationToken.None);

        var setCookie = httpContext.Response.Headers.SetCookie.ToString();
        Assert.Contains($"refresh_token={loginResponse.RefreshToken}", setCookie);
        Assert.Contains("expires=", setCookie.ToLowerInvariant());
    }

    [Fact]
    public async Task RefreshToken_ReadsCookie_RotatesCookie_AndOmitsRefreshTokenFromBody()
    {
        var mediatorMock = new Mock<IMediator>();
        RefreshTokenCommand? sentCommand = null;
        var tokenDto = new TokenDto
        {
            AccessToken = "new-access-token",
            RefreshToken = "rotated-refresh-token-1234567890",
            ExpiresAt = DateTime.UtcNow.AddDays(7),
            TokenType = "Bearer",
            RememberMe = true
        };

        mediatorMock
            .Setup(x => x.Send(It.IsAny<RefreshTokenCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Planora.BuildingBlocks.Application.Models.Result<TokenDto>>, CancellationToken>((command, _) => sentCommand = (RefreshTokenCommand)command)
            .ReturnsAsync(ApplicationResult.Success(tokenDto));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "https";
        httpContext.Request.Headers.Cookie = "refresh_token=old-refresh-token-1234567890";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.RefreshToken(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        var bodyJson = JsonSerializer.Serialize(ok.Value);
        Assert.NotNull(sentCommand);
        Assert.Equal("old-refresh-token-1234567890", sentCommand.RefreshToken);
        Assert.DoesNotContain("RefreshToken", bodyJson);
        Assert.DoesNotContain(tokenDto.RefreshToken, bodyJson);

        var setCookie = httpContext.Response.Headers.SetCookie.ToString();
        Assert.Contains($"refresh_token={tokenDto.RefreshToken}", setCookie);
        Assert.Contains("httponly", setCookie.ToLowerInvariant());
        Assert.Contains("secure", setCookie.ToLowerInvariant());
        Assert.Contains("samesite=strict", setCookie.ToLowerInvariant());
        Assert.Contains("path=/auth/api/v1/auth", setCookie.ToLowerInvariant());
        Assert.Contains("expires=", setCookie.ToLowerInvariant());
    }

    [Fact]
    public async Task RefreshToken_ReturnsNoContent_AndDoesNotCallMediator_WhenCookieIsMissing()
    {
        var mediatorMock = new Mock<IMediator>();
        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var result = await controller.RefreshToken(CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
        mediatorMock.Verify(
            x => x.Send(It.IsAny<RefreshTokenCommand>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Logout_UsesCookieRefreshTokenBeforeBodyToken_AndDeletesCookie()
    {
        var mediatorMock = new Mock<IMediator>();
        LogoutCommand? sentCommand = null;
        mediatorMock
            .Setup(x => x.Send(It.IsAny<LogoutCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<ApplicationResult>, CancellationToken>((command, _) => sentCommand = (LogoutCommand)command)
            .ReturnsAsync(ApplicationResult.Success());

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "https";
        httpContext.Request.Headers.Cookie = "refresh_token=cookie-refresh-token-1234567890";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.Logout(
            new LogoutCommand { RefreshToken = "body-refresh-token-1234567890" },
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(sentCommand);
        Assert.Equal("cookie-refresh-token-1234567890", sentCommand.RefreshToken);

        var setCookie = httpContext.Response.Headers.SetCookie.ToString();
        Assert.Contains("refresh_token=", setCookie);
        Assert.Contains("expires=", setCookie.ToLowerInvariant());
        Assert.Contains("path=/auth/api/v1/auth", setCookie.ToLowerInvariant());
    }

    [Fact]
    public async Task Logout_FallsBackToBodyRefreshToken_WhenCookieIsMissing()
    {
        var mediatorMock = new Mock<IMediator>();
        LogoutCommand? sentCommand = null;
        mediatorMock
            .Setup(x => x.Send(It.IsAny<LogoutCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<ApplicationResult>, CancellationToken>((command, _) => sentCommand = (LogoutCommand)command)
            .ReturnsAsync(ApplicationResult.Success());

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        await controller.Logout(
            new LogoutCommand { RefreshToken = "body-refresh-token-1234567890" },
            CancellationToken.None);

        Assert.NotNull(sentCommand);
        Assert.Equal("body-refresh-token-1234567890", sentCommand.RefreshToken);
    }

    [Fact]
    public async Task Register_ReturnsConflict_ForDuplicateUserFailure()
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .Setup(x => x.Send(It.IsAny<RegisterCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(RegisterResult.Failure("USER_ALREADY_EXISTS", "Email already exists"));

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var result = await controller.Register(
            new RegisterCommand
            {
                Email = "user@example.com",
                Password = "Password123!",
                ConfirmPassword = "Password123!",
                FirstName = "Test",
                LastName = "User"
            },
            CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result);
        Assert.Contains("USER_ALREADY_EXISTS", JsonSerializer.Serialize(conflict.Value));
    }

    [Fact]
    public async Task Register_ReturnsBadRequest_ForValidationFailure()
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .Setup(x => x.Send(It.IsAny<RegisterCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(RegisterResult.Failure("VALIDATION_ERROR", "Invalid registration"));

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var result = await controller.Register(new RegisterCommand(), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("VALIDATION_ERROR", JsonSerializer.Serialize(badRequest.Value));
    }

    [Fact]
    public async Task Login_ReturnsUnauthorized_ForFailedCredentials()
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .Setup(x => x.Send(It.IsAny<LoginCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(LoginResult.Failure("INVALID_CREDENTIALS", "Invalid credentials"));

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var result = await controller.Login(
            new LoginCommand { Email = "user@example.com", Password = "wrong" },
            CancellationToken.None);

        var unauthorized = Assert.IsType<UnauthorizedObjectResult>(result);
        Assert.Contains("INVALID_CREDENTIALS", JsonSerializer.Serialize(unauthorized.Value));
    }

    [Theory]
    [InlineData("REFRESH_TOKEN_NOT_FOUND", typeof(NotFoundObjectResult))]
    [InlineData("REFRESH_TOKEN_INVALID", typeof(BadRequestObjectResult))]
    [InlineData("REFRESH_TOKEN_EXPIRED", typeof(UnauthorizedObjectResult))]
    public async Task RefreshToken_ClearsCookie_AndMapsFailureCodes(string code, Type expectedResultType)
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .Setup(x => x.Send(It.IsAny<RefreshTokenCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Failure<TokenDto>(code, "Refresh failed"));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Cookie = "refresh_token=stale-refresh-token";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.RefreshToken(CancellationToken.None);

        Assert.IsType(expectedResultType, result);
        Assert.Contains("refresh_token=", httpContext.Response.Headers.SetCookie.ToString());
        Assert.Contains("expires=", httpContext.Response.Headers.SetCookie.ToString().ToLowerInvariant());
    }

    [Fact]
    public async Task Logout_ReturnsServerError_WhenMediatorFails_ButStillDeletesCookie()
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .Setup(x => x.Send(It.IsAny<LogoutCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Failure("LOGOUT_FAILED", "Could not revoke session"));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Cookie = "refresh_token=refresh-token";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.Logout(null, CancellationToken.None);

        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status500InternalServerError, objectResult.StatusCode);
        Assert.Contains("refresh_token=", httpContext.Response.Headers.SetCookie.ToString());
    }

    [Fact]
    public async Task ValidateToken_MapsSuccessAndFailure()
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .SetupSequence(x => x.Send(It.IsAny<ValidateTokenQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Success(new TokenValidationDto
            {
                IsValid = true,
                UserId = Guid.NewGuid(),
                Email = "user@example.com",
                Roles = ["User"]
            }))
            .ReturnsAsync(ApplicationResult.Failure<TokenValidationDto>("TOKEN_INVALID", "Invalid token"));

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var okResult = await controller.ValidateToken(new ValidateTokenQuery { Token = "valid" }, CancellationToken.None);
        Assert.IsType<OkObjectResult>(okResult);

        var badResult = await controller.ValidateToken(new ValidateTokenQuery { Token = "bad" }, CancellationToken.None);
        var badRequest = Assert.IsType<BadRequestObjectResult>(badResult);
        Assert.Contains("TOKEN_INVALID", JsonSerializer.Serialize(badRequest.Value));
    }

    [Fact]
    public async Task ValidateToken_UsesAuthorizationBearer_WhenBodyTokenIsMissing()
    {
        var mediatorMock = new Mock<IMediator>();
        ValidateTokenQuery? sentQuery = null;
        mediatorMock
            .Setup(x => x.Send(It.IsAny<ValidateTokenQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Planora.BuildingBlocks.Application.Models.Result<TokenValidationDto>>, CancellationToken>((query, _) =>
            {
                sentQuery = query as ValidateTokenQuery;
            })
            .ReturnsAsync(ApplicationResult.Success(new TokenValidationDto
            {
                IsValid = true,
                UserId = Guid.NewGuid(),
                Email = "user@example.com",
                Roles = ["User"]
            }));

        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Authorization = "Bearer header-token";
        var controller = CreateController(mediatorMock, httpContext);

        var result = await controller.ValidateToken(null, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(sentQuery);
        Assert.Equal("header-token", sentQuery.Token);
    }

    [Fact]
    public async Task ValidateToken_SendsEmptyToken_WhenBodyAndBearerHeaderAreMissing()
    {
        var mediatorMock = new Mock<IMediator>();
        ValidateTokenQuery? sentQuery = null;
        mediatorMock
            .Setup(x => x.Send(It.IsAny<ValidateTokenQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<Planora.BuildingBlocks.Application.Models.Result<TokenValidationDto>>, CancellationToken>((query, _) =>
            {
                sentQuery = query as ValidateTokenQuery;
            })
            .ReturnsAsync(ApplicationResult.Failure<TokenValidationDto>("TOKEN_INVALID", "Token is invalid"));
        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var result = await controller.ValidateToken(null, CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.NotNull(sentQuery);
        Assert.Equal(string.Empty, sentQuery.Token);
        Assert.Contains("TOKEN_INVALID", JsonSerializer.Serialize(badRequest.Value));
    }

    [Fact]
    public async Task RequestPasswordReset_AlwaysReturnsGenericOkMessage()
    {
        var mediatorMock = new Mock<IMediator>();
        RequestPasswordResetCommand? sentCommand = null;
        mediatorMock
            .Setup(x => x.Send(It.IsAny<RequestPasswordResetCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<ApplicationResult>, CancellationToken>((command, _) => sentCommand = (RequestPasswordResetCommand)command)
            .ReturnsAsync(ApplicationResult.Success());

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var result = await controller.RequestPasswordReset(
            new RequestPasswordResetCommand { Email = "user@example.com" },
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.NotNull(sentCommand);
        Assert.Contains("If the email exists", JsonSerializer.Serialize(ok.Value));
    }

    [Fact]
    public void GetCsrfToken_SetsReadableStrictCookie_AndReturnsToken()
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Scheme = "https";
        var controller = CreateController(new Mock<IMediator>(), httpContext);

        var result = controller.GetCsrfToken();

        var ok = Assert.IsType<OkObjectResult>(result);
        var bodyJson = JsonSerializer.Serialize(ok.Value);
        Assert.Contains("Token", bodyJson);
        Assert.Contains("ExpiresIn", bodyJson);

        var setCookie = httpContext.Response.Headers.SetCookie.ToString();
        Assert.Contains("XSRF-TOKEN=", setCookie);
        Assert.Contains("secure", setCookie.ToLowerInvariant());
        Assert.Contains("samesite=strict", setCookie.ToLowerInvariant());
        Assert.DoesNotContain("httponly", setCookie.ToLowerInvariant());
    }

    [Fact]
    public async Task ResetPassword_MapsSuccessAndFailure()
    {
        var mediatorMock = new Mock<IMediator>();
        mediatorMock
            .SetupSequence(x => x.Send(It.IsAny<ResetPasswordCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ApplicationResult.Success())
            .ReturnsAsync(ApplicationResult.Failure("RESET_TOKEN_INVALID", "Invalid reset token"));

        var controller = CreateController(mediatorMock, new DefaultHttpContext());

        var okResult = await controller.ResetPassword(
            new ResetPasswordCommand { ResetToken = "token", NewPassword = "Password123!" },
            CancellationToken.None);
        Assert.IsType<OkObjectResult>(okResult);

        var badResult = await controller.ResetPassword(
            new ResetPasswordCommand { ResetToken = "token", NewPassword = "Password123!" },
            CancellationToken.None);
        var badRequest = Assert.IsType<BadRequestObjectResult>(badResult);
        Assert.Contains("RESET_TOKEN_INVALID", JsonSerializer.Serialize(badRequest.Value));
    }

    private static AuthenticationController CreateController(
        Mock<IMediator> mediatorMock,
        HttpContext httpContext)
    {
        var loggerMock = new Mock<ILogger<AuthenticationController>>();
        return new AuthenticationController(mediatorMock.Object, loggerMock.Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = httpContext
            }
        };
    }
}
