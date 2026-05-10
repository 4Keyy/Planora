using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;

namespace Planora.Auth.Application.Features.Users.Validators.RevokeSessions
{
    public sealed class RevokeAllSessionsCommandValidator : AbstractValidator<RevokeAllSessionsCommand>
    {
        public RevokeAllSessionsCommandValidator()
        {
            RuleFor(x => x.Password)
                .NotEmpty().WithMessage("Password is required to revoke all sessions");
        }
    }
}
