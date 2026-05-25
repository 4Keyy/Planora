using Planora.BuildingBlocks.Domain.Interfaces;
using MediatR;

namespace Planora.BuildingBlocks.Application.Messaging;

/// <summary>
/// MediatR notification wrapper for a domain event. Lives in the Application
/// layer alongside the rest of the messaging contracts so handlers can sit in
/// Application without depending on Infrastructure.
/// </summary>
public sealed class DomainEventNotification<TDomainEvent> : INotification
    where TDomainEvent : IDomainEvent
{
    public TDomainEvent DomainEvent { get; }

    public DomainEventNotification(TDomainEvent domainEvent)
    {
        DomainEvent = domainEvent;
    }
}
