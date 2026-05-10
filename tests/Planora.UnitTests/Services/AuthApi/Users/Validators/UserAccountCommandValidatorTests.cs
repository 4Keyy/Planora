using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest;
using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;
using Planora.Auth.Application.Features.Users.Commands.RevokeSession;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
using Planora.Auth.Application.Features.Users.Validators.DeleteUser;
using Planora.Auth.Application.Features.Users.Validators.GetUser;
using Planora.Auth.Application.Features.Users.Validators.RevokeSession;
using Planora.Auth.Application.Features.Users.Validators.RevokeSessions;

namespace Planora.UnitTests.Services.AuthApi.Users.Validators;

public sealed class UserAccountCommandValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void DeleteAndRevokeAllSessionsValidators_ShouldRequirePassword()
    {
        var deleteValidator = new DeleteUserCommandValidator();
        var revokeAllValidator = new RevokeAllSessionsCommandValidator();

        Assert.False(deleteValidator.Validate(new DeleteUserCommand()).IsValid);
        Assert.True(deleteValidator.Validate(new DeleteUserCommand { Password = "Password123!" }).IsValid);
        Assert.False(revokeAllValidator.Validate(new RevokeAllSessionsCommand()).IsValid);
        Assert.True(revokeAllValidator.Validate(new RevokeAllSessionsCommand { Password = "Password123!" }).IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void GuidValidators_ShouldRejectEmptyIdentifiers()
    {
        var getUserValidator = new GetUserQueryValidator();
        var revokeSessionValidator = new RevokeSessionCommandValidator();
        var sendFriendRequestValidator = new SendFriendRequestCommandValidator();

        Assert.False(getUserValidator.Validate(new GetUserQuery(Guid.Empty)).IsValid);
        Assert.True(getUserValidator.Validate(new GetUserQuery(Guid.NewGuid())).IsValid);
        Assert.False(revokeSessionValidator.Validate(new RevokeSessionCommand { TokenId = Guid.Empty }).IsValid);
        Assert.True(revokeSessionValidator.Validate(new RevokeSessionCommand { TokenId = Guid.NewGuid() }).IsValid);
        Assert.False(sendFriendRequestValidator.Validate(new SendFriendRequestCommand(Guid.Empty)).IsValid);
        Assert.True(sendFriendRequestValidator.Validate(new SendFriendRequestCommand(Guid.NewGuid())).IsValid);
    }
}
