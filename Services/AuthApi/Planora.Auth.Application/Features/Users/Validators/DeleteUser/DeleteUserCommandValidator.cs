using Planora.Auth.Application.Features.Users.Commands.DeleteUser;

namespace Planora.Auth.Application.Features.Users.Validators.DeleteUser
{
    public sealed class DeleteUserCommandValidator : AbstractValidator<DeleteUserCommand>
    {
        public DeleteUserCommandValidator()
        {
            RuleFor(x => x.Password)
                .NotEmpty().WithMessage("Password is required to delete account");
        }
    }
}
