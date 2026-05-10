using Planora.Auth.Application.Features.Authentication.Commands.Logout;

namespace Planora.Auth.Application.Features.Authentication.Validators.Logout
{
    public sealed class LogoutCommandValidator : AbstractValidator<LogoutCommand>
    {
        public LogoutCommandValidator()
        {
            When(x => !string.IsNullOrEmpty(x.RefreshToken), () =>
            {
                RuleFor(x => x.RefreshToken)
                    .MinimumLength(20).WithMessage("Invalid refresh token format");
            });
        }
    }
}
