namespace Planora.BuildingBlocks.Application.Models;

public sealed record Error
{
    public string Code { get; }
    public string Message { get; }
    public Dictionary<string, string[]>? ValidationErrors { get; init; }

    public Error(string code, string message)
    {
        Code = code;
        Message = message;
    }

    public Error(string code, string message, Dictionary<string, string[]> validationErrors)
        : this(code, message)
    {
        ValidationErrors = validationErrors;
    }

    public static Error None => new(string.Empty, string.Empty);
    public static Error NullValue => new("Error.NullValue", "Null value was provided");

    public static Error Validation(string code, string message, Dictionary<string, string[]> errors)
        => new(code, message, errors);

    public static Error NotFound(string code, string message)
        => new(code, message);

    public static Error Conflict(string code, string message)
        => new(code, message);

    public static Error Unauthorized(string code, string message)
        => new(code, message);

    public static Error Forbidden(string code, string message)
        => new(code, message);

    public static Error InternalServer(string code, string message)
        => new(code, message);
}