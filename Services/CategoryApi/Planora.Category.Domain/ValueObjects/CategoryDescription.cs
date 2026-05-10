using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Category.Domain.ValueObjects
{
    public sealed class CategoryDescription : ValueObject
    {
        public string Value { get; private set; }

        // Parameterless ctor required by EF Core for materialization
        private CategoryDescription()
        {
            Value = string.Empty;
        }

        private CategoryDescription(string value)
        {
            Value = value;
        }

        public static Result<CategoryDescription> Create(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return Result<CategoryDescription>.Failure(
                    ErrorCode.Validation.MissingRequired,
                    "Description cannot be empty");

            if (value.Length > 500)
                return Result<CategoryDescription>.Failure(
                    ErrorCode.Validation.InvalidLength,
                    "Description cannot exceed 500 characters");

            return Result<CategoryDescription>.Success(new CategoryDescription(value.Trim()));
        }

        protected override IEnumerable<object?> GetEqualityComponents()
        {
            yield return Value;
        }
    }

}
