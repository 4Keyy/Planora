using Planora.Category.Domain.Enums;

namespace Planora.Category.Application.Features.Categories.Commands.CreateCategory
{
    public sealed class CreateCategoryCommandValidator : AbstractValidator<CreateCategoryCommand>
    {
        public CreateCategoryCommandValidator()
        {
            RuleFor(x => x.Name)
                .NotEmpty().WithMessage("Category name is required")
                .MaximumLength(50).WithMessage("Category name cannot exceed 50 characters");

            RuleFor(x => x.Description)
                .MaximumLength(500).WithMessage("Description cannot exceed 500 characters");

            RuleFor(x => x.Color)
                .Must(c => string.IsNullOrEmpty(c) || CategoryColors.IsValid(c))
                .WithMessage("Invalid color format")
                .When(x => !string.IsNullOrEmpty(x.Color));
        }
    }
}
