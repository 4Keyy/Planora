using Grpc.Core;
using Planora.Auth.Application.Features.Authentication.Commands.Logout;
using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;
using Planora.Auth.Application.Features.Friendships.Queries.AreFriends;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.Auth.Application.Features.Users.Queries.GetUser;
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
            var query = new GetUserQuery(Guid.Parse(request.UserId));
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
                IsActive = true // Assuming active if found, or add field to DTO
            };
            // Roles might not be in UserDto, check if needed. Proto has it.
            // UserDto usually doesn't have roles unless explicitly loaded.
            // For now leaving roles empty or if UserDto has it.

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
            var query = new GetFriendIdsQuery(Guid.Parse(request.UserId));
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
            var query = new AreFriendsQuery(Guid.Parse(request.UserId1), Guid.Parse(request.UserId2));
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
