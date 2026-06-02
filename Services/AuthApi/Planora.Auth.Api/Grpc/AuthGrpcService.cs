using Grpc.Core;
using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
using Planora.Auth.Application.Features.Friendships.Queries.AreFriends;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
using Planora.Auth.Application.Features.Users.Queries.GetUserAvatarsByIds;
using Planora.Auth.Application.Features.Users.Queries.GetUserProfilesByIds;
using Planora.GrpcContracts;
using MediatR;

namespace Planora.Auth.Api.Grpc
{
    public class AuthGrpcService : AuthService.AuthServiceBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<AuthGrpcService> _logger;

        public AuthGrpcService(IMediator mediator, ILogger<AuthGrpcService> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        public override async Task<ValidateTokenResponse> ValidateToken(ValidateTokenRequest request, ServerCallContext context)
        {
            var query = new ValidateTokenQuery { Token = request.Token };
            var result = await _mediator.Send(query);

            if (result.IsFailure || result.Value is null || !result.Value.IsValid)
            {
                return new ValidateTokenResponse
                {
                    IsValid = false,
                    ErrorMessage = result.Error?.Message
                        ?? result.Value?.Message
                        ?? "Validation failed"
                };
            }

            var validation = result.Value;
            var response = new ValidateTokenResponse
            {
                IsValid = true,
                UserId = validation.UserId?.ToString() ?? string.Empty,
                Email = validation.Email ?? string.Empty
            };
            response.Roles.AddRange(validation.Roles ?? Enumerable.Empty<string>());

            return response;
        }

        public override async Task<GetUserInfoResponse> GetUserInfo(GetUserInfoRequest request, ServerCallContext context)
        {
            if (!Guid.TryParse(request.UserId, out var userInfoId))
                throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.InvalidArgument, "Invalid user ID format"));

            var query = new GetUserQuery(userInfoId);
            var result = await _mediator.Send(query);

            if (result.IsFailure)
            {
                throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.NotFound, "User not found"));
            }

            var response = new GetUserInfoResponse
            {
                UserId = result.Value.Id.ToString(),
                Email = result.Value.Email,
                FirstName = result.Value.FirstName,
                LastName = result.Value.LastName,
                IsActive = true,
                ProfilePictureUrl = result.Value.ProfilePictureUrl ?? string.Empty,
            };

            return response;
        }

        public override async Task<GetUserAvatarsBatchResponse> GetUserAvatarsBatch(
            GetUserAvatarsBatchRequest request, ServerCallContext context)
        {
            var userIds = request.UserIds
                .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
                .Where(id => id != Guid.Empty)
                .ToList();

            if (userIds.Count == 0)
                return new GetUserAvatarsBatchResponse();

            var query = new GetUserAvatarsByIdsQuery(userIds);
            var result = await _mediator.Send(query);

            var response = new GetUserAvatarsBatchResponse();
            if (result.IsSuccess)
            {
                foreach (var kvp in result.Value)
                {
                    response.AvatarUrls[kvp.Key.ToString()] = kvp.Value;
                }
            }

            return response;
        }

        public override async Task<GetUserProfilesBatchResponse> GetUserProfilesBatch(
            GetUserProfilesBatchRequest request, ServerCallContext context)
        {
            var userIds = request.UserIds
                .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
                .Where(id => id != Guid.Empty)
                .ToList();

            var response = new GetUserProfilesBatchResponse();
            if (userIds.Count == 0)
                return response;

            var result = await _mediator.Send(new GetUserProfilesByIdsQuery(userIds));
            if (result.IsSuccess)
            {
                foreach (var kvp in result.Value)
                {
                    response.Profiles[kvp.Key.ToString()] = new UserProfileSummary
                    {
                        DisplayName = kvp.Value.DisplayName ?? string.Empty,
                        AvatarUrl = kvp.Value.AvatarUrl ?? string.Empty,
                    };
                }
            }

            return response;
        }

        public override async Task<RevokeTokenResponse> RevokeToken(RevokeTokenRequest request, ServerCallContext context)
        {
            var command = new LogoutCommand { RefreshToken = request.Token };
            var result = await _mediator.Send(command);

            return new RevokeTokenResponse
            {
                Success = result.IsSuccess,
                Message = result.IsSuccess ? "Token revoked" : result.Error?.Message ?? "Failed to revoke token"
            };
        }

        public override async Task<GetFriendIdsResponse> GetFriendIds(GetFriendIdsRequest request, ServerCallContext context)
        {
            if (!Guid.TryParse(request.UserId, out var friendIdsUserId))
                throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.InvalidArgument, "Invalid user ID format"));

            var query = new GetFriendIdsQuery(friendIdsUserId);
            var result = await _mediator.Send(query);

            if (result.IsFailure)
            {
                throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Failed to get friends"));
            }

            var response = new GetFriendIdsResponse();
            response.FriendIds.AddRange(result.Value.Select(id => id.ToString()));

            return response;
        }

        public override async Task<AreFriendsResponse> AreFriends(AreFriendsRequest request, ServerCallContext context)
        {
            if (!Guid.TryParse(request.UserId1, out var areFriendsId1) ||
                !Guid.TryParse(request.UserId2, out var areFriendsId2))
                throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.InvalidArgument, "Invalid user ID format"));

            var query = new AreFriendsQuery(areFriendsId1, areFriendsId2);
            var result = await _mediator.Send(query);

            if (result.IsFailure)
            {
                throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Failed to check friendship"));
            }

            return new AreFriendsResponse
            {
                AreFriends = result.Value
            };
        }
    }
}
