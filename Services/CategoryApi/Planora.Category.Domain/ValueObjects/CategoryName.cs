using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Category.Domain.ValueObjects
{
    public sealed class CategoryName : ValueObject
    {
        public string Value { get; private set; }

        private CategoryName()
        {
            Value = string.Empty;
        }

        private CategoryName(string value)
        {
            Value = value;
        }

        public static Result<CategoryName> Create(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return Result<CategoryName>.Failure(
                    ErrorCode.Validation.MissingRequired,
                    "Category name cannot be empty");

            if (value.Length > 100)
                return Result<CategoryName>.Failure(
                    ErrorCode.Validation.InvalidLength,
                    "Category name cannot exceed 100 characters");

            return Result<CategoryName>.Success(new CategoryName(value.Trim()));
        }

        protected override IEnumerable<object?> GetEqualityComponents()
        {
            yield return Value;
        }
    }
}
