using FluentValidation.Results;

namespace Planora.BuildingBlocks.Application.Validation;

public class ValidationException : Exception
{
    public IDictionary<string, string[]> Errors { get; }
    public string ErrorCode => "VALIDATION.INVALID_INPUT";

    public ValidationException()
        : base("One or more validation failures have occurred.")
    {
        Errors = new Dictionary<string, string[]>();
    }

    public ValidationException(IEnumerable<ValidationFailure> failures)
        : this()
    {
        Errors = failures
            .GroupBy(e => e.PropertyName, e => e.ErrorMessage)
            .ToDictionary(failureGroup => failureGroup.Key, failureGroup => failureGroup.ToArray());
    }

    public ValidationException(string message, IDictionary<string, string[]> errors)
        : base(message)
    {
        Errors = errors;
    }
}