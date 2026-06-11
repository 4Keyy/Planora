using Planora.Todo.Application.Services;

namespace Planora.Todo.Infrastructure.Services
{
    /// <summary>
    /// Resolves live user profiles from the Auth service via the existing
    /// <c>GetUserProfilesBatch</c> gRPC contract. Failure-tolerant by design: profile
    /// enrichment is cosmetic (subtask author labels), so any transport/parse failure
    /// degrades to an empty dictionary and the read path proceeds without names.
    /// </summary>
    public sealed class UserProfileGrpcService : IUserProfileService
    {
        private readonly AuthService.AuthServiceClient _client;
        private readonly ILogger<UserProfileGrpcService> _logger;

        public UserProfileGrpcService(
            AuthService.AuthServiceClient client,
            ILogger<UserProfileGrpcService> logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public async Task<IReadOnlyDictionary<Guid, UserProfileInfo>> GetProfilesAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default)
        {
            var ids = userIds.Where(id => id != Guid.Empty).Distinct().ToList();
            if (ids.Count == 0)
                return new Dictionary<Guid, UserProfileInfo>();

            try
            {
                var request = new GetUserProfilesBatchRequest();
                request.UserIds.AddRange(ids.Select(id => id.ToString()));

                var response = await _client.GetUserProfilesBatchAsync(
                    request, cancellationToken: cancellationToken);

                var result = new Dictionary<Guid, UserProfileInfo>(response.Profiles.Count);
                foreach (var (key, profile) in response.Profiles)
                {
                    if (Guid.TryParse(key, out var userId) && userId != Guid.Empty)
                    {
                        result[userId] = new UserProfileInfo(
                            profile.DisplayName,
                            string.IsNullOrEmpty(profile.AvatarUrl) ? null : profile.AvatarUrl);
                    }
                }

                return result;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC profile batch lookup failed for {Count} user(s); subtask author enrichment skipped",
                    ids.Count);
                return new Dictionary<Guid, UserProfileInfo>();
            }
        }
    }
}
