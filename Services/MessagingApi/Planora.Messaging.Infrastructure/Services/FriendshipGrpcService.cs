using Grpc.Core;
using Planora.GrpcContracts;
using Planora.Messaging.Application.Services;

namespace Planora.Messaging.Infrastructure.Services
{
    public sealed class FriendshipGrpcService : IFriendshipService
    {
        private readonly AuthService.AuthServiceClient _client;
        private readonly ILogger<FriendshipGrpcService> _logger;

        public FriendshipGrpcService(
            AuthService.AuthServiceClient client,
            ILogger<FriendshipGrpcService> logger)
        {
            _client = client;
            _logger = logger;
        }

        public async Task<bool> AreFriendsAsync(
            Guid userId1,
            Guid userId2,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var response = await _client.AreFriendsAsync(
                    new AreFriendsRequest
                    {
                        UserId1 = userId1.ToString(),
                        UserId2 = userId2.ToString()
                    },
                    cancellationToken: cancellationToken);

                return response.AreFriends;
            }
            catch (RpcException ex) when (
                ex.StatusCode is StatusCode.InvalidArgument or StatusCode.NotFound)
            {
                _logger.LogWarning(
                    ex,
                    "Auth rejected friendship check between {UserId1} and {UserId2}",
                    userId1,
                    userId2);

                return false;
            }
            catch (RpcException ex)
            {
                _logger.LogError(
                    ex,
                    "Auth friendship check failed between {UserId1} and {UserId2}",
                    userId1,
                    userId2);

                throw new HttpRequestException("Unable to verify friendship with Auth service.", ex);
            }
        }
    }
}
