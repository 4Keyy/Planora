using Planora.Auth.Application.Features.Users.Queries.GetUserAvatarsByIds;
using Planora.Auth.Domain.Repositories;
using Microsoft.Extensions.Logging;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUserAvatarsByIds
{
    public sealed class GetUserAvatarsByIdsQueryHandler
        : IRequestHandler<GetUserAvatarsByIdsQuery, Result<IReadOnlyDictionary<Guid, string>>>
    {
        private readonly IUserRepository _userRepository;
        private readonly ILogger<GetUserAvatarsByIdsQueryHandler> _logger;

        public GetUserAvatarsByIdsQueryHandler(
            IUserRepository userRepository,
            ILogger<GetUserAvatarsByIdsQueryHandler> logger)
        {
            _userRepository = userRepository;
            _logger = logger;
        }

        public async Task<Result<IReadOnlyDictionary<Guid, string>>> Handle(
            GetUserAvatarsByIdsQuery request,
            CancellationToken cancellationToken)
        {
            try
            {
                if (request.UserIds.Count == 0)
                    return Result.Success<IReadOnlyDictionary<Guid, string>>(
                        new Dictionary<Guid, string>());

                var users = await _userRepository.GetByIdsAsync(request.UserIds, cancellationToken);

                var result = users
                    .Where(u => !string.IsNullOrEmpty(u.ProfilePictureUrl))
                    .ToDictionary(u => u.Id, u => u.ProfilePictureUrl!);

                return Result.Success<IReadOnlyDictionary<Guid, string>>(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving avatars for {Count} users", request.UserIds.Count);
                return Result.Failure<IReadOnlyDictionary<Guid, string>>(
                    Error.InternalServer("GET_AVATARS_ERROR", "An error occurred while retrieving user avatars"));
            }
        }
    }
}
