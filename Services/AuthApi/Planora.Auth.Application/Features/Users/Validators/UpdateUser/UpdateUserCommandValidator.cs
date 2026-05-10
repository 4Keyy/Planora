using Planora.Auth.Application.Features.Users.Commands.UpdateUser;

namespace Planora.Auth.Application.Features.Users.Validators.UpdateUser
{
    public sealed class UpdateUserCommandValidator : AbstractValidator<UpdateUserCommand>
    {
        public UpdateUserCommandValidator()
        {
            RuleFor(x => x.FirstName)
                .NotEmpty().WithMessage("First name is required")
                .MaximumLength(100).WithMessage("First name cannot exceed 100 characters")
                .Matches(@"^[a-zA-Zа-яА-ЯёЁ\s\-']+$").WithMessage("First name contains invalid characters");

            RuleFor(x => x.LastName)
                .NotEmpty().WithMessage("Last name is required")
                .MaximumLength(100).WithMessage("Last name cannot exceed 100 characters")
                .Matches(@"^[a-zA-Zа-яА-ЯёЁ\s\-']+$").WithMessage("Last name contains invalid characters");

            RuleFor(x => x.ProfilePictureUrl)
                .MaximumLength(500).WithMessage("Profile picture URL cannot exceed 500 characters")
                .Must(BeValidUrl).WithMessage("Profile picture URL is not valid")
                .When(x => !string.IsNullOrEmpty(x.ProfilePictureUrl));
        }

        private bool BeValidUrl(string? url)
        {
            if (string.IsNullOrEmpty(url))
                return true;

            return Uri.TryCreate(url, UriKind.Absolute, out var uriResult) &&
                   (uriResult.Scheme == Uri.UriSchemeHttp || uriResult.Scheme == Uri.UriSchemeHttps);
        }
    }
}
