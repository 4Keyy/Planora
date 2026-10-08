namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendships;

public sealed class GetFriendshipsQueryHandler(IFriendshipRepository repository)
    : IRequestHandler<GetFriendshipsQuery, Result<IReadOnlyList<FriendshipInfoDto>>>
{
    public async Task<Result<IReadOnlyList<FriendshipInfoDto>>> Handle(
        GetFriendshipsQuery request, CancellationToken cancellationToken)
    {
        var friendships = await repository.GetFriendshipsForUserAsync(
            request.UserId, Domain.Enums.FriendshipStatus.Accepted, cancellationToken);
        IReadOnlyList<FriendshipInfoDto> result = friendships
            // Historical concurrent reciprocal requests can leave several accepted rows.
            // Preserve the earliest acceptance (or the explicit legacy-null convention).
            .GroupBy(f => f.RequesterId == request.UserId ? f.AddresseeId : f.RequesterId)
            .Select(group => new FriendshipInfoDto(group.Key,
                group.Any(f => f.AcceptedAt is null) ? null : group.Min(f => f.AcceptedAt)))
            .ToArray();
        return Result.Success(result);
    }
}
