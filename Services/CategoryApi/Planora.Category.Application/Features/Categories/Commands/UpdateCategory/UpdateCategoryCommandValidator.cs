using Planora.Category.Domain.Enums;

namespace Planora.Category.Application.Features.Categories.Commands.UpdateCategory
{
    public sealed class UpdateCategoryCommandValidator : AbstractValidator<UpdateCategoryCommand>
    {
        public UpdateCategoryCommandValidator()
        {
            RuleFor(x => x.CategoryId)
                .NotEmpty().WithMessage("Category ID is required");

            RuleFor(x => x.Name)
                .NotEmpty().WithMessage("Category name is required")
                .MaximumLength(50).WithMessage("Category name cannot exceed 50 characters")
                .When(x => !string.IsNullOrEmpty(x.Name));

            RuleFor(x => x.Description)
                .MaximumLength(500).WithMessage("Description cannot exceed 500 characters")
                .When(x => x.Description != null);

            RuleFor(x => x.Color)
                .Must(c => string.IsNullOrEmpty(c) || CategoryColors.IsValid(c))
                .WithMessage("Invalid color format")
                .When(x => !string.IsNullOrEmpty(x.Color));

            // Only validated when supplied (DisplayOrder is optional on update). The domain rejects a
            // negative order, so catch it here as a 400 rather than letting it surface as a 500.
            RuleFor(x => x.DisplayOrder!.Value)
                .GreaterThanOrEqualTo(0).WithMessage("Display order must be zero or greater")
                .When(x => x.DisplayOrder.HasValue);
        }
    }
}
