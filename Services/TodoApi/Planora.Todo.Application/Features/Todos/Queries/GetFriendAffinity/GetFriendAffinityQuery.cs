using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetFriendAffinity
{
    public sealed record GetFriendAffinityQuery : IQuery<IReadOnlyList<FriendAffinityDto>>;
}
