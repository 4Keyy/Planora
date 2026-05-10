using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Todo.Application.Exceptions;

public sealed class ExternalServiceUnavailableException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.ServiceUnavailable;

    public ExternalServiceUnavailableException(string serviceName, string operationName, Exception innerException)
        : base(
            $"{serviceName} is unavailable while executing {operationName}.",
            Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Infrastructure.ExternalServiceUnavailable,
            ErrorCategory.ServiceUnavailable,
            innerException)
    {
        AddDetail("ServiceName", serviceName);
        AddDetail("OperationName", operationName);
    }
}
