namespace Planora.BuildingBlocks.Application.CQRS;

public interface ICommand : IRequest<Result>
{
}

public interface ICommand<out TResponse> : IRequest<TResponse>
{
}