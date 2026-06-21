namespace Planora.BuildingBlocks.Domain.Exceptions;

/// <summary>
/// Carries a <c>Result</c> <see cref="Error"/>'s exact code, message, and category through to the
/// global exception middleware. Used when translating a failed <c>Result</c> into an exception so
/// the original diagnostic detail is preserved instead of being replaced by a placeholder
/// (the entity-specific exceptions hardcode a generic message/code and are unsuitable for an
/// arbitrary mapped error).
/// </summary>
public sealed class MappedDomainException : DomainException
{
    public MappedDomainException(string message, string errorCode, ErrorCategory category)
        : base(message, errorCode, category)
    {
    }
}
