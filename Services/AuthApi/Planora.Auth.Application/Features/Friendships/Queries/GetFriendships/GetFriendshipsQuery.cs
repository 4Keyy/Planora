namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendships;

public sealed record FriendshipInfoDto(Guid FriendId, DateTime? AcceptedAt);

public sealed record GetFriendshipsQuery(Guid UserId) : IQuery<Result<IReadOnlyList<FriendshipInfoDto>>>;
