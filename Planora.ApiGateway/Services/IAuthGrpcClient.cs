namespace Planora.ApiGateway.Services
{
    public interface IAuthGrpcClient
    {
        Task<bool> ValidateTokenAsync(string token, CancellationToken cancellationToken = default);
    }
}
