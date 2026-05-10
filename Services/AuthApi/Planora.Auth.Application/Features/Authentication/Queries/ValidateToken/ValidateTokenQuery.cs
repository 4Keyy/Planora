namespace Planora.Auth.Application.Features.Authentication.Queries.ValidateToken
{
    public sealed record ValidateTokenQuery : IQuery<Result<TokenValidationDto>>
    {
        public string Token { get; init; } = string.Empty;
    }
}
