using Planora.Auth.Application.Features.Users.Queries.GetUserProfilesByIds;
using Planora.Auth.Domain.Repositories;
using Microsoft.Extensions.Logging;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUserProfilesByIds
{
    public sealed class GetUserProfilesByIdsQueryHandler
        : IRequestHandler<GetUserProfilesByIdsQuery, Result<IReadOnlyDictionary<Guid, UserProfileSummaryDto>>>
    {
        private readonly IUserRepository _userRepository;
        private readonly ILogger<GetUserProfilesByIdsQueryHandler> _logger;

        public GetUserProfilesByIdsQueryHandler(
            IUserRepository userRepository,
            ILogger<GetUserProfilesByIdsQueryHandler> logger)
        {
            _userRepository = userRepository;
            _logger = logger;
        }

        public async Task<Result<IReadOnlyDictionary<Guid, UserProfileSummaryDto>>> Handle(
            GetUserProfilesByIdsQuery request,
            CancellationToken cancellationToken)
        {
            try
            {
                if (request.UserIds.Count == 0)
                    return Result.Success<IReadOnlyDictionary<Guid, UserProfileSummaryDto>>(
                        new Dictionary<Guid, UserProfileSummaryDto>());

                var users = await _userRepository.GetByIdsAsync(request.UserIds, cancellationToken);

                var result = users.ToDictionary(
                    u => u.Id,
                    u => new UserProfileSummaryDto(
                        u.FullName,
                        string.IsNullOrEmpty(u.ProfilePictureUrl) ? null : u.ProfilePictureUrl));

                return Result.Success<IReadOnlyDictionary<Guid, UserProfileSummaryDto>>(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving profiles for {Count} users", request.UserIds.Count);
                return Result.Failure<IReadOnlyDictionary<Guid, UserProfileSummaryDto>>(
                    Error.InternalServer("GET_PROFILES_ERROR", "An error occurred while retrieving user profiles"));
            }
        }
    }
}
