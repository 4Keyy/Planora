using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Collaboration.Application.Exceptions
{
    /// <summary>
    /// Raised when a downstream service (Todo / Auth gRPC) is unavailable. Surfaces as HTTP 503
    /// through the shared global exception middleware, mirroring TodoApi's identical contract for
    /// consistent cross-service error semantics.
    /// </summary>
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
}
