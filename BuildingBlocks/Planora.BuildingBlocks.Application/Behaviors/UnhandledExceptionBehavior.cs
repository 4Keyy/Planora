namespace Planora.BuildingBlocks.Application.Behaviors;

public sealed class UnhandledExceptionBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly ILogger<UnhandledExceptionBehavior<TRequest, TResponse>> _logger;

    public UnhandledExceptionBehavior(ILogger<UnhandledExceptionBehavior<TRequest, TResponse>> logger)
    {
        _logger = logger;
    }

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        try
        {
            return await next();
        }
        catch (Exception ex)
        {
            // Log only the request NAME here. The raw {@Request} was destructured unredacted (leaking
            // passwords/PII) AND duplicated the sanitized request that LoggingBehavior already logs on
            // failure. Keep this as a lightweight backstop without the payload.
            var requestName = typeof(TRequest).Name;
            _logger.LogError(ex, "Unhandled Exception for Request {Name}", requestName);
            throw;
        }
    }
}