namespace Planora.BuildingBlocks.Domain.Exceptions;

public abstract class DomainException : Exception
{
    public string ErrorCode { get; }
    public Dictionary<string, object> Details { get; }
    public virtual ErrorCategory Category { get; }

    protected DomainException(string message, string errorCode, ErrorCategory category = ErrorCategory.InternalServer)
        : base(message)
    {
        ErrorCode = errorCode;
        Details = new Dictionary<string, object>();
        Category = category;
    }

    protected DomainException(string message, string errorCode, ErrorCategory category, Exception innerException)
        : base(message, innerException)
    {
        ErrorCode = errorCode;
        Details = new Dictionary<string, object>();
        Category = category;
    }

    public void AddDetail(string key, object value)
    {
        Details[key] = value;
    }

    public ProblemDetailsContext ToProblemDetailsContext(string traceId, string instance, string? userId = null, long elapsedMilliseconds = 0)
    {
        return new ProblemDetailsContext
        {
            ErrorCode = ErrorCode,
            Title = Category.GetTitle(),
            Detail = Message,
            StatusCode = Category.GetStatusCode(),
            Instance = instance,
            TraceId = traceId,
            UserId = userId,
            Extensions = Details.Any() ? new Dictionary<string, object>(Details) : null,
            InnerException = InnerException,
            ElapsedMilliseconds = elapsedMilliseconds
        };
    }

    public override string ToString()
    {
        var detailsString = Details.Any()
            ? $", Details: {string.Join(", ", Details.Select(d => $"{d.Key}={d.Value}"))}"
            : string.Empty;

        return $"{GetType().Name}: {Message} (Code: {ErrorCode}{detailsString})";
    }
}