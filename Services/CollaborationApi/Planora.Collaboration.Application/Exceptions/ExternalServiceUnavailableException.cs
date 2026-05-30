using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Collaboration.Application.Exceptions
{
    /// <summary>
    /// Raised when a downstream service (Todo / Auth gRPC) is unavailable. Surfaces as
    /// HTTP 503 via the shared global exception middleware (DomainException → status code),
    /// mirroring TodoApi's identical contract for consistent cross-service error semantics.
    /// </summary>
    public sealed class ExternalServiceUnavailableException : DomainException
    {
        public ExternalServiceUnavailableException(string serviceName, string operation, Exception? innerException = null)
            : base(
                $"{serviceName} is currently unavailable. Operation: {operation}",
                "EXTERNAL_SERVICE_UNAVAILABLE",
                503)
        {
        }
    }
}
