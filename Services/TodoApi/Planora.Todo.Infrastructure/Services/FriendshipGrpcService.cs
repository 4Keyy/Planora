using Grpc.Core;
using Planora.Todo.Application.Exceptions;
using Planora.Todo.Application.Services;
using Microsoft.Extensions.Logging;

namespace Planora.Todo.Infrastructure.Services
{
    public sealed class FriendshipGrpcService : IFriendshipService
    {
        private readonly AuthService.AuthServiceClient _client;
        private readonly ILogger<FriendshipGrpcService> _logger;

        public FriendshipGrpcService(
            AuthService.AuthServiceClient client,
            ILogger<FriendshipGrpcService> logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public async Task<IReadOnlyList<Guid>> GetFriendIdsAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            try
            {
                _logger.LogInformation("Getting friend IDs for user {UserId} via Auth gRPC", userId);

                var response = await _client.GetFriendIdsAsync(
                    new GetFriendIdsRequest { UserId = userId.ToString() },
                    cancellationToken: cancellationToken);

                var friendIds = response.FriendIds
                    .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
                    .Where(id => id != Guid.Empty)
                    .Distinct()
                    .ToList();

                _logger.LogInformation(
                    "Auth gRPC returned {Count} friends for user {UserId}",
                    friendIds.Count,
                    userId);

                return friendIds;
            }
            catch (RpcException ex) when (IsUnavailable(ex.StatusCode))
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC unavailable while getting friend IDs for user {UserId}: Status={Status}",
                    userId,
                    ex.StatusCode);
                throw new ExternalServiceUnavailableException("AuthApi", "GetFriendIds", ex);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC failed while getting friend IDs for user {UserId}",
                    userId);
                throw new ExternalServiceUnavailableException("AuthApi", "GetFriendIds", ex);
            }
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

                _logger.LogInformation(
                    "Auth gRPC friendship check for {UserId1} and {UserId2}: {AreFriends}",
                    userId1,
                    userId2,
                    response.AreFriends);

                return response.AreFriends;
            }
            catch (RpcException ex) when (IsUnavailable(ex.StatusCode))
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC unavailable while checking friendship between {UserId1} and {UserId2}: Status={Status}",
                    userId1,
                    userId2,
                    ex.StatusCode);
                throw new ExternalServiceUnavailableException("AuthApi", "AreFriends", ex);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Auth gRPC failed while checking friendship between {UserId1} and {UserId2}",
                    userId1,
                    userId2);
                throw new ExternalServiceUnavailableException("AuthApi", "AreFriends", ex);
            }
        }

        private static bool IsUnavailable(StatusCode statusCode) =>
            statusCode is StatusCode.Unavailable or StatusCode.DeadlineExceeded or StatusCode.Internal;
    }
}
