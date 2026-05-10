using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;

namespace Planora.Auth.Application.Features.Authentication.Validators.RequestPasswordReset
{
    public sealed class RequestPasswordResetCommandValidator : AbstractValidator<RequestPasswordResetCommand>
    {
        public RequestPasswordResetCommandValidator()
        {
            RuleFor(x => x.Email)
                .NotEmpty().WithMessage("Email is required")
                .EmailAddress().WithMessage("Invalid email format")
                .MaximumLength(255).WithMessage("Email cannot exceed 255 characters");
        }
    }
}
