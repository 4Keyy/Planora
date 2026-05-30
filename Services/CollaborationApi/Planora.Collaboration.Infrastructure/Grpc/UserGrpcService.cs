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

        public async Task<IReadOnlyDictionary<Guid, string>> GetUserAvatarsAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default)
        {
            var ids = userIds.Distinct().ToList();
            if (ids.Count == 0)
                return new Dictionary<Guid, string>();

            try
            {
                var request = new GetUserAvatarsBatchRequest();
                request.UserIds.AddRange(ids.Select(id => id.ToString()));

                var response = await _client.GetUserAvatarsBatchAsync(
                    request,
                    cancellationToken: cancellationToken);

                var result = new Dictionary<Guid, string>();
                foreach (var kvp in response.AvatarUrls)
                {
                    if (Guid.TryParse(kvp.Key, out var guid) && !string.IsNullOrEmpty(kvp.Value))
                        result[guid] = kvp.Value;
                }

                return result;
            }
            catch (RpcException ex)
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC unavailable while fetching avatars for {Count} users: Status={Status}",
                    ids.Count,
                    ex.StatusCode);
                // Non-fatal — comment thread still loads, just without live avatars
                return new Dictionary<Guid, string>();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch user avatars from Auth gRPC");
                return new Dictionary<Guid, string>();
            }
        }
    }
}
