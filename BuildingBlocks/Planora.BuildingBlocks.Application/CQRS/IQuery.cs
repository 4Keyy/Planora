namespace Planora.BuildingBlocks.Application.CQRS;

public interface IQuery<out TResponse> : IRequest<TResponse>
{
}