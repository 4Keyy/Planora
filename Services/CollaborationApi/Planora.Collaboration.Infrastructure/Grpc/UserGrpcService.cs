using Grpc.Core;
using Planora.Collaboration.Application.Services;
using Planora.GrpcContracts;

namespace Planora.Collaboration.Infrastructure.Grpc
{
    public sealed class UserGrpcService : IUserService
    {
        private readonly AuthService.AuthServiceClient _client;
        private readonly ILogger<UserGrpcService> _logger;

        public UserGrpcService(
            AuthService.AuthServiceClient client,
            ILogger<UserGrpcService> logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public async Task<IReadOnlyDictionary<Guid, UserProfile>> GetUserProfilesAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default)
        {
            var ids = userIds.Distinct().ToList();
            if (ids.Count == 0)
                return new Dictionary<Guid, UserProfile>();

            try
            {
                var request = new GetUserProfilesBatchRequest();
                request.UserIds.AddRange(ids.Select(id => id.ToString()));

                var response = await _client.GetUserProfilesBatchAsync(
                    request,
                    cancellationToken: cancellationToken);

                var result = new Dictionary<Guid, UserProfile>();
                foreach (var kvp in response.Profiles)
                {
                    if (Guid.TryParse(kvp.Key, out var guid))
                    {
                        result[guid] = new UserProfile(
                            kvp.Value.DisplayName ?? string.Empty,
                            string.IsNullOrEmpty(kvp.Value.AvatarUrl) ? null : kvp.Value.AvatarUrl);
                    }
                }

                return result;
            }
            catch (RpcException ex)
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC unavailable while fetching profiles for {Count} users: Status={Status}",
                    ids.Count,
                    ex.StatusCode);
                // Non-fatal — comment thread still loads, callers fall back to stored data
                return new Dictionary<Guid, UserProfile>();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch user profiles from Auth gRPC");
                return new Dictionary<Guid, UserProfile>();
            }
        }
    }
}
